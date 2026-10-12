import { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "../deps.ts";
import { type PanelEnv, requirePermission } from "./session.ts";
import { toAppointment, type AppointmentRow } from "../../store/db.ts";
import { candidateSlots } from "../../domain/slots.ts";
import { appointmentView, hhmm, localIso, zdt } from "./views.ts";
import { spokenDate, spokenDateTime } from "../../domain/time.ts";
import type { Tenant, WeekHours } from "../../domain/tenant.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const NewAppointment = z.object({
  serviceId: z.string(),
  date: isoDate,
  time,
  staffId: z.string().optional(),
  customerName: z.string().trim().min(2, "Müşterinin adını yazın"),
  customerPhone: z.string().trim().min(7, "Telefon numarasını yazın"),
  note: z.string().trim().max(500).optional(),
  notify: z.boolean().default(true),
});

/** Bir gün için işletme saatleri ve personelin çalışıp çalışmadığı */
export function daySchedule(tenant: Tenant, day: Temporal.PlainDate) {
  const key = String(day.dayOfWeek) as keyof WeekHours;
  const closed = tenant.closedDates.includes(day.toString());
  return {
    open: closed ? [] : tenant.hours[key],
    staff: tenant.staff.map((s) => {
      const hours = closed ? [] : (s.hours ?? tenant.hours)[key];
      return { id: s.id, name: s.name, working: hours.length > 0, hours };
    }),
  };
}

