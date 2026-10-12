import { describe, expect, it } from "vitest";
import { demoTenant, makeApp, MONDAY_9AM } from "./helpers.ts";
import type { FirebaseVerifier } from "../src/auth/firebase.ts";

const verifier = (email: string, uid = "uid-admin"): FirebaseVerifier => ({ verify: async () => ({ uid, email, emailVerified: true, name: "Yönetici" }) });
const form = (name = "Deniz Emlak") => ({
  business: { name, sector: "emlak" },
  contact: { person: "Emre Can", phone: "0532 111 22 33" },
  services: [{ name: "Satılık danışmanlığı" }],
  staff: [{ name: "Ali Danışman", phone: "0533 000 11 22" }],
  consent: { kvkk: true },
});

async function setup() {
  const ctx = makeApp(MONDAY_9AM, { firebase: verifier("Admin@Ornek.com"), adminEmails: ["admin@ornek.com"], paymentTestMode: true });
  const { app, deps } = ctx;
  // yönetici: Firebase ile girer ve yönetici olur
  const fb = await app.request("/api/auth/firebase", { method: "POST", headers: { "content-type": "application/json", "x-panel": "1" }, body: JSON.stringify({ idToken: "x".repeat(30) }) });
  const adminCookie = fb.headers.get("set-cookie")!.split(";")[0]!;
  // müşteri: ödemesi alınmış üye
  const member = await deps.users.create({ tenantId: null, email: "uye@ornek.com", name: "Yeni Üye", role: "owner", password: "sifre-12345", mustChangePassword: false });
  const login = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-panel": "1" }, body: JSON.stringify({ email: "uye@ornek.com", password: "sifre-12345" }) });
  const memberCookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const call = (cookie: string) => async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { cookie, "x-panel": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as any };
  };
  const admin = call(adminCookie);
  const asMember = call(memberCookie);
  await asMember("POST", "/api/auth/plan", { plan: "standart" });
  await asMember("POST", "/api/auth/pay");
  const sub = await app.request("/api/onboarding", { method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" }, body: JSON.stringify(form()) });
  const { reference } = (await sub.json()) as { reference: string };
  return { ...ctx, admin, asMember, member, reference, adminCookie };
}

describe("yönetici hesabı ve admin API", () => {
  it("ADMIN_EMAILS listesindeki doğrulanmış e-posta yönetici olur", async () => {
    const { deps, admin } = await setup();
    expect(deps.users.findByEmail("admin@ornek.com")?.role).toBe("agency");
    expect((await admin("GET", "/api/auth/session")).body.user.role).toBe("agency");
  });

  it("listede olmayan e-posta yönetici olmaz", async () => {
    const { app, deps } = makeApp(MONDAY_9AM, { firebase: verifier("baska@ornek.com", "uid-2"), adminEmails: ["admin@ornek.com"] });
    await app.request("/api/auth/firebase", { method: "POST", headers: { "content-type": "application/json", "x-panel": "1" }, body: JSON.stringify({ idToken: "x".repeat(30) }) });
    expect(deps.users.findByEmail("baska@ornek.com")?.role).toBe("owner");
  });

  it("müşteri hesapları ve oturumsuzlar admin API'ye giremez", async () => {
    const { asMember, app } = await setup();
    expect((await asMember("GET", "/api/admin/overview")).status).toBe(403);
    expect((await app.request("/api/admin/overview", { headers: { "x-panel": "1" } })).status).toBe(401);
  });

  it("genel bakış satış ve başvuru rakamlarını verir", async () => {
    const { admin } = await setup();
    const r = (await admin("GET", "/api/admin/overview")).body;
    expect(r).toMatchObject({ members: 1, paid: 1, mrrUsd: 299, byPlan: { standart: 1 }, submissions: { new: 1 } });
    expect(r.callsByDay).toHaveLength(30);
  });

  it("başvuru listesi ve detayı üye, paket ve kontrol listesini içerir", async () => {
    const { admin, reference } = await setup();
    const list = (await admin("GET", "/api/admin/submissions")).body.submissions;
    expect(list[0]).toMatchObject({ reference, sector: "emlak", plan: "standart", paid: true, status: "new", member: { email: "uye@ornek.com" } });
    const d = (await admin("GET", `/api/admin/submissions/${reference}`)).body;
    expect(d.payload.business.name).toBe("Deniz Emlak");
    // emlak şablonu hazır: "şablon yok" uyarısı çıkmaz, alan sayısı teyidi istenir
    expect(d.checklist.some((t: string) => t.includes("şablonu henüz yok"))).toBe(false);
    expect(d.checklist.some((t: string) => t.includes("Alanlar"))).toBe(true);
  });

  it("durum ve not güncellenir", async () => {
    const { admin, reference } = await setup();
    expect((await admin("PATCH", `/api/admin/submissions/${reference}`, { status: "reviewing", note: "Aranacak" })).status).toBe(200);
    const d = (await admin("GET", `/api/admin/submissions/${reference}`)).body;
    expect(d).toMatchObject({ status: "reviewing", note: "Aranacak" });
    expect((await admin("PATCH", `/api/admin/submissions/${reference}`, { status: "uçtu" })).status).toBe(400);
  });

  it("onaylayınca firma oluşur, üye firmaya bağlanır ve kendi panosunu görür", async () => {
    const { admin, asMember, reference, deps } = await setup();
    const r = await admin("POST", `/api/admin/submissions/${reference}/create-tenant`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, tenantId: "deniz-emlak", linkedMember: true });
    expect(deps.tenants.get("deniz-emlak")?.name).toBe("Deniz Emlak");
    expect(deps.tenants.get("deniz-emlak")).toMatchObject({ vertical: "emlak" });
    expect(deps.tenants.get("deniz-emlak")?.rooms).toEqual([{ id: "ofis-1", type: "ofis" }]);
    expect(deps.tenants.get("deniz-emlak")?.services[0]?.roomType).toBe("ofis");
    expect((await asMember("GET", "/api/panel/me")).body.tenant.id).toBe("deniz-emlak");
    expect((await admin("GET", `/api/admin/submissions/${reference}`)).body).toMatchObject({ status: "approved", tenantId: "deniz-emlak" });
    expect((await admin("POST", `/api/admin/submissions/${reference}/create-tenant`)).status).toBe(409);
    const tenants = (await admin("GET", "/api/admin/tenants")).body.tenants;
    expect(tenants.find((t: any) => t.id === "deniz-emlak")).toMatchObject({ owner: "uye@ornek.com", plan: "standart" });
  });

  it("yönetici bir firmanın panelini x-tenant ile açabilir", async () => {
    const { admin, adminCookie, app } = await setup();
    const res = await app.request("/api/panel/me", { headers: { cookie: adminCookie, "x-panel": "1", "x-tenant": demoTenant.id } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).tenant.id).toBe(demoTenant.id);
    void admin;
  });
});

