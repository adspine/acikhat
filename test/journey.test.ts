import { describe, expect, it } from "vitest";
import { demoTenant, makeApp, MONDAY_9AM } from "./helpers.ts";

const form = (name = "Yeni Spa") => ({
  business: { name },
  contact: { person: "Yeni Üye", phone: "0532 111 22 33" },
  consent: { kvkk: true },
});

async function setup(paymentTestMode: boolean) {
  const ctx = makeApp(MONDAY_9AM, { paymentTestMode });
  const { app, deps } = ctx;
  const user = await deps.users.create({ tenantId: null, email: "uye@ornek.com", name: "Yeni Üye", role: "owner", password: "sifre-12345", mustChangePassword: false });
  const login = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-panel": "1" }, body: JSON.stringify({ email: "uye@ornek.com", password: "sifre-12345" }) });
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { cookie, "x-panel": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { ...ctx, user, cookie, api };
}

describe("kurulum yolculuğu: paket → ödeme → form → hazırlık", () => {
  it("yeni üye 1. adımda başlar", async () => {
    const { api } = await setup(true);
    const r = await api("GET", "/api/auth/session");
    expect(r.body.onboarding).toMatchObject({ plan: null, paidAt: null, reference: null, step: 1 });
    expect(r.body.paymentTestMode).toBe(true);
  });

  it("paket seçilir, ödeme (test) alınınca 2. adıma geçer", async () => {
    const { api } = await setup(true);
    expect((await api("POST", "/api/auth/plan", { plan: "standart" })).body.onboarding).toMatchObject({ plan: "standart", step: 1 });
    expect((await api("POST", "/api/auth/pay")).body.onboarding).toMatchObject({ plan: "standart", step: 2 });
  });

  it("paket seçmeden ödeme yapılamaz; geçersiz paket reddedilir", async () => {
    const { api } = await setup(true);
    expect((await api("POST", "/api/auth/pay")).status).toBe(400);
    expect((await api("POST", "/api/auth/plan", { plan: "bedava" })).status).toBe(400);
  });

  it("ödenmiş paket değiştirilemez", async () => {
    const { api } = await setup(true);
    await api("POST", "/api/auth/plan", { plan: "pro" });
    await api("POST", "/api/auth/pay");
    expect((await api("POST", "/api/auth/plan", { plan: "baslangic" })).status).toBe(409);
  });

  it("test modu kapalıyken ödeme alınmaz (canlı varsayılanı)", async () => {
    const { api } = await setup(false);
    await api("POST", "/api/auth/plan", { plan: "standart" });
    const r = await api("POST", "/api/auth/pay");
    expect(r.status).toBe(501);
    expect((await api("GET", "/api/auth/session")).body.onboarding.step).toBe(1);
  });

  it("ödenmiş üyenin kurulum formu hesabına bağlanır ve 3. adıma geçer", async () => {
    const { api, app, cookie, store } = await setup(true);
    await api("POST", "/api/auth/plan", { plan: "standart" });
    await api("POST", "/api/auth/pay");
    const res = await app.request("/api/onboarding", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(form()) });
    const { reference } = (await res.json()) as { reference: string };
    expect((await api("GET", "/api/auth/session")).body.onboarding).toMatchObject({ reference, step: 3 });
    expect(store.db.prepare("SELECT user_id, plan FROM onboarding_submissions WHERE reference = ?").get(reference)).toMatchObject({ plan: "standart" });
  });

  it("ödemeden gönderilen form 402, oturumsuz form 401 alır; kaydedilmez", async () => {
    const { api, app, cookie, store } = await setup(true);
    const unpaid = await app.request("/api/onboarding", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(form()) });
    expect(unpaid.status).toBe(402);
    expect((await api("GET", "/api/auth/session")).body.onboarding.step).toBe(1);
    const anon = await app.request("/api/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form("Anonim Spa")) });
    expect(anon.status).toBe(401);
    expect(store.db.prepare("SELECT COUNT(*) n FROM onboarding_submissions").get()).toMatchObject({ n: 0 });
  });

  it("oturumsuz çağrı 401 alır", async () => {
    const { app } = makeApp(MONDAY_9AM, { tenant: demoTenant });
    for (const [m, p] of [["POST", "/api/auth/plan"], ["POST", "/api/auth/pay"]] as const) {
      const res = await app.request(p, { method: m, headers: { "x-panel": "1", "content-type": "application/json" }, body: "{}" });
      expect(res.status).toBe(401);
    }
  });
});
