import { z } from "zod";
import { PERMISSIONS } from "./permissions.ts";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM bekleniyor");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD bekleniyor");
const e164 = z.string().regex(/^\+\d{10,15}$/, "+90... formatı bekleniyor");

/** Haftanın günleri ISO sırasıyla: 1 = Pazartesi ... 7 = Pazar */
const weekHours = z.object({
  "1": z.array(z.tuple([hhmm, hhmm])),
  "2": z.array(z.tuple([hhmm, hhmm])),
  "3": z.array(z.tuple([hhmm, hhmm])),
  "4": z.array(z.tuple([hhmm, hhmm])),
  "5": z.array(z.tuple([hhmm, hhmm])),
  "6": z.array(z.tuple([hhmm, hhmm])),
  "7": z.array(z.tuple([hhmm, hhmm])),
});

/** Sektör şablonları: her biri için agent/verticals/<ad>/ klasörü bulunur */
export const VERTICALS = ["spa"] as const;

export const TenantSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  vertical: z.enum(VERTICALS).default("spa"),
  /** Ajanın kimliği firmaya göre değişir */
  agent: z
    .object({
      name: z.string().default("Defne"),
      /** Boşsa ELEVENLABS_VOICE_ID kullanılır */
      voiceId: z.string().optional(),
      /** Boşsa sektör şablonundaki karşılama kullanılır; {firma} ve {ajan} yer tutucuları desteklenir */
      greeting: z.string().optional(),
    })
    .prefault({}),
  /**
   * Eşzamanlı çağrı yönetimi. Ajan aynı anda maxConcurrent çağrıya cevap verir;
   * fazlası queueWaitSeconds boyunca bekleme anonsu dinler, sonra reddedilir.
   * Netgsm hattının kanal sayısı da bu sayıdan az olmamalı.
   */
  calls: z
    .object({
      maxConcurrent: z.number().int().min(1).max(50).default(3),
      queueWaitSeconds: z.number().int().min(0).max(1800).default(60),
      /** Bekleyip kapatan veya ulaşamayan arayan için otomatik geri arama notu açılsın mı */
      callbackOnMissed: z.boolean().default(true),
    })
    .prefault({}),
  /** Paneldeki ekip rolü; boş alanlar sektör şablonundan gelir (ad: "Resepsiyon", "Sekreter"...) */
  team: z
    .object({ label: z.string().optional(), permissions: z.array(z.enum(PERMISSIONS)).optional() })
    .prefault({}),
  /** Paket bilgisi: raporlarda kullanılan dakika / dahil dakika */
  plan: z.object({ includedMinutes: z.number().int().nonnegative().optional() }).prefault({}),
  /**
   * Randevu takviminin kaynağı.
   * internal: yalnızca kendi veritabanımız.
   * google: firmanın Google Takvim'i okunur (dolu saatler) ve asistanın randevuları oraya yazılır.
   */
  calendar: z
    .object({
      provider: z.enum(["internal", "google"]).default("internal"),
      google: z
        .object({
          /** Randevuların okunduğu ve yazıldığı takvim (genelde firmanın e-posta adresi) */
          calendarId: z.string().min(3),
          /** Terapist başına ayrı takvim varsa: { "ayse": "ayse@...com" }. O takvimdeki her etkinlik o kişiyi meşgul eder. */
          staffCalendars: z.record(z.string(), z.string()).default({}),
          /** Etkinlik başlığında terapist adı geçiyorsa o kişiye ait say */
          matchStaffNames: z.boolean().default(true),
        })
        .optional(),
    })
    .prefault({})
    .refine((c) => c.provider !== "google" || c.google, { message: 'provider "google" ise calendar.google.calendarId zorunlu' }),
  /**
   * Randevu onayının gönderileceği kanallar, deneme sırasıyla.
   * Örn. ["whatsapp", "sms"]: önce WhatsApp, ulaşmazsa SMS.
   */
  notifications: z
    .object({
      channels: z.array(z.enum(["sms", "whatsapp"])).min(1).default(["sms"]),
      /** Yer tutucular: {firma} {isim} {hizmet} {zaman} {personel} */
      confirmationTemplate: z.string().optional(),
    })
    .prefault({}),
  timezone: z.string().default("Europe/Istanbul"),
  /** Ajanın bağlı olduğu numaralar (0850 vb.); init webhook'ta tenant'ı bulmak için */
  phoneNumbers: z.array(e164),
  agentIds: z.array(z.string()).default([]),
  hours: weekHours,
  closedDates: z.array(isoDate).default([]),
  slotStepMinutes: z.number().int().positive().default(15),
  minLeadMinutes: z.number().int().nonnegative().default(60),
  maxDaysAhead: z.number().int().positive().default(30),
  services: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      aliases: z.array(z.string()).default([]),
      durationMin: z.number().int().positive(),
      bufferMin: z.number().int().nonnegative().default(15),
      priceTRY: z.number().nonnegative(),
      roomType: z.string(),
      /** Aynı anda kaç terapist gerekir (çift masajında 2) */
      staffCount: z.number().int().min(1).max(4).default(1),
    }),
  ),
  staff: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      gender: z.enum(["kadin", "erkek"]),
      services: z.array(z.string()),
      /** Verilmezse spa çalışma saatleri geçerli */
      hours: weekHours.optional(),
    }),
  ),
  rooms: z.array(z.object({ id: z.string(), type: z.string() })),
  handoff: z
    .object({
      /** Yönlendirme kuralı OLMAYAN bir hat olmalı, yoksa çağrı ajana geri döner. Yoksa ajan geri arama notu alır. */
      transferNumber: e164.optional(),
    })
    .prefault({}),
  /** SMS başlığı (gönderici adı); SMS kanalı kullanılıyorsa gerekir */
  sms: z.object({ sender: z.string().max(11) }).optional(),
  /** Kısa bilgi tabanı: SSS, politika. Uzun içerik ElevenLabs knowledge base'e yüklenir. */
  faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
}).refine((t) => !t.notifications.channels.includes("sms") || t.sms, {
  message: 'notifications.channels "sms" içeriyorsa sms.sender (SMS başlığı) zorunlu',
  path: ["sms"],
});

export type Tenant = z.infer<typeof TenantSchema>;
export type Service = Tenant["services"][number];
export type Staff = Tenant["staff"][number];
export type WeekHours = Tenant["hours"];

/** "Ayşe", "Ayşe ve Elif", "Ayşe, Elif ve Murat" */
export function staffNames(tenant: Tenant, ids: string[]): string | undefined {
  const names = ids.map((id) => tenant.staff.find((s) => s.id === id)?.name).filter((n): n is string => !!n);
  if (!names.length) return undefined;
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} ve ${names.at(-1)}`;
}
