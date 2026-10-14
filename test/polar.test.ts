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
    portalUrl: async (id) => (calls.push(["portal", id]), "https://polar.test/portal/abc"),
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
  let seq = 0;
  const hook = async (event: unknown, signature = "ok", id = `w${++seq}`) => {
    const res = await app.request("/webhooks/polar", { method: "POST", headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": "1", "webhook-signature": signature }, body: JSON.stringify(event) });
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

describe("abonelik yaşam döngüsü", () => {
  const sub = (type: string, data: object = {}) => ({ type, data: { id: "sub_7", ...data } });
  async function paid() {
    const t = await setup();
    t.deps.users.setPolarSubscription(t.owner.id, "sub_7");
    t.mailbox.length = 0;
    return t;
  }
  const suspended = (deps: any) => deps.tenants.get(demoTenant.id).suspended;

  it("Aboneliği yönet: portal adresi ödeyen üyenin kimliğiyle istenir; abonelik bağlı değilse 409", async () => {
    const t = await setup();
    expect((await t.as("POST", "/api/panel/portal")).status).toBe(409);
    expect((await t.as("GET", "/api/panel/usage")).body.canManageSubscription).toBe(false);
    t.deps.users.setPolarSubscription(t.owner.id, "sub_7");
    expect((await t.as("GET", "/api/panel/usage")).body.canManageSubscription).toBe(true);
    expect(await t.as("POST", "/api/panel/portal")).toMatchObject({ status: 200, body: { url: "https://polar.test/portal/abc" } });
    expect(t.calls.at(-1)).toEqual(["portal", t.owner.id]);
  });

  it("ödeme alınamadı: müşteriye uyarı e-postası gider, hizmet hemen kapanmaz", async () => {
    const t = await paid();
    await t.hook(sub("subscription.past_due", { status: "past_due" }));
    expect(t.mailbox.some((m) => m.to.includes("sahip@lavanta.com") && m.subject.includes("Ödemeniz alınamadı"))).toBe(true);
    expect(suspended(t.deps)).toBe(false);
  });

  it("abonelik sona erince (revoked) firma askıya alınır; ödeme gelince kendiliğinden açılır", async () => {
    const t = await paid();
    await t.hook(sub("subscription.revoked", { status: "canceled" }));
    expect(suspended(t.deps)).toBe(true);
    expect(t.mailbox.some((m) => m.to.includes("sahip@lavanta.com") && m.subject.includes("askıya alındı"))).toBe(true);
    await t.hook(sub("subscription.revoked", { status: "canceled" })); // tekrar gelirse e-posta çoğalmaz
    expect(t.mailbox.filter((m) => m.subject.includes("askıya alındı"))).toHaveLength(1);

    await t.hook({ type: "order.paid", data: { id: "o9", subscription_id: "sub_7", billing_reason: "subscription_cycle", total_amount: 29900 } });
    expect(suspended(t.deps)).toBe(false);
    expect(t.mailbox.some((m) => m.subject.includes("yeniden açıldı"))).toBe(true);
  });

  it("aynı webhook-id ikinci kez gelirse işlenmez (tekrar e-postası ve çift işlem olmaz)", async () => {
    const t = await paid();
    const cycle = { type: "order.paid", data: { id: "o20", subscription_id: "sub_7", billing_reason: "subscription_cycle", total_amount: 29900 } };
    expect(await t.hook(cycle, "ok", "msg_tekrar")).toBe(200);
    expect(await t.hook(cycle, "ok", "msg_tekrar")).toBe(200);
    expect(t.mailbox.filter((m) => m.subject.startsWith("Aylık ödemeniz alındı"))).toHaveLength(1);
  });

  it("ödenen ürün seçilen paketle uyuşmuyorsa üyelik ödenmiş sayılmaz", async () => {
    const t = await setup();
    // sahte Polar tüm ürünleri tanımaz: ters arama pro ürününü "pro" diye döner
    (t.deps as any).polar.itemOf = (id: string) => (id === "urun-pro" ? "pro" : undefined);
    const body = (productId: string) => ({ type: "order.paid", data: { id: "o30", subscription_id: "sub_1", product_id: productId, metadata: { kind: "membership", user_id: t.owner.id, plan: "standart" } } });
    await t.hook(body("urun-pro")); // standart seçilmiş ama pro ürünü ödenmiş: uyuşmaz
    expect(t.deps.users.onboardingOf(t.owner.id).paidAt).toBeNull();
    (t.deps as any).polar.itemOf = (id: string) => (id === "urun-standart" ? "standart" : undefined);
    await t.hook(body("urun-standart"));
    expect(t.deps.users.onboardingOf(t.owner.id).paidAt).not.toBeNull();
  });

  it("yenileme ödemesi: müşteriye 'ödemeniz alındı' e-postası gider", async () => {
    const t = await paid();
    await t.hook({ type: "order.paid", data: { id: "o10", subscription_id: "sub_7", billing_reason: "subscription_cycle", total_amount: 29900 } });
    const m = t.mailbox.find((x) => x.subject.startsWith("Aylık ödemeniz alındı"))!;
    expect(m.to).toContain("sahip@lavanta.com");
    expect(m.text).toContain("299");
  });

  it("yöneticinin elle askıya aldığı firma ödeme gelince kendiliğinden açılmaz", async () => {
    const t = await paid();
    const raw = structuredClone(t.deps.tenantStore.getLiveRaw(demoTenant.id) as any);
    raw.suspended = true;
    const { TenantSchema } = await import("../src/domain/tenant.ts");
    const next = TenantSchema.parse(raw);
    t.deps.tenantStore.publish(next);
    t.deps.tenants.set(next);
    await t.hook(sub("subscription.active"));
    expect(suspended(t.deps)).toBe(true);
  });

  it("dönem sonunda iptal: müşteriye bitiş tarihiyle e-posta gider, hizmet açık kalır", async () => {
    const t = await paid();
    await t.hook(sub("subscription.canceled", { cancel_at_period_end: true, ends_at: "2026-11-14T18:08:44Z" }));
    expect(t.mailbox.some((m) => m.subject === "Aboneliğiniz iptal edildi" && m.text.includes("14"))).toBe(true);
    expect(suspended(t.deps)).toBe(false);
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
    expect(seen[0]).toEqual(["https://sandbox-api.polar.sh/v1/checkouts/", "POST", { products: ["p-p"], external_customer_id: "u1", customer_email: "a@b.c", metadata: { k: "v" }, success_url: "https://s", locale: "tr" }, "Bearer tok"]);
    await polar.changePlan("sub", "standart", "next_period");
    expect(seen[1]).toEqual(["https://sandbox-api.polar.sh/v1/subscriptions/sub", "PATCH", { product_id: "p-s", proration_behavior: "next_period" }, "Bearer tok"]);
    await expect(polar.createCheckout({ item: "yok", externalCustomerId: "u", email: "a@b.c", metadata: {}, successUrl: "https://s" })).rejects.toThrow(/tanımlı değil/);
  });
});
