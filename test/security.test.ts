import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { demoTenant, makeApp, MONDAY_9AM } from "./helpers.ts";
import { rateLimit, safeEqual, securityHeaders } from "../src/http/security.ts";

describe("güvenlik başlıkları", () => {
  it("her yanıtta çerçeve engeli, nosniff, referrer ve mikrofon dışındaki izinler kapalı", async () => {
    const { app } = makeApp(MONDAY_9AM);
    for (const path of ["/health", "/api/yok", "/olmayan-sayfa"]) {
      const h = (await app.request(path)).headers;
      expect(h.get("x-frame-options"), path).toBe("DENY");
      expect(h.get("x-content-type-options"), path).toBe("nosniff");
      expect(h.get("referrer-policy"), path).toBe("strict-origin-when-cross-origin");
      expect(h.get("permissions-policy"), path).toMatch(/camera=\(\)/);
      expect(h.get("permissions-policy"), path).toMatch(/microphone=\(self\)/);
      expect(h.get("content-security-policy"), path).toMatch(/frame-ancestors 'none'/);
      expect(h.get("content-security-policy"), path).toMatch(/object-src 'none'/);
      // Zorlanan CSP betikleri kısıtlamaz: Firebase girişi tarayıcıda denenmeden kapatılmaz
      expect(h.get("content-security-policy"), path).not.toMatch(/script-src/);
      expect(h.get("content-security-policy-report-only"), path).toMatch(/script-src 'self' https:\/\/www\.gstatic\.com/);
      // Google ile giriş penceresi için COOP gönderilmemeli
      expect(h.get("cross-origin-opener-policy"), path).toBeNull();
    }
  });

  it("HSTS yalnızca HTTPS ortamında, alt alan adları olmadan gönderilir", async () => {
    const mk = (https: boolean) => new Hono().use("*", securityHeaders({ https })).get("/", (c) => c.text("ok"));
    expect((await mk(true).request("/")).headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect((await mk(false).request("/")).headers.get("strict-transport-security")).toBeNull();
  });

  it("API yanıtları önbelleğe alınmaz", async () => {
    const { app } = makeApp(MONDAY_9AM);
    expect((await app.request("/api/yok")).headers.get("cache-control")).toBe("no-store");
    expect((await app.request("/api/auth/session")).headers.get("cache-control")).toBe("no-store");
  });
});

describe("istek sınırları", () => {
  it("aşırı büyük gövde 413 ile reddedilir (kimliksiz uç dahil)", async () => {
    const { app } = makeApp(MONDAY_9AM);
    const big = JSON.stringify({ pad: "x".repeat(1_100_000) });
    const res = await app.request("/api/demo-call", { method: "POST", headers: { "content-type": "application/json" }, body: big });
    expect(res.status).toBe(413);
    const tool = await app.request("/tools/demo-spa/check_availability", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer tool-secret" }, body: "x".repeat(300_000) });
    expect(tool.status).toBe(413);
  });

  it("IP başına istek sınırı: aşılınca 429 ve Retry-After, pencere dolunca yeniden açılır", async () => {
    let now = 1_000_000;
    const app = new Hono().use("*", rateLimit({ windowMs: 60_000, max: 3, now: () => now })).get("/", (c) => c.text("ok"));
    const get = (ip: string) => app.request("/", { headers: { "fly-client-ip": ip } });
    for (let i = 0; i < 3; i++) expect((await get("1.1.1.1")).status).toBe(200);
    const blocked = await get("1.1.1.1");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await get("2.2.2.2")).status).toBe(200); // başka IP etkilenmez
    now += 61_000;
    expect((await get("1.1.1.1")).status).toBe(200);
  });
});

describe("CSP raporu ve webhook kimliği", () => {
  it("CSP raporu 204 döner; bozuk gövde sunucuyu düşürmez", async () => {
    const { app } = makeApp(MONDAY_9AM);
    const ok = await app.request("/api/csp-report", { method: "POST", headers: { "content-type": "application/csp-report" }, body: JSON.stringify({ "csp-report": { "violated-directive": "script-src", "blocked-uri": "inline\nSAHTE" } }) });
    expect(ok.status).toBe(204);
    expect((await app.request("/api/csp-report", { method: "POST", body: "{bozuk" })).status).toBe(204);
  });

  it("init webhook: yanlış veya eksik anahtar 401, bozuk gövde 400", async () => {
    const { app } = makeApp(MONDAY_9AM);
    const post = (auth: string | undefined, body: string) => app.request("/webhooks/elevenlabs/init", { method: "POST", headers: { "content-type": "application/json", ...(auth && { authorization: auth }) }, body });
    expect((await post(undefined, "{}")).status).toBe(401);
    expect((await post("Bearer yanlis", "{}")).status).toBe(401);
    expect((await post("Bearer tool-secret", "{bozuk")).status).toBe(400);
    expect((await post("Bearer tool-secret", "{}")).status).toBe(404);
  });

  it("safeEqual: uzunluk ve içerik farkını reddeder", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual(undefined, "abc")).toBe(false);
    expect(safeEqual("", "")).toBe(false);
  });
});

describe("test sayfası (TEST_UI)", () => {
  afterEach(() => void delete process.env.TEST_UI);
  it("firma adı ve arayan numara HTML ve betikte kaçırılır", async () => {
    process.env.TEST_UI = "1";
    const tenant = { ...demoTenant, name: `<img src=x onerror=alert(1)>Spa`, agentIds: ["agent_x"] };
    const { app } = makeApp(MONDAY_9AM, { tenant });
    const html = await (await app.request(`/test/${tenant.id}?arayan=${encodeURIComponent("</script><script>alert(2)</script>")}`)).text();
    expect(html).not.toContain("<img src=x onerror");
    expect(html).not.toContain("</script><script>alert(2)");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;Spa");
  });
});
