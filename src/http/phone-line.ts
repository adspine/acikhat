import type { Deps } from "./deps.ts";
import { POOL } from "../domain/phone-pool.ts";
import { TenantSchema, type Tenant } from "../domain/tenant.ts";
import { PhonePool } from "../store/phone-pool.ts";
import { mailLineReady, mailPoolEmpty, mailPoolLow, mailPoolRenewal } from "../notify/emails.ts";

/**
 * Hat havuzunun iş kuralları: atama, bırakma, ElevenLabs bağlantısı, bakım.
 * Çağrı eşlemesinin tek kaynağı tenant.phoneNumbers'tır; havuz tablosu envanterdir ve ikisi birlikte güncellenir.
 */
export const poolOf = (deps: Deps) => new PhonePool(deps.store.db);

const day = (deps: Deps) => deps.now().toPlainDate().toString();
const nowMs = (deps: Deps) => deps.now().epochMilliseconds;

/** Aynı uyarı aynı dönemde bir kez gider (true: bu çağrıda ilk kez) */
function once(deps: Deps, kind: string, period: string): boolean {
  return Number(deps.store.db.prepare("INSERT OR IGNORE INTO notice_log (tenant_id, kind, period, sent_at) VALUES ('_pool', ?, ?, ?)").run(kind, period, Date.now()).changes) > 0;
}

/** Firmanın numaralarını yazar (canlı ayar ve varsa taslak) ve bellekteki kaydı günceller */
function writePhones(deps: Deps, tenant: Tenant, numbers: string[]): Tenant {
  const raw = structuredClone(deps.tenantStore.getLiveRaw(tenant.id) as Record<string, unknown>);
  raw.phoneNumbers = numbers;
  const next = TenantSchema.parse(raw);
  deps.tenantStore.publish(next);
  deps.tenants.set(next);
  const editable = deps.tenantStore.getEditable(tenant.id);
  if (editable?.hasDraft) deps.tenantStore.saveDraft(tenant.id, { ...(editable.config as Record<string, unknown>), phoneNumbers: numbers });
  return next;
}

/** Firmanın sahibi paketini ödemiş mi (Polar webhook'u doğrulamış mı) */
export function ownerPaid(deps: Deps, tenantId: string): boolean {
  return deps.users.listForTenant(tenantId).some((u) => u.role === "owner" && !!deps.users.onboardingOf(u.id).paidAt);
}

/** Hat bekleyen firmalar: ödemiş sahibi var, askıda değil, hiç numarası yok */
export function waitingTenants(deps: Deps): Tenant[] {
  return deps.tenants.all().filter((t) => !t.suspended && t.phoneNumbers.length === 0 && ownerPaid(deps, t.id));
}

/** Müsait numara azaldıysa yöneticiye (günde bir kez) haber verir */
export function checkPoolStock(deps: Deps): void {
  const { available } = poolOf(deps).stats();
  if (available <= POOL.lowStockAt && once(deps, "pool-low", day(deps))) mailPoolLow(deps, available);
}

/**
 * Numarayı ElevenLabs'te asistana bağlar. Havuzdan atanmış bir numaraysa müşteriye "hat hazır" e-postası (numara başına bir kez) gider.
 * Elle girilmiş numaralar için e-posta gitmez (mevcut müşteriler habersiz e-posta almasın).
 */
export async function connectTenantLine(deps: Deps, tenant: Tenant): Promise<{ connected: boolean; error?: string }> {
  if (!tenant.phoneNumbers.length) return { connected: false, error: "Firmaya atanmış numara yok" };
  if (!deps.connectPhone) return { connected: false, error: "Numara bağlama bu sunucuda kapalı" };
  if (!tenant.agentIds.length) return { connected: false, error: "Numara kaydedildi ama asistan kurulu değil; önce asistanı kurun, sonra hat bağlanır" };
  const r = await deps.connectPhone(tenant);
  if (!r.ok) return { connected: false, error: r.error };
  const pool = poolOf(deps);
  for (const n of tenant.phoneNumbers) {
    const row = pool.get(n);
    if (row?.status === "assigned" && row.tenantId === tenant.id && once(deps, `line-ready:${tenant.id}:${n}`, "once")) mailLineReady(deps, tenant, n);
  }
  return { connected: true };
}

export type AssignResult =
  | { ok: true; number: string; created: boolean; connected: boolean; note?: string }
  | { ok: false; reason: "unpaid" | "has_number" | "empty" | "no_tenant"; message: string };

/**
 * Firmaya havuzdan numara atar.
 * requirePaid: otomatik yolda zorunlu (ödemeyen numara tüketemez); yönetici düğmesinde kapatılabilir.
 * Tekrar çağrılabilir: firmanın zaten havuz numarası varsa aynısı döner.
 */
