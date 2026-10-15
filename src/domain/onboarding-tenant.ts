/**
 * Web formundan gelen başvuruyu firma ayar taslağına çevirir (kontrol listesiyle).
 * Hem komut satırı betiği (scripts/onboarding-to-tenant.ts) hem yönetici paneli kullanır.
 * Taslak doğrudan yayına girmez; eksikler tamamlanıp ajan kurulunca canlıya alınır.
 */
import { existsSync } from "node:fs";
import type { z } from "zod";
import type { OnboardingSchema } from "../http/onboarding.ts";
import { TenantSchema, type Tenant } from "./tenant.ts";
import { normalizeTrPhone, isTrMobile } from "./phone.ts";
import { loadVertical } from "./vertical.ts";

export type OnboardingForm = z.infer<typeof OnboardingSchema>;

export const slugify = (s: string) =>
  s
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" })[c]!)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function buildTenantDraft(f: OnboardingForm): { tenant: Record<string, unknown>; parsed: Tenant | null; todo: string[] } {
  const todo: string[] = [];
  // Ajan şablonu (agent/verticals/<sektör>) yalnızca hazır sektörler için var; diğerleri taslak olarak spa şablonuyla açılır, elle uyarlanır
  const vertical = existsSync(new URL(`../../agent/verticals/${f.business.sector}`, import.meta.url)) ? (f.business.sector as Tenant["vertical"]) : "spa";
  // Oda tipleri yalnızca spa formunda sorulur; diğer sektörlerde hizmetler sektörün ilk alan tipine bağlanır
  const isSpa = vertical === "spa";
  const defaultRoomType = isSpa ? "tek" : Object.keys(loadVertical(vertical).roomTypes)[0]!;
  if (vertical !== f.business.sector) todo.push(`Sektör "${f.business.sector}": ajan şablonu henüz yok, taslak spa şablonuyla açıldı. Şablon yazılıp vertical değiştirilmeli.`);
  for (const [k, v] of Object.entries(f.extras ?? {})) todo.push(`Sektör cevabı — ${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
  const slug = slugify;

  // --- saatler ---
  const hours = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [String(d), [] as [string, string][]])) as Record<string, [string, string][]>;
  for (const h of f.hours) if (h.open && h.from && h.to) hours[String(h.day)] = [[h.from, h.to]];
  if (!f.hours.length) todo.push("Çalışma saatleri gelmedi.");

  // --- hizmetler ---
  const services = f.services.map((s) => {
    const price = Number((s.price ?? "").replace(/[^\d,.]/g, "").replace(/\.(?=\d{3})/g, "").replace(",", "."));
    if (!s.durationMin) todo.push(`"${s.name}" hizmetinin süresi eksik.`);
    if (!Number.isFinite(price) || !price) todo.push(`"${s.name}" hizmetinin fiyatı okunamadı ("${s.price ?? ""}").`);
    return {
      id: slug(`${s.name}-${s.durationMin ?? ""}`),
      name: s.durationMin ? `${s.name} (${s.durationMin} dakika)` : s.name,
      aliases: [s.name.toLocaleLowerCase("tr")],
      durationMin: s.durationMin ?? 60,
      bufferMin: s.bufferMin ?? 15,
      priceTRY: Number.isFinite(price) ? price : 0,
      roomType: isSpa ? (s.room ?? "tek") : defaultRoomType,
      staffCount: s.staffCount ?? 1,
    };
  });
  if (!services.length) todo.push("Hizmet listesi boş.");
  for (const s of f.services)
    if (isSpa && /çift|iki kişi/i.test(s.name) && (s.staffCount ?? 1) < 2) todo.push(`"${s.name}" çift hizmeti gibi görünüyor ama 1 terapist girilmiş; doğru mu?`);
  {
    // Yazım hatası şüphesi: aynı sürede bir hizmet diğerlerinden 5 kattan fazla pahalı/ucuzsa
    const priced = services.filter((s) => s.priceTRY > 0);
    for (const s of priced) {
      const peers = priced.filter((p) => p !== s && Math.abs(p.durationMin - s.durationMin) <= 30);
      if (peers.length && peers.every((p) => s.priceTRY / p.priceTRY > 5 || p.priceTRY / s.priceTRY > 5))
        todo.push(`"${s.name}" fiyatı (${s.priceTRY} TL) benzer süreli hizmetlerden çok farklı; yazım hatası olabilir.`);
    }
  }

  // --- ekip ---
  const byName = new Map(f.services.map((s, i) => [s.name.trim().toLocaleLowerCase("tr"), services[i]!.id]));
  const staff = f.staff.map((p) => {
    const ids = (p.services ?? "")
      .split(",")
      .map((x) => byName.get(x.trim().toLocaleLowerCase("tr")))
      .filter((x): x is string => !!x);
    if (!p.gender && (isSpa || vertical === "guzellik")) todo.push(`${p.name} için cinsiyet seçilmemiş (kadın/erkek terapist tercihi için gerekli).`);
    if (!ids.length) todo.push(`${p.name} hangi hizmetleri yapıyor, seçilmemiş.`);
    return { id: slug(p.name), name: p.name, gender: p.gender ?? "kadin", services: ids };
  });
  if (!staff.length) todo.push("Ekip listesi boş.");

  // --- odalar ---
  const rooms: { id: string; type: string }[] = [];
  for (const type of ["tek", "cift", "hamam"] as const) for (let i = 1; i <= (f.rooms[type] ?? 0); i++) rooms.push({ id: `${type}-${i}`, type });
  if (!isSpa) {
    // Form alan sayısını sormuyor: ekipteki kişi başına bir alan açılır, gerçek sayı kurulumda teyit edilir
    const n = Math.max(1, f.staff.length);
    for (let i = 1; i <= n; i++) rooms.push({ id: `${defaultRoomType}-${i}`, type: defaultRoomType });
    todo.push(`${loadVertical(vertical).roomLabelPlural}: ekip sayısı kadar (${n}) açıldı; aynı anda kaç ${loadVertical(vertical).roomLabel.toLocaleLowerCase("tr")} kullanılabiliyorsa teyit edip düzeltin.`);
  }
  const neededTypes = new Set(services.map((s) => s.roomType));
  for (const t of neededTypes) if (!rooms.some((r) => r.type === t)) todo.push(`"${t}" tipinde oda yok ama bu odada yapılan hizmet var.`);
  if (f.rooms.diger) todo.push(`Diğer alanlar elle eklenmeli: ${f.rooms.diger}`);

  // --- telefon ve bildirim ---
  const transfer = normalizeTrPhone(f.phone.transferNumber);
  if (f.phone.transferNumber && !transfer) todo.push(`Aktarma numarası okunamadı: ${f.phone.transferNumber}`);
  if (transfer && normalizeTrPhone(f.phone.publicNumber) === transfer) todo.push("Aktarma numarası, yönlendirilen numarayla aynı: çağrı döngüye girer. Farklı numara iste.");
  if (transfer?.startsWith("+90850")) todo.push(`Aktarma numarası bir 0850 hattı (${f.phone.transferNumber}). Asistanın kendi hattıysa ajan kendini arar. Yetkilinin cep numarasını iste; şimdilik aktarma kapalı.`);
  else if (transfer && !isTrMobile(transfer)) todo.push(`Aktarma numarası cep hattı değil (${f.phone.transferNumber}); doğruysa handoff.transferNumber alanına elle yaz.`);
  if (f.phone.when === "her-zaman" && normalizeTrPhone(f.phone.publicNumber) === normalizeTrPhone(f.contact.phone))
    todo.push("Yetkilinin telefonu, tüm çağrıları asistana yönlendirilecek numarayla aynı: yönlendirme açılınca yetkiliye bu numaradan ulaşılamaz. Başka bir iletişim numarası iste.");
  const channels = f.notifications.channels.length ? f.notifications.channels : ["sms" as const];
  if (!f.notifications.channels.length) todo.push("Onay kanalı seçilmemiş; varsayılan SMS.");
  // SMS başlığı en fazla 11 karakter; kelime ortasından kesme
  const sender = slug(f.business.name)
    .toUpperCase()
    .split("-")
    .reduce((acc, w) => (acc.length + w.length <= 11 ? acc + w : acc), "") || slug(f.business.name).replace(/-/g, "").toUpperCase().slice(0, 11);
  if (channels.includes("sms")) todo.push(`SMS başlığı "${sender}" olarak önerildi; Netgsm'de başlık onayı gerekir.`);
  if (channels.includes("whatsapp")) todo.push("WhatsApp için firmanın Meta Business hesabı gerekiyor.");

  // --- diğer ---
  if (f.closedDates) todo.push(`Kapalı günler elle girilmeli (closedDates, YYYY-AA-GG): ${f.closedDates}`);
  if (f.calendar.current === "google")
    todo.push("Randevuları Google Takvim'de tutuyor: takvimi servis hesabıyla paylaşmasını iste, takvim kimliğini calendar.google.calendarId alanına yaz ve npm run calendar:check -- <id> --yazma-testi çalıştır (docs/google-takvim-kurulumu.md). Bağlanmadan yayına alma: asistan dolu saate randevu verebilir.");
  if (f.calendar.current === "yazilim") todo.push(`Randevu programı kullanıyor: ${f.calendar.software ?? "adı yok"}. Çift takvim riski, entegrasyonu konuş.`);
  if (f.phone.languages && !/^\s*(sadece |yalnızca )?türkçe\s*$/i.test(f.phone.languages)) todo.push(`Dil notu: ${f.phone.languages}`);
  todo.push("Telefon hattı: numara müşterinin kendi Netgsm aboneliğindedir. Başvuruda bildirdiği numara firma oluşturulunca firmaya yazılır (yoksa 3. adımda bildirir; elle girmek için Müşteriler > Yönet). Asistanı kurunca hat ElevenLabs'e bağlanır. Müşterinin Netgsm SIP ayarını yaptığını doğrulamak için numarayı arayıp deneyin.");

  const faq = [
    f.business.address && { q: "Adres", a: f.business.address },
    f.policies.cancellation && { q: "İptal politikası", a: f.policies.cancellation },
    f.policies.payment && { q: "Ödeme", a: `${f.policies.payment} Telefonda ödeme alınmaz.` },
    f.policies.health && { q: "Sağlık kuralları", a: f.policies.health },
    ...(f.policies.faq ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const i = l.indexOf("?");
        return i > 0 ? { q: l.slice(0, i + 1).trim(), a: l.slice(i + 1).trim() } : { q: "Bilgi", a: l };
      }),
  ].filter(Boolean);

  const tenant = {
    id: slug(f.business.name),
    name: f.business.name,
    vertical,
    agent: { name: f.agent.name || "Defne" },
    notifications: { channels },
    timezone: "Europe/Istanbul",
    phoneNumbers: [],
    agentIds: [],
    hours,
    closedDates: [],
    minLeadMinutes: f.booking.minLeadMinutes ?? 60,
    maxDaysAhead: f.booking.maxDaysAhead ?? 30,
    services,
    staff,
    rooms,
    handoff: { ...(transfer && isTrMobile(transfer) && { transferNumber: transfer }), ...(normalizeTrPhone(f.phone.publicNumber) && { publicNumber: normalizeTrPhone(f.phone.publicNumber)! }) },
    ...(channels.includes("sms") && { sms: { sender } }),
    faq,
  };

  const parsed = TenantSchema.safeParse(tenant);
  if (!parsed.success) todo.unshift(`Ayar dosyası doğrulamadan geçmedi:\n${parsed.error.message}`);


  return { tenant, parsed: parsed.success ? parsed.data : null, todo };
}
