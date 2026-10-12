import type { DatabaseSync } from "node:sqlite";
import type { Tenant } from "../../domain/tenant.ts";
import type { Appointment } from "../../store/db.ts";
import { loadVertical } from "../../domain/vertical.ts";
import { spokenDate } from "../../domain/time.ts";
import { spokenPhone } from "../../domain/phone.ts";

/**
 * Panelin gördüğü biçimler. Saat dilimi hesabı sunucuda yapılır; tarayıcı hazır metin ve
 * firma saatine göre "YYYY-MM-DDTHH:MM" değerleri alır (Temporal'a bağımlı olmaz).
 */
export const zdt = (tenant: Tenant, ms: number) => Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(tenant.timezone);
export const localIso = (z: Temporal.ZonedDateTime) => z.toPlainDateTime().toString({ smallestUnit: "minute" });
export const hhmm = (z: Temporal.ZonedDateTime) => `${String(z.hour).padStart(2, "0")}:${String(z.minute).padStart(2, "0")}`;
export const phoneText = (p: string | null | undefined) => (p && /^\+90\d{10}$/.test(p) ? spokenPhone(p) : (p ?? null));

/** Bugün/dün için kısa, diğer günler için tam tarih */
export function relativeDate(tenant: Tenant, ms: number, nowMs: number): string {
  const d = zdt(tenant, ms).toPlainDate();
  const today = zdt(tenant, nowMs).toPlainDate();
  const diff = today.until(d).days;
  if (diff === 0) return "Bugün";
  if (diff === -1) return "Dün";
  if (diff === 1) return "Yarın";
  return spokenDate(d);
}

export function terms(tenant: Tenant) {
  const v = loadVertical(tenant.vertical);
  return {
    staffTerm: v.staffTerm,
    staffLabel: v.staffLabel,
    roomLabel: v.roomLabel,
    roomLabelPlural: v.roomLabelPlural,
    roomTypes: v.roomTypes,
    teamRoleLabel: tenant.team.label ?? v.teamRoleLabel,
  };
}

export function userName(db: DatabaseSync, id: string | null): string | null {
  if (!id) return null;
  if (id === "assistant") return "Asistan";
  const r = db.prepare("SELECT name FROM users WHERE id = ?").get(id) as { name: string } | undefined;
  return r?.name ?? null;
}

export function appointmentView(tenant: Tenant, a: Appointment, db: DatabaseSync) {
  const service = tenant.services.find((s) => s.id === a.serviceId);
  const start = zdt(tenant, a.startMs);
  const end = zdt(tenant, a.endMs);
  const room = tenant.rooms.find((r) => r.id === a.roomId);
  const t = terms(tenant);
  return {
    id: a.id,
    serviceId: a.serviceId,
    serviceName: service?.name ?? a.serviceId,
    price: service?.priceTRY ?? null,
    staff: [a.staffId, ...a.extraStaffIds].map((id) => ({ id, name: tenant.staff.find((s) => s.id === id)?.name ?? id })),
    room: room ? { id: room.id, label: `${t.roomTypes[room.type] ?? room.type} (${room.id})` } : null,
    date: start.toPlainDate().toString(),
    dateText: spokenDate(start.toPlainDate()),
    start: localIso(start),
    end: localIso(end),
    blockEnd: localIso(zdt(tenant, a.blockEndMs)),
    startText: hhmm(start),
    endText: hhmm(end),
    customerName: a.customerName,
    customerPhone: a.customerPhone,
    phoneText: phoneText(a.customerPhone),
    source: a.source,
    status: a.status,
    note: a.note,
    conversationId: a.conversationId,
    syncedToCalendar: !!a.calendarEventId,
    createdAt: a.createdAt,
    cancelledAt: a.cancelledAt,
    cancelledBy: userName(db, a.cancelledBy),
  };
}
