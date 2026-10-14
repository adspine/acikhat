import { checkQuotaNotices } from "./panel/billing.ts";
import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Deps } from "./deps.ts";
import type { Tenant } from "../domain/tenant.ts";
import { openCallbackForMissed } from "../domain/missed-calls.ts";
import { analyzeCall, type PostCallData } from "../domain/call-outcome.ts";
import { dateTable, spokenDate, spokenTime } from "../domain/time.ts";
import { normalizeTrPhone, spokenPhone } from "../domain/phone.ts";
import { DemoCalls, type DemoEnd } from "../store/demo-calls.ts";
import { safeEqual } from "./security.ts";

/** Görüşmeyi kimin bitirdiği: ElevenLabs'in kapanış nedeninden */
export function endedBy(reason: string | undefined): DemoEnd {
  if (!reason) return "other";
  if (/end_call/i.test(reason)) return "agent";
  if (/duration|time ?limit|max/i.test(reason)) return "limit";
  if (/disconnect|hang|client|user|caller/i.test(reason)) return "caller";
  return "other";
}

/** ElevenLabs-Signature: "t=<unix>,v0=<hex hmac_sha256(secret, `${t}.${body}`)>" */
export function verifyElevenLabsSignature(
  header: string | undefined,
  rawBody: string,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
  toleranceSec = 30 * 60,
): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > toleranceSec || !parts.v0) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"));
  const given = Buffer.from(parts.v0);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Arama başında ajana verilen dinamik değişkenler (telefon webhook'u ve tarayıcı test sayfası ortak) */
export function initVariables(tenant: Tenant, nowUtc: Temporal.ZonedDateTime, callerId?: string) {
  const now = nowUtc.withTimeZone(tenant.timezone);
  const caller = normalizeTrPhone(callerId);
  return {
    tenant_id: tenant.id,
    today: `${spokenDate(now.toPlainDate())} ${now.year}`,
    now_time: spokenTime(now.toPlainTime()),
    date_table: dateTable(now.toPlainDate()),
    caller_phone: caller ?? "",
    caller_phone_spoken: caller ? spokenPhone(caller) : "bilinmiyor",
  };
}

export function webhookRoutes(deps: Deps) {
  const app = new Hono();
  const demoCalls = () => deps.demoCalls ?? new DemoCalls(deps.store.db);

  const markEnded = (callSid: string, conversationId: string | undefined, result: string, atMs: number) => {
    const row = deps.store.db.prepare("SELECT tenant_id, caller_phone, started_at FROM call_log WHERE call_sid = ? AND status = 'started'").get(callSid) as
      | { tenant_id: string; caller_phone: string | null; started_at: number }
      | undefined;
    if (!row || !deps.store.logCallEnd({ callSid, conversationId, result, atMs })) return;
    if (result !== "answered") openCallbackForMissed(deps, { ...row, result, call_sid: callSid });
  };

  /**
   * Gelen arama başında ElevenLabs bu adresi çağırır (SIP/Twilio "conversation initiation client data" webhook).
   * Dönen dinamik değişkenler system prompt'taki {{...}} yerlerine yazılır.
   */
  app.post("/elevenlabs/init", async (c) => {
    if (!safeEqual(c.req.header("authorization"), `Bearer ${deps.toolSecret}`)) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => null)) as { caller_id?: string; agent_id?: string; called_number?: string; call_sid?: string } | null;
    if (!body || typeof body !== "object") return c.json({ error: "bad request" }, 400);
    const tenant = deps.tenants.find({
      agentId: body.agent_id,
      calledNumber: normalizeTrPhone(body.called_number) ?? body.called_number,
    });
    if (!tenant) return c.json({ error: "unknown tenant" }, 404);
    if (tenant.suspended) return c.json({ error: "tenant suspended" }, 403);

    // Giden arama (landing test görüşmesi): arayan taraf bizim kendi hattımız. Gelen çağrı gibi kaydedilmez
    // (kaçan çağrı ve geri arama notu açılmasın) ve "arayan" olarak aranan kişi yazılır.
    const caller = normalizeTrPhone(body.caller_id);
    const outbound = !!caller && deps.tenants.all().some((t) => t.phoneNumbers.includes(caller));
    if (outbound) {
      return c.json({
        type: "conversation_initiation_client_data",
        dynamic_variables: initVariables(tenant, deps.now(), body.called_number),
      });
    }

    // Her gelen çağrının kaydı: bitiş kaydı gelmezse kaçan çağrı sayılır (missed-calls.ts)
    if (body.call_sid) {
      deps.store.logCallStart({
        callSid: body.call_sid,
        tenantId: tenant.id,
        agentId: body.agent_id,
        callerPhone: normalizeTrPhone(body.caller_id),
        calledNumber: body.called_number,
        atMs: deps.now().epochMilliseconds,
      });
    }

    return c.json({
      type: "conversation_initiation_client_data",
      dynamic_variables: initVariables(tenant, deps.now(), body.caller_id),
    });
  });

  /** Görüşme bittikten sonra transkript, özet ve analiz. HMAC imzası zorunlu. */
  app.post("/elevenlabs/post-call", async (c) => {
    const raw = await c.req.text();
    if (!verifyElevenLabsSignature(c.req.header("elevenlabs-signature"), raw, deps.webhookSecret)) {
      return c.json({ error: "invalid signature" }, 401);
    }
    const event = JSON.parse(raw) as {
      type: string;
      data?: {
        conversation_id?: string;
        agent_id?: string;
        metadata?: {
          start_time_unix_secs?: number;
          call_duration_secs?: number;
          termination_reason?: string;
          phone_call?: { call_sid?: string; call_result?: string | null } | null;
          // call_initiation_failure olayında
          body?: { call_sid?: string } | null;
        };
        failure_reason?: string;
        analysis?: { call_successful?: string; transcript_summary?: string };
        conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> };
      };
    };
    const d = event.data;
    const nowMs = deps.now().epochMilliseconds;

    // Kurulamayan çağrı (meşgul, cevapsız, bağlantı hatası)
    if (event.type === "call_initiation_failure") {
      const callSid = d?.metadata?.phone_call?.call_sid ?? d?.metadata?.body?.call_sid;
      if (callSid) markEnded(callSid, d?.conversation_id, d?.failure_reason ?? "failed", nowMs);
      if (d?.conversation_id) demoCalls().markUnanswered(d.conversation_id, d.failure_reason ?? "failed", nowMs);
      return c.json({ ok: true });
    }
    // Ses dosyası vb. diğer olay türlerini şimdilik yalnızca onaylıyoruz.
    if (event.type !== "post_call_transcription" || !d?.conversation_id) return c.json({ ok: true });

    const callSid = d.metadata?.phone_call?.call_sid;
    if (callSid) markEnded(callSid, d.conversation_id, d.metadata?.phone_call?.call_result ?? "answered", nowMs);

    const tenantId =
      (d.conversation_initiation_client_data?.dynamic_variables?.tenant_id as string | undefined) ??
      deps.tenants.find({ agentId: d.agent_id })?.id;
    const a = analyzeCall(tenantId ? deps.tenants.get(tenantId) : undefined, d as PostCallData);
    deps.store.saveCall({
      conversationId: d.conversation_id!,
      tenantId,
      agentId: d.agent_id,
      startedAtMs: d.metadata?.start_time_unix_secs ? d.metadata.start_time_unix_secs * 1000 : undefined,
      durationSecs: d.metadata?.call_duration_secs,
      callSuccessful: d.analysis?.call_successful,
      summary: d.analysis?.transcript_summary,
      outcome: a.outcome,
      callerPhone: a.callerPhone,
      appointmentId: a.appointmentId,
      afterHours: a.afterHours,
      payload: event,
    });
    // Landing test görüşmesi ise sonucu demo kaydına yaz
    demoCalls().finish(d.conversation_id, {
      durationSecs: d.metadata?.call_duration_secs,
      endedBy: endedBy(d.metadata?.termination_reason),
      booked: a.outcome === "booked",
      atMs: nowMs,
    });
    if (tenantId) {
      try {
        checkQuotaNotices(deps, tenantId);
      } catch (err) {
        console.error(`[kota] bildirim kontrolü başarısız: ${(err as Error).message}`);
      }
    }
    return c.json({ ok: true });
  });

  return app;
}
