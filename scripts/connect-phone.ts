/**
 * Firmanın 0850 numarasını (SIP trunk) ElevenLabs'e tanıtır ve firmanın ajanına bağlar.
 *   node --env-file=.env scripts/connect-phone.ts <tenant-id>
 * Panelde aynı iş: Yönetici > Müşteriler > firma > Telefon hattı (numarayı kaydedince otomatik bağlanır).
 *
 * Netgsm tarafında (webportal > Ses Hizmeti > Ayarlar > Sip Bilgileri) yapılması gerekenler:
 *   - "SIP Trunk" aktif, SIP Trunk Bilgileri: sip.rtc.elevenlabs.io  Port: 5060  (protokol: TCP)
 *   - Aranan Prefix: +90   (ElevenLabs'e numara +90850... olarak gelir; burada da öyle tanıtılır)
 *
 * Gelen çağrı: Netgsm → sip.rtc.elevenlabs.io:5060 → ajan
 * Giden bacak (insana aktarma): ElevenLabs → sip.netgsm.com.tr (Netgsm SIP kullanıcı adı/şifresiyle)
 */
import { TenantRegistry } from "../src/store/tenants.ts";
import { connectPhoneNumbers } from "../src/agent/phone.ts";

const tenantId = process.argv[2];
if (!tenantId) throw new Error("Kullanım: node --env-file=.env scripts/connect-phone.ts <tenant-id>");
const tenant = TenantRegistry.fromDir("tenants").get(tenantId);
if (!tenant) throw new Error(`tenants/${tenantId}.json bulunamadı`);
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) throw new Error("ELEVENLABS_API_KEY eksik");

const result = await connectPhoneNumbers(tenant, {
  apiKey,
  sipUsername: process.env.NETGSM_SIP_USERNAME ?? "",
  sipPassword: process.env.NETGSM_SIP_PASSWORD ?? "",
});
if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}
for (const c of result.connected) console.info(`${c.created ? "Bağlandı" : "Güncellendi"}: ${c.number} → ${tenant.agentIds[0]} (${c.phoneNumberId})`);
