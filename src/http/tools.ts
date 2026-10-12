import { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "./deps.ts";
import { bestSlots, type Slot } from "../domain/slots.ts";
import { encodeSlotId, decodeSlotId } from "../domain/slot-token.ts";
import { spokenDateTime } from "../domain/time.ts";
import { normalizeTrPhone, spokenPhone } from "../domain/phone.ts";
import { staffNames, type Tenant } from "../domain/tenant.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const CheckAvailability = z.object({
  service_id: z.string(),
  date_from: isoDate.optional(),
  date_to: isoDate.optional(),
  part_of_day: z.enum(["sabah", "ogle", "aksam"]).optional(),
  preferred_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  staff_id: z.string().optional(),
  staff_gender: z.enum(["kadin", "erkek"]).optional(),
  conversation_id: z.string().optional(),
});

const BookAppointment = z.object({
  slot_id: z.string(),
  customer_name: z.string().trim().min(2),
  customer_phone: z.string(),
  confirmed_by_caller: z.boolean(),
  conversation_id: z.string().optional(),
});

const LogCallback = z.object({
  reason: z.string().min(2),
  customer_name: z.string().optional(),
  customer_phone: z.string().optional(),
  conversation_id: z.string().optional(),
});

/** Araç cevapları LLM'e gider: kısa, Türkçe ve ne söyleneceğini açıkça belirten metinler */
const fail = (error: string, instruction: string) => ({ ok: false, error, instruction });

