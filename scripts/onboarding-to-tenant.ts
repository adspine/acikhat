/**
 * Web sitesinden gelen başvuruları listeler veya birini firma ayar dosyası taslağına çevirir.
 *   node --env-file=.env scripts/onboarding-to-tenant.ts            → başvuruları listele
 *   node --env-file=.env scripts/onboarding-to-tenant.ts VO-7K3Q    → tenants/<id>.json taslağı + kontrol listesi
 * Taslak doğrudan yayına girmez: eksikler tamamlanıp `agent:push` çalıştırılınca ajan kurulur.
 */
import { existsSync, writeFileSync } from "node:fs";
import { Store } from "../src/store/db.ts";
import { OnboardingSchema } from "../src/http/onboarding.ts";
import { buildTenantDraft } from "../src/domain/onboarding-tenant.ts";
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

const { tenant, todo } = buildTenantDraft(f);

const out = `tenants/${tenant.id}.json`;
if (existsSync(out)) throw new Error(`${out} zaten var; üzerine yazmıyorum. Eski dosyayı kontrol et.`);
writeFileSync(out, JSON.stringify(tenant, null, 2) + "\n");
store.db.prepare("UPDATE onboarding_submissions SET status = 'reviewing' WHERE reference = ?").run(ref);

console.info(`Taslak yazıldı: ${out}\nYetkili: ${f.contact.person}, ${f.contact.phone}${f.contact.email ? `, ${f.contact.email}` : ""}\n`);
console.info("Kurulumdan önce kontrol et:");
for (const t of todo) console.info(`  - ${t}`);
