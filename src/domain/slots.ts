import type { Service, Staff, Tenant, WeekHours } from "./tenant.ts";
import { parseTime, partOfDay, type PartOfDay } from "./time.ts";

/**
 * Dolu aralık. endMs, temizlik/ara tamponu dahil bitiş zamanıdır.
 * staffId/roomId yoksa kime ait olduğu bilinmiyor demektir (örn. Google Takvim'deki
 * başlığında terapist adı geçmeyen randevu): en kötü durum varsayılır, bu hizmete uygun
 * bir terapist ve bir oda dolu sayılır. everything: o aralıkta hiçbir randevu verilmez.
 */
export interface BusyBlock {
  staffId?: string | undefined;
  roomId?: string | undefined;
  startMs: number;
  endMs: number;
  everything?: boolean;
}

export interface SlotQuery {
  service: Service;
  now: Temporal.ZonedDateTime;
  dateFrom: Temporal.PlainDate;
  dateTo: Temporal.PlainDate;
  partOfDay?: PartOfDay | undefined;
  /** "15:00" gibi; varsa bu saate en yakın seçenekler öne gelir */
  preferredTime?: Temporal.PlainTime | undefined;
  staffId?: string | undefined;
  staffGender?: Staff["gender"] | undefined;
  limit?: number;
  /** Önerilen seçenekler arasındaki en az fark (aynı gün içinde) */
  minGapMinutes?: number;
}