export async function assignLine(deps: Deps, tenantIn: Tenant, opts: { requirePaid: boolean; actorId: string | null }): Promise<AssignResult> {
  const tenant = deps.tenants.get(tenantIn.id);
  if (!tenant) return { ok: false, reason: "no_tenant", message: "Firma bulunamadı" };
  const pool = poolOf(deps);
  if (opts.requirePaid && !ownerPaid(deps, tenant.id)) return { ok: false, reason: "unpaid", message: "Firmanın sahibi paketini henüz ödememiş" };
  const mine = pool.forTenant(tenant.id);
  if (!mine && tenant.phoneNumbers.length) return { ok: false, reason: "has_number", message: "Firmanın elle girilmiş bir numarası var; havuzdan ek numara atanmadı" };

  pool.promoteExpired(nowMs(deps));
  const picked = pool.assign(tenant.id, nowMs(deps));
  if (!picked) {
    if (once(deps, `pool-empty:${tenant.id}`, day(deps))) mailPoolEmpty(deps, tenant);
    deps.store.audit({ tenantId: tenant.id, userId: opts.actorId, action: "pool.empty", target: tenant.id });
    return { ok: false, reason: "empty", message: "Havuzda müsait numara yok. Netgsm'den numara alıp Hat havuzuna ekleyin; ekleyince bu firmaya kendiliğinden atanır." };
  }

  const withNumber = tenant.phoneNumbers.includes(picked.number) ? tenant : writePhones(deps, tenant, [...tenant.phoneNumbers, picked.number]);
  deps.store.audit({ tenantId: tenant.id, userId: opts.actorId, action: "pool.assign", target: picked.number });
  const link = await connectTenantLine(deps, withNumber);
  checkPoolStock(deps);
  return { ok: true, number: picked.number, created: picked.created, connected: link.connected, ...(link.error && { note: link.error }) };
}

/** Hat bekleyen tüm firmalara, numara yettiği kadar atar (havuza numara eklenince ve günlük bakımda çalışır) */
export async function assignWaiting(deps: Deps): Promise<{ tenantId: string; tenantName: string; number: string; connected: boolean }[]> {
  const done: { tenantId: string; tenantName: string; number: string; connected: boolean }[] = [];
  for (const t of waitingTenants(deps)) {
    const r = await assignLine(deps, t, { requirePaid: true, actorId: null });
    if (!r.ok) {
      if (r.reason === "empty") break;
      continue;
    }
    done.push({ tenantId: t.id, tenantName: t.name, number: r.number, connected: r.connected });
  }
  return done;
}

/**
 * Atanmış numarayı bırakır: karantinaya alınır (POOL.quarantineDays boyunca kimseye verilmez), firmadan çıkarılır,
 * ElevenLabs'ten kaldırılır. ElevenLabs adımı başarısız olursa numara yine karantinadadır; hata mesajı elle kaldırmayı söyler.
 */
export async function releaseLine(deps: Deps, number: string, actorId: string | null): Promise<{ ok: true; disconnected: boolean; warning?: string } | { ok: false; error: string }> {
  const pool = poolOf(deps);
  const row = pool.get(number);
  if (!row) return { ok: false, error: "Numara havuzda yok" };
  if (row.status !== "assigned") return { ok: false, error: "Numara şu an bir firmaya atanmış değil" };
  const tenant = row.tenantId ? deps.tenants.get(row.tenantId) : undefined;
  pool.release(number, nowMs(deps));
  if (tenant) writePhones(deps, tenant, tenant.phoneNumbers.filter((n) => n !== number));
  let disconnected = false;
  let warning: string | undefined;
  if (!deps.disconnectPhone) warning = "ElevenLabs bağlantısı bu sunucuda kapalı; numarayı ElevenLabs panelinden elle kaldırın.";
  else {
    const r = await deps.disconnectPhone(number);
    disconnected = r.ok;
    if (!r.ok) warning = `${r.error}. Numara karantinada ama ElevenLabs'te hâlâ bağlı olabilir; elle kaldırın.`;
  }
  deps.store.audit({ tenantId: row.tenantId, userId: actorId, action: "pool.release", target: number, detail: { disconnected } });
  checkPoolStock(deps);
  return { ok: true, disconnected, ...(warning && { warning }) };
}

/** Yöneticinin firma numaralarını elle değiştirmesi havuz envanterini bozmasın */
export async function syncPoolWithTenantNumbers(deps: Deps, tenantId: string, before: string[], after: string[], actorId: string | null): Promise<void> {
  const pool = poolOf(deps);
  for (const n of after) if (!before.includes(n)) pool.markAssigned(n, tenantId, nowMs(deps));
  for (const n of before) {
    if (after.includes(n)) continue;
    const row = pool.get(n);
    if (row?.status === "assigned" && row.tenantId === tenantId) {
      pool.release(n, nowMs(deps));
      if (deps.disconnectPhone) await deps.disconnectPhone(n).catch(() => undefined);
      deps.store.audit({ tenantId, userId: actorId, action: "pool.release", target: n, detail: { source: "tenant-edit" } });
    }
  }
  checkPoolStock(deps);
}

/** Günlük bakım: karantinası biten numaralar müsait olur, yenilemesi yaklaşanlar için uyarı, stok kontrolü, bekleyen firmalar */
export async function poolMaintenance(deps: Deps): Promise<{ promoted: number; renewalReminders: number; assigned: number }> {
  const pool = poolOf(deps);
  const promoted = pool.promoteExpired(nowMs(deps));
  const names = new Map(deps.tenants.all().map((t) => [t.id, t.name]));
  const month = day(deps).slice(0, 7);
  const due = pool.renewalsDue(nowMs(deps)).filter((r) => once(deps, `pool-renew:${r.number}`, month));
  if (due.length) mailPoolRenewal(deps, due.map((r) => ({ number: r.number, renewAt: r.renewAt, tenantName: r.tenantId ? (names.get(r.tenantId) ?? null) : null })));
  checkPoolStock(deps);
  const assigned = (await assignWaiting(deps)).length;
  return { promoted, renewalReminders: due.length, assigned };
}
