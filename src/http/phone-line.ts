import type { Deps } from "./deps.ts";
import { TenantSchema, type Tenant } from "../domain/tenant.ts";
import { isCustomerLineNumber, normalizeLineNumber } from "../domain/phone.ts";
import { mailLineReady } from "../notify/emails.ts";

/**
 * Müşterinin asistan hattı. Numarayı müşteri kendi Netgsm aboneliğinden alır (rehber: /numara-al); biz yalnızca
 * tenant.phoneNumbers'a yazar ve ElevenLabs'te asistana bağlarız. Çağrı eşlemesinin tek kaynağı tenant.phoneNumbers'tır.
 */

/** Aynı bildirim aynı anahtar için bir kez gider (true: bu çağrıda ilk kez) */
function once(deps: Deps, tenantId: string, kind: string): boolean {
  return Number(deps.store.db.prepare("INSERT OR IGNORE INTO notice_log (tenant_id, kind, period, sent_at) VALUES (?, ?, 'once', ?)").run(tenantId, kind, Date.now()).changes) > 0;
}

/** Firmanın numaralarını yazar (canlı ayar ve varsa taslak) ve bellekteki kaydı günceller */
export function writePhones(deps: Deps, tenant: Tenant, numbers: string[]): Tenant {
  const raw = structuredClone(deps.tenantStore.getLiveRaw(tenant.id) as Record<string, unknown>);
  raw.phoneNumbers = numbers;
  const next = TenantSchema.parse(raw);
  deps.tenantStore.publish(next);
  deps.tenants.set(next);
  const editable = deps.tenantStore.getEditable(tenant.id);
  if (editable?.hasDraft) deps.tenantStore.saveDraft(tenant.id, { ...(editable.config as Record<string, unknown>), phoneNumbers: numbers });
  return next;
}

export type LineCheck = { ok: true; number: string } | { ok: false; status: 409 | 422; error: string };

/**
 * Hat numarasının uygunluğu. strict (müşteri girişi): yalnızca 0850 ya da sabit hat; cep numarası olamaz.
 * Yönetici girişi (strict değil) geçerli her numarayı kabul eder. Başka firmada kayıtlı numara reddedilir;
 * müşteriye hangi firmanın olduğu söylenmez (otherName yalnızca yönetici mesajında).
 */
export function checkLineNumber(deps: Deps, raw: string, opts: { tenantId?: string | undefined; strict?: boolean; revealOwner?: boolean } = {}): LineCheck {
  const n = normalizeLineNumber(raw);
  if (!n) return { ok: false, status: 422, error: `Geçersiz numara: ${raw}` };
  if (opts.strict && !isCustomerLineNumber(n)) return { ok: false, status: 422, error: "0850 ile başlayan işletme numarası ya da şehir kodlu sabit hat (örneğin 0212, 0374) yazın. Cep numarası olmaz." };
  const other = deps.tenants.all().find((t) => t.id !== opts.tenantId && t.phoneNumbers.includes(n));
  if (other) return { ok: false, status: 409, error: opts.revealOwner ? `${n} numarası ${other.name} firmasına atanmış` : "Bu numara başka bir hesapta kayıtlı. Numarayı doğru yazdığınızdan emin olun; sorun sürerse support@acikhat.si adresine yazın." };
  return { ok: true, number: n };
}

/** Firmanın sahibi yeni kurulum yolculuğundan (başvuruyla) gelmiş mi: "hat hazır" e-postası yalnızca onlara gider */
function fromOnboarding(deps: Deps, tenantId: string): boolean {
  return deps.users.listForTenant(tenantId).some((u) => u.role === "owner" && !!deps.users.onboardingOf(u.id).reference);
}

/**
 * Numarayı ElevenLabs'te asistana bağlar. Başvuruyla gelen firmaya numara başına bir kez "hat hazır" e-postası gider
 * (eski, elle kurulmuş müşteriler habersiz e-posta almasın).
 */
export async function connectTenantLine(deps: Deps, tenant: Tenant): Promise<{ connected: boolean; error?: string }> {
  if (!tenant.phoneNumbers.length) return { connected: false, error: "Firmaya atanmış numara yok" };
  if (!tenant.agentIds.length) return { connected: false, error: "Numara kaydedildi ama asistan kurulu değil; önce asistanı kurun, sonra hat bağlanır" };
  if (!deps.connectPhone) return { connected: false, error: "Numara bağlama bu sunucuda kapalı" };
  const r = await deps.connectPhone(tenant);
  if (!r.ok) return { connected: false, error: r.error };
  if (fromOnboarding(deps, tenant.id)) {
    for (const n of tenant.phoneNumbers) if (once(deps, tenant.id, `line-ready:${n}`)) mailLineReady(deps, tenant, n);
  }
  return { connected: true };
}

/** Firmaya yöneticinin onayladığı numarayı yazar (önce checkLineNumber ile denetlenmiş olmalı) ve asistana bağlar */
export async function assignLine(deps: Deps, tenantIn: Tenant, number: string, actorId: string | null): Promise<{ number: string; connected: boolean; note?: string }> {
  const tenant = deps.tenants.get(tenantIn.id) ?? tenantIn;
  const withNumber = tenant.phoneNumbers.includes(number) ? tenant : writePhones(deps, tenant, [...tenant.phoneNumbers, number]);
  deps.store.audit({ tenantId: tenant.id, userId: actorId, action: "line.assign", target: number });
  const link = await connectTenantLine(deps, withNumber);
  return { number, connected: link.connected, ...(link.error && { note: link.error }) };
}

/** Yönetici firmanın numaralarını değiştirince kaldırılan numaralar ElevenLabs'ten de silinir (eski asistana çağrı düşmesin) */
export async function disconnectRemovedNumbers(deps: Deps, tenantId: string, before: string[], after: string[], actorId: string | null): Promise<void> {
  for (const n of before) {
    if (after.includes(n)) continue;
    if (deps.disconnectPhone) await deps.disconnectPhone(n).catch(() => undefined);
    deps.store.audit({ tenantId, userId: actorId, action: "line.release", target: n });
  }
}
