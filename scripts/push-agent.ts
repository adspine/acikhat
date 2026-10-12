/**
 * Firmanın ajanını tenants/<id>.json dosyasından üretip ElevenLabs'e gönderir (yerel geliştirme).
 *   node --env-file=.env scripts/push-agent.ts demo-spa
 * Canlıda ayarlar veritabanında; orada panelin "Yayınla" düğmesi aynı kodu (src/agent/sync.ts) çalıştırır.
 */
import { TenantRegistry } from "../src/store/tenants.ts";
import { agentEnvFrom } from "../src/agent/build.ts";
import { pushAgent } from "../src/agent/sync.ts";

const tenantId = process.argv[2];
if (!tenantId) throw new Error("Kullanım: node --env-file=.env scripts/push-agent.ts <tenant-id>");
const tenant = TenantRegistry.fromDir("tenants").get(tenantId);
if (!tenant) throw new Error(`tenants/${tenantId}.json bulunamadı`);
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) throw new Error("ELEVENLABS_API_KEY eksik");

const result = await pushAgent(tenant, { ...agentEnvFrom(process.env), apiKey });
if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}
console.info(result.created ? `Oluşturuldu: ${result.agentId} → tenants/${tenantId}.json agentIds alanına ekle` : `Güncellendi: ${result.agentId}`);
