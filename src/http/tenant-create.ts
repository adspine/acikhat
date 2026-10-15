import type { Deps } from "./deps.ts";
import type { OnboardingSchema } from "./onboarding.ts";
import type { z } from "zod";
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
