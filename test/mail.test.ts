import { describe, expect, it, vi } from "vitest";
import { demoTenant, makeApp, MONDAY_9AM } from "./helpers.ts";
import { createMailer } from "../src/integrations/mail.ts";
import { checkQuotaNotices } from "../src/http/panel/billing.ts";
import type { FirebaseVerifier } from "../src/auth/firebase.ts";

const verifier = (email: string): FirebaseVerifier => ({ verify: async () => ({ uid: "uid-" + email, email, emailVerified: true, name: "Yönetici" }) });
const json = { "content-type": "application/json", "x-panel": "1" };

async function setup(opts: { tenantPlan?: boolean } = {}) {
  const tenant = opts.tenantPlan === false ? demoTenant : { ...demoTenant, plan: { id: "standart" as const, includedMinutes: 100 } };
  const ctx = makeApp(MONDAY_9AM, { tenant, firebase: verifier("admin@ornek.com"), adminEmails: ["admin@ornek.com"], paymentTestMode: true });
  const { app, deps } = ctx;
  await deps.users.create({ tenantId: tenant.id, email: "sahip@lavanta.com", name: "Ayla", role: "owner", password: "sifre-12345", mustChangePassword: false });
  const login = await app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ email: "sahip@lavanta.com", password: "sifre-12345" }) });
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const owner = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { ...json, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as any };
  };
  ctx.mailbox.length = 0;
  return { ...ctx, owner, tenant };
}

