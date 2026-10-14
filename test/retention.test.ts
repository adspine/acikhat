import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { demoTenant, makeApp, MONDAY_9AM } from "./helpers.ts";
import { RETENTION } from "../src/domain/retention.ts";
import { ERASED_NAME, eraseTenantData, purgeExpired } from "../src/store/retention.ts";

const DAY = 86_400_000;
const NOW = MONDAY_9AM.epochMilliseconds;
const ago = (days: number) => NOW - days * DAY;
const count = (db: any, sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { n: number }).n;

function seed(store: ReturnType<typeof makeApp>["store"]) {
  const call = (id: string, days: number) =>
    store.saveCall({ conversationId: id, tenantId: demoTenant.id, startedAtMs: ago(days), durationSecs: 120, summary: "Ayşe Hanım masaj istedi", callerPhone: "+905321112233", outcome: "booked", payload: { data: { transcript: [{ role: "user", message: "Merhaba" }] } } });
  call("eski", RETENTION.callDays + 1);
  call("yeni", RETENTION.callDays - 1);
  store.logCallStart({ callSid: "cs-eski", tenantId: demoTenant.id, callerPhone: "+905321112233", atMs: ago(RETENTION.callDays + 1) });
  store.logCallStart({ callSid: "cs-yeni", tenantId: demoTenant.id, callerPhone: "+905321112233", atMs: ago(10) });
  const cb = store.db.prepare("INSERT INTO callback_requests (id, tenant_id, name, phone, reason, created_at) VALUES (?, ?, ?, ?, 'x', ?)");
  cb.run("cb-eski", demoTenant.id, "Ali", "+905320000001", ago(RETENTION.callbackDays + 1));
  cb.run("cb-yeni", demoTenant.id, "Veli", "+905320000002", ago(5));
  const ap = store.db.prepare("INSERT INTO appointments (id, tenant_id, service_id, staff_id, room_id, start_ms, end_ms, block_end_ms, customer_name, customer_phone, created_at) VALUES (?, ?, 's', 'p', 'r', ?, ?, ?, ?, ?, ?)");
  const old = ago(RETENTION.appointmentDays + 1);
  ap.run("ap-eski", demoTenant.id, old, old + 3600_000, old + 3600_000, "Ayşe Yılmaz", "+905321112233", old);
  ap.run("ap-yeni", demoTenant.id, ago(30), ago(30) + 3600_000, ago(30) + 3600_000, "Fatma Demir", "+905329998877", ago(30));
  const dc = store.db.prepare("INSERT INTO demo_calls (id, phone, ip, status, created_at) VALUES (?, ?, '1.2.3.4', 'done', ?)");
  dc.run("d-eski", "+905321110000", ago(RETENTION.demoCallDays + 1));
  dc.run("d-yeni", "+905321110001", ago(3));
  const lead = store.db.prepare("INSERT INTO onboarding_submissions (reference, business_name, contact_phone, status, payload_json, created_at, tenant_id) VALUES (?, 'X', '+905321112233', ?, '{}', ?, ?)");
  lead.run("L-eski-yeni", "new", ago(RETENTION.leadDays + 1), null);
  lead.run("L-eski-canli", "live", ago(RETENTION.leadDays + 1), demoTenant.id);
  lead.run("L-yeni", "new", ago(2), null);
  store.audit({ tenantId: demoTenant.id, userId: null, action: "x.eski" });
  store.db.prepare("UPDATE audit_log SET at = ?").run(ago(RETENTION.auditDays + 1));
  store.audit({ tenantId: demoTenant.id, userId: null, action: "x.yeni" });
  store.db.prepare("INSERT INTO webhook_events (id, received_at) VALUES ('we-eski', ?), ('we-yeni', ?)").run(ago(RETENTION.webhookEventDays + 1), ago(1));
}

