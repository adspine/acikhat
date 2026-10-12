import { describe, expect, it } from "vitest";
import { demoTenant, makeApp, MONDAY_9AM } from "./helpers.ts";
import { checkQuotaNotices } from "../src/http/panel/billing.ts";

const json = { "content-type": "application/json", "x-panel": "1" };

async function setup() {
  const tenant = { ...demoTenant, plan: { id: "standart" as const, includedMinutes: 100 } };
  const ctx = makeApp(MONDAY_9AM, { tenant, paymentTestMode: true });
  await ctx.deps.users.create({ tenantId: tenant.id, email: "sahip@lavanta.com", name: "Ayla", role: "owner", password: "sifre-12345", mustChangePassword: false });
  const login = await ctx.app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ email: "sahip@lavanta.com", password: "sifre-12345" }) });
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await ctx.app.request(path, { method, headers: { ...json, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as any };
  };
  ctx.mailbox.length = 0;
  return { ...ctx, call, tenant };
}

describe("hesap ayarları", () => {
  it("kullanıcı kendi adını ve e-posta bildirimi tercihini değiştirir", async () => {
    const { call } = await setup();
    expect((await call("GET", "/api/auth/session")).body.user).toMatchObject({ name: "Ayla", notifyEmail: true });
    const r = await call("PATCH", "/api/auth/profile", { name: "  Ayla Yılmaz ", notifyEmail: false });
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ name: "Ayla Yılmaz", notifyEmail: false });
    expect((await call("GET", "/api/panel/me")).body.user).toMatchObject({ name: "Ayla Yılmaz", notifyEmail: false });
  });

  it("geçersiz ad reddedilir; oturumsuz istek 401 alır; kısmi güncelleme diğer alanı korur", async () => {
    const { call, app } = await setup();
    expect((await call("PATCH", "/api/auth/profile", { name: "A" })).status).toBe(400);
    expect((await call("PATCH", "/api/auth/profile", { notifyEmail: false })).body.user).toMatchObject({ name: "Ayla", notifyEmail: false });
    const anon = await app.request("/api/auth/profile", { method: "PATCH", headers: json, body: JSON.stringify({ name: "Ali" }) });
    expect(anon.status).toBe(401);
  });

  it("bilgilendirme e-postalarını kapatan kullanıcıya kota uyarısı gitmez, satın alma onayı yine gider", async () => {
    const { call, store, deps, mailbox, tenant } = await setup();
    store.saveCall({ conversationId: "k", tenantId: tenant.id, startedAtMs: MONDAY_9AM.epochMilliseconds - 3600_000, durationSecs: 90 * 60, outcome: "info", payload: {} });
    checkQuotaNotices(deps, tenant.id);
    expect(mailbox.map((m) => m.subject)).toEqual(["Aylık kotanızın %80'ini kullandınız"]);

    mailbox.length = 0;
    await call("PATCH", "/api/auth/profile", { notifyEmail: false });
    store.saveCall({ conversationId: "k2", tenantId: tenant.id, startedAtMs: MONDAY_9AM.epochMilliseconds - 1800_000, durationSecs: 20 * 60, outcome: "info", payload: {} });
    checkQuotaNotices(deps, tenant.id);
    expect(mailbox).toHaveLength(0);

    await call("POST", "/api/panel/addons", { pack: "ek-100" });
    expect(mailbox.some((m) => m.to.includes("sahip@lavanta.com") && m.subject.includes("Satın alma onayı"))).toBe(true);
  });
});
