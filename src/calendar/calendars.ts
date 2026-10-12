import type { BusyBlock } from "../domain/slots.ts";
import type { Tenant } from "../domain/tenant.ts";
import type { Store } from "../store/db.ts";
import type { CalendarApi, GoogleEvent } from "../integrations/google/client.ts";
import { spokenPhone } from "../domain/phone.ts";

/** Asistanın yazdığı etkinlikleri tanımak için etkinliğe gizli alan olarak eklenir */
const TAG = "acikhat";

const trLower = (s: string) => s.toLocaleLowerCase("tr");

/** Başlıkta kelime olarak geçen terapist adları ("Ayşe – masaj" → ayse) */
function staffInText(tenant: Tenant, text: string): string[] {
  const t = trLower(text);
  return tenant.staff
    .filter((p) => new RegExp(`(^|[^\\p{L}])${trLower(p.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "u").test(t))
    .map((p) => p.id);
}

function eventRange(tenant: Tenant, e: GoogleEvent): { startMs: number; endMs: number; allDay: boolean } | null {
  if (e.start.dateTime && e.end.dateTime) {
    return { startMs: Temporal.Instant.from(e.start.dateTime).epochMilliseconds, endMs: Temporal.Instant.from(e.end.dateTime).epochMilliseconds, allDay: false };
  }
  if (e.start.date && e.end.date) {
    const at = (d: string) => Temporal.PlainDate.from(d).toZonedDateTime(tenant.timezone).epochMilliseconds;
    return { startMs: at(e.start.date), endMs: at(e.end.date), allDay: true };
  }
  return null;
}

/**
 * Google etkinliklerini dolu zaman bloklarına çevirir.
 * - Asistanın yazdığı etkinlik: terapist ve oda bilinir (gizli alanlardan).
 * - Terapistin kendi takvimi: o terapist meşgul.
 * - Ortak takvimde başlığında terapist adı geçen: o terapist(ler) meşgul, oda bilinmiyor.
 * - Ortak takvimde adı geçmeyen: bilinmeyen bir terapist + oda meşgul; tüm gün ise o gün kapalı.
 */
export function eventsToBlocks(tenant: Tenant, events: GoogleEvent[], ownerStaffId?: string): BusyBlock[] {
  const out: BusyBlock[] = [];
  const matchNames = tenant.calendar.google?.matchStaffNames ?? true;
  // Elle girilen randevularda da temizlik/hazırlık payı bırak (hizmetlerdeki en uzun tampon)
  const bufferMs = Math.max(0, ...tenant.services.map((s) => s.bufferMin)) * 60_000;
  for (const e of events) {
    if (e.status === "cancelled" || e.transparency === "transparent") continue;
    const range = eventRange(tenant, e);
    if (!range || range.endMs <= range.startMs) continue;
    const { startMs } = range;
    const endMs = range.allDay ? range.endMs : range.endMs + bufferMs;

    const own = e.extendedProperties?.private;
    if (own?.[`${TAG}_appointment`]) {
      const [first, ...extra] = (own[`${TAG}_staff`] ?? "").split(",").filter(Boolean);
      const end = Number(own[`${TAG}_block_end`]) || range.endMs;
      out.push({ staffId: first, roomId: own[`${TAG}_room`], startMs, endMs: end });
      for (const staffId of extra) out.push({ staffId, roomId: "-", startMs, endMs: end });
      continue;
    }
    if (ownerStaffId) {
      out.push({ staffId: ownerStaffId, startMs, endMs });
      continue;
    }
    const named = matchNames ? staffInText(tenant, `${e.summary ?? ""} ${e.description ?? ""}`) : [];
    if (named.length) {
      // Adı geçen kişi o gün izinliyse (tüm gün) oda tutmaz; saatli randevuda bir oda da dolu sayılır
      for (const [i, staffId] of named.entries()) out.push({ staffId, startMs, endMs, ...(range.allDay || i > 0 ? { roomId: "-" } : {}) });
      continue;
    }
    out.push(range.allDay ? { startMs, endMs, everything: true } : { startMs, endMs });
  }
  return out;
}

export interface AppointmentForCalendar {
  id: string;
  serviceName: string;
  staffId: string;
  extraStaffIds?: string[] | undefined;
  /** Başlıkta gösterilecek terapist ad(lar)ı, örn. "Ayşe ve Elif" */
  staffName?: string | undefined;
  roomId: string;
  customerName: string;
  customerPhone: string;
  start: Temporal.ZonedDateTime;
  end: Temporal.ZonedDateTime;
  blockEndMs: number;
}

/**
 * Firmanın takvim kaynağına göre dolu zamanları getirir ve randevuları takvime yazar.
 * Google firmalarında takvim asıl kaynaktır; bizim veritabanındaki yalnızca henüz
 * takvime yazılamamış randevular ek olarak sayılır.
 */
export class Calendars {
  private readonly store: Store;
  private readonly google: CalendarApi | null;
  private readonly cacheMs: number;
  private readonly cache = new Map<string, { fromMs: number; toMs: number; at: number; events: GoogleEvent[] }>();

  constructor(store: Store, google: CalendarApi | null, opts: { cacheMs?: number } = {}) {
    this.store = store;
    this.google = google;
    this.cacheMs = opts.cacheMs ?? 45_000;
  }

  private api(tenant: Tenant): CalendarApi {
    if (!this.google) throw new Error(`${tenant.id} Google Takvim kullanıyor ama GOOGLE_SERVICE_ACCOUNT_FILE tanımlı değil`);
    return this.google;
  }

  private async events(tenant: Tenant, calendarId: string, fromMs: number, toMs: number, fresh: boolean) {
    const hit = this.cache.get(calendarId);
    if (!fresh && hit && hit.fromMs <= fromMs && hit.toMs >= toMs && Date.now() - hit.at < this.cacheMs) return hit.events;
    const iso = (ms: number) => Temporal.Instant.fromEpochMilliseconds(ms).toString();
    const events = await this.api(tenant).listEvents(calendarId, iso(fromMs), iso(toMs));
    this.cache.set(calendarId, { fromMs, toMs, at: Date.now(), events });
    return events;
  }

  /** fresh: önbelleği atla (randevu yazmadan hemen önceki kontrol için) */
  async busy(tenant: Tenant, fromMs: number, toMs: number, opts: { fresh?: boolean } = {}): Promise<BusyBlock[]> {
    const g = tenant.calendar.google;
    if (tenant.calendar.provider !== "google" || !g) return this.store.busyBlocks(tenant.id, fromMs, toMs);

    const fresh = opts.fresh ?? false;
    const [main, ...perStaff] = await Promise.all([
      this.events(tenant, g.calendarId, fromMs, toMs, fresh),
      ...Object.values(g.staffCalendars).map((id) => this.events(tenant, id, fromMs, toMs, fresh)),
    ]);
    const staffIds = Object.keys(g.staffCalendars);
    return [
      ...this.store.busyBlocks(tenant.id, fromMs, toMs, { unsyncedOnly: true }),
      ...eventsToBlocks(tenant, main!),
      ...perStaff.flatMap((evs, i) => eventsToBlocks(tenant, evs, staffIds[i])),
    ];
  }

  /** Randevuyu firmanın takvimine yazar. Takvim kullanmayan firmada bir şey yapmaz. */
  async write(tenant: Tenant, a: AppointmentForCalendar): Promise<void> {
    const g = tenant.calendar.google;
    if (tenant.calendar.provider !== "google" || !g) return;
    const fmt = (z: Temporal.ZonedDateTime) => z.toPlainDateTime().toString({ smallestUnit: "second" });
    const eventId = await this.api(tenant).insertEvent(g.calendarId, {
      summary: `${a.serviceName} – ${a.customerName}${a.staffName ? ` (${a.staffName})` : ""}`,
      description: `Telefon: ${spokenPhone(a.customerPhone)}\nRandevuyu telefon asistanı aldı.\nRef: ${a.id}`,
      start: { dateTime: fmt(a.start), timeZone: tenant.timezone },
      end: { dateTime: fmt(a.end), timeZone: tenant.timezone },
      extendedProperties: {
        private: {
          [`${TAG}_appointment`]: a.id,
          [`${TAG}_staff`]: [a.staffId, ...(a.extraStaffIds ?? [])].join(","),
          [`${TAG}_room`]: a.roomId,
          [`${TAG}_block_end`]: String(a.blockEndMs),
        },
      },
    });
    this.store.setCalendarEventId(a.id, eventId);
    this.cache.delete(g.calendarId);
  }

  /** İptal edilen randevunun etkinliğini firmanın takviminden siler */
  async remove(tenant: Tenant, eventId: string): Promise<void> {
    const g = tenant.calendar.google;
    if (tenant.calendar.provider !== "google" || !g) return;
    const api = this.api(tenant);
    if (!api.deleteEvent) return;
    await api.deleteEvent(g.calendarId, eventId);
    this.cache.delete(g.calendarId);
  }

  /** Takvime yazılamamış randevuları yeniden dener (dakikada bir) */
  async retryPending(
    tenantOf: (id: string) => Tenant | undefined,
    describe: (tenant: Tenant, row: PendingRow) => AppointmentForCalendar,
    nowMs = Date.now(),
  ) {
    let ok = 0;
    for (const row of this.store.unsyncedAppointments(nowMs)) {
      const tenant = tenantOf(row.tenant_id);
      if (tenant?.calendar.provider !== "google") continue;
      try {
        await this.write(tenant, describe(tenant, row));
        ok++;
      } catch (err) {
        console.warn(`[calendar] ${row.id} hâlâ yazılamadı`, (err as Error).message);
      }
    }
    return ok;
  }
}

export interface PendingRow {
  id: string;
  tenant_id: string;
  service_id: string;
  staff_id: string;
  extra_staff_ids: string;
  room_id: string;
  start_ms: number;
  end_ms: number;
  block_end_ms: number;
  customer_name: string;
  customer_phone: string;
}