describe("e-posta bildirimleri", () => {
  it("ek paket alınca müşteriye onay, yöneticiye satış bildirimi gider", async () => {
    const { owner, mailbox } = await setup();
    await owner("POST", "/api/panel/addons", { pack: "ek-100" });
    expect(mailbox).toHaveLength(2);
    const customer = mailbox.find((m) => m.to.includes("sahip@lavanta.com"))!;
    expect(customer.subject).toContain("[TEST]");
    expect(customer.subject).toContain("100 dk ek paket");
    expect(customer.html).toContain("https://panel.test/panel/paketim");
    expect(mailbox.find((m) => m.to.includes("admin@ornek.com"))!.subject).toContain("Panelden satış");
  });

  it("paket düşürmede planlama e-postası, dönem gelince uygulama e-postası gider", async () => {
    const { owner, mailbox, deps } = await setup();
    await owner("POST", "/api/panel/plan-change", { plan: "baslangic" });
    expect(mailbox.map((m) => m.subject)).toEqual(["Paket değişikliğiniz planlandı"]);
    mailbox.length = 0;
    deps.now = () => MONDAY_9AM.add({ months: 1 }).with({ day: 2 });
    await owner("GET", "/api/panel/usage");
    expect(mailbox.map((m) => m.subject)).toEqual(["Paketiniz Başlangıç oldu"]);
  });

  it("kota %80 ve %100'de birer kez uyarır; kota değişirse yeniden uyarır", async () => {
    const { owner, store, deps, mailbox, tenant } = await setup();
    const t0 = MONDAY_9AM.epochMilliseconds;
    const call = (id: string, mins: number) => store.saveCall({ conversationId: id, tenantId: tenant.id, startedAtMs: t0 - 3600_000, durationSecs: mins * 60, outcome: "info", payload: {} });

    call("a", 50);
    checkQuotaNotices(deps, tenant.id);
    expect(mailbox).toHaveLength(0);

    call("b", 35); // 85 / 100
    checkQuotaNotices(deps, tenant.id);
    checkQuotaNotices(deps, tenant.id);
    expect(mailbox.map((m) => m.subject)).toEqual(["Aylık kotanızın %80'ini kullandınız"]);

    call("c", 20); // 105 / 100
    checkQuotaNotices(deps, tenant.id);
    checkQuotaNotices(deps, tenant.id);
    expect(mailbox.map((m) => m.subject)).toEqual(["Aylık kotanızın %80'ini kullandınız", "Aylık kotanız doldu"]);

    // ek paket alınca kota 200 olur; yeniden dolarsa yeni uyarı gider
    await owner("POST", "/api/panel/addons", { pack: "ek-100" });
    mailbox.length = 0;
    call("d", 100); // 205 / 200
    checkQuotaNotices(deps, tenant.id);
    expect(mailbox.map((m) => m.subject)).toEqual(["Aylık kotanız doldu"]);
  });

  it("kotası tanımsız firmada uyarı gitmez; askıdaki firmada da gitmez", async () => {
    const none = await setup({ tenantPlan: false });
    none.store.saveCall({ conversationId: "x", tenantId: none.tenant.id, startedAtMs: MONDAY_9AM.epochMilliseconds - 3600_000, durationSecs: 99999, outcome: "info", payload: {} });
    checkQuotaNotices(none.deps, none.tenant.id);
    expect(none.mailbox).toHaveLength(0);

    const { store, deps, tenant, mailbox } = await setup();
    store.saveCall({ conversationId: "y", tenantId: tenant.id, startedAtMs: MONDAY_9AM.epochMilliseconds - 3600_000, durationSecs: 99999, outcome: "info", payload: {} });
    deps.tenants.set({ ...deps.tenants.get(tenant.id)!, suspended: true });
    checkQuotaNotices(deps, tenant.id);
    expect(mailbox).toHaveLength(0);
  });

  it("başvuru: yöneticiye bildirim, üyeye alındı e-postası; kullanıcı metni escape edilir", async () => {
    const { app, deps, mailbox } = await setup();
    const member = await deps.users.create({ tenantId: null, email: "uye@ornek.com", name: "Yeni Üye", role: "owner", password: "sifre-12345", mustChangePassword: false });
    deps.users.selectPlan(member.id, "standart");
    deps.users.markPaid(member.id);
    const login = await app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ email: "uye@ornek.com", password: "sifre-12345" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    mailbox.length = 0;
    const res = await app.request("/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ business: { name: "<b>Deniz</b> & Ortakları", sector: "emlak" }, contact: { person: "Emre Can", phone: "0532 111 22 33", email: "emre@ornek.com" }, consent: { kvkk: true } }),
    });
    expect(res.status).toBe(200);
    const toAdmin = mailbox.find((m) => m.to.includes("admin@ornek.com"))!;
    expect(toAdmin.subject).toContain("Yeni başvuru");
    expect(toAdmin.html).toContain("&lt;b&gt;Deniz&lt;/b&gt; &amp; Ortakları");
    expect(toAdmin.html).not.toContain("<b>Deniz</b>");
    const toMember = mailbox.find((m) => m.subject === "Başvurunuzu aldık")!;
    expect(toMember.to.sort()).toEqual(["emre@ornek.com", "uye@ornek.com"]);
  });

  it("üyelik ödemesi, firma açılışı ve askıya alma e-postaları gider", async () => {
    const { app, deps, mailbox } = await setup();
    const fb = await app.request("/api/auth/firebase", { method: "POST", headers: json, body: JSON.stringify({ idToken: "x".repeat(30) }) });
    const adminCookie = fb.headers.get("set-cookie")!.split(";")[0]!;
    const admin = async (method: string, path: string, body?: unknown) => {
      const r = await app.request(path, { method, headers: { ...json, cookie: adminCookie }, body: body === undefined ? undefined : JSON.stringify(body) });
      return r.status;
    };
    const member = await deps.users.create({ tenantId: null, email: "uye@ornek.com", name: "Yeni Üye", role: "owner", password: "sifre-12345", mustChangePassword: false });
    const login = await app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ email: "uye@ornek.com", password: "sifre-12345" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    await app.request("/api/auth/plan", { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ plan: "pro" }) });
    mailbox.length = 0;
    await app.request("/api/auth/pay", { method: "POST", headers: { ...json, cookie } });
    await app.request("/api/auth/pay", { method: "POST", headers: { ...json, cookie } }); // ikinci çağrı yeni e-posta üretmez
    expect(mailbox.map((m) => m.to[0]).sort()).toEqual(["admin@ornek.com", "uye@ornek.com"]);
    expect(mailbox.find((m) => m.to[0] === "uye@ornek.com")!.subject).toContain("Pro");

    const sub = await app.request("/api/onboarding", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ business: { name: "Deniz Emlak", sector: "emlak" }, contact: { person: "Emre Can", phone: "0532 111 22 33" }, services: [{ name: "Danışmanlık" }], staff: [{ name: "Ali" }], consent: { kvkk: true } }) });
    const { reference } = (await sub.json()) as { reference: string };
    mailbox.length = 0;
    expect(await admin("POST", `/api/admin/submissions/${reference}/create-tenant`)).toBe(200);
    // Hat havuzu boş olduğu için yöneticiye "hat bekleyen firma" uyarısı da gider
    expect(mailbox.map((m) => m.subject)).toEqual(["Deniz Emlak panelinize erişebilirsiniz", "Hat bekleyen firma: Deniz Emlak"]);
    expect(mailbox[0]!.to).toEqual(["uye@ornek.com"]);
    expect(mailbox[1]!.to).toEqual(["admin@ornek.com"]);
    void member;

    mailbox.length = 0;
    await admin("PATCH", "/api/admin/tenants/deniz-emlak", { suspended: true });
    await admin("PATCH", "/api/admin/tenants/deniz-emlak", { suspended: true }); // değişmediği için ikinci e-posta yok
    await admin("PATCH", "/api/admin/tenants/deniz-emlak", { suspended: false });
    expect(mailbox.map((m) => m.subject)).toEqual(["Hizmetiniz askıya alındı", "Hizmetiniz yeniden açıldı"]);
  });

  it("gönderici hatası asıl işlemi bozmaz", async () => {
    const ctx = await setup();
    ctx.deps.mailer = { send: async () => { throw new Error("servis yok"); } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await ctx.owner("POST", "/api/panel/addons", { pack: "ek-100" })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("createMailer", () => {
  it("anahtar yoksa göndermez; varsa Resend'e doğru gövdeyle gider", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await createMailer({ from: "A <a@x.com>", fetchFn: fetchFn as unknown as typeof fetch }).send({ to: ["b@x.com"], subject: "s", text: "t", html: "<p>t</p>" });
    expect(fetchFn).not.toHaveBeenCalled();
    info.mockRestore();

    await createMailer({ apiKey: "re_test", from: "A <a@x.com>", replyTo: "destek@x.com", fetchFn: fetchFn as unknown as typeof fetch }).send({ to: ["b@x.com"], subject: "s", text: "t", html: "<p>t</p>" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    expect(JSON.parse(init.body as string)).toMatchObject({ from: "A <a@x.com>", to: ["b@x.com"], subject: "s", reply_to: "destek@x.com" });
  });

  it("servis hata dönerse istisna fırlatır", async () => {
    const fetchFn = vi.fn(async () => new Response("kötü", { status: 422 }));
    await expect(createMailer({ apiKey: "k", from: "a@x.com", fetchFn: fetchFn as unknown as typeof fetch }).send({ to: ["b@x.com"], subject: "s", text: "t", html: "h" })).rejects.toThrow("Resend 422");
  });
});
