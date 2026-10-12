/**
 * Firma paneline kullanıcı açar ve geçici şifre verir (ilk girişte değiştirilir).
 *   node --env-file=.env scripts/create-user.ts <firma-id> <e-posta> "<Ad Soyad>" [owner|team]
 * Canlıda:  fly ssh console -C 'node scripts/create-user.ts von-resort-spa sahip@ornek.com "Ad Soyad" owner'
 */
import { Store } from "../src/store/db.ts";
import { Users, temporaryPassword } from "../src/auth/users.ts";

const [tenantId, email, name, role = "owner"] = process.argv.slice(2);
if (!tenantId || !email || !name || !["owner", "team"].includes(role)) {
  console.error('Kullanım: node scripts/create-user.ts <firma-id> <e-posta> "<Ad Soyad>" [owner|team]');
  process.exit(1);
}
const store = new Store(process.env.DB_PATH ?? "data/app.db");
if (!store.db.prepare("SELECT 1 FROM tenants WHERE id = ?").get(tenantId)) {
  console.error(`Firma bulunamadı: ${tenantId} (sunucu en az bir kez açılmış olmalı)`);
  process.exit(1);
}
const password = temporaryPassword();
const user = await new Users(store.db).create({ tenantId, email, name, role: role as "owner" | "team", password });
console.info(`Kullanıcı açıldı: ${user.name} <${user.email}> (${role === "owner" ? "sahip" : "ekip"})\nGeçici şifre: ${password}\nİlk girişte kendi şifresini belirleyecek.`);
