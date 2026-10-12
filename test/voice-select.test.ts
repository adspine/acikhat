import { describe, expect, it } from "vitest";
import { demoTenant, makeApp, MONDAY_9AM } from "./helpers.ts";
import type { Voice } from "../src/integrations/voices.ts";

const json = { "content-type": "application/json", "x-panel": "1" };
const catalog: Voice[] = [
  { id: "MzfWWOj9g3sIKex1YFMV", name: "Duygu Eris", gender: "female", tags: [], previewUrl: null },
  { id: "5nr6ATQepuidiLb6OT3B", name: "Ozan Karaca", gender: "male", tags: [], previewUrl: null },
];

async function setup(voices: () => Promise<Voice[]> = async () => catalog) {
  const tenant = { ...demoTenant, agentIds: ["agent_1"], agent: { ...demoTenant.agent, voiceId: "MzfWWOj9g3sIKex1YFMV" } };
  const ctx = makeApp(MONDAY_9AM, { tenant, voices });
  await ctx.deps.users.create({ tenantId: tenant.id, email: "sahip@lavanta.com", name: "Ayla", role: "owner", password: "sifre-12345", mustChangePassword: false });
  const login = await ctx.app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ email: "sahip@lavanta.com", password: "sifre-12345" }) });
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await ctx.app.request(`/api/panel${path}`, { method, headers: { ...json, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { ...ctx, call };
}

/** Taslağa ses, ad ve karşılamayı birlikte yazar */
async function saveAgent(call: Awaited<ReturnType<typeof setup>>["call"], agent: Record<string, unknown>) {
  const cfg = (await call("GET", "/settings")).body.config;
  return call("PUT", "/settings", { config: { ...cfg, agent: { ...cfg.agent, ...agent } } });
}

describe("asistan sesi seçimi", () => {
  it("listedeki bir ses seçilir, ad ve karşılama birlikte taslağa yazılır ve yayınlanınca asistana gider", async () => {
    const { call, published } = await setup();
    const r = await saveAgent(call, { voiceId: "5nr6ATQepuidiLb6OT3B", name: "Aylin", greeting: "{firma}, merhaba. Ben {ajan}." });
    expect(r.body.config.agent).toMatchObject({ voiceId: "5nr6ATQepuidiLb6OT3B", name: "Aylin", greeting: "{firma}, merhaba. Ben {ajan}." });
    // sayfa yenilenince de aynı (taslak kalıcı)
    expect((await call("GET", "/settings")).body.config.agent.voiceId).toBe("5nr6ATQepuidiLb6OT3B");

    expect((await call("POST", "/settings/publish")).status).toBe(200);
    expect(published.at(-1)?.agent.voiceId).toBe("5nr6ATQepuidiLb6OT3B");
    expect(published.at(-1)?.agent.name).toBe("Aylin");
  });

  it("listede olmayan ses kimliği kabul edilmez; canlıdaki ses korunur", async () => {
    const { call } = await setup();
    const r = await saveAgent(call, { voiceId: "BaskaBirSesKimligi123" });
    expect(r.body.config.agent.voiceId).toBe("MzfWWOj9g3sIKex1YFMV");
  });

  it("ses listesi alınamıyorsa ses değişikliği yok sayılır, ad ve karşılama yine kaydedilir", async () => {
    const { call } = await setup(async () => { throw new Error("yok"); });
    const r = await saveAgent(call, { voiceId: "5nr6ATQepuidiLb6OT3B", name: "Aylin" });
    expect(r.body.config.agent).toMatchObject({ voiceId: "MzfWWOj9g3sIKex1YFMV", name: "Aylin" });
  });
});