describe("başvuru verisi düzenleme", () => {
  it("geçerli veri kaydedilir, işletme adı listeye yansır", async () => {
    const { admin, reference } = await setup();
    const d = (await admin("GET", `/api/admin/submissions/${reference}`)).body;
    const payload = { ...d.payload, business: { ...d.payload.business, name: "Deniz Gayrimenkul" } };
    expect((await admin("PATCH", `/api/admin/submissions/${reference}`, { payload })).status).toBe(200);
    const list = (await admin("GET", "/api/admin/submissions")).body.submissions;
    expect(list[0].businessName).toBe("Deniz Gayrimenkul");
  });

  it("geçersiz veri reddedilir ve sebepleri döner", async () => {
    const { admin, reference } = await setup();
    const r = await admin("PATCH", `/api/admin/submissions/${reference}`, { payload: { business: { name: "X" } } });
    expect(r.status).toBe(422);
    expect(r.body.issues.length).toBeGreaterThan(0);
  });

  it("firma oluşturulduktan sonra değiştirilemez", async () => {
    const { admin, reference } = await setup();
    await admin("POST", `/api/admin/submissions/${reference}/create-tenant`);
    const d = (await admin("GET", `/api/admin/submissions/${reference}`)).body;
    expect((await admin("PATCH", `/api/admin/submissions/${reference}`, { payload: d.payload })).status).toBe(409);
  });

  it("onaylanan firmaya üyenin ödediği paketin dakikası yazılır", async () => {
    const { admin, reference, deps } = await setup();
    await admin("POST", `/api/admin/submissions/${reference}/create-tenant`);
    expect(deps.tenants.get("deniz-emlak")?.plan).toMatchObject({ includedMinutes: 1000, id: "standart" });
  });
});

