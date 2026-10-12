import type { Tenant } from "../domain/tenant.ts";
import { buildAgent, type AgentEnv } from "./build.ts";

export type AgentPushResult = { ok: true; agentId: string; created: boolean } | { ok: false; error: string };

/**
 * Firmanın ajanını ElevenLabs'te günceller; ajanı yoksa oluşturur.
 * Hata mesajı Türkçe ve panelde gösterilebilir biçimde döner (istisna fırlatmaz).
 */
export async function pushAgent(
  tenant: Tenant,
  env: AgentEnv & { apiKey: string },
  fetchFn: typeof fetch = fetch,
): Promise<AgentPushResult> {
  const agentId = tenant.agentIds[0];
  let res: Response;
  try {
    res = await fetchFn(
      agentId ? `https://api.elevenlabs.io/v1/convai/agents/${agentId}` : "https://api.elevenlabs.io/v1/convai/agents/create",
      {
        method: agentId ? "PATCH" : "POST",
        headers: { "xi-api-key": env.apiKey, "content-type": "application/json" },
        body: JSON.stringify(buildAgent(tenant, env)),
        signal: AbortSignal.timeout(20_000),
      },
    );
  } catch (err) {
    return { ok: false, error: `Asistan sunucusuna ulaşılamadı: ${(err as Error).message}` };
  }
  const json = (await res.json().catch(() => ({}))) as { agent_id?: string; detail?: unknown };
  if (!res.ok) {
    const detail = typeof json.detail === "string" ? json.detail : JSON.stringify(json.detail ?? json).slice(0, 400);
    return { ok: false, error: `Asistan güncellenemedi (${res.status}): ${detail}` };
  }
  return { ok: true, agentId: agentId ?? json.agent_id!, created: !agentId };
}
