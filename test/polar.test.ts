import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { demoTenant, makeApp, MONDAY_9AM } from "./helpers.ts";
import { createPolar, verifyStandardWebhook, type Polar } from "../src/integrations/polar.ts";

const SECRET = "whsec_" + Buffer.from("test-secret-bytes").toString("base64");
const sign = (id: string, ts: string, body: string, key: Buffer) => `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`;

describe("webhook imzası", () => {
  const body = '{"type":"order.paid"}';
  const now = 1_800_000_000;
  const ts = String(now);
  it("yeni (base64 çözülmüş) ve eski (düz metin) anahtarı kabul eder, bozuk imzayı reddeder", () => {
    const std = sign("m1", ts, body, Buffer.from("test-secret-bytes"));
    const legacy = sign("m1", ts, body, Buffer.from(SECRET));
    expect(verifyStandardWebhook(SECRET, { id: "m1", timestamp: ts, signature: std }, body, now)).toBe(true);
    expect(verifyStandardWebhook(SECRET, { id: "m1", timestamp: ts, signature: legacy }, body, now)).toBe(true);
    expect(verifyStandardWebhook(SECRET, { id: "m1", timestamp: ts, signature: `v1,AAAA ${std}` }, body, now)).toBe(true);
    expect(verifyStandardWebhook(SECRET, { id: "m1", timestamp: ts, signature: std }, body + " ", now)).toBe(false);
    expect(verifyStandardWebhook(SECRET, { id: "m1", timestamp: ts, signature: std }, body, now + 3600)).toBe(false);
    expect(verifyStandardWebhook("", { id: "m1", timestamp: ts, signature: std }, body, now)).toBe(false);
  });
});

const PRODUCTS = { baslangic: "p-b", standart: "p-s", pro: "p-p", "ek-100": "p-e1", "ek-300": "p-e3", "ek-600": "p-e6" };

function fakePolar() {
  const calls: any[] = [];
  const polar: Polar = {
    createCheckout: async (o) => (calls.push(["checkout", o]), { id: "co_1", url: "https://polar.test/checkout/co_1" }),
    changePlan: async (...a) => void calls.push(["change", ...a]),
    verifyWebhook: (h) => h.signature === "ok",
    itemOf: () => undefined,
  };
  return { polar, calls };
}

async function setup() {
  const { polar, calls } = fakePolar();
  const ctx = makeApp(MONDAY_9AM, { tenant: { ...demoTenant, plan: { id: "standart", includedMinutes: 1000 } } });
  (ctx.deps as any).polar = polar;
  const { app, deps } = ctx;
  const owner = await deps.users.create({ tenantId: demoTenant.id, email: "sahip@lavanta.com", name: "Ayla", role: "owner", password: "sifre-12345", mustChangePassword: false });
  deps.users.selectPlan(owner.id, "standart");
  const login = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-panel": "1" }, body: JSON.stringify({ email: "sahip@lavanta.com", password: "sifre-12345" }) });
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const as = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { cookie, "x-panel": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as any };
  };
  const hook = async (event: unknown, signature = "ok") => {
    const res = await app.request("/webhooks/polar", { method: "POST", headers: { "content-type": "application/json", "webhook-id": "w1", "webhook-timestamp": "1", "webhook-signature": signature }, body: JSON.stringify(event) });
    return res.status;
  };
  return { ...ctx, owner, as, hook, calls };
}

