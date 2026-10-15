import { describe, expect, it } from "vitest";
import { makeApp, MONDAY_9AM } from "./helpers.ts";
import type { FirebaseVerifier } from "../src/auth/firebase.ts";
import { eraseTenantData } from "../src/store/retention.ts";
import { isCustomerLineNumber, normalizeLineNumber } from "../src/domain/phone.ts";

const verifier = (email: string): FirebaseVerifier => ({ verify: async () => ({ uid: "uid-admin", email, emailVerified: true, name: "Yönetici" }) });
const form = (name: string, assistantNumber?: string) => ({
  business: { name, sector: "emlak" },
  contact: { person: "Emre Can", phone: "0532 111 22 33" },
  services: [{ name: "Satılık danışmanlığı" }],
  staff: [{ name: "Ali Danışman", phone: "0533 000 11 22" }],
  phone: assistantNumber ? { assistantNumber } : {},
  consent: { kvkk: true },
});
const lineBody = (over: Record<string, unknown> = {}) => ({ number: "0850 300 00 01", subscriptionType: "onodemeli", sipConfigured: true, ownerConfirmed: true, ...over });

async function setup() {
  const connected: string[][] = [];
  const disconnected: string[] = [];
  const ctx = makeApp(MONDAY_9AM, {
    firebase: verifier("Admin@Ornek.com"),
    adminEmails: ["admin@ornek.com"],
    paymentTestMode: true,
    publishAgent: async (t) => ({ ok: true as const, agentId: `agent_${t.id}`, created: true }),
    connectPhone: async (t) => (connected.push([...t.phoneNumbers]), { ok: true as const, connected: t.phoneNumbers.map((number) => ({ number, created: true, phoneNumberId: `p${number}` })) }),
    disconnectPhone: async (n) => (disconnected.push(n), { ok: true as const, removed: true }),
  });
  const { app, deps } = ctx;
  const json = { "content-type": "application/json", "x-panel": "1" };
  const call = (cookie: string) => async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { ...json, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  const fb = await app.request("/api/auth/firebase", { method: "POST", headers: json, body: JSON.stringify({ idToken: "x".repeat(30) }) });
  const admin = call(fb.headers.get("set-cookie")!.split(";")[0]!);
  /** Üye açar, giriş yapar; oturum çağırıcısını döner */
  const member = async (email: string) => {
    await deps.users.create({ tenantId: null, email, name: "Üye", role: "owner", password: "sifre-12345", mustChangePassword: false });
    const login = await app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ email, password: "sifre-12345" }) });
    return call(login.headers.get("set-cookie")!.split(";")[0]!);
  };
  const paid = async (as: ReturnType<typeof call>) => {
    await as("POST", "/api/auth/plan", { plan: "standart" });
    await as("POST", "/api/auth/pay");
  };
  return { ...ctx, admin, member, paid, connected, disconnected };
}

describe("numara kuralları", () => {
  it("0850 ve sabit hat müşteri hattı olabilir, cep olamaz", () => {
    expect(isCustomerLineNumber(normalizeLineNumber("0850 303 83 32")!)).toBe(true);
    expect(isCustomerLineNumber(normalizeLineNumber("0212 555 44 33")!)).toBe(true);
    expect(isCustomerLineNumber(normalizeLineNumber("0374 215 00 00")!)).toBe(true);
    expect(isCustomerLineNumber(normalizeLineNumber("0532 111 22 33")!)).toBe(false);
  });
});

