import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { basicAuth } from "hono/basic-auth";
import { HTTPException } from "hono/http-exception";
import type { Deps } from "./deps.ts";
import { toolRoutes } from "./tools.ts";
import { webhookRoutes } from "./webhooks.ts";
import { testUiRoutes } from "./test-ui.ts";
import { onboardingRoutes } from "./onboarding.ts";
import { panelRoutes } from "./panel/index.ts";
import { authRoutes } from "./panel/session.ts";
import { serveStatic } from "@hono/node-server/serve-static";

export function createApp(deps: Deps) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  // Araç ve webhook çağrılarının kısa kaydı (gövde ve kişisel veri loglanmaz)
  app.use("*", async (c, next) => {
    const t0 = performance.now();
    await next();
    if (/^\/(tools|webhooks|api)\//.test(c.req.path)) console.info(`[http] ${c.req.method} ${c.req.path} ${c.res.status} ${Math.round(performance.now() - t0)}ms`);
  });

  app.use("/tools/*", bearerAuth({ token: deps.toolSecret }));
  app.route("/tools", toolRoutes(deps));
  app.route("/webhooks", webhookRoutes(deps));
  if (process.env.TEST_UI === "1") {
    // Test sayfası görüşmeyi bizim ElevenLabs anahtarımızla başlatır: internete açık sunucuda şifresiz bırakılmaz
    const password = process.env.TEST_UI_PASSWORD;
    if (password) app.use("/test/*", basicAuth({ username: "test", password }));
    else if (process.env.NODE_ENV === "production") throw new Error("TEST_UI=1 iken TEST_UI_PASSWORD zorunlu");
    app.route("/test", testUiRoutes(deps));
  }
  app.route("/api/auth", authRoutes(deps));
  app.route("/api/panel", panelRoutes(deps));
  app.route("/api", onboardingRoutes(deps));
  // Bilinmeyen API yolları siteye düşmesin
  app.all("/api/*", (c) => c.json({ error: "Bulunamadı" }, 404));

  // Firma tanıtım ve kurulum sitesi (web/). Tek sayfa: bilinmeyen yollar index.html'e düşer.
  // Node serveStatic m4a türünü tanımıyor; Safari doğru tür olmadan çalmıyor
  app.use("/audio/*", async (c, next) => {
    await next();
    if (c.req.path.endsWith(".m4a")) c.header("content-type", "audio/mp4");
  });
  app.use("/*", serveStatic({ root: "./web" }));
  // Firma paneli (panel/ derlemesi web/panel/ altında): kendi yönlendiricisi olduğu için bilinmeyen alt yollar panele düşer
  app.get("/panel", (c) => c.redirect("/panel/"));
  app.get("/panel/*", serveStatic({ path: "./web/panel/index.html" }));
  app.get("*", serveStatic({ path: "./web/index.html" }));

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    // Ajan bu cevabı okuyup geri arama teklif eder (prompt'taki "araç hatası" kuralı).
    return c.json({ ok: false, error: "internal", instruction: "Sistemde anlık sorun var. Özür dile, geri arama kaydı al." }, 500);
  });

  return app;
}