describe("saklama süresi temizliği", () => {
  it("süresi dolanı siler/anonimleştirir, taze kayda ve istatistiğe dokunmaz", () => {
    const { store } = makeApp(MONDAY_9AM);
    seed(store);
    const r = purgeExpired(store.db, NOW);
    expect(r).toEqual({ callsAnonymized: 1, callLogAnonymized: 1, callbacksDeleted: 1, appointmentsAnonymized: 1, demoCallsDeleted: 1, leadsDeleted: 1, auditDeleted: 1, webhookEventsDeleted: 1 });

    const eski = store.db.prepare("SELECT summary, caller_phone, payload_json, duration_secs, outcome FROM calls WHERE conversation_id = 'eski'").get() as any;
    expect(eski).toMatchObject({ summary: null, caller_phone: null, payload_json: "{}", duration_secs: 120, outcome: "booked" }); // istatistik kalır
    const yeni = store.db.prepare("SELECT summary, caller_phone FROM calls WHERE conversation_id = 'yeni'").get() as any;
    expect(yeni).toMatchObject({ summary: "Ayşe Hanım masaj istedi", caller_phone: "+905321112233" });
    expect(store.db.prepare("SELECT caller_phone FROM call_log WHERE call_sid = 'cs-eski'").get()).toMatchObject({ caller_phone: null });
    expect(store.db.prepare("SELECT caller_phone FROM call_log WHERE call_sid = 'cs-yeni'").get()).toMatchObject({ caller_phone: "+905321112233" });

    expect(count(store.db, "SELECT COUNT(*) n FROM callback_requests WHERE id = 'cb-yeni'")).toBe(1);
    expect(count(store.db, "SELECT COUNT(*) n FROM callback_requests WHERE id = 'cb-eski'")).toBe(0);
    expect(store.db.prepare("SELECT customer_name, customer_phone FROM appointments WHERE id = 'ap-eski'").get()).toMatchObject({ customer_name: ERASED_NAME, customer_phone: "" });
    expect(store.db.prepare("SELECT customer_name FROM appointments WHERE id = 'ap-yeni'").get()).toMatchObject({ customer_name: "Fatma Demir" });
    expect(count(store.db, "SELECT COUNT(*) n FROM demo_calls")).toBe(1);
    // Firması olan (canlı) başvuru, yaşı ne olursa olsun silinmez
    expect(store.db.prepare("SELECT reference FROM onboarding_submissions ORDER BY reference").all().map((x: any) => x.reference)).toEqual(["L-eski-canli", "L-yeni"]);
    expect(store.db.prepare("SELECT action FROM audit_log").all().map((x: any) => x.action)).toEqual(["x.yeni"]);
    expect(count(store.db, "SELECT COUNT(*) n FROM webhook_events")).toBe(1);
  });

  it("ikinci çalıştırma hiçbir şeyi değiştirmez", () => {
    const { store } = makeApp(MONDAY_9AM);
    seed(store);
    purgeExpired(store.db, NOW);
    expect(Object.values(purgeExpired(store.db, NOW)).every((n) => n === 0)).toBe(true);
  });

  it("anonimleştirilmiş çağrı ve randevu panelde hata vermeden açılır", async () => {
    const ctx = makeApp(MONDAY_9AM);
    seed(ctx.store);
    purgeExpired(ctx.store.db, NOW);
    await ctx.deps.users.create({ tenantId: demoTenant.id, email: "s@ornek.com", name: "S", role: "owner", password: "sifre-12345", mustChangePassword: false });
    const login = await ctx.app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-panel": "1" }, body: JSON.stringify({ email: "s@ornek.com", password: "sifre-12345" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const get = (path: string) => ctx.app.request(`/api/panel${path}`, { headers: { cookie, "x-panel": "1" } });
    const detail = await get("/calls/eski");
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as any).transcript).toEqual([]);
    expect((await get("/calls")).status).toBe(200);
    expect((await get("/appointments/ap-eski")).status).toBe(200);
    expect((await get("/reports")).status).toBe(200);
  });
});

