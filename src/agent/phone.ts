import type { Tenant } from "../domain/tenant.ts";

export type PhoneConnectResult =
  | { ok: true; connected: { number: string; created: boolean; phoneNumberId: string }[] }
  | { ok: false; error: string };

export interface PhoneEnv {
  apiKey: string;
  sipUsername: string;
  sipPassword: string;
}

const API = "https://api.elevenlabs.io/v1/convai";

/**
 * Firmanın 0850 numaralarını (Netgsm SIP trunk) ElevenLabs'e tanıtır ve firmanın asistanına bağlar.
 * Numara zaten kayıtlıysa günceller. Netgsm tarafı (SIP Trunk → sip.rtc.elevenlabs.io:5060, Aranan Prefix +90) panelden elle yapılır.
 * Giden bacak (insana aktarma): ElevenLabs → sip.netgsm.com.tr
 */
export async function connectPhoneNumbers(tenant: Tenant, env: PhoneEnv, fetchFn: typeof fetch = fetch): Promise<PhoneConnectResult> {
  const agentId = tenant.agentIds[0];
  if (!agentId) return { ok: false, error: "Önce asistanı kurun (müşteri satırı ⋮ > Asistanı kur)" };
  if (!tenant.phoneNumbers.length) return { ok: false, error: "Firmaya atanmış numara yok" };
  if (!env.sipUsername || !env.sipPassword) return { ok: false, error: "NETGSM_SIP_USERNAME ve NETGSM_SIP_PASSWORD sunucuda tanımlı değil" };

  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetchFn(`${API}${path}`, {
      method,
      headers: { "xi-api-key": env.apiKey, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  };

  try {
    const existing = await call<{ phone_number: string; phone_number_id: string }[]>("GET", "/phone-numbers");
    const connected: { number: string; created: boolean; phoneNumberId: string }[] = [];
    for (const number of tenant.phoneNumbers) {
      const config = {
        label: `${tenant.name} (${number})`,
        agent_id: agentId,
        // Netgsm SRTP desteği doğrulanana kadar "allowed": şifreli medya varsa kullanılır, yoksa düz devam eder
        inbound_trunk_config: { media_encryption: "allowed" },
        outbound_trunk_config: {
          address: "sip.netgsm.com.tr",
          transport: "auto",
          media_encryption: "allowed",
          credentials: { username: env.sipUsername, password: env.sipPassword },
        },
        // Pilot boyunca açık: bağlantı sorunlarında GET /phone-numbers/{id}/sip-messages ile okunur
        store_sip_messages: true,
      };
      const found = existing.find((p) => p.phone_number === number);
      if (found) {
        await call("PATCH", `/phone-numbers/${found.phone_number_id}`, config);
        connected.push({ number, created: false, phoneNumberId: found.phone_number_id });
      } else {
        const { phone_number_id } = await call<{ phone_number_id: string }>("POST", "/phone-numbers", { ...config, phone_number: number, provider: "sip_trunk" });
        connected.push({ number, created: true, phoneNumberId: phone_number_id });
      }
    }
    return { ok: true, connected };
  } catch (err) {
    return { ok: false, error: `Numara asistana bağlanamadı: ${(err as Error).message}` };
  }
}
