import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeApp, MONDAY_9AM } from "./helpers.ts";
import { PLANS } from "../src/domain/plans.ts";
import { SECTOR_PAGES } from "../src/domain/seo-sectors.ts";

const strip = (t: string) => t.replace(/<[^>]+>/g, "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

async function load(slug: string) {
  const { app } = makeApp(MONDAY_9AM);
  const res = await app.request(`/${slug}`);
  return { app, res, html: await res.text() };
}

describe.each(SECTOR_PAGES)("sektör sayfası /$slug", (page) => {
  it("200 ve doğru etiketler: başlık, açıklama, canonical, tek H1, indekslenebilir", async () => {
    const { res, html } = await load(page.slug);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const title = /<title>(.*?)<\/title>/.exec(html)![1]!;
    const desc = /<meta name="description" content="([^"]*)">/.exec(html)![1]!;
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).toContain("Yapay Zeka");
    expect(desc.length).toBeGreaterThan(110);
    expect(desc.length).toBeLessThanOrEqual(160);
    expect(html).toMatch(new RegExp(`<link rel="canonical" href="[^"]*/${page.slug}">`));
    expect(html).toContain('<meta name="robots" content="index, follow');
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain('<html lang="tr">');
  });

  it("sektör şablonu gerçekten var (sayfa var olmayan bir ürün anlatmıyor)", () => {
    expect(existsSync(`agent/verticals/${page.sectorId}/vertical.json`)).toBe(true);
    expect(existsSync(`agent/verticals/${page.sectorId}/prompt.tr.md`)).toBe(true);
  });

  it("yapısal veri geçerli, SSS görünür metinle aynı, fiyatlar plans.ts ile aynı", async () => {
    const { html } = await load(page.slug);
    const graph = (JSON.parse(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/.exec(html)![1]!) as { "@graph": any[] })["@graph"];
    expect(graph.map((n) => n["@type"]).sort()).toEqual(["BreadcrumbList", "FAQPage", "Service", "WebPage"]);
    const visible = [...html.matchAll(/<details><summary>(.*?)<\/summary><p>(.*?)<\/p><\/details>/gs)].map(([, q, a]) => [strip(q!), strip(a!)]);
    const data = (graph.find((n) => n["@type"] === "FAQPage").mainEntity as any[]).map((e) => [e.name, e.acceptedAnswer.text]);
    expect(visible.length).toBeGreaterThanOrEqual(6);
    expect(data).toEqual(visible);
    for (const p of Object.values(PLANS)) expect(html).toContain(`<td><strong>${p.name}</strong></td><td>$${p.priceUsd} / ay</td>`);
  });

  it("yazım kuralları: uzun tire ve abartı sözcükleri yok, örnek görüşme kurgusal diye işaretli", async () => {
    const { html } = await load(page.slug);
    const text = strip(html.slice(html.indexOf("<body>")));
    expect(text).not.toContain("—");
    for (const w of ["kapsamlı", "devrim", "çığır", "kusursuz", "%100", "en iyi", "garanti"]) expect(text.toLocaleLowerCase("tr"), w).not.toContain(w);
    expect(text).toContain("Kurgusal");
    expect(text).toContain("Telefon hattı ve operatör ücretleri pakete dahil değildir");
  });

  it("sayfadaki tüm iç bağlantılar çalışır", async () => {
    const { app, html } = await load(page.slug);
    const hrefs = [...new Set([...html.matchAll(/href="(\/[^"#]*)"/g)].map((m) => m[1]!))].filter((h) => !/\.(ico|png)$/.test(h));
    expect(hrefs.length).toBeGreaterThanOrEqual(3);
    for (const h of hrefs) expect([200, 301], h).toContain((await app.request(h)).status);
  });
});

describe("sınırların dürüstçe yazılması (gerileme koruması)", () => {
  it("klinik: teşhis koymaz, acilde 112, sonuç paylaşmaz, ABD aktarımı açık", async () => {
    const { html } = await load("klinik");
    const t = strip(html);
    expect(t).toContain("Teşhis koymaz");
    expect(t).toContain("112");
    expect(t).toContain("Hasta sonuçlarını ya da dosya bilgisini telefonda paylaşmaz");
    expect(t).toContain("yurt dışındaki (ABD)");
    expect(t).toContain("ağrısız");
  });

  it("otel: PMS entegrasyonu yok, oda talebi not olarak alınır, yalnızca Türkçe", async () => {
    const { html } = await load("otel");
    const t = strip(html);
    expect(t).toContain("rezervasyon sistemi değildir");
    expect(t).toContain("entegrasyon şu an yok");
    expect(t).toContain("yalnızca Türkçe");
    expect(t).toContain("söz veremem");
  });

  it("onay mesajı (WhatsApp/SMS) hiçbir sayfada yapılıyormuş gibi yazılmaz, yakında diye yazılır", async () => {
    for (const p of SECTOR_PAGES) {
      const t = strip((await load(p.slug)).html).toLocaleLowerCase("tr");
      for (const m of t.matchAll(/(whatsapp|sms)/g)) {
        const around = t.slice(Math.max(0, m.index! - 120), m.index! + 120);
        expect(around, `${p.slug}: ${around}`).toContain("yakında");
      }
    }
  });
});

describe("keşfedilebilirlik", () => {
  it("ana sayfa alt bilgisi ve sitemap sektör sayfalarını gösterir", async () => {
    const home = readFileSync("web/index.html", "utf8");
    const { app } = makeApp(MONDAY_9AM);
    const sitemap = await (await app.request("/sitemap.xml")).text();
    for (const p of SECTOR_PAGES) {
      expect(home).toContain(`href="/${p.slug}"`);
      expect(sitemap).toContain(`<loc>https://acikhat.si/${p.slug}</loc>`);
    }
  });
});
