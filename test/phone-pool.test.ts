import { describe, expect, it } from "vitest";
import { makeApp, MONDAY_9AM } from "./helpers.ts";
import type { FirebaseVerifier } from "../src/auth/firebase.ts";
import { POOL } from "../src/domain/phone-pool.ts";
import { PhonePool } from "../src/store/phone-pool.ts";
import { eraseTenantData } from "../src/store/retention.ts";
import { poolMaintenance } from "../src/http/phone-line.ts";
import { Store } from "../src/store/db.ts";

const DAY = 86_400_000;
const NOW = MONDAY_9AM.epochMilliseconds;
const N = (i: number) => `+9085030000${String(i).padStart(2, "0")}`; // +90850300000i

describe("PhonePool deposu", () => {
  const mk = () => new PhonePool(new Store(":memory:").db);

  it("numaraları normalleştirir, tekrar ve geçersizleri atlar, başka firmaya ait numarayı almaz", () => {
    const pool = mk();
    const r = pool.add(["0850 300 00 01", "+908503000002", "0850 300 00 01", "abc", "0850 300 00 03"], { nowMs: NOW, inUse: (n) => n === "+908503000003" });
    expect(r.added).toEqual(["+908503000001", "+908503000002"]);
    expect(r.skipped.map((x) => x.reason)).toEqual(["Havuzda zaten var", "Geçersiz numara", "Bir firmaya elle atanmış"]);
    expect(pool.stats()).toMatchObject({ available: 2, total: 2 });
  });

  it("en eski numarayı verir, aynı firmaya tekrar çağrılınca aynısını döner, boşken null", () => {
    const pool = mk();
    pool.add([N(1)], { nowMs: NOW });
    pool.add([N(2)], { nowMs: NOW + 1000 });
    expect(pool.assign("a", NOW)).toEqual({ number: N(1), created: true });
    expect(pool.assign("a", NOW)).toEqual({ number: N(1), created: false });
    expect(pool.assign("b", NOW)).toEqual({ number: N(2), created: true });
    expect(pool.assign("c", NOW)).toBeNull();
    expect(pool.stats()).toMatchObject({ available: 0, assigned: 2 });
  });

  it("bırakılan numara 180 gün karantinada kalır, süre dolunca müsait olur, karantinadaki hiç atanmaz", () => {
    const pool = mk();
    pool.add([N(1)], { nowMs: NOW });
    pool.assign("a", NOW);
    expect(pool.release(N(1), NOW)).toBe(true);
    expect(pool.release(N(1), NOW)).toBe(false); // atanmış değil artık
    expect(pool.get(N(1))).toMatchObject({ status: "quarantine", tenantId: null, quarantineUntil: NOW + POOL.quarantineDays * DAY });
    expect(pool.assign("b", NOW + 10 * DAY)).toBeNull();
    expect(pool.promoteExpired(NOW + (POOL.quarantineDays - 1) * DAY)).toBe(0);
    expect(pool.promoteExpired(NOW + POOL.quarantineDays * DAY)).toBe(1);
    expect(pool.assign("b", NOW + POOL.quarantineDays * DAY)).toEqual({ number: N(1), created: true });
  });

  it("emekli yalnızca müsait ya da karantinadaki numaraya uygulanır; yenileme hatırlatması yaklaşanları listeler", () => {
    const pool = mk();
    pool.add([N(1), N(2), N(3)], { nowMs: NOW, renewAt: NOW + 10 * DAY });
    pool.setMeta(N(3), { renewAt: NOW + 200 * DAY });
    pool.assign("a", NOW);
    expect(pool.retire(N(1))).toBe(false); // atanmış
    expect(pool.retire(N(2))).toBe(true);
    expect(pool.assign("b", NOW)).toEqual({ number: N(3), created: true }); // emekli seçilmez
    expect(pool.renewalsDue(NOW).map((r) => r.number)).toEqual([N(1)]); // N2 emekli, N3 uzak
  });
});

