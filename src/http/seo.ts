import { readFileSync } from "node:fs";
import { Hono, type MiddlewareHandler } from "hono";

export const BRAND = "Açık Hat";
export const esc = (v: string) => v.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

/**
 * Tek adres: www ve eski *.fly.dev adresleri ana alan adına 301 ile yönlendirilir (aynı içeriğin birden çok adreste
 * indekslenmesi ve sinyallerin bölünmesi engellenir). Yalnızca GET/HEAD ve site sayfaları: araç/webhook/API/sağlık uçları
 * etkilenmez, çünkü ElevenLabs ve Polar eski adrese çağrı yapıyor olabilir.
 */
export function canonicalHost(baseUrl: string | undefined): MiddlewareHandler {
  const origin = baseUrl && baseUrl.startsWith("https://") ? new URL(baseUrl) : null;
  return async (c, next) => {
    if (!origin || (c.req.method !== "GET" && c.req.method !== "HEAD")) return next();
    const host = (c.req.header("host") ?? "").toLowerCase().replace(/:\d+$/, "");
    const redirectable = host !== origin.hostname && (host === `www.${origin.hostname}` || host.endsWith(".fly.dev"));
    if (redirectable && !/^\/(api|tools|webhooks|test|health)(\/|$)/.test(c.req.path)) {
      const u = new URL(c.req.url);
      return c.redirect(`${origin.origin}${u.pathname}${u.search}`, 301);
    }
    return next();
  };
}

/** Panel, API ve sunucu uçları arama motorlarına kapalı (robots.txt taramayı, bu başlık indekslemeyi kapatır) */
export const noindexPrivate: MiddlewareHandler = async (c, next) => {
  await next();
  if (/^\/(api|tools|webhooks|panel|test)(\/|$)/.test(c.req.path)) c.res.headers.set("x-robots-tag", "noindex, nofollow");
};

interface LegalPage {
  slug: string;
  title: string;
  description: string;
  body: string;
}

/** web/index.html içindeki yasal metinler tek kaynaktır; burada ayrı, taranabilir sayfalar olarak sunulur */
function readLegalPages(path = "./web/index.html"): LegalPage[] {
  const html = readFileSync(path, "utf8");
  const pages: LegalPage[] = [];
  for (const m of html.matchAll(/<article data-legal="([a-z0-9-]+)" data-title="([^"]+)" hidden>([\s\S]*?)<\/article>/g)) {
    const [, slug, title, inner] = m as unknown as [string, string, string, string];
    const firstText = /<p>(?!<span)([\s\S]*?)<\/p>/.exec(inner.replace(/<p class="legal-date">[\s\S]*?<\/p>/, ""))?.[1] ?? title;
    const plain = firstText.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const description = plain.length > 155 ? `${plain.slice(0, 152).trimEnd()}…` : plain;
    const body = inner
      .replace(/href="#\/yasal\/([a-z0-9-]+)"/g, 'href="/yasal/$1"')
      .replace(/href="#\/([a-z0-9-]+)"/g, 'href="/#/$1"');
    pages.push({ slug, title, description, body });
  }
  return pages;
}

