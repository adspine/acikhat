import type { Tenant } from "../domain/tenant.ts";
import { initVariables } from "../http/webhooks.ts";

export const DEMO_MAX_SECONDS = 120;

export type DemoCallStart = { ok: true; conversationId: string } | { ok: false; error: string };

const API = "https://api.elevenlabs.io/v1/convai";

/** Test görüşmesinde asistanın ilk cümlesi: kim olduğunu, kaydı ve süreyi söyler */
export const demoGreeting = (t: Tenant) =>
  `${t.name}, merhaba. Ben yapay zekâ asistanı ${t.agent.name}. Açık Hat test görüşmesi için sizi aradım. Görüşmemiz kaydediliyor ve en fazla iki dakika sürecek. Bir randevu almayı deneyebilirsiniz. Nasıl yardımcı olabilirim?`;

export const demoTimeUpMessage = "Test görüşmemiz için ayrılan süre doldu. Açık Hat'ı denediğiniz için teşekkürler, iyi günler dilerim.";

/**
 * Landing sayfasındaki test görüşmesi: firmanın 0850 hattından ziyaretçinin cep numarasını arar ve demo firmanın asistanına bağlar.
 * Süre sınırı ve karşılama yalnızca bu çağrıya özeldir (asistanın kendi ayarları değişmez); ElevenLabs bu geçersiz kılmaları
 * agent ayarında açık olduğunda kabul eder (build.ts: platform_settings.overrides).
 */
export async function startDemoCall(
  tenant: Tenant,
  env: { apiKey: string },
  call: { phone: string; demoId: string; nowUtc: Temporal.ZonedDateTime; ringingSecs?: number },
  fetchFn: typeof fetch = fetch,
): Promise<DemoCallStart> {
  const agentId = tenant.agentIds[0];
  const fromNumber = tenant.phoneNumbers[0];
  if (!agentId || !fromNumber) return { ok: false, error: "Demo firmanın asistanı ya da hattı tanımlı değil" };
  const headers = { "xi-api-key": env.apiKey, "content-type": "application/json" };
  try {
    const list = await fetchFn(`${API}/phone-numbers`, { headers, signal: AbortSignal.timeout(10_000) });
    if (!list.ok) return { ok: false, error: `Hat listesi alınamadı (${list.status})` };
    const phoneNumberId = ((await list.json()) as { phone_number: string; phone_number_id: string }[]).find((p) => p.phone_number === fromNumber)?.phone_number_id;
    if (!phoneNumberId) return { ok: false, error: `${fromNumber} ElevenLabs'te kayıtlı değil (panelden "kaydet ve bağla")` };

    const res = await fetchFn(`${API}/sip-trunk/outbound-call`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        agent_id: agentId,
        agent_phone_number_id: phoneNumberId,
        to_number: call.phone,
        conversation_initiation_client_data: {
          dynamic_variables: { ...initVariables(tenant, call.nowUtc, call.phone), demo_call_id: call.demoId },
          conversation_config_override: {
            agent: { first_message: demoGreeting(tenant), max_conversation_duration_message: demoTimeUpMessage },
            conversation: { max_duration_seconds: DEMO_MAX_SECONDS },
          },
        },
        telephony_call_config: { ringing_timeout_secs: call.ringingSecs ?? 30 },
      }),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `Arama başlatılamadı (${res.status}): ${text.slice(0, 250)}` };
    const json = JSON.parse(text) as { success?: boolean; message?: string; conversation_id?: string | null };
    if (json.success === false || !json.conversation_id) return { ok: false, error: `Arama başlatılamadı: ${json.message ?? "bilinmeyen hata"}` };
    return { ok: true, conversationId: json.conversation_id };
  } catch (err) {
    return { ok: false, error: `Arama başlatılamadı: ${(err as Error).message}` };
  }
}
