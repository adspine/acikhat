import { Hono } from "hono";
import { OVERAGE_USD_PER_MINUTE } from "./panel/overview.ts";
import { PLANS } from "../domain/plans.ts";
import { SECTOR_PAGES, type SectorPage } from "../domain/seo-sectors.ts";
import { BRAND, esc, footer, head, header } from "./seo.ts";

const CSS = `
  main.s { display:block; max-width:960px; padding-top:20px; }
  .crumbs { font-size:14px; color:var(--cam-soluk); margin:0 0 18px; }
  .crumbs a { color:var(--cam-soluk); }
  .s section { margin:0 0 44px; }
  .s h2 { font-size:clamp(22px,3vw,28px); line-height:1.25; margin:0 0 14px; }
  .s h3 { font-size:18px; margin:0 0 6px; }
  .s-hero { background:var(--kagit); border:1px solid var(--cizgi); border-radius:18px; padding:clamp(24px,5vw,48px); }
  .kicker { display:inline-block; font-size:13px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:#8a5d00; background:#fbf0d6; padding:4px 10px; border-radius:999px; margin:0 0 14px; }
  .s-hero h1 { font-size:clamp(28px,5vw,42px); line-height:1.15; margin:0 0 14px; }
  .s-hero .lead { font-size:clamp(17px,2.2vw,20px); color:var(--cam-soluk); margin:0 0 22px; max-width:46em; }
  .cta-row { display:flex; flex-wrap:wrap; gap:12px; margin:0 0 12px; }
  .btn { display:inline-block; background:var(--gol); color:#fff; padding:12px 22px; border-radius:12px; text-decoration:none; font-weight:600; }
  .btn.alt { background:transparent; color:var(--gol); border:1px solid var(--gol); }
  .hint { font-size:14px; color:var(--cam-soluk); margin:0; }
  .s p { margin:0 0 14px; max-width:46em; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(270px,1fr)); gap:16px; }
  .card { background:var(--kagit); border:1px solid var(--cizgi); border-radius:14px; padding:20px; }
  .card p { margin:0; font-size:16px; color:var(--cam-soluk); }
  ul.nots { list-style:none; padding:0; margin:0; display:grid; gap:10px; max-width:46em; }
  ul.nots li { position:relative; padding:12px 14px 12px 44px; background:var(--kagit); border:1px solid var(--cizgi); border-radius:12px; }
  ul.nots li::before { content:"×"; position:absolute; left:16px; top:9px; font-size:22px; line-height:1.3; color:#a4271f; font-weight:700; }
  .note { background:#e3eef1; border:1px solid #bcd3da; border-radius:14px; padding:20px 22px; max-width:calc(46em + 44px); }
  .note h2 { font-size:20px; }
  .chat { list-style:none; padding:0; margin:0 0 14px; display:grid; gap:8px; max-width:46em; }
  .turn { display:grid; grid-template-columns:96px 1fr; gap:12px; padding:10px 14px; border-radius:12px; font-size:16px; }
  .turn b { font-size:13px; letter-spacing:.04em; text-transform:uppercase; padding-top:2px; }
  .turn.a { background:#e3eef1; } .turn.c { background:var(--kagit); border:1px solid var(--cizgi); }
  ol.steps { list-style:none; counter-reset:s; padding:0; margin:0; display:grid; gap:14px; max-width:46em; }
  ol.steps li { counter-increment:s; position:relative; padding-left:52px; }
  ol.steps li::before { content:counter(s); position:absolute; left:0; top:0; width:36px; height:36px; border-radius:50%; background:var(--cam); color:#fff; display:grid; place-items:center; font-weight:700; }
  ol.steps p { margin:0; }
  table.plans { width:100%; border-collapse:collapse; background:var(--kagit); border:1px solid var(--cizgi); border-radius:12px; overflow:hidden; max-width:46em; }
  table.plans th, table.plans td { text-align:left; padding:12px 16px; border-bottom:1px solid var(--cizgi); }
  table.plans th { background:#e1e8e5; font-size:14px; }
  .small { font-size:14px; color:var(--cam-soluk); }
  details { background:var(--kagit); border:1px solid var(--cizgi); border-radius:12px; padding:14px 18px; margin:0 0 10px; max-width:46em; }
  details summary { cursor:pointer; font-weight:600; }
  details p { margin:10px 0 0; color:var(--cam-soluk); }
  .s-cta { background:var(--cam); color:#fff; border-radius:18px; padding:clamp(24px,5vw,44px); }
  .s-cta h2 { color:#fff; } .s-cta p { color:#d9e4e0; }
  .s-cta .btn { background:var(--lamba); color:#13332d; }
  .related { margin-top:18px; font-size:15px; }
  .related a { color:#fff; margin-right:14px; }
  @media (max-width:560px) { .turn { grid-template-columns:1fr; gap:2px; } }
`;

const plural = (n: number) => n.toLocaleString("tr-TR");

function chat(turns: [string, string][]): string {
  return `<ol class="chat">${turns.map(([who, text]) => `<li class="turn ${who === "Asistan" ? "a" : "c"}"><b>${who}</b><span>${esc(text)}</span></li>`).join("")}</ol>`;
}

