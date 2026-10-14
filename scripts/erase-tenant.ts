/**
 * Hizmeti sona eren firmanın verilerini siler (sözleşme: hizmet sonundan itibaren 30 gün içinde).
 * Firma önce yönetim panelinden askıya alınmış olmalı. Silinen veri geri getirilemez.
 *   fly ssh console -C 'node scripts/erase-tenant.ts <firma-id> <firma-id>'     (ikinci argüman onay: aynı kimlik)
 * Sonrasında sunucu belleğinden düşmesi için makineyi yeniden başlatın: fly machine restart -a acikhat-resepsiyon
 * Dış sistemler elle kapatılır: ElevenLabs asistanı, ElevenLabs'e bağlı 0850 numarası (Netgsm havuzuna dön), Google Takvim erişimi, Polar aboneliği.
 */
import { Store } from "../src/store/db.ts";
import { eraseTenantData } from "../src/store/retention.ts";

const [tenantId, confirm] = process.argv.slice(2);
if (!tenantId || !confirm) {
  console.error("Kullanım: node scripts/erase-tenant.ts <firma-id> <firma-id (onay)>");
  process.exit(1);
}
const store = new Store(process.env.DB_PATH ?? "data/app.db");
try {
  const r = eraseTenantData(store.db, tenantId, confirm);
  console.info(`Silindi (${tenantId}):`, r);
  console.info("Hatırlatma: ElevenLabs asistanı, 0850 numarası, Google Takvim erişimi ve Polar aboneliği elle kapatılmalı; sonra: fly machine restart");
} catch (err) {
  console.error(`Reddedildi: ${(err as Error).message}`);
  process.exit(1);
}
