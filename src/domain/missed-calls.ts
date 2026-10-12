import type { Store } from "../store/db.ts";
import type { TenantRegistry } from "../store/tenants.ts";
import { spokenPhone } from "./phone.ts";

const REASONS: Record<string, string> = {
  timeout: "hat doluyken beklerken kapattı veya görüşme kurulamadı",
  busy: "hat meşguldü",
  no_answer: "cevap verilemedi",
  failed: "bağlantı kurulamadı",
};

/**
 * Kaçan çağrı için resepsiyona geri arama notu açar.
 * Arayan numarası bilinmiyorsa yalnızca kayıt kalır (call_log).
 */
export function openCallbackForMissed(
  deps: { store: Store; tenants: TenantRegistry },
  call: { tenant_id: string; caller_phone: string | null; started_at: number; result?: string | undefined; call_sid: string },
): string | null {
  const tenant = deps.tenants.get(call.tenant_id);
  if (!tenant?.calls.callbackOnMissed || !call.caller_phone) return null;
  const when = Temporal.Instant.fromEpochMilliseconds(call.started_at).toZonedDateTimeISO(tenant.timezone);
  const reason = REASONS[call.result ?? "timeout"] ?? call.result;
  return deps.store.addCallback({
    tenantId: tenant.id,
    phone: call.caller_phone,
    reason: `Kaçan çağrı (${when.toPlainDate().toString()} ${when.toPlainTime().toString().slice(0, 5)}): ${reason}. Arayan: ${spokenPhone(call.caller_phone)}`,
    conversationId: call.call_sid,
  });
}

/** Belirli aralıkla çalışır: bitiş kaydı gelmeyen çağrıları kaçan çağrı sayar. */
export function sweepMissedCalls(deps: { store: Store; tenants: TenantRegistry }, nowMs: number, graceMs = 15 * 60_000) {
  const rows = deps.store.sweepMissedCalls(nowMs - graceMs, nowMs);
  for (const r of rows) openCallbackForMissed(deps, { ...r, result: "timeout" });
  return rows.length;
}
