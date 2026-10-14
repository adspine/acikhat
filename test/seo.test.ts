import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeApp, MONDAY_9AM } from "./helpers.ts";
import { PLANS } from "../src/domain/plans.ts";

const html = readFileSync("web/index.html", "utf8");
const strip = (t: string) => t.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const meta = (name: string, attr = "name") => new RegExp(`<meta ${attr}="${name}" content="([^"]*)">`).exec(html)?.[1];

describe("ana sayfa etiketleri", () => {
  it("başlık ve açıklama uzunluk sınırında, anahtar ifadeyi içerir", () => {
    const title = /<title>(.*?)<\/title>/.exec(html)![1]!;
    const desc = meta("description")!;
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.toLocaleLowerCase("tr")).toContain("yapay zeka");
    expect(desc.length).toBeGreaterThan(110);
    expect(desc.length).toBeLessThanOrEqual(160);
    expect(meta("og:title", "property")).toBe(title);
    expect(meta("twitter:title")).toBe(title);
    expect(meta("og:description", "property")).toBe(desc);
    // site.js sayfa açılınca başlığı yeniden yazar: aynı olmalı
    expect(readFileSync("web/site.js", "utf8")).toContain(`home: "${title}"`);
  });

  it("canonical, hreflang, OG görseli ve robots doğru", () => {
    expect(html).toContain('<link rel="canonical" href="https://acikhat.si/">');
    expect(html).toContain('hreflang="tr" href="https://acikhat.si/"');
    expect(html).toContain('<html lang="tr">');
    expect(meta("robots")).toMatch(/^index, follow/);
    expect(meta("og:image", "property")).toBe("https://acikhat.si/og-image.png");
    expect(html.match(/<h1[ >]/g)!.length).toBeGreaterThanOrEqual(1);
  });
});

describe("yapısal veri (JSON-LD)", () => {
  const block = /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/.exec(html)![1]!;
  const graph = (JSON.parse(block) as { "@graph": any[] })["@graph"];
  const of = (type: string) => graph.find((n) => n["@type"] === type);

  it("geçerli JSON ve beklenen türler", () => {
    expect(graph.map((n) => n["@type"]).sort()).toEqual(["FAQPage", "Organization", "SoftwareApplication", "WebSite"]);
    expect(of("Organization").email).toBe("support@acikhat.si");
  });

  it("fiyatlar plans.ts ile aynı", () => {
    const offers = of("SoftwareApplication").offers as any[];
    expect(offers.map((o) => [o.name, o.priceSpecification.price]).sort()).toEqual(Object.values(PLANS).map((p) => [p.name, p.priceUsd]).sort());
    for (const o of offers) expect(o.priceCurrency).toBe("USD");
  });

  it("SSS yapısal verisi görünür SSS metniyle aynı (gizli/uydurma içerik yok)", () => {
    const section = html.slice(html.indexOf('id="sss"'), html.indexOf("<!-- ===== İletişim"));
    const visible = [...section.matchAll(/<summary>(.*?)<\/summary>\s*<p>(.*?)<\/p>/gs)].map(([, q, a]) => [strip(q!), strip(a!)]);
    const data = (of("FAQPage").mainEntity as any[]).map((e) => [e.name, e.acceptedAnswer.text]);
    expect(visible.length).toBeGreaterThan(0);
    expect(data).toEqual(visible);
  });
});