function jsonLd(page: SectorPage, origin: string): string {
  const url = `${origin}/${page.slug}`;
  const graph = [
    { "@type": "WebPage", "@id": `${url}#page`, url, name: page.title, description: page.description, inLanguage: "tr", isPartOf: { "@id": `${origin}/#site` }, breadcrumb: { "@id": `${url}#breadcrumb` } },
    { "@type": "BreadcrumbList", "@id": `${url}#breadcrumb`, itemListElement: [
      { "@type": "ListItem", position: 1, name: "Ana sayfa", item: `${origin}/` },
      { "@type": "ListItem", position: 2, name: page.nav, item: url },
    ] },
    { "@type": "Service", "@id": `${url}#service`, name: page.h1, serviceType: "Yapay zekâ telefon asistanı", description: page.description, provider: { "@id": `${origin}/#org` }, areaServed: { "@type": "Country", name: "Türkiye" }, inLanguage: "tr", url },
    { "@type": "FAQPage", "@id": `${url}#sss`, inLanguage: "tr", mainEntity: page.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
  ];
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2).replace(/<\//g, "<\\/");
}

export function renderSectorPage(page: SectorPage, origin: string): string {
  const others = SECTOR_PAGES.filter((p) => p.slug !== page.slug);
  const planRows = Object.values(PLANS)
    .map((p) => `<tr><td><strong>${esc(p.name)}</strong></td><td>$${p.priceUsd} / ay</td><td>${plural(p.minutes)} dk</td></tr>`)
    .join("");
  const body = `<body>${header}
<main class="s">
<nav class="crumbs" aria-label="Sayfa yolu"><a href="/">Ana sayfa</a> / <span>${esc(page.nav)}</span></nav>
<section class="s-hero">
  <p class="kicker">${esc(page.nav)} için</p>
  <h1>${esc(page.h1)}</h1>
  <p class="lead">${esc(page.lead)}</p>
  <div class="cta-row"><a class="btn" href="/#/uye-ol">Hemen başla</a><a class="btn alt" href="/#/fiyatlandirma">Fiyatları gör</a></div>
  <p class="hint">Numaranız değişmez. Kurulum bedeli yok.</p>
</section>

<section><h2>${esc(page.problem.heading)}</h2>${page.problem.paragraphs.map((t) => `<p>${esc(t)}</p>`).join("")}</section>

<section><h2>${esc(page.does.heading)}</h2><div class="cards">${page.does.items.map((i) => `<div class="card"><h3>${esc(i.title)}</h3><p>${esc(i.text)}</p></div>`).join("")}</div></section>

<section><h2>${esc(page.doesNot.heading)}</h2><p>${esc(page.doesNot.intro)}</p><ul class="nots">${page.doesNot.items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></section>
${page.note ? `\n<section class="note"><h2>${esc(page.note.heading)}</h2>${page.note.paragraphs.map((t) => `<p>${esc(t)}</p>`).join("")}<p><a href="/yasal/kvkk-aydinlatma-metni">KVKK aydınlatma metni</a> · <a href="/yasal/kullanim-kosullari">Kullanım koşulları</a></p></section>\n` : ""}
<section><h2>${esc(page.dialogue.heading)}</h2><p class="small">${esc(page.dialogue.intro)}</p>${chat(page.dialogue.turns)}${page.dialogue.extra ? `<p>${esc(page.dialogue.extra.intro)}</p>${chat(page.dialogue.extra.turns)}` : ""}</section>

<section><h2>${esc(page.setup.heading)}</h2><ol class="steps">${page.setup.steps.map((s) => `<li><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></li>`).join("")}</ol></section>

<section><h2>Fiyat</h2>
<table class="plans"><thead><tr><th>Paket</th><th>Aylık ücret</th><th>Dahil yapay zekâ kullanımı</th></tr></thead><tbody>${planRows}</tbody></table>
<p class="small">Fiyatlar USD cinsindendir ve KDV dahildir. Kullanım hakkı bitince her ek dakika $${String(OVERAGE_USD_PER_MINUTE).replace(".", ",")}. Kurulum bedeli yoktur. Telefon hattı ve operatör ücretleri pakete dahil değildir. <a href="/#/fiyatlandirma">Ayrıntılı fiyatlandırma</a></p></section>

<section><h2>Sık sorulanlar</h2>${page.faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}</section>

<section class="s-cta"><h2>${esc(page.nav)} telefonunuz bu akşam da açık kalsın</h2><p>Bilgi formunu doldurmak yaklaşık 15 dakika sürer. Asistanı birlikte hazırlar, yayına almadan önce denersiniz.</p><a class="btn" href="/#/uye-ol">Hemen başla</a>
<p class="related">Diğer sektörler: ${others.map((o) => `<a href="/${o.slug}">${esc(o.nav)}</a>`).join("")}<a href="/">Ana sayfa</a></p></section>
</main>${footer}</body></html>`;
  return (
    head({ title: page.title, description: page.description, canonical: `${origin}/${page.slug}`, robots: "index, follow, max-image-preview:large", jsonLd: jsonLd(page, origin), extraStyle: CSS }).replace(
      "</head>",
      `<meta name="twitter:card" content="summary_large_image">\n<meta property="og:url" content="${esc(origin)}/${page.slug}">\n</head>`,
    ) + body
  );
}

/** /spa, /klinik, /otel: sektöre özel, taranabilir, JavaScript gerektirmeyen iniş sayfaları */
export function sectorRoutes(baseUrl: string | undefined) {
  const app = new Hono();
  const origin = (baseUrl ?? "https://acikhat.si").replace(/\/$/, "");
  const html = new Map(SECTOR_PAGES.map((p) => [p.slug, renderSectorPage(p, origin)]));
  for (const slug of html.keys()) app.get(`/${slug}`, (c) => c.html(html.get(slug)!));
  return app;
}
