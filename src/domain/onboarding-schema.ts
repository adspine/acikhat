import { z } from "zod";
import { SECTOR_IDS } from "./sectors.ts";
import { normalizeTrPhone } from "./phone.ts";

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
