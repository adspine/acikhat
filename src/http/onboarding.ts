import { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "./deps.ts";
import { normalizeTrPhone } from "../domain/phone.ts";
import { checkLineNumber } from "./phone-line.ts";
import { createTenantFromSubmission } from "./tenant-create.ts";
import { SECTOR_IDS } from "../domain/sectors.ts";
import { userFromCookie } from "./panel/session.ts";
import { mailLineSubmitted, mailSubmission } from "../notify/emails.ts";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const text = (max = 500) => z.string().trim().max(max);

/**
 * Web sitesindeki firma bilgi formu. Bilinçli olarak esnek: eksik alanlar kurulum öncesi
 * telefonla tamamlanır; yalnızca iletişim ve KVKK onayı zorunlu.
 * Kurulumda tenants/<id>.json'a dönüştürülür (scripts/onboarding-to-tenant.ts).
 */
export const OnboardingSchema = z.object({
  business: z.object({
    name: text(120).min(2, "İşletme adını yazın"),
    sector: z.enum(SECTOR_IDS).default("spa"),
    address: text().optional(),
    website: text(200).optional(),
    /** İşletme yapısı: sektöre göre seçenekler değişir (örn. "Bağımsız işletme", "Zincir şube") */
    operatedBy: text(80).optional(),
  }),
  contact: z.object({
    person: text(120).min(2, "Yetkili kişinin adını yazın"),
    phone: z.string().refine((v) => normalizeTrPhone(v) !== null, "Geçerli bir telefon numarası yazın"),
    email: z.union([z.literal(""), z.email("Geçerli bir e-posta yazın")]).optional(),
  }),
  phone: z
    .object({
      publicNumber: text(40).optional(),
      when: z.enum(["her-zaman", "mesgul-cevapsiz", "mesai-disi"]).optional(),
      transferNumber: text(40).optional(),
      /** Müşterinin kendi aldığı 0850 ya da sabit hat numarası (asistanın karşılayacağı hat); yoksa 3. adımda alınır */
      assistantNumber: text(40).optional(),
      languages: text(200).optional(),
    })
    .prefault({}),
  hours: z
    .array(z.object({ day: z.number().int().min(1).max(7), open: z.boolean(), from: hhmm.optional(), to: hhmm.optional() }))
    .max(7)
    .default([]),
  closedDates: text(1000).optional(),
  booking: z
    .object({
      minLeadMinutes: z.number().int().min(0).max(10_080).optional(),
      maxDaysAhead: z.number().int().min(1).max(365).optional(),
    })
    .prefault({}),
  services: z
    .array(
      z.object({
        name: text(120).min(1),
        durationMin: z.number().int().min(5).max(600).optional(),
        price: text(40).optional(),
        bufferMin: z.number().int().min(0).max(120).optional(),
        room: text(60).optional(),
        staffCount: z.number().int().min(1).max(4).optional(),
        aliases: text(300).optional(),
        /** Kapasite (kişi): oda tipi, masa, ders gibi sektörlerde */
        capacity: z.number().int().min(1).max(500).optional(),
        note: text(300).optional(),
      }),
    )
    .max(80)
    .default([]),
  staff: z
    .array(
      z.object({
        name: text(80).min(1),
        gender: z.enum(["kadin", "erkek"]).optional(),
        services: text(500).optional(),
        hours: text(300).optional(),
        /** Unvan veya uzmanlık (Dt., Danışman, Resepsiyon müdürü...) */
        title: text(80).optional(),
        /** Çağrı aktarılacaksa cep numarası */
        phone: text(40).optional(),
      }),
    )
    .max(60)
    .default([]),
  rooms: z.object({ tek: z.number().int().min(0).max(50).optional(), cift: z.number().int().min(0).max(50).optional(), hamam: z.number().int().min(0).max(50).optional(), diger: text(200).optional() }).prefault({}),
  calendar: z.object({ current: z.enum(["defter", "excel", "google", "yazilim", "diger"]).optional(), software: text(120).optional() }).prefault({}),
  policies: z
    .object({
      cancellation: text(1000).optional(),
      payment: text(500).optional(),
      health: text(1000).optional(),
      faq: text(4000).optional(),
    })
    .prefault({}),
  /** Sektöre özel cevaplar: {"Hizmet verdiğiniz bölgeler": "Bolu, Düzce", ...} */
  extras: z.record(z.string().max(120), z.union([z.string().max(1500), z.array(z.string().max(200)).max(60), z.number()])).default({}),
  notifications: z.object({ channels: z.array(z.enum(["whatsapp", "sms"])).default([]) }).prefault({}),
  agent: z.object({ name: text(40).optional(), voice: z.enum(["kadin", "erkek", "farketmez"]).optional(), greetingNote: text(300).optional() }).prefault({}),
  /** Üyenin bildirdiği hat bilgisi: yalnızca sunucu yazar (form gövdesindeki değer atılır) */
  line: z
    .object({
      number: z.string().max(20),
      subscriptionType: z.enum(["onodemeli", "faturali"]).optional(),
      sipConfigured: z.boolean().optional(),
      source: z.enum(["form", "step3"]).optional(),
      at: z.number().optional(),
    })
    .optional(),
  consent: z.object({
    kvkk: z.literal(true, "Devam etmek için aydınlatma metnini onaylayın"),
    signer: text(120).optional(),
  }),
});

export function onboardingRoutes(deps: Deps) {
  const app = new Hono();

  app.post("/onboarding", async (c) => {
    const raw = await c.req.text();
    if (raw.length > 100_000) return c.json({ ok: false, error: "Form çok büyük" }, 413);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ ok: false, error: "Form okunamadı, sayfayı yenileyip tekrar deneyin" }, 400);
    }
    // Bot tuzağı: görünmeyen alan doluysa sessizce kabul edip kaydetme
    if (typeof body.company_fax === "string" && body.company_fax) return c.json({ ok: true, reference: "OK" });

    // Form yalnızca giriş yapmış ve paketini ödemiş üyeye açıktır (yönetici hesabı istisna)
    const user = userFromCookie(c, deps);
    if (!user) return c.json({ ok: false, error: "Kurulum formu için önce giriş yapın" }, 401);
    const journey = deps.users.onboardingOf(user.id);
    if (!journey.paidAt && user.role !== "agency") return c.json({ ok: false, error: "Kurulum formu için önce paketinizi seçip ödemeyi tamamlayın" }, 402);

    delete body.line; // hat bilgisi yalnızca doğrulanarak yazılır
    const parsed = OnboardingSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: "Bazı alanlar eksik", fields: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
        422,
      );
    }
    // Formda 0850/sabit hat numarası yazıldıysa doğrulanır; yazılmadıysa üye 3. adımda numara almaya yönlendirilir
    const declared = parsed.data.phone.assistantNumber?.trim();
    if (declared) {
      const chk = checkLineNumber(deps, declared, { strict: true });
      if (!chk.ok) return c.json({ ok: false, error: "Bazı alanlar eksik", fields: [{ path: "phone.assistantNumber", message: chk.error }] }, 422);
      parsed.data.line = { number: chk.number, source: "form", at: Date.now() };
    }
    // Paketi ödenmiş üyenin başvurusu hesabına bağlanır (kurulum yolculuğunun 3. adımı)
    const owner = journey.paidAt ? user : null;
    const reference = deps.store.saveOnboarding({
      businessName: parsed.data.business.name,
      contactPhone: normalizeTrPhone(parsed.data.contact.phone)!,
      payload: parsed.data,
      ...(owner && { userId: owner.id, plan: journey.plan ?? undefined }),
    });
    if (owner) deps.users.setOnboardingRef(owner.id, reference);
    console.info(`[onboarding] yeni başvuru ${reference}: ${parsed.data.business.name}`);
    mailSubmission(deps, {
      reference,
      businessName: parsed.data.business.name,
      person: parsed.data.contact.person,
      phone: parsed.data.contact.phone,
      sector: parsed.data.business.sector,
      memberEmail: owner?.email ?? null,
      contactEmail: parsed.data.contact.email || undefined,
      plan: owner ? (journey.plan ?? null) : null,
    });
    // Ödemiş üyenin firması hemen oluşturulur: üye panele girer ve numara adımını panelde rehberle tamamlar.
    // Firma canlı sayılmaz (asistan ve numara yönetici onayıyla bağlanır). Oluşturulamazsa başvuru yönetici inceleyene kadar bekler.
    if (owner) {
      const made = createTenantFromSubmission(deps, { reference, userId: owner.id, form: parsed.data });
      if (made.ok) return c.json({ ok: true, reference, tenantCreated: true });
      console.error(`[onboarding] firma otomatik oluşturulamadı (${reference}): ${made.error}`);
    }
    return c.json({ ok: true, reference });
  });

  /**
   * Kurulumun 3. adımı: üye Netgsm'den numarasını aldıktan sonra numarayı ve gerekli bilgileri gönderir.
   * Firma onaylanana kadar tekrar gönderilebilir (numara değiştirmek için). Başarılı olunca yolculuk 4. adıma (onay bekleniyor) geçer.
   */
  const Line = z.object({
    number: z.string().trim().min(1, "Numaranızı yazın").max(32),
    subscriptionType: z.enum(["onodemeli", "faturali"], "Abonelik türünü seçin"),
    sipConfigured: z.literal(true, "Netgsm SIP ayarını yaptığınızı onaylayın"),
    ownerConfirmed: z.literal(true, "Numaranın sizin adınıza kayıtlı olduğunu onaylayın"),
  });
  app.post("/onboarding/line", async (c) => {
    const user = userFromCookie(c, deps);
    if (!user) return c.json({ ok: false, error: "Önce giriş yapın" }, 401);
    const journey = deps.users.onboardingOf(user.id);
    if (!journey.paidAt || !journey.reference) return c.json({ ok: false, error: "Önce paketinizi ödeyip kurulum formunu gönderin" }, 409);
    if (user.tenantId) return c.json({ ok: false, error: "Firmanız zaten kurulmuş. Numarayı değiştirmek için bize yazın." }, 409);
    const parsed = Line.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Eksik bilgi" }, 422);
    const chk = checkLineNumber(deps, parsed.data.number, { strict: true });
    if (!chk.ok) return c.json({ ok: false, error: chk.error }, chk.status);
    const row = deps.store.db.prepare("SELECT payload_json FROM onboarding_submissions WHERE reference = ?").get(journey.reference) as { payload_json: string } | undefined;
    if (!row) return c.json({ ok: false, error: "Başvuru bulunamadı" }, 404);
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    payload.line = { number: chk.number, subscriptionType: parsed.data.subscriptionType, sipConfigured: true, source: "step3", at: Date.now() };
    deps.store.db.prepare("UPDATE onboarding_submissions SET payload_json = ? WHERE reference = ?").run(JSON.stringify(payload), journey.reference);
    deps.store.audit({ tenantId: null, userId: user.id, action: "onboarding.line", target: chk.number });
    mailLineSubmitted(deps, { reference: journey.reference, number: chk.number, memberEmail: user.email, subscriptionType: parsed.data.subscriptionType });
    return c.json({ ok: true, number: chk.number });
  });

  return app;
}