describe("hizmet sonu silme", () => {
  const suspend = (ctx: ReturnType<typeof makeApp>) => {
    const raw = structuredClone(ctx.deps.tenantStore.getLiveRaw(demoTenant.id) as any);
    raw.suspended = true;
    ctx.deps.tenantStore.patchLive(demoTenant.id, "suspended", true);
    return raw;
  };

  it("askıda olmayan firmayı veya yanlış onayı reddeder, hiçbir şeyi silmez", async () => {
    const ctx = makeApp(MONDAY_9AM);
    seed(ctx.store);
    expect(() => eraseTenantData(ctx.store.db, demoTenant.id, demoTenant.id)).toThrow(/askıda değil/);
    expect(() => eraseTenantData(ctx.store.db, demoTenant.id, "baska")).toThrow(/Onay metni/);
    expect(() => eraseTenantData(ctx.store.db, "yok-firma", "yok-firma")).toThrow(/bulunamadı/);
    expect(count(ctx.store.db, "SELECT COUNT(*) n FROM appointments")).toBe(2);
  });

  it("askıdaki firmanın verisini siler; başka firmaya ve faturaya dokunmaz", async () => {
    const other = { ...demoTenant, id: "diger-firma", name: "Diğer", phoneNumbers: ["+908500000099"], agentIds: [] };
    const ctx = makeApp(MONDAY_9AM, { tenants: [demoTenant, other] });
    seed(ctx.store);
    ctx.store.db.prepare("INSERT INTO appointments (id, tenant_id, service_id, staff_id, room_id, start_ms, end_ms, block_end_ms, customer_name, customer_phone, created_at) VALUES ('ap-diger', 'diger-firma', 's','p','r',1,2,2,'Başka','+905000000000',1)").run();
    ctx.store.db.prepare("INSERT INTO orders (id, tenant_id, kind, item, label, amount_usd, period, created_at, status) VALUES ('o1', ?, 'plan', 'pro', 'x', 599, '2026-10', 1, 'paid')").run(demoTenant.id);
    await ctx.deps.users.create({ tenantId: demoTenant.id, email: "s@ornek.com", name: "S", role: "owner", password: "sifre-12345", mustChangePassword: false });
    suspend(ctx);
    const r = eraseTenantData(ctx.store.db, demoTenant.id, demoTenant.id);
    expect(r).toMatchObject({ users: 1, appointments: 2, tenant: 1 });
    expect(count(ctx.store.db, "SELECT COUNT(*) n FROM appointments WHERE tenant_id = ?", demoTenant.id)).toBe(0);
    expect(count(ctx.store.db, "SELECT COUNT(*) n FROM appointments WHERE tenant_id = 'diger-firma'")).toBe(1);
    expect(count(ctx.store.db, "SELECT COUNT(*) n FROM orders WHERE id = 'o1'")).toBe(1); // yasal saklama
    expect(count(ctx.store.db, "SELECT COUNT(*) n FROM tenants WHERE id = 'diger-firma'")).toBe(1);
  });
});

describe("sözleşme metni ile politika tutarlılığı", () => {
  const html = readFileSync("web/index.html", "utf8");
  const article = (key: string) => html.slice(html.indexOf(`data-legal="${key}"`), html.indexOf("</article>", html.indexOf(`data-legal="${key}"`)));
  const months = (days: number) => `${Math.round(days / 30.4)} ay`;

  it("KVKK 6. bölümü kodla aynı süreleri yazar", () => {
    const k = article("kvkk-aydinlatma-metni");
    const sec = k.slice(k.indexOf("6. Saklama süreleri"), k.indexOf("7. Haklarınız"));
    expect(sec).toContain(`en çok ${RETENTION.elevenLabsDays} gün`);
    expect(sec).toContain(`</strong> ${months(RETENTION.callDays)}.`);
    expect(sec).toContain(`</strong> ${months(RETENTION.callbackDays)}.`);
    expect(sec).toContain(`${months(RETENTION.appointmentDays)} sonra`);
    expect(sec).toContain(`(girilen cep numarası ve IP adresi): ${RETENTION.demoCallDays} gün`);
    expect(sec).toContain(`</strong> ${months(RETENTION.leadDays)}.`);
    expect(sec).toContain(`</strong> ${months(RETENTION.auditDays)}.`);
    expect(sec).toContain(`${RETENTION.terminationDays} gün içinde silinir`);
  });

  it("kullanım koşulları ve iptal sayfası hizmet sonu süresini aynı yazar", () => {
    expect(article("kullanim-kosullari")).toContain(`${RETENTION.terminationDays} gün içinde silinir`);
    expect(article("iptal-iade")).toContain(`${RETENTION.terminationDays} gün içinde silinir`);
  });

  it("sitede kişisel iletişim bilgisi kalmadı", () => {
    expect(html).not.toMatch(/kisaltici@gmail|425 ?14 ?95|26080379140|hs02\.kep|Beşkavaklar|Necdet Gören/);
  });
});
