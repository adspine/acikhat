import { Hono } from "hono";
import type { Deps } from "../deps.ts";
import { type PanelEnv, requirePermission } from "./session.ts";
import { toAppointment, type AppointmentRow } from "../../store/db.ts";
import type { Tenant } from "../../domain/tenant.ts";
import { spokenDate } from "../../domain/time.ts";
import { appointmentView, terms } from "./views.ts";
import { callView, missedView } from "./calls.ts";
import { daySchedule } from "./appointments.ts";
import { PLANS } from "../../domain/plans.ts";
import { ADDON_PACKS, periodKey, planChange, upgradeCharge } from "../../domain/billing.ts";
import { addonMinutes, applyScheduledPlans } from "./billing.ts";

/** Paket dakikası bitince her ek dakika (USD, KDV dahil) */
export const OVERAGE_USD_PER_MINUTE = 0.3;

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
    const alerts: { level: "info" | "warning" | "error"; text: string }[] = [];
    const unsynced = count(
      "SELECT COUNT(*) n FROM appointments WHERE tenant_id = ? AND status = 'confirmed' AND calendar_event_id IS NULL AND start_ms > ?",
      tenant.id, nowMs,
    );
    if (tenant.calendar.provider === "google" && unsynced > 0) {
      alerts.push({ level: "warning", text: `${unsynced} randevu henüz Google Takvim'e yazılamadı. Sistem dakikada bir yeniden deniyor.` });
    }
    if (!tenant.agentIds.length) alerts.push({ level: "info", text: "Asistanınız hazırlanıyor. Kurulum ekibimiz telefon hattını ve son ayarları tamamlayınca size haber vereceğiz; bu sürede panelden bilgilerinizi gözden geçirebilirsiniz." });
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

  /** Paketim: bu ayın dakika kullanımı, kalan, ay sonu tahmini ve olası aşım */
  app.get("/usage", (c) => {
    applyScheduledPlans(deps);
    const tenant = deps.tenants.get(c.get("tenant").id) ?? c.get("tenant");
    const now = deps.now().withTimeZone(tenant.timezone);
    const today = now.toPlainDate();
    const first = today.with({ day: 1 });
    const { fromMs, toMs } = dayRange(tenant, first, today);
    const calls = db.prepare("SELECT started_at, duration_secs FROM calls WHERE tenant_id = ? AND started_at >= ? AND started_at < ?").all(tenant.id, fromMs, toMs) as {
      started_at: number;
      duration_secs: number | null;
    }[];
    const perDay = Array.from({ length: today.day }, (_, i) => {
      const d = first.add({ days: i });
      const r = dayRange(tenant, d, d);
      const secs = calls.filter((x) => x.started_at >= r.fromMs && x.started_at < r.toMs).reduce((s, x) => s + (x.duration_secs ?? 0), 0);
      return { date: d.toString(), label: String(d.day), minutes: Math.round((secs / 60) * 10) / 10 };
    });
    const used = Math.round(calls.reduce((s, x) => s + (x.duration_secs ?? 0), 0) / 60);
    const planMinutes = tenant.plan.includedMinutes ?? null;
    const addon = addonMinutes(deps, tenant.id, periodKey(now));
    // Kota: paket dakikası + bu dönem satın alınan ek dakikalar
    const included = planMinutes === null && !addon ? null : (planMinutes ?? 0) + addon;
    const projected = Math.round((used / today.day) * today.daysInMonth);
    const over = included ? Math.max(0, used - included) : 0;
    const projectedOver = included ? Math.max(0, projected - included) : 0;
    return c.json({
      plan: tenant.plan.id ? { id: tenant.plan.id, name: PLANS[tenant.plan.id].name, priceUsd: PLANS[tenant.plan.id].priceUsd } : null,
      includedMinutes: included,
      planMinutes,
      addonMinutes: addon,
      usedMinutes: used,
      remainingMinutes: included ? Math.max(0, included - used) : null,
      projectedMinutes: projected,
      overageMinutes: over,
      overageUsd: Math.round(over * OVERAGE_USD_PER_MINUTE * 100) / 100,
      projectedOverageUsd: Math.round(projectedOver * OVERAGE_USD_PER_MINUTE * 100) / 100,
      overagePerMinuteUsd: OVERAGE_USD_PER_MINUTE,
      periodText: `${spokenDate(first)} – ${spokenDate(today)}`,
      daysLeft: today.daysInMonth - today.day,
      perDay,
      suspended: tenant.suspended,
      testMode: !!deps.paymentTestMode,
      renewsText: spokenDate(first.add({ months: 1 })),
      pending: tenant.plan.pending ? { plan: tenant.plan.pending.id, name: PLANS[tenant.plan.pending.id].name, effectiveText: spokenDate(first.add({ months: 1 })) } : null,
      packs: ADDON_PACKS,
      plans: Object.values(PLANS).map((p) => {
        const relation = planChange(tenant.plan.id, p.id);
        return { id: p.id, name: p.name, priceUsd: p.priceUsd, minutes: p.minutes, relation, chargeUsd: relation === "upgrade" ? upgradeCharge(tenant.plan.id, p.id, { day: today.day, daysInMonth: today.daysInMonth }) : 0 };
      }),
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

    // Haftanın günlerine göre çağrılar (1 = Pazartesi)
    const byWeekday = Array.from({ length: 7 }, (_, i) => ({ day: i + 1, calls: 0 }));
    for (const x of calls) byWeekday[Temporal.Instant.fromEpochMilliseconds(x.started_at).toZonedDateTimeISO(tenant.timezone).dayOfWeek - 1]!.calls++;

    // En çok randevu alınan hizmetler (iptal edilmeyenler)
    const serviceCount = new Map<string, number>();
    for (const a of appts) if (a.status !== "cancelled") serviceCount.set(a.service_id, (serviceCount.get(a.service_id) ?? 0) + 1);
    const topServices = [...serviceCount.entries()]
      .map(([id, count]) => ({ name: tenant.services.find((s) => s.id === id)?.name ?? id, count, revenue: count * price(id) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    // Arayanlar: yeni ve tekrar arayan (önceki dönemlerde ya da bu dönemde birden çok kez aramış)
    const phoneRows = db.prepare("SELECT caller_phone FROM calls WHERE tenant_id = ? AND started_at >= ? AND started_at < ? AND caller_phone IS NOT NULL").all(tenant.id, fromMs, toMs) as { caller_phone: string }[];
    const inPeriod = new Map<string, number>();
    for (const r of phoneRows) inPeriod.set(r.caller_phone, (inPeriod.get(r.caller_phone) ?? 0) + 1);
    const earlier = new Set((db.prepare("SELECT DISTINCT caller_phone FROM calls WHERE tenant_id = ? AND started_at < ? AND caller_phone IS NOT NULL").all(tenant.id, fromMs) as { caller_phone: string }[]).map((r) => r.caller_phone));
    const returning = [...inPeriod.entries()].filter(([phone, n]) => n > 1 || earlier.has(phone)).length;
    const callers = { unique: inPeriod.size, returning, fresh: inPeriod.size - returning };

    // Kaçan çağrıların nedeni
    const reasonLabels: Record<string, string> = { busy: "Hat meşguldü", no_answer: "Cevap verilemedi", timeout: "Bekleme süresi doldu", failed: "Bağlantı kurulamadı" };
    const reasonRows = db.prepare("SELECT COALESCE(result, 'diger') AS result, COUNT(*) AS n FROM call_log WHERE tenant_id = ? AND status = 'missed' AND started_at >= ? AND started_at < ? GROUP BY result ORDER BY n DESC").all(tenant.id, fromMs, toMs) as { result: string; n: number }[];
    const missedReasons = reasonRows.map((r) => ({ label: reasonLabels[r.result] ?? "Diğer", count: r.n }));
    const afterHoursCalls = calls.filter((x) => x.after_hours === 1).length;

    // Önceki dönem (aynı uzunlukta): rakamların yanında "geçen döneme göre" farkı gösterilir
    const len = from.until(to).days + 1;
    const prevTo = from.subtract({ days: 1 });
    const prevFrom = from.subtract({ days: len });
    const pr = dayRange(tenant, prevFrom, prevTo);
    const pCalls = db.prepare("SELECT duration_secs, outcome FROM calls WHERE tenant_id = ? AND started_at >= ? AND started_at < ?").all(tenant.id, pr.fromMs, pr.toMs) as { duration_secs: number | null; outcome: string | null }[];
    const pMissed = (db.prepare("SELECT COUNT(*) AS n FROM call_log WHERE tenant_id = ? AND status = 'missed' AND started_at >= ? AND started_at < ?").get(tenant.id, pr.fromMs, pr.toMs) as { n: number }).n;
    const pBooked = pCalls.filter((x) => x.outcome === "booked").length;
    const pSecs = pCalls.reduce((s, x) => s + (x.duration_secs ?? 0), 0);
    const previous = {
      incoming: pCalls.length + pMissed,
      answered: pCalls.length,
      missed: pMissed,
      booked: pBooked,
      conversionRate: pCalls.length ? pBooked / pCalls.length : 0,
      avgDurationSecs: pCalls.length ? Math.round(pSecs / pCalls.length) : 0,
      minutesUsed: Math.round(pSecs / 60),
    };
    return c.json({
      previous,
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
        includedMinutes: tenant.plan.includedMinutes === undefined ? null : tenant.plan.includedMinutes + addonMinutes(deps, tenant.id, periodKey(to)),
      },
      byOutcome,
      days,
      byHour,
      byWeekday,
      topServices,
      callers,
      missedReasons,
      afterHoursCalls,
      terms: terms(tenant),
    });
  });

  return app;
}
