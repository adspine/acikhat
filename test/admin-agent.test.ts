import { describe, expect, it } from "vitest";
import { demoTenant, makeApp, MONDAY_9AM } from "./helpers.ts";
import type { FirebaseVerifier } from "../src/auth/firebase.ts";
import type { Voice } from "../src/integrations/voices.ts";

const json = { "content-type": "application/json", "x-panel": "1" };
const verifier: FirebaseVerifier = { verify: async () => ({ uid: "uid-admin", email: "admin@ornek.com", emailVerified: true, name: "Yönetici" }) };
const catalog: Voice[] = [
  { id: "MzfWWOj9g3sIKex1YFMV", name: "Duygu", gender: "female", tags: [], previewUrl: null },
  { id: "5nr6ATQepuidiLb6OT3B", name: "Ozan", gender: "male", tags: [], previewUrl: null },
];

async function setup(opts: { agentIds?: string[]; publish?: (t: unknown) => Promise<any> } = {}) {
  const tenant = { ...demoTenant, agentIds: opts.agentIds ?? ["agent_1"], agent: { ...demoTenant.agent, voiceId: "MzfWWOj9g3sIKex1YFMV" } };
  const ctx = makeApp(MONDAY_9AM, { tenant, firebase: verifier, adminEmails: ["admin@ornek.com"], voices: async () => catalog, ...(opts.publish && { publishAgent: opts.publish as never }) });
  const fb = await ctx.app.request("/api/auth/firebase", { method: "POST", headers: json, body: JSON.stringify({ idToken: "x".repeat(30) }) });
  const adminCookie = fb.headers.get("set-cookie")!.split(";")[0]!;
  await ctx.deps.users.create({ tenantId: tenant.id, email: "sahip@lavanta.com", name: "Ayla", role: "owner", password: "sifre-12345", mustChangePassword: false });
  const login = await ctx.app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ email: "sahip@lavanta.com", password: "sifre-12345" }) });
  const ownerCookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const as = (cookie: string, extra: Record<string, string> = {}) => async (method: string, path: string, body?: unknown) => {
    const res = await ctx.app.request(path, { method, headers: { ...json, cookie, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { ...ctx, tenant, admin: as(adminCookie), adminForTenant: as(adminCookie, { "x-tenant": tenant.id }), owner: as(ownerCookie) };
}

describe("yönetici: asistanı değiştirme", () => {
  it("ses listesi ve firmanın asistan kimliği verilir", async () => {
    const { admin, tenant } = await setup();
    const v = (await admin("GET", "/api/admin/voices")).body;
    expect(v).toMatchObject({ enabled: true });
    expect(v.voices.map((x: Voice) => x.id)).toEqual(catalog.map((x) => x.id));
    const a = (await admin("GET", `/api/admin/tenants/${tenant.id}/agent`)).body;
    expect(a).toMatchObject({ voiceId: "MzfWWOj9g3sIKex1YFMV", name: "Defne", ready: true, firma: tenant.name });
    expect(a.defaultGreeting).toContain("{firma}");
  });

  it("ses, ad ve karşılama canlıya uygulanır, asistan ElevenLabs'te güncellenir", async () => {
    const { admin, deps, published, tenant } = await setup();
    const r = await admin("PATCH", `/api/admin/tenants/${tenant.id}`, { agent: { voiceId: "5nr6ATQepuidiLb6OT3B", name: "Aylin", greeting: "{firma}, merhaba. Ben {ajan}." } });
    expect(r.status).toBe(200);
    expect(deps.tenants.get(tenant.id)?.agent).toMatchObject({ voiceId: "5nr6ATQepuidiLb6OT3B", name: "Aylin", greeting: "{firma}, merhaba. Ben {ajan}." });
    expect(published.at(-1)?.agent.voiceId).toBe("5nr6ATQepuidiLb6OT3B");
    // karşılama boşaltılırsa varsayılana döner
    await admin("PATCH", `/api/admin/tenants/${tenant.id}`, { agent: { greeting: "" } });
    expect(deps.tenants.get(tenant.id)?.agent.greeting).toBeUndefined();
  });

  it("listede olmayan ses reddedilir; ElevenLabs güncellemesi başarısızsa canlı ayar değişmez", async () => {
    const { admin, deps, tenant } = await setup();
    expect((await admin("PATCH", `/api/admin/tenants/${tenant.id}`, { agent: { voiceId: "BaskaBirSesKimligi123" } })).status).toBe(422);

    const broken = await setup({ publish: async () => ({ ok: false, error: "ElevenLabs yanıt vermedi" }) });
    const r = await broken.admin("PATCH", `/api/admin/tenants/${broken.tenant.id}`, { agent: { name: "Aylin" } });
    expect(r).toMatchObject({ status: 502, body: { error: "ElevenLabs yanıt vermedi" } });
    expect(broken.deps.tenants.get(broken.tenant.id)?.agent.name).toBe("Defne");
    void deps;
  });

  it("asistanı kurulmamış firmada ElevenLabs'e gitmeden yalnızca ayar güncellenir", async () => {
    const { admin, deps, published, tenant } = await setup({ agentIds: [] });
    expect((await admin("PATCH", `/api/admin/tenants/${tenant.id}`, { agent: { name: "Aylin" } })).status).toBe(200);
    expect(published).toHaveLength(0);
    expect(deps.tenants.get(tenant.id)?.agent.name).toBe("Aylin");
  });

  it("müşteri ses listesine ve yönetici uçlarına giremez", async () => {
    const { owner, tenant } = await setup();
    expect((await owner("GET", "/api/admin/voices")).status).toBe(403);
    expect((await owner("PATCH", `/api/admin/tenants/${tenant.id}`, { agent: { name: "X" } })).status).toBe(403);
  });
});

describe("Asistanı dene yalnızca yöneticiye açık", () => {
  it("müşteri deneme görüşmesi başlatamaz (403)", async () => {
    const { owner } = await setup();
    expect((await owner("GET", "/api/panel/test-call")).status).toBe(403);
  });

  it("yönetici firma seçerek açar (asistan kurulu değilse 409, anahtar yoksa da 409; 403 değil)", async () => {
    const { adminForTenant } = await setup({ agentIds: [] });
    expect((await adminForTenant("GET", "/api/panel/test-call")).status).toBe(409);
  });
});

describe("yönetici: asistanı kur", () => {
  it("asistanı olmayan firmada oluşturur ve kimliği firmaya yazar", async () => {
    const { admin, deps, tenant } = await setup({ agentIds: [], publish: async () => ({ ok: true, agentId: "agent_yeni", created: true }) });
    const r = await admin("POST", `/api/admin/tenants/${tenant.id}/assistant`);
    expect(r).toMatchObject({ status: 200, body: { ok: true, created: true } });
    expect(deps.tenants.get(tenant.id)?.agentIds).toEqual(["agent_yeni"]);
    expect((await admin("GET", `/api/admin/tenants/${tenant.id}/agent`)).body.ready).toBe(true);
  });

  it("ElevenLabs hata verirse firma değişmez; müşteri kuramaz", async () => {
    const { admin, owner, deps, tenant } = await setup({ agentIds: [], publish: async () => ({ ok: false, error: "ElevenLabs yanıt vermedi" }) });
    expect((await admin("POST", `/api/admin/tenants/${tenant.id}/assistant`)).status).toBe(502);
    expect(deps.tenants.get(tenant.id)?.agentIds).toEqual([]);
    expect((await owner("POST", `/api/admin/tenants/${tenant.id}/assistant`)).status).toBe(403);
  });
});