export const STYLE = `
  :root { --cam:#13332d; --cam-soluk:#4a645e; --gol:#1b5e73; --sis:#edf1ef; --kagit:#fbfcfb; --cizgi:#ccd7d3; --lamba:#e4a11b; }
  * { box-sizing: border-box; }
  body { margin:0; font:17px/1.65 "Onest", system-ui, sans-serif; color:var(--cam); background:var(--sis); }
  a { color:var(--gol); }
  .top { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:16px clamp(16px,4vw,40px); background:var(--kagit); border-bottom:1px solid var(--cizgi); }
  .brand { display:flex; align-items:center; gap:10px; font-weight:700; font-size:20px; color:var(--cam); text-decoration:none; }
  .brand i { width:14px; height:14px; border-radius:50%; background:var(--lamba); display:inline-block; }
  .cta { background:var(--gol); color:#fff; padding:9px 16px; border-radius:10px; text-decoration:none; font-weight:600; font-size:15px; }
  main { max-width:1000px; margin:0 auto; padding:28px clamp(16px,4vw,40px) 64px; display:grid; grid-template-columns:230px 1fr; gap:36px; }
  nav.legal-nav { display:flex; flex-direction:column; gap:4px; align-self:start; position:sticky; top:16px; }
  nav.legal-nav a { padding:8px 12px; border-radius:8px; text-decoration:none; color:var(--cam-soluk); font-size:15px; }
  nav.legal-nav a[aria-current="page"] { background:#fff; color:var(--cam); font-weight:600; border:1px solid var(--cizgi); }
  article { background:var(--kagit); border:1px solid var(--cizgi); border-radius:14px; padding:clamp(20px,4vw,40px); min-width:0; }
  h1 { font-size:clamp(26px,4vw,34px); line-height:1.2; margin:0 0 6px; }
  h2 { font-size:20px; margin:28px 0 8px; }
  .legal-date { color:var(--cam-soluk); font-size:14px; margin:0 0 18px; }
  dl.facts-list div { display:grid; grid-template-columns:150px 1fr; gap:12px; padding:8px 0; border-bottom:1px solid var(--cizgi); }
  dt { color:var(--cam-soluk); } dd { margin:0; }
  footer { text-align:center; color:var(--cam-soluk); font-size:14px; padding:0 16px 40px; }
  @media (max-width:760px) { main { grid-template-columns:1fr; } nav.legal-nav { position:static; flex-direction:row; flex-wrap:wrap; } dl.facts-list div { grid-template-columns:1fr; gap:2px; } }
`;

export const head = (opts: { title: string; description: string; canonical: string | null; robots: string; jsonLd?: string; extraStyle?: string }) => `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
${opts.canonical ? `<link rel="canonical" href="${esc(opts.canonical)}">\n` : ""}<meta name="robots" content="${opts.robots}">
<meta name="theme-color" content="#13332d">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/png" sizes="32x32" href="/icon-32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${BRAND}">
<meta property="og:locale" content="tr_TR">
<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}">
<meta property="og:image" content="https://acikhat.si/og-image.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${STYLE}${opts.extraStyle ?? ""}</style>
${opts.jsonLd ? `<script type="application/ld+json">\n${opts.jsonLd}\n</script>\n` : ""}</head>`;

export const header = `<header class="top"><a class="brand" href="/"><i aria-hidden="true"></i>${BRAND}</a><a class="cta" href="/#/uye-ol">Hemen başla</a></header>`;
export const footer = `<footer>© 2026 ${BRAND} · <a href="mailto:support@acikhat.si">support@acikhat.si</a> · <a href="/">Ana sayfa</a></footer>`;

export function notFoundHtml(): string {
  return `${head({ title: `Sayfa bulunamadı | ${BRAND}`, description: "Aradığınız sayfa bulunamadı.", canonical: null, robots: "noindex, follow" })}
<body>${header}<main style="display:block;text-align:center;padding-top:72px"><h1>Sayfa bulunamadı</h1><p>Aradığınız adres yok ya da taşınmış olabilir.</p><p><a href="/">Ana sayfaya dön</a></p></main>${footer}</body></html>`;
}

/** /yasal ve /yasal/<sayfa>: gerçek adresli, tek başına açılan, JavaScript gerektirmeyen yasal metinler */
export function legalRoutes(baseUrl: string | undefined) {
  const app = new Hono();
  const origin = (baseUrl ?? "https://acikhat.si").replace(/\/$/, "");
  let cache: LegalPage[] | null = null;
  const pages = () => (cache ??= readLegalPages());

  app.get("/yasal", (c) => c.redirect("/yasal/gizlilik-politikasi", 301));
  app.get("/yasal/:slug", (c) => {
    const all = pages();
    const page = all.find((p) => p.slug === c.req.param("slug"));
    if (!page) return c.html(notFoundHtml(), 404);
    const nav = all.map((p) => `<a href="/yasal/${p.slug}"${p.slug === page.slug ? ' aria-current="page"' : ""}>${esc(p.title)}</a>`).join("");
    return c.html(
      `${head({ title: `${page.title} | ${BRAND}`, description: page.description, canonical: `${origin}/yasal/${page.slug}`, robots: "index, follow" })}
<body>${header}<main><nav class="legal-nav" aria-label="Yasal sayfalar">${nav}</nav><article>${page.body}</article></main>${footer}</body></html>`,
    );
  });
  return app;
}