const verifier = (email: string): FirebaseVerifier => ({ verify: async () => ({ uid: "uid-admin", email, emailVerified: true, name: "Yönetici" }) });
const form = (name: string) => ({ business: { name, sector: "emlak" }, contact: { person: "Emre Can", phone: "0532 111 22 33" }, services: [{ name: "Satılık danışmanlığı" }], staff: [{ name: "Ali Danışman", phone: "0533 000 11 22" }], consent: { kvkk: true } });

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
  const fb = await app.request("/api/auth/firebase", { method: "POST", headers: json, body: JSON.stringify({ idToken: "x".repeat(30) }) });
  const adminCookie = fb.headers.get("set-cookie")!.split(";")[0]!;
  const call = (cookie: string) => async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { ...json, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  const admin = call(adminCookie);
  /** Bir üye açar; paid ise paketi ödenmiş olur; formu gönderir. Başvuru referansını döner. */
  const member = async (email: string, business: string, paid: boolean) => {
    await deps.users.create({ tenantId: null, email, name: "Üye", role: "owner", password: "sifre-12345", mustChangePassword: false });
    const login = await app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ email, password: "sifre-12345" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const asMember = call(cookie);
    await asMember("POST", "/api/auth/plan", { plan: "standart" });
    if (paid) await asMember("POST", "/api/auth/pay");
    const sub = await app.request("/api/onboarding", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(form(business)) });
    // ödemesiz üyenin formu reddedilir (402); yöneticiyle aynı başvuruyu tekrar oluşturmak için doğrudan kaydedilir
    if (sub.status !== 200) return deps.store.saveOnboarding({ businessName: business, contactPhone: "+905321112233", payload: form(business), userId: (deps.users.findByEmail(email)!).id });
    return ((await sub.json()) as { reference: string }).reference;
  };
  return { ...ctx, admin, member, connected, disconnected, call };
}