describe("yönetici firma işlemleri ve paket talebi", () => {
  const approve = async () => {
    const ctx = await setup();
    await ctx.admin("POST", `/api/admin/submissions/${ctx.reference}/create-tenant`);
    return ctx;
  };

  it("paket değiştirilince firma, dakika ve üye paketi güncellenir", async () => {
    const { admin, deps } = await approve();
    expect((await admin("PATCH", "/api/admin/tenants/deniz-emlak", { plan: "pro" })).status).toBe(200);
    expect(deps.tenants.get("deniz-emlak")?.plan).toMatchObject({ id: "pro", includedMinutes: 2500 });
    expect((deps.store.db.prepare("SELECT plan FROM users WHERE email = ?").get("uye@ornek.com") as { plan: string }).plan).toBe("pro");
  });

  it("telefon hattı atanır, başkasındaki numara reddedilir, geçersiz numara 422 olur", async () => {
    const { admin, deps } = await approve();
    const other = demoTenant.phoneNumbers[0]!;
    expect((await admin("PATCH", "/api/admin/tenants/deniz-emlak", { phoneNumbers: ["0850 123 45 67"] })).status).toBe(200);
    expect(deps.tenants.get("deniz-emlak")?.phoneNumbers).toEqual(["+908501234567"]);
    expect((await admin("PATCH", "/api/admin/tenants/deniz-emlak", { phoneNumbers: [other] })).status).toBe(409);
    expect((await admin("PATCH", "/api/admin/tenants/deniz-emlak", { phoneNumbers: ["12"] })).status).toBe(422);
  });

  it("askıya alınan firma gelen çağrıyı karşılamaz, geri açılınca karşılar", async () => {
    const { admin, deps, app } = await approve();
    await admin("PATCH", "/api/admin/tenants/deniz-emlak", { phoneNumbers: ["+908501234567"] });
    const init = () => app.request("/webhooks/elevenlabs/init", { method: "POST", headers: { authorization: `Bearer ${deps.toolSecret}`, "content-type": "application/json" }, body: JSON.stringify({ called_number: "+908501234567", caller_id: "+905551112233" }) });
    expect((await init()).status).toBe(200);
    await admin("PATCH", "/api/admin/tenants/deniz-emlak", { suspended: true });
    expect((await init()).status).toBe(403);
    await admin("PATCH", "/api/admin/tenants/deniz-emlak", { suspended: false });
    expect((await init()).status).toBe(200);
  });

  it("panel ayarı askıya alma ve telefon alanlarını değiştiremez", async () => {
    const { asMember, deps } = await approve();
    const cfg = (await asMember("GET", "/api/panel/settings")).body.config;
    await asMember("PUT", "/api/panel/settings", { config: { ...cfg, suspended: true, phoneNumbers: ["+905550000000"] } });
    expect(deps.tenantStore.getEditable("deniz-emlak")?.config).toMatchObject({ suspended: false, phoneNumbers: [] });
  });
});
