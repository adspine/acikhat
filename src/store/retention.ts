import type { DatabaseSync } from "node:sqlite";
import { RETENTION } from "../domain/retention.ts";

const DAY = 86_400_000;
/** Anonimleştirilen randevularda ad yerine yazılır; ikinci çalıştırmada tekrar işlenmesin diye de işaret görevi görür */
export const ERASED_NAME = "Silinmiş kayıt";

export interface PurgeResult {
  callsAnonymized: number;
  callLogAnonymized: number;
  callbacksDeleted: number;
  appointmentsAnonymized: number;
  demoCallsDeleted: number;
  leadsDeleted: number;
  auditDeleted: number;
  webhookEventsDeleted: number;
}

/**
 * Süresi dolan kişisel verileri siler veya anonimleştirir. Günde bir ve açılışta çalışır; tekrar çalıştırmak zararsızdır.
 * Anonimleştirme: süre, sonuç, tarih gibi kişisel veri içermeyen istatistikler (kullanım ve fatura kanıtı) kalır.
 * Silinen hiçbir şey geri getirilemez: koşullar yalnızca yaş ölçütüne bağlıdır, firma veya kullanıcı girdisinden türemez.
 */
export function purgeExpired(db: DatabaseSync, nowMs: number): PurgeResult {
  const before = (days: number) => nowMs - days * DAY;
  const run = (sql: string, ...params: (string | number)[]) => Number(db.prepare(sql).run(...params).changes);
  return {
    callsAnonymized: run(
      "UPDATE calls SET payload_json = '{}', summary = NULL, caller_phone = NULL WHERE COALESCE(started_at, received_at) < ? AND (payload_json != '{}' OR summary IS NOT NULL OR caller_phone IS NOT NULL)",
      before(RETENTION.callDays),
    ),
    callLogAnonymized: run("UPDATE call_log SET caller_phone = NULL WHERE started_at < ? AND caller_phone IS NOT NULL", before(RETENTION.callDays)),
    callbacksDeleted: run("DELETE FROM callback_requests WHERE created_at < ?", before(RETENTION.callbackDays)),
    appointmentsAnonymized: run("UPDATE appointments SET customer_name = ?, customer_phone = '' WHERE end_ms < ? AND customer_name != ?", ERASED_NAME, before(RETENTION.appointmentDays), ERASED_NAME),
    demoCallsDeleted: run("DELETE FROM demo_calls WHERE created_at < ?", before(RETENTION.demoCallDays)),
    leadsDeleted: run("DELETE FROM onboarding_submissions WHERE tenant_id IS NULL AND status IN ('new', 'rejected') AND created_at < ?", before(RETENTION.leadDays)),
    auditDeleted: run("DELETE FROM audit_log WHERE at < ?", before(RETENTION.auditDays)),
    webhookEventsDeleted: run("DELETE FROM webhook_events WHERE received_at < ?", before(RETENTION.webhookEventDays)),
  };
}

export interface EraseResult {
  users: number;
  sessions: number;
  appointments: number;
  callbacks: number;
  calls: number;
  callLog: number;
  audit: number;
  submissions: number;
  notices: number;
  tenant: number;
  /** Firmanın asistana bağlı numaraları (ElevenLabs bağlantısı elle kaldırılmalı; numara müşterinindir, Netgsm'de onda kalır) */
  phoneNumbers: string[];
}

/**
 * Hizmeti sona eren bir firmanın verilerini siler (hizmet sonu + RETENTION.terminationDays içinde yapılır).
 * Güvenlik: firma var olmalı, askıda olmalı (canlı bir firma yanlışlıkla silinmesin) ve onay metni firma kimliğiyle birebir aynı olmalı.
 * Fatura ve ödeme kayıtları (orders) yasal saklama için kalır. ElevenLabs asistanı ve 0850 numarası dış sistemlerdedir, elle kapatılır.
 */
export function eraseTenantData(db: DatabaseSync, tenantId: string, confirm: string, nowMs: number = Date.now()): EraseResult {
  if (!tenantId || confirm !== tenantId) throw new Error("Onay metni firma kimliğiyle aynı olmalı");
  const row = db.prepare("SELECT config_live FROM tenants WHERE id = ?").get(tenantId) as { config_live: string } | undefined;
  if (!row) throw new Error(`Firma bulunamadı: ${tenantId}`);
  let suspended = false;
  try {
    suspended = (JSON.parse(row.config_live) as { suspended?: boolean }).suspended === true;
  } catch {
    /* bozuk kayıt: askıda sayılmaz, silme reddedilir */
  }
  if (!suspended) throw new Error("Firma askıda değil: önce hizmeti askıya alın (yönetim paneli > müşteri > askıya al)");

  const run = (sql: string) => Number(db.prepare(sql).run(tenantId).changes);
  db.exec("BEGIN");
  try {
    // Numara müşterinin Netgsm aboneliğindedir; yalnızca asistan bağlantısı kaldırılacağı için numaralar bildirilir
    let phoneNumbers: string[] = [];
    try {
      phoneNumbers = (JSON.parse(row.config_live) as { phoneNumbers?: string[] }).phoneNumbers ?? [];
    } catch {
      /* bozuk kayıt: numara listesi alınamaz */
    }
    const result: EraseResult = {
      phoneNumbers,
      sessions: run("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ?)"),
      users: run("DELETE FROM users WHERE tenant_id = ?"),
      appointments: run("DELETE FROM appointments WHERE tenant_id = ?"),
      callbacks: run("DELETE FROM callback_requests WHERE tenant_id = ?"),
      calls: run("DELETE FROM calls WHERE tenant_id = ?"),
      callLog: run("DELETE FROM call_log WHERE tenant_id = ?"),
      audit: run("DELETE FROM audit_log WHERE tenant_id = ?"),
      submissions: run("DELETE FROM onboarding_submissions WHERE tenant_id = ?"),
      notices: run("DELETE FROM notice_log WHERE tenant_id = ?"),
      tenant: run("DELETE FROM tenants WHERE id = ?"),
    };
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