describe("hat havuzu: yönetici API'si ve otomatik atama", () => {
  it("yalnızca yönetici erişir", async () => {
    const t = await setup();
    await t.deps.users.create({ tenantId: null, email: "musteri@ornek.com", name: "M", role: "owner", password: "sifre-12345", mustChangePassword: false });
    const login = await t.app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-panel": "1" }, body: JSON.stringify({ email: "musteri@ornek.com", password: "sifre-12345" }) });
    const asOwner = t.call(login.headers.get("set-cookie")!.split(";")[0]!);
    expect((await asOwner("GET", "/api/admin/phone-pool")).status).toBe(403);
    expect((await asOwner("POST", "/api/admin/phone-pool", { numbers: N(1) })).status).toBe(403);
  });

  it("ödemiş üyenin firması oluşturulunca havuzdan numara atanır; asistan kurulunca hat bağlanır ve müşteriye bir kez e-posta gider", async () => {
    const t = await setup();
    await t.admin("POST", "/api/admin/phone-pool", { numbers: `${N(1)}\n${N(2)}\n${N(3)}`, note: "ilk parti" });
    const ref = await t.member("a@ornek.com", "Deniz Emlak", true);
    t.mailbox.length = 0;
    const r = await t.admin("POST", `/api/admin/submissions/${ref}/create-tenant`);
    expect(r.status).toBe(200);
    expect(r.body.line).toMatchObject({ number: N(1), connected: false }); // asistan henüz yok
    expect(t.deps.tenants.get("deniz-emlak")!.phoneNumbers).toEqual([N(1)]);
    expect(t.connected).toEqual([]);

    // asistan kurulunca hat da bağlanır
    const a = await t.admin("POST", "/api/admin/tenants/deniz-emlak/assistant");
    expect(a.body).toMatchObject({ ok: true, created: true, phone: { connected: true } });
    expect(t.connected).toEqual([[N(1)]]);
    const toMember = t.mailbox.filter((m) => m.subject.startsWith("Telefon hattınız hazır"));
    expect(toMember).toHaveLength(1);
    expect(toMember[0]!.to).toEqual(["a@ornek.com"]);
    expect(toMember[0]!.text).toContain("0850 300 00 01");
    expect(toMember[0]!.text).toMatch(/operatörü tarafından ücretlendirilebilir/);
    expect(toMember[0]!.text).toMatch(/koşullu yönlendirme/i);

    // yeniden bağlama ikinci e-posta üretmez
    await t.admin("POST", "/api/admin/tenants/deniz-emlak/phone/connect");
    expect(t.mailbox.filter((m) => m.subject.startsWith("Telefon hattınız hazır"))).toHaveLength(1);
    // havuz envanteri
    const pool = (await t.admin("GET", "/api/admin/phone-pool")).body;
    expect(pool.stats).toMatchObject({ available: 2, assigned: 1 });
    expect(pool.numbers.find((x: any) => x.number === N(1))).toMatchObject({ status: "assigned", tenantName: "Deniz Emlak" });
  });

  it("ödemesi doğrulanmamış üyeye otomatik numara verilmez, yönetici düğmesiyle verilebilir", async () => {
    const t = await setup();
    await t.admin("POST", "/api/admin/phone-pool", { numbers: N(1) });
    const ref = await t.member("b@ornek.com", "Ödemesiz Firma", false);
    const r = await t.admin("POST", `/api/admin/submissions/${ref}/create-tenant`);
    expect(r.body.line).toMatchObject({ reason: "unpaid" });
    expect(t.deps.tenants.get("odemesiz-firma")!.phoneNumbers).toEqual([]);
    expect((await t.admin("GET", "/api/admin/phone-pool")).body.stats.available).toBe(1);

    const manual = await t.admin("POST", "/api/admin/tenants/odemesiz-firma/assign-number");
    expect(manual).toMatchObject({ status: 200, body: { ok: true, number: N(1) } });
    // aynı firmaya ikinci çağrı aynı numarayı döner, yeni numara tüketmez
    expect((await t.admin("POST", "/api/admin/tenants/odemesiz-firma/assign-number")).body.number).toBe(N(1));
  });

  it("havuz boşken firma oluşunca yönetici uyarılır; numara eklenince bekleyen firmaya kendiliğinden atanır", async () => {
    const t = await setup();
    const ref = await t.member("c@ornek.com", "Bekleyen Firma", true);
    t.mailbox.length = 0;
    const r = await t.admin("POST", `/api/admin/submissions/${ref}/create-tenant`);
    expect(r.body.line).toMatchObject({ reason: "empty" });
    expect(t.mailbox.some((m) => m.subject === "Hat bekleyen firma: Bekleyen Firma" && m.to.includes("admin@ornek.com"))).toBe(true);
    expect((await t.admin("GET", "/api/admin/phone-pool")).body.waiting).toEqual([{ id: "bekleyen-firma", name: "Bekleyen Firma" }]);

    const add = await t.admin("POST", "/api/admin/phone-pool", { numbers: `${N(1)}, ${N(2)}` });
    expect(add.body.added).toHaveLength(2);
    expect(add.body.assigned).toMatchObject([{ tenantId: "bekleyen-firma", number: N(1) }]);
    expect(t.deps.tenants.get("bekleyen-firma")!.phoneNumbers).toEqual([N(1)]);
  });

  it("müsait numara 2'ye düşünce yöneticiye günde bir kez uyarı gider", async () => {
    const t = await setup();
    t.mailbox.length = 0;
    await t.admin("POST", "/api/admin/phone-pool", { numbers: `${N(1)}\n${N(2)}` }); // 2 müsait: eşikte
    await t.admin("POST", "/api/admin/phone-pool", { numbers: N(3) }); // aynı gün ikinci uyarı yok
    const low = t.mailbox.filter((m) => m.subject.startsWith("Hat havuzunda") || m.subject === "Hat havuzu boş");
    expect(low).toHaveLength(1);
    expect(low[0]!.to).toContain("admin@ornek.com");
  });

  it("numarayı bırakınca karantinaya girer, firmadan ve ElevenLabs'ten kalkar, başkasına verilmez ve elle de yazılamaz", async () => {
    const t = await setup();
    await t.admin("POST", "/api/admin/phone-pool", { numbers: `${N(1)}\n${N(2)}` });
    const ref = await t.member("d@ornek.com", "Birinci Firma", true);
    await t.admin("POST", `/api/admin/submissions/${ref}/create-tenant`);
    expect(t.deps.tenants.get("birinci-firma")!.phoneNumbers).toEqual([N(1)]);

    const rel = await t.admin("POST", `/api/admin/phone-pool/${encodeURIComponent(N(1))}/release`);
    expect(rel).toMatchObject({ status: 200, body: { ok: true, disconnected: true } });
    expect(t.disconnected).toEqual([N(1)]);
    expect(t.deps.tenants.get("birinci-firma")!.phoneNumbers).toEqual([]);
    const row = (await t.admin("GET", "/api/admin/phone-pool")).body.numbers.find((x: any) => x.number === N(1));
    expect(row).toMatchObject({ status: "quarantine", tenantId: null });
    expect(row.quarantineUntil).toBeGreaterThan(NOW + 179 * DAY);

    // karantinadaki numara yeni firmaya verilmez
    const ref2 = await t.member("e@ornek.com", "Ikinci Firma", true);
    const r2 = await t.admin("POST", `/api/admin/submissions/${ref2}/create-tenant`);
    expect(r2.body.line.number).toBe(N(2));
    // elle yazılmaya çalışılırsa reddedilir
    const manual = await t.admin("PATCH", "/api/admin/tenants/ikinci-firma", { phoneNumbers: [N(1)] });
    expect(manual.status).toBe(409);
    expect(manual.body.error).toMatch(/karantinada/);
    // atanmış olmayan numara bırakılamaz
    expect((await t.admin("POST", `/api/admin/phone-pool/${encodeURIComponent(N(1))}/release`)).status).toBe(409);
  });

  it("yöneticinin firma numarasını elle değiştirmesi havuz envanterini doğru tutar", async () => {
    const t = await setup();
    await t.admin("POST", "/api/admin/phone-pool", { numbers: N(1) });
    const ref = await t.member("f@ornek.com", "Elle Firma", false);
    await t.admin("POST", `/api/admin/submissions/${ref}/create-tenant`); // ödemesiz: otomatik atama yok
    await t.admin("PATCH", "/api/admin/tenants/elle-firma", { phoneNumbers: [N(1)] });
    expect((await t.admin("GET", "/api/admin/phone-pool")).body.numbers[0]).toMatchObject({ number: N(1), status: "assigned", tenantId: "elle-firma" });
    await t.admin("PATCH", "/api/admin/tenants/elle-firma", { phoneNumbers: [] });
    expect((await t.admin("GET", "/api/admin/phone-pool")).body.numbers[0]).toMatchObject({ status: "quarantine" });
    expect(t.disconnected).toContain(N(1));
  });

  it("bakım: karantinası biten numara müsait olur ve hat bekleyen firmaya atanır; yenileme yaklaşınca uyarı gider", async () => {
    const t = await setup();
    await t.admin("POST", "/api/admin/phone-pool", { numbers: N(1), renewAt: new Date(NOW + 10 * DAY).toISOString().slice(0, 10) });
    const ref = await t.member("g@ornek.com", "Eski Firma", true);
    await t.admin("POST", `/api/admin/submissions/${ref}/create-tenant`);
    await t.admin("POST", `/api/admin/phone-pool/${encodeURIComponent(N(1))}/release`);
    await t.admin("PATCH", "/api/admin/tenants/eski-firma", { suspended: true }); // ayrılan firma: askıda, hat beklemez
    const ref2 = await t.member("h@ornek.com", "Bekleyen Yeni", true);
    await t.admin("POST", `/api/admin/submissions/${ref2}/create-tenant`); // havuz boş: bekler
    expect(t.deps.tenants.get("bekleyen-yeni")!.phoneNumbers).toEqual([]);

    t.mailbox.length = 0;
    t.deps.now = () => MONDAY_9AM.add({ days: POOL.quarantineDays + 1 });
    const r = await poolMaintenance(t.deps);
    expect(r).toMatchObject({ promoted: 1, assigned: 1, renewalReminders: 1 });
    expect(t.deps.tenants.get("bekleyen-yeni")!.phoneNumbers).toEqual([N(1)]);
    expect(t.mailbox.some((m) => m.subject.startsWith("Numara yenilemesi yaklaşıyor"))).toBe(true);
    // aynı ay içinde ikinci bakım ikinci hatırlatma üretmez
    t.mailbox.length = 0;
    expect((await poolMaintenance(t.deps)).renewalReminders).toBe(0);
  });

  it("emekli, not ve yenileme tarihi güncelleme uçları çalışır", async () => {
    const t = await setup();
    await t.admin("POST", "/api/admin/phone-pool", { numbers: `${N(1)}\n${N(2)}` });
    expect((await t.admin("PATCH", `/api/admin/phone-pool/${encodeURIComponent(N(1))}`, { note: "Netgsm sipariş 123", renewAt: "2027-10-15" })).status).toBe(200);
    const one = (await t.admin("GET", "/api/admin/phone-pool")).body.numbers.find((x: any) => x.number === N(1));
    expect(one).toMatchObject({ note: "Netgsm sipariş 123" });
    expect(one.renewAt).toBeGreaterThan(NOW);
    expect((await t.admin("POST", `/api/admin/phone-pool/${encodeURIComponent(N(2))}/retire`)).status).toBe(200);
    expect((await t.admin("POST", `/api/admin/phone-pool/${encodeURIComponent(N(2))}/retire`)).status).toBe(409); // ikinci emekli denemesi: artık müsait değil
    expect((await t.admin("POST", "/api/admin/phone-pool", { numbers: "abc" })).body.skipped).toHaveLength(1);
    expect((await t.admin("POST", "/api/admin/phone-pool", { numbers: Array.from({ length: 51 }, (_, i) => N(i)).join("\n") })).status).toBe(422);
  });
});

