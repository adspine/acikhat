import { serve } from "@hono/node-server";
import { createApp } from "./http/app.ts";
import type { Deps } from "./http/deps.ts";
import { applyScheduledPlans } from "./http/panel/billing.ts";
import { Store } from "./store/db.ts";
import { TenantRegistry } from "./store/tenants.ts";
import { TenantStore } from "./store/tenant-store.ts";
import { Users } from "./auth/users.ts";
import { createFirebaseVerifier, createPasswordResetSender } from "./auth/firebase.ts";
import { createVoiceCatalog } from "./integrations/voices.ts";
import { createMailer } from "./integrations/mail.ts";
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

const deps: Deps = {
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
  firebase: createFirebaseVerifier({ projectId: process.env.FIREBASE_PROJECT_ID ?? "acikhat-ai" }),
  passwordReset: createPasswordResetSender({ apiKey: process.env.FIREBASE_API_KEY ?? "AIzaSyBAW7N5g4Ihfl6-jULFjybon7AH3skBXNY" }),
  voices: process.env.ELEVENLABS_API_KEY ? createVoiceCatalog(process.env.ELEVENLABS_API_KEY) : null,
  adminEmails: (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
  paymentTestMode: (process.env.PAYMENT_TEST_MODE ?? (process.env.NODE_ENV === "production" ? "0" : "1")) === "1",
  mailer: createMailer({ apiKey: process.env.RESEND_API_KEY, from: process.env.MAIL_FROM ?? "Açık Hat <bildirim@acikhat.ai>", replyTo: "destek@acikhat.ai" }),
  baseUrl: (process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 8787}`).replace(/\/$/, ""),
  secureCookies: process.env.NODE_ENV === "production",
  now,
};
const app = createApp(deps);

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.info(`Resepsiyonist backend http://localhost:${port}`));

// Bitiş kaydı gelmeyen çağrıları dakikada bir "kaçan çağrı" olarak işaretle
setInterval(() => {
  const n = sweepMissedCalls({ store, tenants }, Date.now());
  if (n) console.info(`[calls] ${n} kaçan çağrı işaretlendi`);
}, 60_000).unref();

// Dönemi gelen paket düşürmelerini uygula (saatte bir; panel de açıldığında ayrıca kontrol eder)
setInterval(() => {
  const n = applyScheduledPlans(deps);
  if (n) console.info(`[billing] ${n} firmanın paketi yeni döneme göre değişti`);
}, 3_600_000).unref();

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