describe("kurulum yolculuğu: numara adımı sunucuda saklanır", () => {
  it("formda numara yoksa 3. adımda kalır (çıkış yapıp dönünce de), numara bildirince 4. adıma geçer", async () => {
    const t = await setup();
    const m = await t.member("a@ornek.com");
    await t.paid(m);
    expect((await m("GET", "/api/auth/session")).body.onboarding.step).toBe(2);
    const sub = await m("POST", "/api/onboarding", form("Deniz Emlak"));
    expect(sub.status).toBe(200);
    expect((await m("GET", "/api/auth/session")).body.onboarding).toMatchObject({ step: 3, lineNumber: null });

    // yeniden giriş: yine 3. adım
    const again = await t.member("a2@ornek.com").catch(() => null);
    void again;
    const login = await t.app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-panel": "1" }, body: JSON.stringify({ email: "a@ornek.com", password: "sifre-12345" }) });
    const back = (await (await t.app.request("/api/auth/session", { headers: { cookie: login.headers.get("set-cookie")!.split(";")[0]!, "x-panel": "1" } })).json()) as any;
    expect(back.onboarding.step).toBe(3);

    // eksik onay, cep numarası: reddedilir
    expect((await m("POST", "/api/onboarding/line", lineBody({ sipConfigured: false }))).status).toBe(422);
    expect((await m("POST", "/api/onboarding/line", lineBody({ ownerConfirmed: false }))).status).toBe(422);
    expect((await m("POST", "/api/onboarding/line", lineBody({ subscriptionType: undefined }))).status).toBe(422);
    expect((await m("POST", "/api/onboarding/line", lineBody({ number: "0532 111 22 33" }))).status).toBe(422);
    expect((await m("GET", "/api/auth/session")).body.onboarding.step).toBe(3);

    t.mailbox.length = 0;
    const ok = await m("POST", "/api/onboarding/line", lineBody());
    expect(ok).toMatchObject({ status: 200, body: { ok: true, number: "+908503000001" } });
    expect((await m("GET", "/api/auth/session")).body.onboarding).toMatchObject({ step: 4, lineNumber: "+908503000001" });
    expect(t.mailbox.find((x) => x.subject.startsWith("Numara bildirildi"))?.to).toContain("admin@ornek.com");
  });

  it("formda numara yazıldıysa doğrudan 4. adım; geçersiz numara formu reddeder; form gövdesiyle line sızdırılamaz", async () => {
    const t = await setup();
    const m = await t.member("b@ornek.com");
    await t.paid(m);
    const bad = await m("POST", "/api/onboarding", form("Bir Firma", "0532 111 22 33"));
    expect(bad.status).toBe(422);
    expect(bad.body.fields[0].path).toBe("phone.assistantNumber");
    const sneaky = await m("POST", "/api/onboarding", { ...form("Bir Firma"), line: { number: "+908509999999" } });
    expect(sneaky.status).toBe(200);
    expect((await m("GET", "/api/auth/session")).body.onboarding).toMatchObject({ step: 3, lineNumber: null });

    const m2 = await t.member("c@ornek.com");
    await t.paid(m2);
    await m2("POST", "/api/onboarding", form("Iki Firma", "0212 555 44 33"));
    expect((await m2("GET", "/api/auth/session")).body.onboarding).toMatchObject({ step: 4, lineNumber: "+902125554433" });
  });

  it("ödemeden ya da formdan önce numara bildirilemez", async () => {
    const t = await setup();
    const m = await t.member("d@ornek.com");
    expect((await m("POST", "/api/onboarding/line", lineBody())).status).toBe(409);
  });
});

