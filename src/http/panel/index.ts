import { Hono } from "hono";
import type { Deps } from "../deps.ts";
import { type PanelEnv, requirePanelHeader, requirePermission, requireSession } from "./session.ts";
import { appointmentRoutes } from "./appointments.ts";
import { callRoutes } from "./calls.ts";
import { overviewRoutes } from "./overview.ts";
import { settingsRoutes } from "./settings.ts";
import { userRoutes } from "./users.ts";
import { initVariables } from "../webhooks.ts";

/** /api/panel/*: oturum gerektiren firma paneli uçları */
export function panelRoutes(deps: Deps) {
  const app = new Hono<PanelEnv>();
  app.use("*", requirePanelHeader);
  app.use("*", requireSession(deps));

  // Geçici şifreyle giren kullanıcı önce şifresini değiştirir (/api/auth/password)
  app.use("*", async (c, next) => {
    if (c.get("user").mustChangePassword && c.req.path !== "/api/panel/me") {
      return c.json({ error: "Devam etmek için şifrenizi değiştirin", mustChangePassword: true }, 403);
    }
    await next();
  });

  app.route("/", userRoutes(deps));
  app.route("/", overviewRoutes(deps));
  app.route("/", appointmentRoutes(deps));
  app.route("/", callRoutes(deps));
  app.route("/", settingsRoutes(deps));

  /**
   * "Asistanı dene": panelden sesli test görüşmesi. Görüşme belirteci sunucuda alınır,
   * API anahtarı tarayıcıya gitmez; tarih tablosu gibi değişkenler de buradan verilir.
   */
  app.get("/test-call", requirePermission("settings.edit"), async (c) => {
    const tenant = c.get("tenant");
    const agentId = tenant.agentIds[0];
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!agentId || !apiKey) return c.json({ error: "Asistan henüz kurulmadı" }, 409);
    const res = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${agentId}`, {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { token?: string }) : {};
    if (!res?.ok || !json.token) return c.json({ error: "Test görüşmesi başlatılamadı" }, 502);
    return c.json({ conversationToken: json.token, dynamicVariables: initVariables(tenant, deps.now()) });
  });

  return app;
}
