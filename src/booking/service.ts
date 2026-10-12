import type { Store } from "../store/db.ts";
import type { Calendars } from "../calendar/calendars.ts";
import type { Notifier } from "../integrations/notify.ts";
import { bestSlots, candidateSlots, type Slot } from "../domain/slots.ts";
import { staffNames, type Service, type Tenant } from "../domain/tenant.ts";
import { fill, loadVertical } from "../domain/vertical.ts";
import { isTrMobile, normalizeTrPhone } from "../domain/phone.ts";
import { spokenDateTime } from "../domain/time.ts";

export interface BookingDeps {
  store: Store;
  calendars: Calendars;
  notifier: Notifier;
  now: () => Temporal.ZonedDateTime;
}

export interface BookInput {
  serviceId: string;
  startMs: number;
  /** Sorumlu personel; verilmezse o saatte boş olan herhangi biri */
  staffId?: string | undefined;
  /** Tercih edilen oda; doluysa aynı tipte başka boş oda */
  roomId?: string | undefined;
  customerName: string;
  customerPhone: string;
  conversationId?: string | undefined;
  source: "assistant" | "panel";
  note?: string | undefined;
  /** Müşteriye onay mesajı gitsin mi (yalnızca cep numarasına gider) */
  notify: boolean;
}

export type BookOutcome =
  | { ok: true; id: string; duplicate: boolean; slot: Slot; when: string; staffName?: string | undefined; phone: string; service: Service }
  | { ok: false; reason: "unknown_service" | "invalid_phone" | "slot_expired" | "calendar_unavailable" }
  | { ok: false; reason: "slot_taken"; alternatives: Slot[] };

/**
 * Randevu yazmanın tek yolu: asistanın aracı da paneldeki elle randevu da bunu kullanır.
 * Son kontrol (takvim önbelleksiz), çift randevu koruması (veritabanı kilidi), takvime yazma ve
 * onay mesajı burada.
 */
export class BookingService {
  private readonly d: BookingDeps;

  constructor(deps: BookingDeps) {
    this.d = deps;
  }

  private dayMs(tenant: Tenant, d: Temporal.PlainDate) {
    return d.toZonedDateTime(tenant.timezone).epochMilliseconds;
  }

  /** Panel randevusunda "en az X dk önceden" kuralı uygulanmaz (kapıdan gelen müşteri) */
  private rules(tenant: Tenant, source: BookInput["source"]): Tenant {
    return source === "panel" ? { ...tenant, minLeadMinutes: 0 } : tenant;
  }

  async alternatives(tenant: Tenant, service: Service, start: Temporal.ZonedDateTime, source: BookInput["source"] = "assistant"): Promise<Slot[]> {
    const day = start.toPlainDate();
    return bestSlots(
      this.rules(tenant, source),
      { service, now: this.d.now().withTimeZone(tenant.timezone), dateFrom: day, dateTo: day.add({ days: 2 }), preferredTime: start.toPlainTime() },
      await this.d.calendars.busy(tenant, this.dayMs(tenant, day), this.dayMs(tenant, day.add({ days: 3 }))),
    );
  }