export function appointmentRoutes(deps: Deps) {
  const app = new Hono<PanelEnv>();
  const db = deps.store.db;

  /** Tarih aralığındaki randevular (gün/hafta görünümü) */
  app.get("/appointments", requirePermission("appointments.view"), (c) => {
    const tenant = c.get("tenant");
    const today = deps.now().withTimeZone(tenant.timezone).toPlainDate();
    const from = Temporal.PlainDate.from(c.req.query("from") ?? today.toString());
    const to = Temporal.PlainDate.from(c.req.query("to") ?? from.toString());
    if (Temporal.PlainDate.compare(to, from) < 0 || from.until(to).days > 62) return c.json({ error: "Tarih aralığı geçersiz" }, 400);
    const includeCancelled = c.req.query("cancelled") === "1";
    const rows = db
      .prepare(
        `SELECT * FROM appointments WHERE tenant_id = ? AND start_ms >= ? AND start_ms < ?
         ${includeCancelled ? "" : "AND status = 'confirmed'"} ORDER BY start_ms`,
      )
      .all(tenant.id, from.toZonedDateTime(tenant.timezone).epochMilliseconds, to.add({ days: 1 }).toZonedDateTime(tenant.timezone).epochMilliseconds) as unknown as AppointmentRow[];
    return c.json({
      from: from.toString(),
      to: to.toString(),
      appointments: rows.map((r) => appointmentView(tenant, toAppointment(r), db)),
      // Tek gün istendiyse o günün çalışma düzeni (gün görünümündeki sütunlar için)
      ...(from.equals(to) && { day: daySchedule(tenant, from) }),
    });
  });

  app.get("/appointments/:id", requirePermission("appointments.view"), (c) => {
    const tenant = c.get("tenant");
    const a = deps.store.getAppointment(tenant.id, c.req.param("id"));
    if (!a) return c.json({ error: "Randevu bulunamadı" }, 404);
    const history = deps.store.auditFor(tenant.id, { target: a.id }).map((h) => ({
      action: h.action, at: h.at, user: h.user_name, detail: h.detail_json ? JSON.parse(h.detail_json) : null,
    }));
    return c.json({ ...appointmentView(tenant, a, db), history });
  });

  /**
   * Elle randevu için o günün boş saatleri. Aynı saatte birden fazla personel boşsa tek satırda
   * listelenir; personel seçilmezse sistem boş olanı atar.
   */
  app.get("/availability", requirePermission("appointments.edit"), async (c) => {
    const tenant = c.get("tenant");
    const service = tenant.services.find((s) => s.id === c.req.query("serviceId"));
    const date = isoDate.safeParse(c.req.query("date"));
    if (!service || !date.success) return c.json({ error: "Hizmet ve tarih seçin" }, 400);
    const day = Temporal.PlainDate.from(date.data);
    const dayMs = (d: Temporal.PlainDate) => d.toZonedDateTime(tenant.timezone).epochMilliseconds;
    const busy = await deps.calendars.busy(tenant, dayMs(day), dayMs(day.add({ days: 1 })));
    const slots = candidateSlots(
      { ...tenant, minLeadMinutes: 0 },
      { service, now: deps.now().withTimeZone(tenant.timezone), dateFrom: day, dateTo: day, staffId: c.req.query("staffId") || undefined },
      busy,
    );
    const byTime = new Map<string, { time: string; staff: { id: string; name: string }[] }>();
    for (const s of slots.sort((a, b) => a.start.epochMilliseconds - b.start.epochMilliseconds)) {
      const t = hhmm(s.start);
      const entry = byTime.get(t) ?? byTime.set(t, { time: t, staff: [] }).get(t)!;
      if (!entry.staff.some((x) => x.id === s.staffId)) entry.staff.push({ id: s.staffId, name: tenant.staff.find((p) => p.id === s.staffId)?.name ?? s.staffId });
    }
    return c.json({ date: day.toString(), dateText: spokenDate(day), service: { id: service.id, name: service.name, durationMin: service.durationMin, staffCount: service.staffCount }, times: [...byTime.values()] });
  });

  app.post("/appointments", requirePermission("appointments.edit"), async (c) => {
    const tenant = c.get("tenant");
    const user = c.get("user");
    const parsed = NewAppointment.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Eksik bilgi" }, 400);
    const p = parsed.data;
    const start = Temporal.PlainDate.from(p.date).toZonedDateTime({ timeZone: tenant.timezone, plainTime: Temporal.PlainTime.from(p.time) });
    const out = await deps.booking.book(tenant, {
      serviceId: p.serviceId, startMs: start.epochMilliseconds, staffId: p.staffId || undefined,
      customerName: p.customerName, customerPhone: p.customerPhone, source: "panel", note: p.note || undefined, notify: p.notify,
    });
    if (!out.ok) {
      const messages: Record<string, string> = {
        unknown_service: "Hizmet bulunamadı",
        invalid_phone: "Telefon numarası geçersiz",
        slot_expired: "Bu saat geçmiş",
        calendar_unavailable: "Takvime şu an ulaşılamıyor; birkaç dakika sonra tekrar deneyin",
        slot_taken: "Bu saat dolu",
      };
      return c.json(
        {
          error: messages[out.reason] ?? "Randevu oluşturulamadı",
          reason: out.reason,
          alternatives:
            out.reason === "slot_taken"
              ? out.alternatives.map((s) => ({ date: s.start.toPlainDate().toString(), time: hhmm(s.start), text: spokenDateTime(s.start), start: localIso(s.start) }))
              : undefined,
        },
        409,
      );
    }
    deps.store.audit({ tenantId: tenant.id, userId: user.id, action: "appointment.create", target: out.id, detail: { service: out.service.name, when: out.when, customer: p.customerName } });
    return c.json(appointmentView(tenant, deps.store.getAppointment(tenant.id, out.id)!, db), 201);
  });

  app.post("/appointments/:id/cancel", requirePermission("appointments.edit"), async (c) => {
    const tenant = c.get("tenant");
    const user = c.get("user");
    const body = z.object({ notify: z.boolean().default(false) }).safeParse(await c.req.json().catch(() => ({})));
    const id = c.req.param("id");
    const before = deps.store.getAppointment(tenant.id, id);
    const res = await deps.booking.cancel(tenant, id, user.id, { notify: body.success ? body.data.notify : false });
    if (res === "not_found") return c.json({ error: "Randevu bulunamadı" }, 404);
    if (res === "already_cancelled") return c.json({ error: "Randevu zaten iptal edilmiş" }, 409);
    deps.store.audit({
      tenantId: tenant.id, userId: user.id, action: "appointment.cancel", target: id,
      detail: { customer: before?.customerName, when: before ? spokenDateTime(zdt(tenant, before.startMs)) : null },
    });
    return c.json(appointmentView(tenant, deps.store.getAppointment(tenant.id, id)!, db));
  });

  app.patch("/appointments/:id", requirePermission("appointments.edit"), async (c) => {
    const tenant = c.get("tenant");
    const body = z.object({ note: z.string().trim().max(500) }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Not en fazla 500 karakter olabilir" }, 400);
    const id = c.req.param("id");
    const res = db.prepare("UPDATE appointments SET note = ? WHERE tenant_id = ? AND id = ?").run(body.data.note || null, tenant.id, id);
    if (!res.changes) return c.json({ error: "Randevu bulunamadı" }, 404);
    deps.store.audit({ tenantId: tenant.id, userId: c.get("user").id, action: "appointment.note", target: id });
    return c.json(appointmentView(tenant, deps.store.getAppointment(tenant.id, id)!, db));
  });

  return app;
}
