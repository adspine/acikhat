import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { basicAuth } from "hono/basic-auth";
import { HTTPException } from "hono/http-exception";
import type { Deps } from "./deps.ts";
import { toolRoutes } from "./tools.ts";
import { webhookRoutes } from "./webhooks.ts";
import { polarWebhookRoutes } from "./polar-webhook.ts";
import { testUiRoutes } from "./test-ui.ts";
import { onboardingRoutes } from "./onboarding.ts";
import { demoRoutes } from "./demo.ts";
import { adminRoutes } from "./admin.ts";
import { panelRoutes } from "./panel/index.ts";
import { authRoutes } from "./panel/session.ts";
import { serveStatic } from "@hono/node-server/serve-static";
import { compress } from "hono/compress";
import { sectorRoutes } from "./sector-pages.ts";
import { appPageRoutes, canonicalHost, legalRoutes, noindexPrivate, notFoundHtml } from "./seo.ts";
import { cspReportRoutes, limitBody, noStore, rateLimit, securityHeaders } from "./security.ts";

export function createApp(deps: Deps) {
  const app = new Hono();

  // Her yanıta güvenlik başlıkları (CSP, HSTS, çerçeve engeli...). Ayrıntı ve gerekçe: security.ts
  app.use("*", securityHeaders({ https: deps.secureCookies }));
  // Tek adres (www ve eski fly.dev ana alan adına gider), metin yanıtları sıkıştırılır, özel uçlar indekslenmez
  app.use("*", canonicalHost(deps.baseUrl));
  app.use("*", compress());
  app.use("*", noindexPrivate);
  app.get("/health", (c) => c.json({ ok: true }));

  // Araç ve webhook çağrılarının kısa kaydı (gövde ve kişisel veri loglanmaz)
  app.use("*", async (c, next) => {
    const t0 = performance.now();
    await next();
    if (/^\/(tools|webhooks|api)\//.test(c.req.path)) console.info(`[http] ${c.req.method} ${c.req.path} ${c.res.status} ${Math.round(performance.now() - t0)}ms`);
  });

  // Gövde ve istek sınırları: kimliksiz uçlara sınırsız gövde veya yüksek hızda istek gönderilemesin
  app.use("/api/*", noStore);
  app.use("/api/*", limitBody(1_000_000));
  app.use("/tools/*", limitBody(256 * 1024));
  app.use("/webhooks/*", limitBody(25 * 1024 * 1024)); // ElevenLabs görüşme sesi base64 ile gelebilir
  app.use("/api/*", rateLimit({ windowMs: 60_000, max: 600 }));
  app.use("/api/auth/*", rateLimit({ windowMs: 60_000, max: 120 }));
  app.use("/api/demo-call", rateLimit({ windowMs: 60_000, max: 20 }));

  app.use("/tools/*", bearerAuth({ token: deps.toolSecret }));
  app.route("/tools", toolRoutes(deps));
  app.route("/webhooks", webhookRoutes(deps));
  app.route("/webhooks", polarWebhookRoutes(deps));
  if (process.env.TEST_UI === "1") {
    // Test sayfası görüşmeyi bizim ElevenLabs anahtarımızla başlatır: internete açık sunucuda şifresiz bırakılmaz
    const password = process.env.TEST_UI_PASSWORD;
    if (password) app.use("/test/*", basicAuth({ username: "test", password }));
    else if (process.env.NODE_ENV === "production") throw new Error("TEST_UI=1 iken TEST_UI_PASSWORD zorunlu");
    app.route("/test", testUiRoutes(deps));
  }
  app.route("/api/auth", authRoutes(deps));
  app.route("/api/panel", panelRoutes(deps));
  app.route("/api/admin", adminRoutes(deps));
  app.route("/api", cspReportRoutes());
  app.route("/api", demoRoutes(deps));
  app.route("/api", onboardingRoutes(deps));
  // Bilinmeyen API yolları siteye düşmesin
  app.all("/api/*", (c) => c.json({ error: "Bulunamadı" }, 404));

  // Firma tanıtım ve kurulum sitesi (web/). Tek sayfa: bilinmeyen yollar index.html'e düşer.
  // Node serveStatic m4a türünü tanımıyor; Safari doğru tür olmadan çalmıyor
  app.use("/audio/*", async (c, next) => {
    await next();
    if (c.req.path.endsWith(".m4a")) c.header("content-type", "audio/mp4");
  });
  // Tanıtım sitesi dosyaları adlarında sürüm taşımaz; tarayıcı her seferinde değişip değişmediğini sormalı
  app.use("/*", async (c, next) => {
    await next();
    const p = c.req.path;
    if (!p.startsWith("/panel/assets/") && (p === "/" || /.(css|js|html|json)$/.test(p))) c.header("cache-control", "no-cache");
  });
  // Yasal metinler gerçek adreslerde (/yasal/<sayfa>): arama motorları tarayabilsin
  app.route("/", legalRoutes(deps.baseUrl));
  // Sektör iniş sayfaları (/spa, /klinik, /otel)
  app.route("/", sectorRoutes(deps.baseUrl));
  // Tanıtım sitesinin sayfa içi adresleri (/hesap, /rehber ...): aynı index.html, her adres için kendi başlık, açıklama ve canonical'ı
  // sunucuda yazılır; sayfayı tarayıcıdaki yönlendirici açar. Giriş ve hesap adresleri arama motoruna kapalıdır.
  app.route("/", appPageRoutes(deps.baseUrl));
  app.use("/*", serveStatic({ root: "./web" }));
  // Firma paneli (panel/ derlemesi web/panel/ altında): kendi yönlendiricisi olduğu için bilinmeyen alt yollar panele düşer
  app.get("/panel", (c) => c.redirect("/panel/"));
  app.get("/panel/*", serveStatic({ path: "./web/panel/index.html" }));
  // Bilinmeyen adresler gerçek 404 döner (eskiden ana sayfa 200 ile dönüyordu: arama motorunda sonsuz kopya sayfa)
  app.notFound((c) => (/^\/api\//.test(c.req.path) ? c.json({ error: "Bulunamadı" }, 404) : c.html(notFoundHtml(), 404)));

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    // Ajan bu cevabı okuyup geri arama teklif eder (prompt'taki "araç hatası" kuralı).
    return c.json({ ok: false, error: "internal", instruction: "Sistemde anlık sorun var. Özür dile, geri arama kaydı al." }, 500);
  });

  return app;
}