export interface Slot {
  start: Temporal.ZonedDateTime;
  end: Temporal.ZonedDateTime;
  /** Sorumlu terapist (müşterinin tercihi buna uygulanır) */
  staffId: string;
  /** Hizmet birden fazla terapist gerektiriyorsa (çift masajı) diğerleri */
  extraStaffIds: string[];
  roomId: string;
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

function windowsFor(hours: WeekHours, date: Temporal.PlainDate) {
  const key = String(date.dayOfWeek) as keyof WeekHours;
  return hours[key].map(([from, to]) => ({ from: parseTime(from), to: parseTime(to) }));
}

/** İki pencere listesinin kesişimi (spa saatleri ∩ terapist saatleri) */
function intersect(
  a: { from: Temporal.PlainTime; to: Temporal.PlainTime }[],
  b: { from: Temporal.PlainTime; to: Temporal.PlainTime }[],
) {
  const out: typeof a = [];
  for (const x of a) {
    for (const y of b) {
      const from = Temporal.PlainTime.compare(x.from, y.from) >= 0 ? x.from : y.from;
      const to = Temporal.PlainTime.compare(x.to, y.to) <= 0 ? x.to : y.to;
      if (Temporal.PlainTime.compare(from, to) < 0) out.push({ from, to });
    }
  }
  return out;
}

/** Kurallara uyan TÜM aday slotlar (sıralanmamış) */
export function candidateSlots(tenant: Tenant, q: SlotQuery, busy: BusyBlock[]): Slot[] {
  const { service } = q;
  const earliest = q.now.add({ minutes: tenant.minLeadMinutes });
  const lastDay = q.now.toPlainDate().add({ days: tenant.maxDaysAhead });
  const closed = new Set(tenant.closedDates);
  const rooms = tenant.rooms.filter((r) => r.type === service.roomType);
  const staff = tenant.staff.filter(
    (s) =>
      s.services.includes(service.id) &&
      (!q.staffId || s.id === q.staffId) &&
      (!q.staffGender || s.gender === q.staffGender),
  );

  const busyByStaff = new Map<string, BusyBlock[]>();
  const busyByRoom = new Map<string, BusyBlock[]>();
  const anonStaff: BusyBlock[] = [];
  const anonRoom: BusyBlock[] = [];
  const closedBlocks: BusyBlock[] = [];
  for (const b of busy) {
    if (b.everything) {
      closedBlocks.push(b);
      continue;
    }
    if (b.staffId) (busyByStaff.get(b.staffId) ?? busyByStaff.set(b.staffId, []).get(b.staffId)!).push(b);
    else anonStaff.push(b);
    if (b.roomId) (busyByRoom.get(b.roomId) ?? busyByRoom.set(b.roomId, []).get(b.roomId)!).push(b);
    else anonRoom.push(b);
  }
  // Bu hizmeti verebilen herkes (müşterinin terapist tercihinden bağımsız): bilinmeyen randevular bunlardan birini tutuyor sayılır
  const qualified = tenant.staff.filter((s) => s.services.includes(service.id));
  const busyAt = (list: BusyBlock[] | undefined, s: number, e: number) => (list ?? []).some((b) => overlaps(s, e, b.startMs, b.endMs));
  const countAt = (list: BusyBlock[], s: number, e: number) => list.filter((b) => overlaps(s, e, b.startMs, b.endMs)).length;

  const out: Slot[] = [];
  for (
    let date = q.dateFrom;
    Temporal.PlainDate.compare(date, q.dateTo) <= 0 && Temporal.PlainDate.compare(date, lastDay) <= 0;
    date = date.add({ days: 1 })
  ) {
    if (closed.has(date.toString())) continue;
    const spaWindows = windowsFor(tenant.hours, date);
    const windowsOf = new Map(
      qualified.map((p) => [p.id, p.hours ? intersect(spaWindows, windowsFor(p.hours, date)) : spaWindows] as const),
    );
    const worksAt = (id: string, start: Temporal.ZonedDateTime, end: Temporal.ZonedDateTime) =>
      (windowsOf.get(id) ?? []).some(
        (w) =>
          Temporal.PlainTime.compare(w.from, start.toPlainTime()) <= 0 && Temporal.PlainTime.compare(end.toPlainTime(), w.to) <= 0,
      );

    for (const person of staff) {
      const windows = person.hours ? intersect(spaWindows, windowsFor(person.hours, date)) : spaWindows;
      for (const w of windows) {
        let start = date.toZonedDateTime({ timeZone: tenant.timezone, plainTime: w.from });
        const close = date.toZonedDateTime({ timeZone: tenant.timezone, plainTime: w.to });

        for (; ; start = start.add({ minutes: tenant.slotStepMinutes })) {
          const end = start.add({ minutes: service.durationMin });
          // Hizmet kapanıştan önce bitmeli; tampon kapanıştan sonraya taşabilir.
          if (Temporal.ZonedDateTime.compare(end, close) > 0) break;
          if (Temporal.ZonedDateTime.compare(start, earliest) < 0) continue;
          if (q.partOfDay && partOfDay(start.toPlainTime()) !== q.partOfDay) continue;

          const s = start.epochMilliseconds;
          const e = end.add({ minutes: service.bufferMin }).epochMilliseconds;
          if (busyAt(closedBlocks, s, e)) continue;
          if (busyAt(busyByStaff.get(person.id), s, e)) continue;
          const freeRooms = rooms.filter((r) => !busyAt(busyByRoom.get(r.id), s, e));
          if (!freeRooms.length) continue;

          // Kime ait olduğu bilinmeyen randevular en kötü durumda uygun personel ve odaları tüketir;
          // çok terapistli hizmette (çift masajı) aynı saatte staffCount kadar boş uygun kişi gerekir.
          const anonS = countAt(anonStaff, s, e);
          let extraStaffIds: string[] = [];
          if (anonS || service.staffCount > 1) {
            const freeQualified = qualified.filter((p) => worksAt(p.id, start, end) && !busyAt(busyByStaff.get(p.id), s, e));
            if (freeQualified.length - anonS < service.staffCount) continue;
            extraStaffIds = freeQualified
              .filter((p) => p.id !== person.id)
              .slice(0, service.staffCount - 1)
              .map((p) => p.id);
          }
          const anonR = countAt(anonRoom, s, e);
          if (anonR > freeRooms.length - 1) continue;
          const room = freeRooms[0]!;

          out.push({ start, end, staffId: person.id, extraStaffIds, roomId: room.id });
        }
      }
    }
  }
  return out;
}

/**
 * Telefonda önerilecek en iyi birkaç seçenek.
 * Sıralama: istenen saate yakınlık, yoksa en erken. Aynı saati farklı terapistlerle
 * tekrar önermek yerine birbirinden ayrık seçenekler döner.
 */
export function bestSlots(tenant: Tenant, q: SlotQuery, busy: BusyBlock[]): Slot[] {
  const limit = q.limit ?? 3;
  const gapMs = (q.minGapMinutes ?? 60) * 60_000;
  const all = candidateSlots(tenant, q, busy);

  const score = (slot: Slot): number[] => {
    const dayIndex = q.dateFrom.until(slot.start.toPlainDate()).days;
    if (q.preferredTime) {
      const diff = Math.abs(q.preferredTime.until(slot.start.toPlainTime()).total("minutes"));
      return [dayIndex, diff, slot.start.epochMilliseconds];
    }
    return [slot.start.epochMilliseconds];
  };
  const cmp = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
    return 0;
  };
  all.sort((a, b) => cmp(score(a), score(b)));

  const picked: Slot[] = [];
  for (const slot of all) {
    const ms = slot.start.epochMilliseconds;
    if (picked.some((p) => Math.abs(p.start.epochMilliseconds - ms) < gapMs)) continue;
    picked.push(slot);
    if (picked.length === limit) break;
  }
  return picked.sort((a, b) => a.start.epochMilliseconds - b.start.epochMilliseconds);
}
