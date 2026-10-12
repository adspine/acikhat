import { Hono } from "hono";
import type { Deps } from "../deps.ts";
import { type PanelEnv, requirePermission } from "./session.ts";
import { toAppointment, type AppointmentRow } from "../../store/db.ts";
import type { Tenant } from "../../domain/tenant.ts";
import { spokenDate } from "../../domain/time.ts";
import { appointmentView, terms } from "./views.ts";
import { callView, missedView } from "./calls.ts";
import { daySchedule } from "./appointments.ts";

const dayRange = (tenant: Tenant, from: Temporal.PlainDate, to: Temporal.PlainDate) => ({
  fromMs: from.toZonedDateTime(tenant.timezone).epochMilliseconds,
  toMs: to.add({ days: 1 }).toZonedDateTime(tenant.timezone).epochMilliseconds,
});

export function overviewRoutes(deps: Deps) {
  const app = new Hono<PanelEnv>();
  const db = deps.store.db;

  /** Ana ekran: bugünün randevuları, bekleyen işler, son çağrılar, asistan durumu */
  app.get("/today", (c) => {
    const tenant = c.get("tenant");
    const perms = c.get("permissions");
    const now = deps.now().withTimeZone(tenant.timezone);
    const today = now.toPlainDate();
    const { fromMs, toMs } = dayRange(tenant, today, today);
    const nowMs = now.epochMilliseconds;

    const appointments = perms.has("appointments.view")
      ? (db
          .prepare("SELECT * FROM appointments WHERE tenant_id = ? AND status = 'confirmed' AND start_ms >= ? AND start_ms < ? ORDER BY start_ms")
          .all(tenant.id, fromMs, toMs) as unknown as AppointmentRow[]).map((r) => appointmentView(tenant, toAppointment(r), db))
      : [];

    const { open: spaHours, staff } = daySchedule(tenant, today);

    const count = (sql: string, ...args: (string | number)[]) => (db.prepare(sql).get(...args) as { n: number }).n;
    const openCallbacks = count("SELECT COUNT(*) n FROM callback_requests WHERE tenant_id = ? AND status = 'open'", tenant.id);
    const missedToday = count("SELECT COUNT(*) n FROM call_log WHERE tenant_id = ? AND status = 'missed' AND started_at >= ? AND started_at < ?", tenant.id, fromMs, toMs);
    const callsToday = count("SELECT COUNT(*) n FROM calls WHERE tenant_id = ? AND started_at >= ? AND started_at < ?", tenant.id, fromMs, toMs);
    const bookedToday = count(
      "SELECT COUNT(*) n FROM appointments WHERE tenant_id = ? AND source = 'assistant' AND created_at >= ? AND created_at < ?",
      tenant.id, fromMs, toMs,
    );

    const recent = perms.has("calls.view")
      ? [
          ...(db
            .prepare(
              `SELECT conversation_id, started_at, duration_secs, outcome, summary, caller_phone, after_hours, appointment_id
               FROM calls WHERE tenant_id = ? ORDER BY started_at DESC LIMIT 6`,
            )
            .all(tenant.id) as never[]).map((r) => callView(tenant, r, nowMs)),
          ...(db
            .prepare("SELECT call_sid, started_at, caller_phone, result FROM call_log WHERE tenant_id = ? AND status = 'missed' ORDER BY started_at DESC LIMIT 6")
            .all(tenant.id) as never[]).map((r) => missedView(tenant, r, nowMs)),
        ]
          .sort((a, b) => b.at - a.at)
          .slice(0, 6)
      : [];

    // Uyarılar: bir şey ters gidiyorsa Bugün ekranının en üstünde gösterilir
    const alerts: { level: "warning" | "error"; text: string }[] = [];
    const unsynced = count(
      "SELECT COUNT(*) n FROM appointments WHERE tenant_id = ? AND status = 'confirmed' AND calendar_event_id IS NULL AND start_ms > ?",
      tenant.id, nowMs,
    );
    if (tenant.calendar.provider === "google" && unsynced > 0) {
      alerts.push({ level: "warning", text: `${unsynced} randevu henüz Google Takvim'e yazılamadı. Sistem dakikada bir yeniden deniyor.` });
    }
    if (!tenant.agentIds.length) alerts.push({ level: "error", text: "Asistan henüz kurulmadı. Kurulum ekibimiz sizinle iletişime geçecek." });
    else if (!tenant.phoneNumbers.length) alerts.push({ level: "warning", text: "Telefon hattı henüz bağlanmadı; asistan şu an yalnızca test görüşmelerine cevap veriyor." });

    return c.json({
      date: today.toString(),
      dateText: spokenDate(today),
      nowTime: `${String(now.hour).padStart(2, "0")}:${String(now.minute).padStart(2, "0")}`,
      open: spaHours.length > 0,
      hours: spaHours,
      staff,
      appointments,
      counts: { openCallbacks, missedToday, callsToday, bookedToday, appointmentsToday: appointments.length },
      recent,
      alerts,
    });
  });

  /** Dönem raporu */
  app.get("/reports", requirePermission("reports.view"), (c) => {
    const tenant = c.get("tenant");
    const today = deps.now().withTimeZone(tenant.timezone).toPlainDate();
    const from = Temporal.PlainDate.from(c.req.query("from") ?? today.with({ day: 1 }).toString());
    const to = Temporal.PlainDate.from(c.req.query("to") ?? today.toString());
    if (Temporal.PlainDate.compare(to, from) < 0 || from.until(to).days > 366) return c.json({ error: "Tarih aralığı geçersiz" }, 400);
    const { fromMs, toMs } = dayRange(tenant, from, to);

    const calls = db
      .prepare("SELECT started_at, duration_secs, outcome, after_hours, appointment_id FROM calls WHERE tenant_id = ? AND started_at >= ? AND started_at < ?")
      .all(tenant.id, fromMs, toMs) as { started_at: number; duration_secs: number | null; outcome: string | null; after_hours: number | null; appointment_id: string | null }[];
    const missed = db
      .prepare("SELECT started_at FROM call_log WHERE tenant_id = ? AND status = 'missed' AND started_at >= ? AND started_at < ?")
      .all(tenant.id, fromMs, toMs) as { started_at: number }[];
    const appts = db
      .prepare("SELECT service_id, source, status, created_at FROM appointments WHERE tenant_id = ? AND created_at >= ? AND created_at < ?")
      .all(tenant.id, fromMs, toMs) as { service_id: string; source: string; status: string; created_at: number }[];

    const price = (serviceId: string) => tenant.services.find((s) => s.id === serviceId)?.priceTRY ?? 0;
    const assistantBookings = appts.filter((a) => a.source === "assistant");
    const keptAssistant = assistantBookings.filter((a) => a.status === "confirmed");
    // Mesai dışı yakalanan randevu: asistanın mesai dışındaki bir görüşmede aldığı randevular
    const afterHoursIds = new Set(calls.filter((c) => c.outcome === "booked" && c.after_hours === 1 && c.appointment_id).map((c) => c.appointment_id!));
    const afterHoursAppts = (db.prepare(
      `SELECT id, service_id, status FROM appointments WHERE tenant_id = ? AND id IN (${[...afterHoursIds].map(() => "?").join(",") || "''"})`,
    ).all(tenant.id, ...afterHoursIds) as { id: string; service_id: string; status: string }[]).filter((a) => a.status === "confirmed");

    const minutes = calls.reduce((s, c) => s + (c.duration_secs ?? 0), 0) / 60;
    const byOutcome = { booked: 0, callback: 0, transferred: 0, info: 0 } as Record<string, number>;
    for (const c of calls) byOutcome[c.outcome ?? "info"] = (byOutcome[c.outcome ?? "info"] ?? 0) + 1;

    // Günlük seri
    const days: { date: string; label: string; calls: number; booked: number; missed: number }[] = [];
    for (let d = from; Temporal.PlainDate.compare(d, to) <= 0; d = d.add({ days: 1 })) {
      const r = dayRange(tenant, d, d);
      const inDay = (ms: number) => ms >= r.fromMs && ms < r.toMs;
      days.push({
        date: d.toString(),
        label: `${d.day}.${String(d.month).padStart(2, "0")}`,
        calls: calls.filter((c) => inDay(c.started_at)).length,
        booked: calls.filter((c) => c.outcome === "booked" && inDay(c.started_at)).length,
        missed: missed.filter((m) => inDay(m.started_at)).length,
      });
    }
    // Saat bazında çağrı yoğunluğu (firma saatine göre)
    const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, calls: 0 }));
    for (const c of calls) byHour[Temporal.Instant.fromEpochMilliseconds(c.started_at).toZonedDateTimeISO(tenant.timezone).hour]!.calls++;

    const totalIncoming = calls.length + missed.length;
    return c.json({
      from: from.toString(),
      to: to.toString(),
      fromText: spokenDate(from),
      toText: spokenDate(to),
      totals: {
        incoming: totalIncoming,
        answered: calls.length,
        missed: missed.length,
        missedRate: totalIncoming ? missed.length / totalIncoming : 0,
        assistantBookings: assistantBookings.length,
        assistantBookingsCancelled: assistantBookings.length - keptAssistant.length,
        panelBookings: appts.filter((a) => a.source === "panel").length,
        assistantRevenue: keptAssistant.reduce((s, a) => s + price(a.service_id), 0),
        afterHoursBookings: afterHoursAppts.length,
        afterHoursRevenue: afterHoursAppts.reduce((s, a) => s + price(a.service_id), 0),
        conversionRate: calls.length ? byOutcome.booked! / calls.length : 0,
        avgDurationSecs: calls.length ? Math.round((minutes * 60) / calls.length) : 0,
        minutesUsed: Math.round(minutes),
        includedMinutes: tenant.plan.includedMinutes ?? null,
      },
      byOutcome,
      days,
      byHour,
      terms: terms(tenant),
    });
  });

  return app;
}