describe("tarama ve adresler", () => {
  it("robots.txt ve sitemap.xml gerçek dosya (HTML değil) ve birbirini gösterir", async () => {
    const { app } = makeApp(MONDAY_9AM);
    const robots = await app.request("/robots.txt");
    expect(robots.headers.get("content-type")).toMatch(/text\/plain/);
    const txt = await robots.text();
    expect(txt).toContain("Sitemap: https://acikhat.si/sitemap.xml");
    expect(txt).toMatch(/Disallow: \/panel\//);
    expect(txt).toMatch(/Disallow: \/api\//);
    const sm = await app.request("/sitemap.xml");
    expect(sm.headers.get("content-type")).toMatch(/xml/);
  });

  it("sitemap'teki her adres 200 döner ve kendini canonical gösterir", async () => {
    const { app } = makeApp(MONDAY_9AM);
    const xml = await (await app.request("/sitemap.xml")).text();
    const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]!);
    expect(urls.length).toBeGreaterThanOrEqual(10);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) {
      const path = new URL(url).pathname;
      const res = await app.request(path);
      expect(res.status, url).toBe(200);
      const canonical = /<link rel="canonical" href="([^"]+)">/.exec(await res.text())?.[1] ?? "";
      // Testte site adresi panel.test; üretimde sitemap ile birebir aynı (acikhat.si). Yol her zaman aynı olmalı.
      expect(new URL(canonical).pathname, url).toBe(path);
    }
  });

  it("yasal sayfalar tek başına açılır: başlık, canonical, h1, gerçek bağlantılar, e-posta dışında kişisel veri yok", async () => {
    const { app } = makeApp(MONDAY_9AM);
    const res = await app.request("/yasal/gizlilik-politikasi");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const page = await res.text();
    expect(page).toContain("<title>Gizlilik politikası | Açık Hat</title>");
    expect(page).toContain('<meta name="robots" content="index, follow">');
    expect(page).toMatch(/<h1>Gizlilik politikası<\/h1>/);
    expect(page).not.toContain('href="#/yasal');
    expect(page).toContain('href="/yasal/kvkk-aydinlatma-metni"');
    expect(page).not.toMatch(/ hidden>/);
    expect(page).not.toMatch(/kisaltici|26080379140|425 ?14 ?95/);
    expect((await app.request("/yasal")).status).toBe(301);
    expect((await app.request("/yasal/olmayan")).status).toBe(404);
  });

  it("bilinmeyen adres gerçek 404 döner (ana sayfayı 200 ile kopyalamaz), noindex ile", async () => {
    const { app } = makeApp(MONDAY_9AM);
    for (const path of ["/olmayan-sayfa", "/fiyatlandirma", "/x/y/z.php"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toMatch(/noindex/);
    }
    expect((await app.request("/")).status).toBe(200);
    expect((await app.request("/api/yok")).status).toBe(404);
    // Panel kendi yönlendiricisine düşer (derleme yalnızca imajda ve yerelde vardır; CI'da testten sonra derlenir)
    if (existsSync("web/panel/index.html")) expect((await app.request("/panel/randevular")).status).toBe(200);
  });

  it("www ve eski fly.dev adresi ana alan adına 301, API ve araç uçları yönlendirilmez", async () => {
    const { app } = makeApp(MONDAY_9AM);
    const at = (path: string, host: string, method = "GET") => app.request(path, { method, headers: { host } });
    const www = await at("/yasal/kullanim-kosullari?x=1", "www.panel.test");
    expect(www.status).toBe(301);
    expect(www.headers.get("location")).toBe("https://panel.test/yasal/kullanim-kosullari?x=1");
    expect((await at("/", "acikhat-resepsiyon.fly.dev")).headers.get("location")).toBe("https://panel.test/");
    expect((await at("/", "panel.test")).status).toBe(200);
    expect((await at("/health", "acikhat-resepsiyon.fly.dev")).status).toBe(200);
    expect((await at("/api/auth/session", "acikhat-resepsiyon.fly.dev")).status).toBe(401);
    expect((await at("/webhooks/polar", "acikhat-resepsiyon.fly.dev", "POST")).status).not.toBe(301);
    expect((await at("/tools/demo-spa/check_availability", "acikhat-resepsiyon.fly.dev", "POST")).status).not.toBe(301);
  });

  it("metin yanıtları sıkıştırılır, özel uçlar noindex", async () => {
    const { app } = makeApp(MONDAY_9AM);
    const res = await app.request("/", { headers: { "accept-encoding": "gzip" } });
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect((await app.request("/api/yok")).headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect((await app.request("/panel/")).headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("OG görseli 1200x630 PNG olarak sunulur", async () => {
    const { app } = makeApp(MONDAY_9AM);
    const res = await app.request("/og-image.png");
    expect(res.headers.get("content-type")).toMatch(/image\/png/);
    const buf = Buffer.from(await res.arrayBuffer());
    expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([1200, 630]);
  });
});
