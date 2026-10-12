/**
 * Eski panelden (yerel şifreyle) açılmış kullanıcıları Firebase'e ekler ve şifre belirleme e-postası gönderir.
 * Firebase hesabı rastgele bir şifreyle açılır; kullanıcı e-postadaki bağlantıyla kendi şifresini belirler
 * (bağlantı e-postayı da doğrulamış sayar) ve yeni giriş sayfasından e-posta + şifreyle girer.
 *
 *   node --env-file=.env scripts/migrate-users-to-firebase.ts --dry-run    # yalnızca listeler
 *   node --env-file=.env scripts/migrate-users-to-firebase.ts              # uygular
 * Canlıda: flyctl ssh console -a acikhat-resepsiyon -C "node scripts/migrate-users-to-firebase.ts"
 *
 * Gereken: FIREBASE_API_KEY (yoksa web sitesindeki herkese açık anahtar kullanılır). Yönetici hesapları atlanır.
 * Zaten Firebase'de kayıtlı e-postalar atlanır. Yeniden çalıştırmak güvenlidir.
 * Not: Eski şifrelerini bilen kullanıcılar bunu beklemeden de yeni girişten eski şifreyle girebilir;
 * o durumda hesapları girişte otomatik taşınır. Bu betik, şifresini unutanlar ve hiç girmeyenler içindir.
 */
import { randomBytes } from "node:crypto";
import { Store } from "../src/store/db.ts";

const API_KEY = process.env.FIREBASE_API_KEY ?? "AIzaSyBAW7N5g4Ihfl6-jULFjybon7AH3skBXNY";
const dry = process.argv.includes("--dry-run");
const BASE = "https://identitytoolkit.googleapis.com/v1/accounts";

async function call(path: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${BASE}:${path}?key=${API_KEY}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  return res.ok ? { ok: true } : { ok: false, error: json.error?.message ?? `HTTP ${res.status}` };
}

const store = new Store(process.env.DB_PATH ?? "data/app.db");
const users = store.db.prepare("SELECT email, name, role FROM users WHERE firebase_uid IS NULL AND role != 'agency' AND disabled = 0 ORDER BY created_at").all() as { email: string; name: string; role: string }[];
console.info(`Taşınacak kullanıcı: ${users.length}${dry ? " (deneme: hiçbir şey gönderilmeyecek)" : ""}`);

let created = 0;
let existing = 0;
let failed = 0;
for (const u of users) {
  if (dry) {
    console.info(`  - ${u.email} (${u.name}, ${u.role})`);
    continue;
  }
  const made = await call("signUp", { email: u.email, password: randomBytes(24).toString("base64url"), returnSecureToken: false });
  if (!made.ok && made.error !== "EMAIL_EXISTS") {
    console.error(`  ✗ ${u.email}: hesap açılamadı (${made.error})`);
    failed++;
    continue;
  }
  if (made.ok) created++;
  else existing++;
  // Hesap yeni açıldıysa kullanıcı şifresini bu e-postayla belirler; zaten varsa da bağlantı işe yarar
  const mail = await call("sendOobCode", { requestType: "PASSWORD_RESET", email: u.email });
  if (mail.ok) console.info(`  ✓ ${u.email}: ${made.ok ? "Firebase hesabı açıldı" : "zaten kayıtlı"}, şifre belirleme e-postası gönderildi`);
  else {
    console.error(`  ✗ ${u.email}: e-posta gönderilemedi (${mail.error})`);
    failed++;
  }
}
if (!dry) console.info(`Bitti: ${created} yeni hesap, ${existing} zaten kayıtlıydı, ${failed} hata.`);
