/**
 * Firmanın Google Takvim bağlantısını kontrol eder ve önümüzdeki 7 günün etkinliklerinin
 * asistan tarafından nasıl yorumlandığını gösterir.
 *   node --env-file=.env scripts/check-calendar.ts <tenant-id> [--yazma-testi]
 * --yazma-testi: takvime deneme etkinliği ekleyip hemen siler (yazma yetkisini doğrular).
 */
import { TenantRegistry } from "../src/store/tenants.ts";
import { GoogleCalendarClient, loadServiceAccount } from "../src/integrations/google/client.ts";
import { eventsToBlocks } from "../src/calendar/calendars.ts";

const tenantId = process.argv[2];
const writeTest = process.argv.includes("--yazma-testi");
const tenant = tenantId ? TenantRegistry.fromDir("tenants").get(tenantId) : undefined;
if (!tenant) throw new Error("Kullanım: node --env-file=.env scripts/check-calendar.ts <tenant-id> [--yazma-testi]");
const g = tenant.calendar.google;
if (tenant.calendar.provider !== "google" || !g) throw new Error(`${tenant.id} Google Takvim kullanmıyor (calendar.provider)`);

const sa = loadServiceAccount(process.env);
if (!sa) throw new Error("GOOGLE_SERVICE_ACCOUNT_FILE .env içinde tanımlı değil (docs/google-takvim-kurulumu.md)");
const api = new GoogleCalendarClient(sa);
console.info(`Servis hesabı: ${sa.client_email}\nTakvim: ${g.calendarId}\n`);

const now = Temporal.Now.zonedDateTimeISO(tenant.timezone);
const from = now.toPlainDate().toZonedDateTime(tenant.timezone);
const to = from.add({ days: 7 });

const calendars = [[g.calendarId, undefined] as const, ...Object.entries(g.staffCalendars).map(([staff, id]) => [id, staff] as const)];
for (const [calendarId, owner] of calendars) {
  let events;
  try {
    events = await api.listEvents(calendarId, from.toInstant().toString(), to.toInstant().toString());
  } catch (err) {
    console.error(`✗ ${calendarId} okunamadı: ${(err as Error).message}`);
    console.error(`  Takvimi ${sa.client_email} adresiyle "Etkinliklerde değişiklik yapma" yetkisiyle paylaştığından emin ol.`);
    process.exitCode = 1;
    continue;
  }
  console.info(`✓ ${calendarId}${owner ? ` (${owner} terapistinin takvimi)` : ""}: 7 günde ${events.length} etkinlik`);
  const staffName = (id?: string) => tenant.staff.find((s) => s.id === id)?.name;
  for (const e of events.slice(0, 40)) {
    const [b] = eventsToBlocks(tenant, [e], owner);
    const when = e.start.dateTime
      ? Temporal.Instant.from(e.start.dateTime).toZonedDateTimeISO(tenant.timezone).toPlainDateTime().toString().slice(0, 16).replace("T", " ")
      : `${e.start.date} (tüm gün)`;
    const meaning = !b
      ? "dikkate alınmıyor (iptal/serbest)"
      : b.everything
        ? "GÜN KAPALI: hiç randevu verilmez"
        : b.staffId && b.staffId !== "-"
          ? `${staffName(b.staffId)} meşgul`
          : "kimin olduğu bilinmiyor: bir terapist + bir oda dolu sayılır";
    console.info(`   ${when}  "${e.summary ?? ""}"  →  ${meaning}`);
  }
  if (events.length > 40) console.info(`   … ve ${events.length - 40} etkinlik daha`);
}

if (writeTest && api.deleteEvent) {
  const start = now.add({ days: 1 }).round({ smallestUnit: "hour", roundingMode: "floor" });
  const fmt = (z: Temporal.ZonedDateTime) => z.toPlainDateTime().toString({ smallestUnit: "second" });
  try {
    const id = await api.insertEvent(g.calendarId, {
      summary: "Bağlantı testi (silinecek)",
      start: { dateTime: fmt(start), timeZone: tenant.timezone },
      end: { dateTime: fmt(start.add({ minutes: 15 })), timeZone: tenant.timezone },
    });
    await api.deleteEvent(g.calendarId, id);
    console.info("\n✓ Yazma yetkisi var (deneme etkinliği eklendi ve silindi).");
  } catch (err) {
    console.error(`\n✗ Takvime yazılamadı: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