describe("Polar ile ödeme akışı", () => {
  it("üyelik: /pay ödeme sayfası adresi döner, ödenmiş sayılmaz; webhook ödenmiş yapar ve abonelik kimliğini saklar", async () => {
    const { as, hook, calls, deps, owner } = await setup();
    const r = await as("POST", "/api/auth/pay");
    expect(r).toMatchObject({ status: 200, body: { checkoutUrl: "https://polar.test/checkout/co_1" } });
    expect(calls[0][1]).toMatchObject({ item: "standart", externalCustomerId: owner.id, metadata: { kind: "membership", user_id: owner.id, plan: "standart" } });
    expect(deps.users.onboardingOf(owner.id).paidAt).toBeNull();

    const event = { type: "order.paid", data: { id: "o1", subscription_id: "sub_1", metadata: { kind: "membership", user_id: owner.id, plan: "standart" } } };
    expect(await hook(event, "bozuk")).toBe(403);
    expect(deps.users.onboardingOf(owner.id).paidAt).toBeNull();
    expect(await hook(event)).toBe(200);
    expect(await hook(event)).toBe(200); // tekrar gelirse zarar vermez
    expect(deps.users.onboardingOf(owner.id).paidAt).not.toBeNull();
    expect(deps.users.polarSubscriptionOf(owner.id)).toBe("sub_1");
  });

  it("ek dakika: sipariş bekler, ödeme webhook'u gelince kotaya eklenir (bir kez)", async () => {
    const { as, hook, deps } = await setup();
    const r = await as("POST", "/api/panel/addons", { pack: "ek-100" });
    expect(r.body.checkoutUrl).toBe("https://polar.test/checkout/co_1");
    expect((await as("GET", "/api/panel/usage")).body.addonMinutes).toBe(0);
    const order = deps.store.db.prepare("SELECT id, provider_ref, status FROM orders").get() as any;
    expect(order).toMatchObject({ provider_ref: "co_1", status: "pending" });
    const event = { type: "order.paid", data: { id: "o2", metadata: { kind: "addon", order_id: order.id, tenant_id: demoTenant.id } } };
    expect(await hook(event)).toBe(200);
    expect(await hook(event)).toBe(200);
    expect((await as("GET", "/api/panel/usage")).body.addonMinutes).toBe(100);
    expect((await as("GET", "/api/panel/orders")).body.orders).toHaveLength(1);
  });

  it("paket değişimi: abonelik bağlı değilse 409; bağlıysa yükseltme hemen, düşürme sonraki dönemde Polar'a iletilir", async () => {
    const { as, deps, owner, calls } = await setup();
    expect((await as("POST", "/api/panel/plan-change", { plan: "pro" })).status).toBe(409);
    deps.users.setPolarSubscription(owner.id, "sub_9");
    expect(await as("POST", "/api/panel/plan-change", { plan: "pro" })).toMatchObject({ status: 200, body: { kind: "upgrade" } });
    expect(calls.at(-1)).toEqual(["change", "sub_9", "pro", "now"]);
    expect(await as("POST", "/api/panel/plan-change", { plan: "baslangic" })).toMatchObject({ status: 200, body: { kind: "downgrade" } });
    expect(calls.at(-1)).toEqual(["change", "sub_9", "baslangic", "next_period"]);
  });
});

describe("Polar istemcisi", () => {
  it("ödeme sayfasını doğru gövdeyle ister, ürün yoksa hata verir", async () => {
    const seen: any[] = [];
    const polar = createPolar({
      accessToken: "tok", webhookSecret: SECRET, server: "sandbox", products: PRODUCTS,
      fetch: (async (url: string, init: any) => (seen.push([url, init.method, JSON.parse(init.body), init.headers.authorization]), new Response(JSON.stringify({ id: "c", url: "https://x/c" }), { status: 201 }))) as any,
    });
    expect(await polar.createCheckout({ item: "pro", externalCustomerId: "u1", email: "a@b.c", metadata: { k: "v" }, successUrl: "https://s" })).toEqual({ id: "c", url: "https://x/c" });
    expect(seen[0]).toEqual(["https://sandbox-api.polar.sh/v1/checkouts/", "POST", { products: ["p-p"], external_customer_id: "u1", customer_email: "a@b.c", metadata: { k: "v" }, success_url: "https://s" }, "Bearer tok"]);
    await polar.changePlan("sub", "standart", "next_period");
    expect(seen[1]).toEqual(["https://sandbox-api.polar.sh/v1/subscriptions/sub", "PATCH", { product_id: "p-s", proration_behavior: "next_period" }, "Bearer tok"]);
    await expect(polar.createCheckout({ item: "yok", externalCustomerId: "u", email: "a@b.c", metadata: {}, successUrl: "https://s" })).rejects.toThrow(/tanımlı değil/);
  });
});
