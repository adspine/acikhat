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
  opts: { tenant?: Tenant; tenants?: Tenant[]; google?: CalendarApi; publishAgent?: (t: Tenant) => Promise<AgentPushResult>; firebase?: FirebaseVerifier; paymentTestMode?: boolean; adminEmails?: string[]; voices?: () => Promise<import("../src/integrations/voices.ts").Voice[]> } = {},
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
    firebase: opts.firebase ?? null,
    paymentTestMode: opts.paymentTestMode ?? false,
    adminEmails: opts.adminEmails ?? [],
    voices: opts.voices ?? null,
    mailer: { send: async (m: Mail) => void mailbox.push(m) },
    baseUrl: "https://panel.test",
    toolSecret: "tool-secret",
    slotKey: "slot-key",
    webhookSecret: "wh-secret",
    secureCookies: false,
    now: () => now,
  };
  const app = createApp(deps);
  const call = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer tool-secret", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    const json = res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text;
    return { status: res.status, body: json as any };
  };
  return { app, store, sms, call, deps, published, mailbox };
}