describe("yönetici onayı: numara firmaya yazılır ve asistana bağlanır", () => {
  it("bildirilen numara firmaya yazılır; asistan kurulunca bağlanır ve müşteriye hat e-postası bir kez gider", async () => {
    const t = await setup();
    const m = await t.member("e@ornek.com");
    await t.paid(m);
    const { body } = await m("POST", "/api/onboarding", form("Deniz Emlak"));
    await m("POST", "/api/onboarding/line", lineBody());
    const r = await t.admin("POST", `/api/admin/submissions/${body.reference}/create-tenant`);
    expect(r).toMatchObject({ status: 200, body: { line: { number: "+908503000001", connected: false } } }); // asistan henüz yok
    expect(t.deps.tenants.get("deniz-emlak")!.phoneNumbers).toEqual(["+908503000001"]);
    expect((await m("GET", "/api/auth/session")).body.hasTenant).toBe(true);

    t.mailbox.length = 0;
    const a = await t.admin("POST", "/api/admin/tenants/deniz-emlak/assistant");
    expect(a.body).toMatchObject({ ok: true, phone: { connected: true } });
    expect(t.connected).toEqual([["+908503000001"]]);
    expect(t.mailbox.filter((x) => x.subject.startsWith("Numaranız asistana bağlandı")).map((x) => x.to)).toEqual([["e@ornek.com"]]);
    await t.admin("PATCH", "/api/admin/tenants/deniz-emlak", { phoneNumbers: ["+908503000001"] }); // tekrar kaydetmek ikinci e-posta üretmez
    expect(t.mailbox.filter((x) => x.subject.startsWith("Numaranız asistana bağlandı"))).toHaveLength(1);
  });

  it("numara bildirilmemişse firma yine oluşur, numara yok; yönetici elle yazabilir; aynı numara ikinci firmaya yazılamaz", async () => {
    const t = await setup();
    const m = await t.member("f@ornek.com");
    await t.paid(m);
    const { body } = await m("POST", "/api/onboarding", form("Birinci Firma"));
    const r = await t.admin("POST", `/api/admin/submissions/${body.reference}/create-tenant`, { phoneNumber: "0850 300 00 05" });
    expect(r.body.line.number).toBe("+908503000005");

    const m2 = await t.member("g@ornek.com");
    await t.paid(m2);
    const s2 = await m2("POST", "/api/onboarding", form("Ikinci Firma"));
    // müşteri 3. adımda başkasına ait numarayı yazarsa: reddedilir ve sahibi söylenmez
    const taken = await m2("POST", "/api/onboarding/line", lineBody({ number: "0850 300 00 05" }));
    expect(taken.status).toBe(409);
    expect(JSON.stringify(taken.body)).not.toMatch(/Birinci/);
    // yönetici mesajında hangi firma olduğu görünür
    const adm = await t.admin("POST", `/api/admin/submissions/${s2.body.reference}/create-tenant`, { phoneNumber: "+908503000005" });
    expect(adm.status).toBe(409);
    expect(adm.body.error).toMatch(/Birinci Firma/);
    expect(t.deps.tenants.get("ikinci-firma")).toBeUndefined(); // hatada firma oluşmaz
    const none = await t.admin("POST", `/api/admin/submissions/${s2.body.reference}/create-tenant`);
    expect(none).toMatchObject({ status: 200, body: { line: { reason: "none" } } });
  });

  it("firmadan çıkarılan numara ElevenLabs'ten de kaldırılır", async () => {
    const t = await setup();
    const m = await t.member("h@ornek.com");
    await t.paid(m);
    const { body } = await m("POST", "/api/onboarding", form("Kaldir Firma", "0850 300 00 07"));
    await t.admin("POST", `/api/admin/submissions/${body.reference}/create-tenant`);
    await t.admin("PATCH", "/api/admin/tenants/kaldir-firma", { phoneNumbers: [] });
    expect(t.disconnected).toEqual(["+908503000007"]);
  });
});

describe("hizmet sonu ve numara değiştirme talebi", () => {
  it("silmede asistana bağlı numaralar elle kaldırılsın diye bildirilir", async () => {
    const t = await setup();
    const m = await t.member("i@ornek.com");
    await t.paid(m);
    const { body } = await m("POST", "/api/onboarding", form("Silinecek Firma", "0850 300 00 08"));
    await t.admin("POST", `/api/admin/submissions/${body.reference}/create-tenant`);
    await t.admin("PATCH", "/api/admin/tenants/silinecek-firma", { suspended: true });
    const r = eraseTenantData(t.deps.store.db, "silinecek-firma", "silinecek-firma");
    expect(r.phoneNumbers).toEqual(["+908503000008"]);
  });

  it("numara değiştirme talebi yöneticiye gider, numara değişmez, günde bir kez, cep numarası reddedilir", async () => {
    const t = await setup();
    const m = await t.member("j@ornek.com");
    await t.paid(m);
    const { body } = await m("POST", "/api/onboarding", form("Talep Firma", "0850 300 00 09"));
    await t.admin("POST", `/api/admin/submissions/${body.reference}/create-tenant`);
    t.mailbox.length = 0;
    expect((await m("POST", "/api/panel/phone-request", { number: "0532 111 22 33" })).status).toBe(422);
    const ok = await m("POST", "/api/panel/phone-request", { number: "0850 777 00 11", note: "Yeni numaram" });
    expect(ok.status).toBe(200);
    const mail = t.mailbox.find((x) => x.subject.startsWith("Numara değişikliği"));
    expect(mail?.to).toContain("admin@ornek.com");
    expect(mail?.text).toContain("Yeni numaram");
    expect((await m("POST", "/api/panel/phone-request", { number: "0850 777 00 12" })).status).toBe(429);
    expect(t.deps.tenants.get("talep-firma")!.phoneNumbers).toEqual(["+908503000009"]);
  });
});