describe("hizmet sonu silme ve hat havuzu", () => {
  it("firma verisi silinirken hat numarası karantinaya alınır", () => {
    const { store, deps } = makeApp(MONDAY_9AM);
    const pool = new PhonePool(store.db);
    pool.add([N(1)], { nowMs: NOW });
    pool.assign("demo-spa", NOW);
    const raw = structuredClone(deps.tenantStore.getLiveRaw("demo-spa") as any);
    raw.suspended = true;
    deps.tenantStore.publish({ ...raw });
    const r = eraseTenantData(store.db, "demo-spa", "demo-spa", NOW);
    expect(r.poolNumbers).toEqual([N(1)]);
    expect(pool.get(N(1))).toMatchObject({ status: "quarantine", tenantId: null, quarantineUntil: NOW + POOL.quarantineDays * DAY });
  });
});

describe("sözleşme metni ile hat havuzu politikası tutarlılığı", () => {
  it("kullanım koşulları teknik yönlendirme hattını ve karantina süresini politikayla aynı yazar", async () => {
    const { readFileSync } = await import("node:fs");
    const html = readFileSync("web/index.html", "utf8");
    const terms = html.slice(html.indexOf('data-legal="kullanim-kosullari"'), html.indexOf("</article>", html.indexOf('data-legal="kullanim-kosullari"')));
    expect(terms).toContain("teknik bir yönlendirme hattıdır");
    expect(terms).toContain("devredemez");
    expect(terms).toContain(`sonraki ${POOL.quarantineDays} gün başka bir işletmeye verilmez`);
    // eski numaralandırma bozulmadı: veri işleme hâlâ 9. madde (klinik sayfası ona atıf yapıyor)
    expect(terms).toContain("<h2>9. Veri işleme, saklama ve silme</h2>");
    expect(terms).toContain("<h2>11. Değişiklikler ve uygulanacak hukuk</h2>");
  });
});
