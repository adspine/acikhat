/**
 * Web sitesinden gelen başvuruları listeler veya birini firma ayar dosyası taslağına çevirir.
 *   node --env-file=.env scripts/onboarding-to-tenant.ts            → başvuruları listele
 *   node --env-file=.env scripts/onboarding-to-tenant.ts VO-7K3Q    → tenants/<id>.json taslağı + kontrol listesi
 * Taslak doğrudan yayına girmez: eksikler tamamlanıp `agent:push` çalıştırılınca ajan kurulur.
 */
import { existsSync, writeFileSync } from "node:fs";
import { Store } from "../src/store/db.ts";
import { OnboardingSchema } from "../src/http/onboarding.ts";
import { TenantSchema } from "../src/domain/tenant.ts";
import { normalizeTrPhone, isTrMobile } from "../src/domain/phone.ts";
import type { z } from "zod";

const store = new Store(process.env.DB_PATH ?? "data/app.db");
const ref = process.argv[2];

if (!ref) {
  const rows = store.db
    .prepare("SELECT reference, business_name, contact_phone, status, created_at FROM onboarding_submissions ORDER BY created_at DESC")
    .all() as { reference: string; business_name: string; contact_phone: string; status: string; created_at: number }[];
  if (!rows.length) console.info("Henüz başvuru yok.");
  for (const r of rows) console.info(`${r.reference}  ${r.status.padEnd(9)}  ${new Date(r.created_at).toLocaleString("tr-TR")}  ${r.business_name} (${r.contact_phone})`);
  process.exit(0);
}

const row = store.db.prepare("SELECT payload_json FROM onboarding_submissions WHERE reference = ?").get(ref) as { payload_json: string } | undefined;
if (!row) throw new Error(`${ref} bulunamadı`);
const f: z.infer<typeof OnboardingSchema> = OnboardingSchema.parse(JSON.parse(row.payload_json));

const todo: string[] = [];
const slug = (s: string) =>
  s
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" })[c]!)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

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
    roomType: s.room ?? "tek",
    staffCount: s.staffCount ?? 1,
  };
});
if (!services.length) todo.push("Hizmet listesi boş.");
for (const s of f.services)
  if (/çift|iki kişi/i.test(s.name) && (s.staffCount ?? 1) < 2) todo.push(`"${s.name}" çift hizmeti gibi görünüyor ama 1 terapist girilmiş; doğru mu?`);
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
  if (!p.gender) todo.push(`${p.name} için cinsiyet seçilmemiş (kadın/erkek terapist tercihi için gerekli).`);
  if (!ids.length) todo.push(`${p.name} hangi hizmetleri yapıyor, seçilmemiş.`);
  return { id: slug(p.name), name: p.name, gender: p.gender ?? "kadin", services: ids };
});
if (!staff.length) todo.push("Ekip listesi boş.");

// --- odalar ---
const rooms: { id: string; type: string }[] = [];
for (const type of ["tek", "cift", "hamam"] as const) for (let i = 1; i <= (f.rooms[type] ?? 0); i++) rooms.push({ id: `${type}-${i}`, type });
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
todo.push("0850 hattı açılınca phoneNumbers alanına yaz, sonra `npm run agent:push` ve `npm run phone:connect`.");

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
  vertical: f.business.sector,
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
  handoff: transfer && isTrMobile(transfer) ? { transferNumber: transfer } : {},
  ...(channels.includes("sms") && { sms: { sender } }),
  faq,
};

const parsed = TenantSchema.safeParse(tenant);
if (!parsed.success) todo.unshift(`Ayar dosyası doğrulamadan geçmedi:\n${parsed.error.message}`);

const out = `tenants/${tenant.id}.json`;
if (existsSync(out)) throw new Error(`${out} zaten var; üzerine yazmıyorum. Eski dosyayı kontrol et.`);
writeFileSync(out, JSON.stringify(tenant, null, 2) + "\n");
store.db.prepare("UPDATE onboarding_submissions SET status = 'reviewing' WHERE reference = ?").run(ref);

console.info(`Taslak yazıldı: ${out}\nYetkili: ${f.contact.person}, ${f.contact.phone}${f.contact.email ? `, ${f.contact.email}` : ""}\n`);
console.info("Kurulumdan önce kontrol et:");
for (const t of todo) console.info(`  - ${t}`);
