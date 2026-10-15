import type { Deps } from "./deps.ts";
import type { z } from "zod";
import type { User } from "../auth/users.ts";
import { OnboardingSchema } from "../domain/onboarding-schema.ts";
import { buildTenantDraft } from "../domain/onboarding-tenant.ts";
import { PLANS } from "../domain/plans.ts";
import { mailTenantReady } from "../notify/emails.ts";

type Form = z.infer<typeof OnboardingSchema>;

export type CreateResult =
  | { ok: true; tenantId: string; checklist: string[]; linkedMember: boolean }
  | { ok: false; error: string; checklist?: string[] };

/**
 * Başvuru formundan firmayı oluşturur ve (üyeyse) üyeyi firmaya bağlar; üye böylece panele girer.
 * Firma canlıya alınmış sayılmaz: asistan ve telefon numarası yönetici tarafından ayrıca kurulup bağlanır
 * (numara olmadan hiçbir çağrı firmaya ulaşmaz). Hem üyenin form gönderimi hem yöneticinin elle oluşturması bunu kullanır.
 */
export function createTenantFromSubmission(deps: Deps, s: { reference: string; userId: string | null; form: Form; approve?: boolean }): CreateResult {
  const { parsed, todo } = buildTenantDraft(s.form);
  if (!parsed) return { ok: false, error: "Firma ayarı doğrulamadan geçmedi", checklist: todo };

  // Aynı adda firma varsa sonuna sayı eklenir
  let id = parsed.id;
  for (let i = 2; deps.tenants.get(id) || deps.tenantStore.getEditable(id); i++) id = `${parsed.id}-${i}`;
  // Üyenin ödediği paketin dakikası firmanın planına işlenir (panelde kullanım buna göre gösterilir)
  const paid = s.userId ? deps.users.onboardingOf(s.userId) : null;
  const plan = paid?.paidAt && paid.plan ? { includedMinutes: PLANS[paid.plan].minutes, id: paid.plan } : parsed.plan;
  const tenant = { ...parsed, id, plan };
  deps.tenantStore.create(tenant);
  deps.tenants.set(tenant);
  if (s.userId) deps.users.assignTenant(s.userId, id);
  // Yönetici elle oluşturduysa onaylı sayılır; üyenin form gönderimiyle oluşan firma, yönetici hattı onaylayana kadar "yeni" kalır (liste rozeti)
  deps.store.db.prepare(`UPDATE onboarding_submissions SET ${s.approve ? "status = 'approved', " : ""}tenant_id = ? WHERE reference = ?`).run(id, s.reference);
  mailTenantReady(deps, tenant);
  return { ok: true, tenantId: id, checklist: todo, linkedMember: !!s.userId };
}

/**
 * Formunu göndermiş, paketini ödemiş ama firması henüz açılmamış üyenin firmasını açar (idempotent).
 * Otomatik oluşturmadan önce form gönderen üyeler ve otomatik oluşturma başarısız olanlar, oturum açınca burada yakalanır;
 * böylece kimse "numara bekleniyor" ekranında takılı kalmaz. Oluştuysa true.
 */
export function ensureTenantForMember(deps: Deps, user: User): boolean {
  if (user.tenantId || user.role === "agency") return false;
  const journey = deps.users.onboardingOf(user.id);
  if (!journey.paidAt || !journey.reference) return false;
  const row = deps.store.db.prepare("SELECT payload_json, tenant_id FROM onboarding_submissions WHERE reference = ?").get(journey.reference) as { payload_json: string; tenant_id: string | null } | undefined;
  if (!row || row.tenant_id) return false;
  const form = OnboardingSchema.safeParse(JSON.parse(row.payload_json));
  if (!form.success) return false;
  const made = createTenantFromSubmission(deps, { reference: journey.reference, userId: user.id, form: form.data });
  if (!made.ok) console.error(`[onboarding] firma otomatik oluşturulamadı (${journey.reference}): ${made.error}`);
  return made.ok;
}
