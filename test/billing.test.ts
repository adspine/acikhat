import { describe, expect, it } from "vitest";
import { demoTenant, makeApp, MONDAY_9AM } from "./helpers.ts";
import { applyScheduledPlans } from "../src/http/panel/billing.ts";

async function setup(opts: { paymentTestMode?: boolean; plan?: "baslangic" | "standart" | "pro" } = {}) {
  const tenant = { ...demoTenant, plan: { id: opts.plan ?? ("standart" as const), includedMinutes: 1000 } };
  const ctx = makeApp(MONDAY_9AM, { tenant, paymentTestMode: opts.paymentTestMode ?? true });
  const { app, deps } = ctx;
  await deps.users.create({ tenantId: tenant.id, email: "sahip@lavanta.com", name: "Ayla", role: "owner", password: "sifre-12345", mustChangePassword: false });
  const login = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-panel": "1" }, body: JSON.stringify({ email: "sahip@lavanta.com", password: "sifre-12345" }) });
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const owner = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api/panel${path}`, { method, headers: { cookie, "x-panel": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { ...ctx, owner, tenant };
}

describe("ek dakika paketi", () => {
  it("satın alınınca bu ayın kotasına eklenir ve geçmişte görünür", async () => {
    const { owner } = await setup();
    const before = (await owner("GET", "/usage")).body;
    expect(before).toMatchObject({ planMinutes: 1000, addonMinutes: 0, includedMinutes: 1000 });
    expect(before.packs.map((p: any) => p.id)).toEqual(["ek-100", "ek-300", "ek-600"]);

    const r = await owner("POST", "/addons", { pack: "ek-300" });
    expect(r).toMatchObject({ status: 200, body: { ok: true, minutes: 300, chargedUsd: 80 } });
    const after = (await owner("GET", "/usage")).body;
    expect(after).toMatchObject({ planMinutes: 1000, addonMinutes: 300, includedMinutes: 1300, remainingMinutes: 1300 });
    const orders = (await owner("GET", "/orders")).body.orders;
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ kind: "addon", minutes: 300, amountUsd: 80 });
  });

  it("ek dakika yalnızca satın alındığı ay geçerlidir", async () => {
    const { owner, deps } = await setup();
    await owner("POST", "/addons", { pack: "ek-100" });
    deps.now = () => MONDAY_9AM.add({ months: 1 });
    expect((await owner("GET", "/usage")).body).toMatchObject({ addonMinutes: 0, includedMinutes: 1000 });
  });

  it("ek dakika paket aşımını ve raporlardaki kotayı etkiler", async () => {
    const { owner, store, tenant } = await setup();
    const t0 = MONDAY_9AM.epochMilliseconds;
    store.saveCall({ conversationId: "buyuk", tenantId: tenant.id, startedAtMs: t0 - 3600_000, durationSecs: 1050 * 60, outcome: "info", payload: {} });
    expect((await owner("GET", "/usage")).body).toMatchObject({ overageMinutes: 50 });
    await owner("POST", "/addons", { pack: "ek-100" });
    expect((await owner("GET", "/usage")).body).toMatchObject({ overageMinutes: 0, remainingMinutes: 50 });
    expect((await owner("GET", "/reports")).body.totals.includedMinutes).toBe(1100);
  });

  it("geçersiz paket 400, ödeme altyapısı kapalıysa 503 verir", async () => {
    const test = await setup();
    expect((await test.owner("POST", "/addons", { pack: "yok" })).status).toBe(400);
    const off = await setup({ paymentTestMode: false });
    expect((await off.owner("POST", "/addons", { pack: "ek-100" })).status).toBe(503);
    expect((await off.owner("GET", "/orders")).body.orders).toEqual([]);
  });
});

describe("paket geçişi", () => {
  it("yükseltme hemen olur ve kalan günlere oranlı fark alınır", async () => {
    const { owner, deps, tenant } = await setup();
    const plans = (await owner("GET", "/usage")).body.plans;
    expect(plans.find((p: any) => p.id === "pro")).toMatchObject({ relation: "upgrade", chargeUsd: 193.55 });
    expect(plans.find((p: any) => p.id === "standart").relation).toBe("same");
    expect(plans.find((p: any) => p.id === "baslangic").relation).toBe("downgrade");

    const r = await owner("POST", "/plan-change", { plan: "pro" });
    expect(r).toMatchObject({ status: 200, body: { kind: "upgrade", chargedUsd: 193.55 } });
    expect(deps.tenants.get(tenant.id)?.plan).toMatchObject({ id: "pro", includedMinutes: 2500 });
    expect((await owner("GET", "/usage")).body).toMatchObject({ planMinutes: 2500, plan: { id: "pro" } });
  });

  it("düşürme ücretsizdir, dönem sonunda kendiliğinden uygulanır, o zamana kadar kota değişmez", async () => {
    const { owner, deps, tenant } = await setup();
    const r = await owner("POST", "/plan-change", { plan: "baslangic" });
    expect(r.body).toMatchObject({ ok: true, kind: "downgrade" });
    expect(deps.tenants.get(tenant.id)?.plan).toMatchObject({ id: "standart", includedMinutes: 1000, pending: { id: "baslangic" } });
    expect((await owner("GET", "/usage")).body).toMatchObject({ planMinutes: 1000, pending: { plan: "baslangic" } });
    expect((await owner("GET", "/orders")).body.orders).toEqual([]);

    // dönem dolmadan uygulanmaz
    expect(applyScheduledPlans(deps)).toBe(0);
    deps.now = () => MONDAY_9AM.add({ months: 1 }).with({ day: 1 });
    expect(applyScheduledPlans(deps)).toBe(1);
    expect(deps.tenants.get(tenant.id)?.plan).toMatchObject({ id: "baslangic", includedMinutes: 400 });
    expect(deps.tenants.get(tenant.id)?.plan.pending).toBeUndefined();
    expect((await owner("GET", "/usage")).body).toMatchObject({ planMinutes: 400, pending: null });
  });

  it("panel açıldığında vakti gelen düşürme de uygulanır", async () => {
    const { owner, deps } = await setup();
    await owner("POST", "/plan-change", { plan: "baslangic" });
    deps.now = () => MONDAY_9AM.add({ months: 1 }).with({ day: 2 });
    expect((await owner("GET", "/usage")).body).toMatchObject({ planMinutes: 400, plan: { id: "baslangic" } });
  });

  it("mevcut paketi seçmek bekleyen düşürmeyi iptal eder; bekleyen yokken 409", async () => {
    const { owner, deps, tenant } = await setup();
    expect((await owner("POST", "/plan-change", { plan: "standart" })).status).toBe(409);
    await owner("POST", "/plan-change", { plan: "baslangic" });
    expect((await owner("POST", "/plan-change", { plan: "standart" })).body).toMatchObject({ kind: "cancelled" });
    expect(deps.tenants.get(tenant.id)?.plan.pending).toBeUndefined();
  });

  it("yükseltme bekleyen düşürmeyi siler; ödeme altyapısı kapalıyken yükseltilemez, düşürülebilir", async () => {
    const { owner, deps, tenant } = await setup();
    await owner("POST", "/plan-change", { plan: "baslangic" });
    await owner("POST", "/plan-change", { plan: "pro" });
    expect(deps.tenants.get(tenant.id)?.plan).toMatchObject({ id: "pro" });
    expect(deps.tenants.get(tenant.id)?.plan.pending).toBeUndefined();

    const off = await setup({ paymentTestMode: false });
    expect((await off.owner("POST", "/plan-change", { plan: "pro" })).status).toBe(503);
    expect((await off.owner("POST", "/plan-change", { plan: "baslangic" })).status).toBe(200);
  });

  it("askıdaki firma satın alma ve paket değişikliği yapamaz", async () => {
    const { owner, deps, tenant } = await setup();
    deps.tenants.set({ ...deps.tenants.get(tenant.id)!, suspended: true });
    expect((await owner("POST", "/addons", { pack: "ek-100" })).status).toBe(409);
    expect((await owner("POST", "/plan-change", { plan: "pro" })).status).toBe(409);
  });

  it("sipariş tekrar işlenirse ikinci kez uygulanmaz", async () => {
    const { owner, deps, tenant } = await setup();
    await owner("POST", "/addons", { pack: "ek-100" });
    const { fulfillOrder } = await import("../src/http/panel/billing.ts");
    const id = (deps.store.db.prepare("SELECT id FROM orders").get() as { id: string }).id;
    expect(fulfillOrder(deps, deps.tenants.get(tenant.id)!, id)).toBe(false);
    expect((await owner("GET", "/usage")).body.addonMinutes).toBe(100);
  });
});