export function toolRoutes(deps: Deps) {
  const app = new Hono<{ Variables: { tenant: Tenant } }>();

  app.use("/:tenant/*", async (c, next) => {
    const tenant = deps.tenants.get(c.req.param("tenant"));
    if (!tenant) return c.json({ error: "unknown tenant" }, 404);
    c.set("tenant", tenant);
    await next();
  });

  const offer = (tenant: Tenant, serviceId: string, slots: Slot[]) =>
    slots.map((s) => ({
      slot_id: encodeSlotId(
        { tenantId: tenant.id, serviceId, staffId: s.staffId, roomId: s.roomId, startMs: s.start.epochMilliseconds },
        deps.slotKey,
      ),
      when: spokenDateTime(s.start),
      staff: staffNames(tenant, [s.staffId, ...s.extraStaffIds]),
    }));

  app.post("/:tenant/check_availability", async (c) => {
    const tenant = c.get("tenant");
    const parsed = CheckAvailability.safeParse(await c.req.json());
    if (!parsed.success) return c.json(fail("invalid_input", "Müşteriye hangi hizmeti ve günü istediğini tekrar sor."));
    const p = parsed.data;

    const service = tenant.services.find((s) => s.id === p.service_id);
    if (!service) return c.json(fail("unknown_service", "Bu hizmet listede yok. Mevcut hizmetleri say ve hangisini istediğini sor."));

    const now = deps.now().withTimeZone(tenant.timezone);
    const today = now.toPlainDate();
    let dateFrom = p.date_from ? Temporal.PlainDate.from(p.date_from) : today;
    if (Temporal.PlainDate.compare(dateFrom, today) < 0) dateFrom = today;
    let dateTo = p.date_to ? Temporal.PlainDate.from(p.date_to) : dateFrom.add({ days: 6 });
    if (Temporal.PlainDate.compare(dateTo, dateFrom) < 0) dateTo = dateFrom;

    const run = async (from: Temporal.PlainDate, to: Temporal.PlainDate) => {
      const fromMs = from.toZonedDateTime(tenant.timezone).epochMilliseconds;
      const toMs = to.add({ days: 1 }).toZonedDateTime(tenant.timezone).epochMilliseconds;
      const busy = await deps.calendars.busy(tenant, fromMs, toMs);
      return bestSlots(
        tenant,
        {
          service, now, dateFrom: from, dateTo: to,
          // Belirli saat istendiyse gün içi aralık filtresi uygulanmaz ("öğleden sonra saat 18" → 18 elenmesin)
          partOfDay: p.preferred_time ? undefined : p.part_of_day,
          preferredTime: p.preferred_time ? Temporal.PlainTime.from(p.preferred_time) : undefined,
          staffId: p.staff_id,
          staffGender: p.staff_gender,
        },
        busy,
      );
    };

    let slots = await run(dateFrom, dateTo);
    let widened = false;
    if (slots.length === 0) {
      // İstenen aralık doluysa sonraki 7 güne bak, müşteriye bunu söyle.
      slots = await run(dateTo.add({ days: 1 }), dateTo.add({ days: 7 }));
      widened = true;
    }
    if (slots.length === 0) {
      return c.json({
        ok: true,
        options: [],
        instruction: "Yakın tarihte uygun yer yok. Özür dile ve geri arama kaydı almayı teklif et (log_callback_request).",
      });
    }
    // İstenen saat açıkça uygun mu? Model sonuçlardan çıkarım yapıp "dolu" demesin.
    let requested: { time: string; available: boolean } | undefined;
    if (p.preferred_time) {
      const wanted = Temporal.PlainTime.from(p.preferred_time);
      const exact = slots.find((x) => !widened && Temporal.PlainTime.compare(x.start.toPlainTime(), wanted) === 0);
      requested = { time: p.preferred_time, available: !!exact };
      // Uygunsa önce o seçenek gelsin
      if (exact) slots = [exact, ...slots.filter((x) => x !== exact)];
    }
    const options = offer(tenant, service.id, slots);
    let instruction = widened
      ? "İstenen tarihlerde yer yok; bunu söyle ve bu en yakın seçenekleri öner."
      : "Seçenekleri kısa şekilde öner, müşterinin seçtiğinin slot_id'sini kullan.";
    if (requested?.available) instruction = `İstenen saat (${options[0]!.when}) UYGUN. Bunu söyle ve bu saati öner.`;
    else if (requested) instruction = `İstenen saat (${requested.time}) o gün uygun değil. Bunu söyle ve en yakın seçenekleri öner.`;
    return c.json({
      ok: true,
      service: service.name,
      price_try: service.priceTRY,
      ...(requested && { requested_time: requested }),
      options,
      instruction,
    });
  });

  app.post("/:tenant/book_appointment", async (c) => {
    const tenant = c.get("tenant");
    const parsed = BookAppointment.safeParse(await c.req.json());
    if (!parsed.success) return c.json(fail("invalid_input", "İsim ve telefon numarasını tekrar al."));
    const p = parsed.data;

    if (!p.confirmed_by_caller) {
      return c.json(fail("not_confirmed", "Önce tarih, saat, hizmet ve ismi müşteriye tekrar okuyup onay al."));
    }
    const claim = decodeSlotId(p.slot_id, deps.slotKey);
    if (!claim || claim.tenantId !== tenant.id) {
      return c.json(fail("invalid_slot", "Bu seçenek geçersiz. check_availability ile yeniden uygun saatlere bak."));
    }
    const service = tenant.services.find((s) => s.id === claim.serviceId);
    if (!service) return c.json(fail("invalid_slot", "check_availability ile yeniden uygun saatlere bak."));

    const outcome = await deps.booking.book(tenant, {
      serviceId: service.id,
      startMs: claim.startMs,
      staffId: claim.staffId,
      roomId: claim.roomId,
      customerName: p.customer_name,
      customerPhone: p.customer_phone,
      conversationId: p.conversation_id,
      source: "assistant",
      notify: true,
    });
    if (!outcome.ok) {
      switch (outcome.reason) {
        case "invalid_phone":
          return c.json(fail("invalid_phone", "Telefon numarası geçersiz görünüyor. 05 ile başlayan cep numarasını tekrar iste."));
        case "slot_expired":
          return c.json(fail("slot_expired", "Bu saat artık geçti. check_availability ile yeni seçeneklere bak."));
        case "calendar_unavailable":
          return c.json(fail("calendar_unavailable", "Takvime şu an ulaşılamıyor. Randevuyu yazma; isim ve numarayı alıp log_callback_request ile geri arama notu bırak."));
        case "slot_taken":
          return c.json({
            ...fail("slot_taken", "Bu saat az önce doldu. Özür dile ve bu alternatifleri öner."),
            options: offer(tenant, service.id, outcome.alternatives),
          });
        default:
          return c.json(fail("invalid_slot", "check_availability ile yeniden uygun saatlere bak."));
      }
    }
    return c.json({
      ok: true,
      appointment_id: outcome.id,
      when: outcome.when,
      service: service.name,
      phone_spoken: spokenPhone(outcome.phone),
      instruction: outcome.duplicate
        ? "Randevu zaten alındı. Bunu söyle ve başka bir isteği olup olmadığını sor."
        : "Randevunun alındığını ve onay mesajı gideceğini söyle. Başka bir isteği olup olmadığını sor.",
    });
  });

  app.post("/:tenant/log_callback_request", async (c) => {
    const tenant = c.get("tenant");
    const parsed = LogCallback.safeParse(await c.req.json());
    if (!parsed.success) return c.json(fail("invalid_input", "Geri arama nedenini kısaca al."));
    const p = parsed.data;
    const phone = normalizeTrPhone(p.customer_phone);
    const id = deps.store.addCallback({
      tenantId: tenant.id,
      name: p.customer_name,
      phone,
      reason: p.reason,
      conversationId: p.conversation_id,
    });
    return c.json({
      ok: true,
      callback_id: id,
      instruction: phone
        ? "Resepsiyonun en kısa sürede geri arayacağını söyle."
        : "Geri arama için numara eksik; cep numarasını iste ve aracı tekrar çağır.",
    });
  });

  return app;
}