  async book(tenant: Tenant, input: BookInput): Promise<BookOutcome> {
    const service = tenant.services.find((s) => s.id === input.serviceId);
    if (!service) return { ok: false, reason: "unknown_service" };

    const phone = normalizeTrPhone(input.customerPhone);
    // Asistan onay mesajı göndereceği için cep numarası ister; panelde sabit hat da kabul edilir
    if (!phone || (input.source === "assistant" && !isTrMobile(phone))) return { ok: false, reason: "invalid_phone" };

    const rules = this.rules(tenant, input.source);
    const start = Temporal.Instant.fromEpochMilliseconds(input.startMs).toZonedDateTimeISO(tenant.timezone);
    const minStart = this.d.now().add({ minutes: rules.minLeadMinutes });
    if (Temporal.Instant.compare(start.toInstant(), minStart.toInstant()) < 0) return { ok: false, reason: "slot_expired" };

    // Aynı görüşmede tekrar gelen istek (ağ tekrarı): ilk randevuyu döndür
    if (input.conversationId) {
      const dupId = this.d.store.findDuplicate(tenant.id, input.conversationId, input.startMs);
      if (dupId) {
        const row = this.d.store.getAppointment(tenant.id, dupId)!;
        const slot: Slot = { start, end: start.add({ minutes: service.durationMin }), staffId: row.staffId, extraStaffIds: row.extraStaffIds, roomId: row.roomId };
        return { ok: true, id: dupId, duplicate: true, slot, when: spokenDateTime(start), staffName: staffNames(tenant, [row.staffId, ...row.extraStaffIds]), phone, service };
      }
    }

    // Son kontrol: takvimi önbelleksiz yeniden oku (bu arada elle randevu girilmiş olabilir)
    const day = start.toPlainDate();
    let busy;
    try {
      busy = await this.d.calendars.busy(tenant, this.dayMs(tenant, day), this.dayMs(tenant, day.add({ days: 1 })), { fresh: true });
    } catch (err) {
      console.error("[calendar] son kontrol yapılamadı", err);
      return { ok: false, reason: "calendar_unavailable" };
    }
    const still = candidateSlots(
      rules,
      { service, now: this.d.now().withTimeZone(tenant.timezone), dateFrom: day, dateTo: day, staffId: input.staffId },
      busy,
    ).filter((x) => x.start.epochMilliseconds === input.startMs);
    const slot = still.find((x) => x.roomId === input.roomId) ?? still[0];
    if (!slot) return { ok: false, reason: "slot_taken", alternatives: await this.alternatives(tenant, service, start, input.source) };

    const end = start.add({ minutes: service.durationMin });
    const blockEndMs = end.add({ minutes: service.bufferMin }).epochMilliseconds;
    const result = this.d.store.bookAtomic(
      {
        tenantId: tenant.id,
        serviceId: service.id,
        staffId: slot.staffId,
        extraStaffIds: slot.extraStaffIds,
        roomId: slot.roomId,
        startMs: input.startMs,
        endMs: end.epochMilliseconds,
        blockEndMs,
        customerName: input.customerName.trim(),
        customerPhone: phone,
        conversationId: input.conversationId,
        source: input.source,
        note: input.note,
      },
      { ignoreSynced: tenant.calendar.provider !== "internal" },
    );
    if (!result.ok) return { ok: false, reason: "slot_taken", alternatives: await this.alternatives(tenant, service, start, input.source) };

    const when = spokenDateTime(start);
    const staffName = staffNames(tenant, [slot.staffId, ...slot.extraStaffIds]);
    if (!result.duplicate) {
      // Firmanın takvimine yaz; başarısız olursa randevu kaybolmaz, dakikada bir yeniden denenir
      this.d.calendars
        .write(tenant, {
          id: result.id, serviceName: service.name, staffId: slot.staffId, extraStaffIds: slot.extraStaffIds, staffName,
          roomId: slot.roomId, customerName: input.customerName, customerPhone: phone, start, end, blockEndMs,
        })
        .catch((err) => console.error("[calendar] takvime yazılamadı, yeniden denenecek", (err as Error).message));
      if (input.notify && isTrMobile(phone)) {
        const text = fill(tenant.notifications.confirmationTemplate ?? loadVertical(tenant.vertical).confirmationTemplate, {
          firma: tenant.name, isim: input.customerName, hizmet: service.name, zaman: when, personel: staffName ? ` (${staffName})` : "",
        });
        // Bildirim cevabı bekletmesin: konuşma gecikmesine eklenmez
        this.d.notifier.send(phone, text, tenant).catch((err) => console.error("[notify] gönderilemedi", err));
      }
    }
    return { ok: true, id: result.id, duplicate: result.duplicate, slot, when, staffName, phone, service };
  }

  /** Randevuyu iptal eder: takvim etkinliğini siler, istenirse müşteriye mesaj gönderir */
  async cancel(tenant: Tenant, appointmentId: string, by: string, opts: { notify: boolean }): Promise<"ok" | "not_found" | "already_cancelled"> {
    const a = this.d.store.getAppointment(tenant.id, appointmentId);
    if (!a) return "not_found";
    if (a.status !== "confirmed") return "already_cancelled";
    this.d.store.cancelAppointment(tenant.id, appointmentId, by, Date.now());
    if (a.calendarEventId) {
      this.d.calendars.remove(tenant, a.calendarEventId).catch((err) => console.error("[calendar] etkinlik silinemedi", (err as Error).message));
    }
    if (opts.notify && isTrMobile(a.customerPhone)) {
      const service = tenant.services.find((s) => s.id === a.serviceId);
      const start = Temporal.Instant.fromEpochMilliseconds(a.startMs).toZonedDateTimeISO(tenant.timezone);
      const text = fill(loadVertical(tenant.vertical).cancellationTemplate, {
        firma: tenant.name, isim: a.customerName, hizmet: service?.name ?? "", zaman: spokenDateTime(start),
      });
      this.d.notifier.send(a.customerPhone, text, tenant).catch((err) => console.error("[notify] gönderilemedi", err));
    }
    return "ok";
  }
}
