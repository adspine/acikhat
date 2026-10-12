/**
 * Firmanın 0850 numarasını (SIP trunk) ElevenLabs'e tanıtır ve firmanın ajanına bağlar.
 *   node --env-file=.env scripts/connect-phone.ts <tenant-id>
 *
 * Netgsm tarafında (webportal > Ses Hizmeti > Ayarlar > Sip Bilgileri) yapılması gerekenler:
 *   - "SIP Trunk" aktif, SIP Trunk Bilgileri: sip.rtc.elevenlabs.io  Port: 5060
 *   - Aranan Prefix: +90   (ElevenLabs'e numara +90850... olarak gelir; burada da öyle tanıtılır)
 *
 * Gelen çağrı: Netgsm → sip.rtc.elevenlabs.io:5060 → ajan
 * Giden bacak (insana aktarma): ElevenLabs → sip.netgsm.com.tr (Netgsm SIP kullanıcı adı/şifresiyle)
 */
import { TenantRegistry } from "../src/store/tenants.ts";

const API = "https://api.elevenlabs.io/v1/convai";
const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY eksik");

const tenantId = process.argv[2];
if (!tenantId) throw new Error("Kullanım: node --env-file=.env scripts/connect-phone.ts <tenant-id>");
const tenant = TenantRegistry.fromDir("tenants").get(tenantId);
if (!tenant) throw new Error(`tenants/${tenantId}.json bulunamadı`);
const agentId = tenant.agentIds[0];
const number = tenant.phoneNumbers[0];
if (!agentId || !number) throw new Error("Tenant dosyasında agentIds ve phoneNumbers dolu olmalı");

const sipUser = process.env.NETGSM_SIP_USERNAME;
const sipPass = process.env.NETGSM_SIP_PASSWORD;
if (!sipUser || !sipPass) throw new Error("NETGSM_SIP_USERNAME ve NETGSM_SIP_PASSWORD .env içinde olmalı");

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "xi-api-key": key!, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 800)}`);
  return JSON.parse(text) as T;
}

const config = {
  label: `${tenant.name} (${number})`,
  agent_id: agentId,
  // Netgsm SRTP desteği doğrulanana kadar "allowed": şifreli medya varsa kullanılır, yoksa düz devam eder
  inbound_trunk_config: { media_encryption: "allowed" },
  outbound_trunk_config: {
    address: "sip.netgsm.com.tr",
    transport: "auto",
    media_encryption: "allowed",
    credentials: { username: sipUser, password: sipPass },
  },
  // Pilot boyunca açık: bağlantı sorunlarında GET /phone-numbers/{id}/sip-messages ile okunur
  store_sip_messages: true,
};

const existing = (await api<{ phone_number: string; phone_number_id: string }[]>("GET", "/phone-numbers")).find(
  (p) => p.phone_number === number,
);
if (existing) {
  await api("PATCH", `/phone-numbers/${existing.phone_number_id}`, config);
  console.info(`Güncellendi: ${number} → ${agentId} (${existing.phone_number_id})`);
} else {
  const { phone_number_id } = await api<{ phone_number_id: string }>("POST", "/phone-numbers", {
    ...config,
    phone_number: number,
    provider: "sip_trunk",
  });
  console.info(`Bağlandı: ${number} → ${agentId} (${phone_number_id})`);
}
