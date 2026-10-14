import type { Mail } from "../src/integrations/mail.ts";
import { readFileSync } from "node:fs";
import { TenantSchema, type Tenant } from "../src/domain/tenant.ts";
import { Store } from "../src/store/db.ts";
import { TenantRegistry } from "../src/store/tenants.ts";
import { ConsoleChannel, Notifier } from "../src/integrations/notify.ts";
import { createApp } from "../src/http/app.ts";
import { Calendars } from "../src/calendar/calendars.ts";
import type { CalendarApi } from "../src/integrations/google/client.ts";
import { BookingService } from "../src/booking/service.ts";
import { TenantStore } from "../src/store/tenant-store.ts";
import { Users } from "../src/auth/users.ts";
import type { AgentPushResult } from "../src/agent/sync.ts";
import type { FirebaseVerifier } from "../src/auth/firebase.ts";

export const demoTenant: Tenant = TenantSchema.parse(
  JSON.parse(readFileSync(new URL("../tenants/demo-spa.json", import.meta.url), "utf8")),
);

/** Pazartesi 12 Ekim 2026, 09:00 İstanbul */
export const MONDAY_9AM = Temporal.ZonedDateTime.from("2026-10-12T09:00[Europe/Istanbul]");

export function makeApp(
  now = MONDAY_9AM,
  opts: { tenant?: Tenant; tenants?: Tenant[]; google?: CalendarApi; publishAgent?: (t: Tenant) => Promise<AgentPushResult>; connectPhone?: (t: Tenant) => Promise<import("../src/agent/phone.ts").PhoneConnectResult>; disconnectPhone?: (n: string) => Promise<import("../src/agent/phone.ts").PhoneDisconnectResult>; startDemoCall?: NonNullable<import("../src/http/deps.ts").Deps["startDemoCall"]>; demoTenantId?: string; firebase?: FirebaseVerifier; paymentTestMode?: boolean; adminEmails?: string[]; voices?: () => Promise<import("../src/integrations/voices.ts").Voice[]> } = {},
) {
  const store = new Store(":memory:");
  const sms = new ConsoleChannel("sms");
  const notifier = new Notifier({ sms });
  const calendars = new Calendars(store, opts.google ?? null, { cacheMs: 0 });
  const tenantList = opts.tenants ?? [opts.tenant ?? demoTenant];
  const tenantStore = new TenantStore(store.db);
  for (const t of tenantList) tenantStore.create(t);
  const published: Tenant[] = [];
  const mailbox: Mail[] = [];
  const resets: string[] = [];
  const deps = {
    store,
    notifier,
    calendars,
    booking: new BookingService({ store, calendars, notifier, now: () => now }),
    tenants: new TenantRegistry(tenantList),
    tenantStore,
    users: new Users(store.db),
    publishAgent:
      opts.publishAgent ?? (async (t: Tenant) => (published.push(t), { ok: true as const, agentId: t.agentIds[0] ?? "agent_test", created: false })),
    ...(opts.connectPhone && { connectPhone: opts.connectPhone }),
    ...(opts.disconnectPhone && { disconnectPhone: opts.disconnectPhone }),
    ...(opts.startDemoCall && { startDemoCall: opts.startDemoCall, demoTenantId: opts.demoTenantId ?? "demo-spa" }),
    firebase: opts.firebase ?? null,
    paymentTestMode: opts.paymentTestMode ?? false,
    adminEmails: opts.adminEmails ?? [],
    voices: opts.voices ?? null,
    mailer: { send: async (m: Mail) => void mailbox.push(m) },
    passwordReset: async (email: string) => void resets.push(email),
    baseUrl: "https://panel.test",
    toolSecret: "tool-secret",
    slotKey: "slot-key",
    webhookSecret: "wh-secret",
    secureCookies: false,
    now: () => now,
  };
  const app = createApp(deps);
  const raw = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer tool-secret", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    const json = res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text;
    return { status: res.status, body: json as any };
  };
  /**
   * Araç çağrısı. book_appointment gerçekte prepare_confirmation jetonu ister; testlerin çoğu randevu akışının
   * kendisini sınadığı için jeton burada otomatik alınır. Jeton kurallarını sınayan testler `raw` kullanır.
   */
  const call = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    const b = body as Record<string, unknown> | string;
    if (path.endsWith("/book_appointment") && typeof b === "object" && b.confirmed_by_caller === true && !("confirmation_token" in b)) {
      const prep = await raw(path.replace(/book_appointment$/, "prepare_confirmation"), { slot_id: b.slot_id, customer_name: b.customer_name, customer_phone: b.customer_phone }, headers);
      if (!prep.body.ok) return prep;
      return raw(path, { ...b, customer_name: prep.body.customer_name, customer_phone: prep.body.customer_phone, confirmation_token: prep.body.confirmation_token }, headers);
    }
    return raw(path, body, headers);
  };
  return { app, store, sms, call, raw, deps, published, mailbox, resets };
}

/** Paketini ödemiş, giriş yapmış üye: kurulum formu gönderebilir. Çerez döner. */
export async function paidMemberCookie(ctx: ReturnType<typeof makeApp>, email = "uye@ornek.com") {
  const { app, deps } = ctx;
  const m = await deps.users.create({ tenantId: null, email, name: "Yeni Üye", role: "owner", password: "sifre-12345", mustChangePassword: false });
  deps.users.selectPlan(m.id, "standart");
  deps.users.markPaid(m.id);
  const login = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-panel": "1" }, body: JSON.stringify({ email, password: "sifre-12345" }) });
  return login.headers.get("set-cookie")!.split(";")[0]!;
}
