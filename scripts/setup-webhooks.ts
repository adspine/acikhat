/**
 * ElevenLabs'te görüşme sonu (post-call) webhook'unu PUBLIC_BASE_URL'e göre kurar.
 *   node --env-file=.env scripts/setup-webhooks.ts
 * ElevenLabs webhook adresinin değiştirilmesine izin vermez: adres değiştiyse yeni webhook
 * oluşturulur, eskisi silinir. Yeni id ve HMAC secret .env'e yazılır; ardından
 *   fly secrets set ELEVENLABS_WEBHOOK_SECRET=...   ve   npm run agent:push -- <firma>
 * çalıştırılmalıdır (script hatırlatır).
 */
import { readFileSync, writeFileSync } from "node:fs";

const key = process.env.ELEVENLABS_API_KEY;
const base = process.env.PUBLIC_BASE_URL;
if (!key || !base) throw new Error("ELEVENLABS_API_KEY ve PUBLIC_BASE_URL gerekli");

const API = "https://api.elevenlabs.io/v1/workspace/webhooks";
const headers = { "xi-api-key": key, "content-type": "application/json" };
const url = `${base}/webhooks/elevenlabs/post-call`;
const existingId = process.env.ELEVENLABS_POST_CALL_WEBHOOK_ID;

const list = (await (await fetch(API, { headers })).json()) as { webhooks?: { webhook_id: string; webhook_url: string }[] };
const existing = list.webhooks?.find((w) => w.webhook_id === existingId);
if (existing?.webhook_url === url) {
  console.info(`Webhook zaten doğru adreste: ${url}`);
  process.exit(0);
}

const res = await fetch(API, {
  method: "POST",
  headers,
  body: JSON.stringify({ settings: { auth_type: "hmac", name: "resepsiyonist-post-call", webhook_url: url } }),
});
const created = (await res.json()) as { webhook_id?: string; webhook_secret?: string };
if (!res.ok || !created.webhook_id || !created.webhook_secret) throw new Error(`Oluşturulamadı: ${res.status} ${JSON.stringify(created)}`);

// Geçici hatalarda (5xx, zaman aşımı) ElevenLabs yeniden denesin
const patch = await fetch(`${API}/${created.webhook_id}`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ retry_enabled: true, is_disabled: false, name: "resepsiyonist-post-call" }),
});
if (!patch.ok) console.warn(`Uyarı: yeniden deneme açılamadı (${patch.status}): ${await patch.text()}`);

// .env'deki id ve secret'ı değiştir (yoksa ekle)
let env = readFileSync(".env", "utf8");
const put = (name: string, value: string) => {
  const re = new RegExp(`^${name}=.*$`, "m");
  env = re.test(env) ? env.replace(re, `${name}=${value}`) : `${env.trimEnd()}\n${name}=${value}\n`;
};
put("ELEVENLABS_POST_CALL_WEBHOOK_ID", created.webhook_id);
put("ELEVENLABS_WEBHOOK_SECRET", created.webhook_secret);
writeFileSync(".env", env);

// Eski webhook ajanlara bağlıyken silinemez: agent:push'tan sonra silinmeli
if (existing) console.info(`Eski webhook (${existing.webhook_id}) agent:push'tan sonra silinmeli:
  curl -X DELETE ${API}/${existing.webhook_id} -H "xi-api-key: …"`);
console.info(`Yeni webhook: ${url} (${created.webhook_id}); id ve secret .env'e yazıldı.
Şimdi:  fly secrets set ELEVENLABS_WEBHOOK_SECRET=<.env'deki değer>  ve  npm run agent:push -- <firma>`);
