import { serve } from "@hono/node-server";
import { createApp } from "./http/app.ts";
import { Store } from "./store/db.ts";
import { TenantRegistry } from "./store/tenants.ts";
import { TenantStore } from "./store/tenant-store.ts";
import { Users } from "./auth/users.ts";
import { createNotifier } from "./integrations/notify.ts";
import { sweepMissedCalls } from "./domain/missed-calls.ts";
import { Calendars } from "./calendar/calendars.ts";
import { BookingService } from "./booking/service.ts";
import { staffNames } from "./domain/tenant.ts";
import { GoogleCalendarClient, loadServiceAccount } from "./integrations/google/client.ts";
import { agentEnvFrom } from "./agent/build.ts";
import { pushAgent } from "./agent/sync.ts";
import { analyzeCall, type PostCallData } from "./domain/call-outcome.ts";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} ortam değişkeni eksik (.env.example'a bak)`);
  return v;
}

const store = new Store(process.env.DB_PATH ?? "data/app.db");

// Firma ayarları veritabanında; tenants/*.json yalnızca ilk kurulum ve yeni firma tohumu
const tenantStore = new TenantStore(store.db);
const seeded = tenantStore.seedFromDir("tenants");
if (seeded.length) console.info(`[tenants] dosyadan içeri alındı: ${seeded.join(", ")}`);
const tenants = new TenantRegistry(tenantStore.loadLive());
const backfilled = store.backfillCalls((tenantId, data) => analyzeCall(tenantId ? tenants.get(tenantId) : undefined, data as PostCallData));
if (backfilled) console.info(`[calls] ${backfilled} eski çağrı kaydı güncellendi`);

const serviceAccount = loadServiceAccount(process.env);
const calendars = new Calendars(store, serviceAccount ? new GoogleCalendarClient(serviceAccount) : null);
if (serviceAccount) console.info(`Google Takvim servis hesabı: ${serviceAccount.client_email}`);
const notifier = createNotifier(process.env);
const now = () => Temporal.Now.zonedDateTimeISO("UTC");

const app = createApp({
  store,
  tenants,
  tenantStore,
  users: new Users(store.db),
  notifier,
  calendars,
  booking: new BookingService({ store, calendars, notifier, now }),
  publishAgent: async (tenant) => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return { ok: false, error: "ELEVENLABS_API_KEY tanımlı değil" };
    try {
      return await pushAgent(tenant, { ...agentEnvFrom(process.env), apiKey });
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },
  toolSecret: required("TOOL_SECRET"),
  slotKey: required("SLOT_SIGNING_KEY"),
  webhookSecret: process.env.ELEVENLABS_WEBHOOK_SECRET ?? "",
  secureCookies: process.env.NODE_ENV === "production",
  now,
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.info(`Resepsiyonist backend http://localhost:${port}`));

// Bitiş kaydı gelmeyen çağrıları dakikada bir "kaçan çağrı" olarak işaretle
setInterval(() => {
  const n = sweepMissedCalls({ store, tenants }, Date.now());
  if (n) console.info(`[calls] ${n} kaçan çağrı işaretlendi`);
}, 60_000).unref();

// Firma takvimine yazılamamış randevuları dakikada bir yeniden dene
setInterval(() => {
  calendars
    .retryPending(
      (id) => tenants.get(id),
      (tenant, r) => {
        const at = (ms: number) => Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(tenant.timezone);
        const extra = r.extra_staff_ids ? r.extra_staff_ids.split(",") : [];
        return {
          id: r.id,
          serviceName: tenant.services.find((s) => s.id === r.service_id)?.name ?? r.service_id,
          staffId: r.staff_id,
          extraStaffIds: extra,
          staffName: staffNames(tenant, [r.staff_id, ...extra]),
          roomId: r.room_id,
          customerName: r.customer_name,
          customerPhone: r.customer_phone,
          start: at(r.start_ms),
          end: at(r.end_ms),
          blockEndMs: r.block_end_ms,
        };
      },
    )
    .then((n) => n && console.info(`[calendar] ${n} randevu takvime yazıldı`))
    .catch((err) => console.error("[calendar] yeniden deneme hatası", err));
}, 60_000).unref();

// Süresi dolan oturumları günde bir temizle
setInterval(() => new Users(store.db).purgeExpiredSessions(), 86_400_000).unref();
