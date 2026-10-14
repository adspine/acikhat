import { timingSafeEqual } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";

/** Fly'ın verdiği istemci adresi (sunucu yalnızca Fly vekili arkasında çalışır; yerelde "local") */
export const clientIp = (c: Context): string => c.req.header("fly-client-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

/** Sabit zamanlı karşılaştırma: gizli değerlerin uzunluğu ve içeriği zamanlamadan sızmasın */
export function safeEqual(a: string | undefined | null, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Güvenlik başlıkları.
 * - Zorlanan CSP yalnızca betikleri ve bağlantıları kısıtlamayan yönergeleri içerir (çerçeve içine alma, <base>, <object>, form hedefi).
 *   Firebase girişi (gstatic betikleri, Google popup'ı) ve ElevenLabs sesli deneme tarayıcıda denenmeden tam CSP zorlanmaz.
 * - Tam politika Report-Only gönderilir; ihlaller /api/csp-report ile günlüğe düşer, sorun çıkmadığı görülünce zorlanır.
 * - COOP kapalı: Google ile giriş penceresi (popup) `same-origin` ile çalışmaz.
 * - HSTS includeSubDomains içermez: diğer alt alanların HTTPS'i bilinmiyor.
 * - Mikrofon yalnızca bu sitede açık (panelde "Asistanı dene"); kamera, konum, ödeme API'leri kapalı.
 */
export function securityHeaders(opts: { https: boolean }): MiddlewareHandler {
  return secureHeaders({
    strictTransportSecurity: opts.https ? "max-age=31536000" : false,
    xFrameOptions: "DENY",
    referrerPolicy: "strict-origin-when-cross-origin",
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    permissionsPolicy: { camera: [], geolocation: [], payment: [], usb: [], microphone: ["self"] },
    contentSecurityPolicy: {
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      formAction: ["'self'"],
    },
    contentSecurityPolicyReportOnly: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://www.gstatic.com", "https://apis.google.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      mediaSrc: ["'self'", "blob:", "data:"],
      connectSrc: ["'self'", "https://*.googleapis.com", "https://www.gstatic.com", "https://*.elevenlabs.io", "wss://*.elevenlabs.io", "https://*.livekit.cloud", "wss://*.livekit.cloud"],
      frameSrc: ["https://acikhat-ai.firebaseapp.com", "https://accounts.google.com"],
      workerSrc: ["'self'", "blob:"],
      manifestSrc: ["'self'"],
      reportUri: ["/api/csp-report"],
    },
  });
}

/** API yanıtları (kişisel veri içerir) tarayıcıda ve aradaki vekillerde önbelleğe alınmasın */
export const noStore: MiddlewareHandler = async (c, next) => {
  await next();
  c.res.headers.set("cache-control", "no-store");
};

/**
 * İstek gövdesi üst sınırı. Kimlik doğrulaması olmayan uçlara sınırsız gövde gönderip belleği doldurmayı engeller.
 * Sınır aşılırsa 413 döner.
 */
export const limitBody = (maxBytes: number): MiddlewareHandler =>
  bodyLimit({ maxSize: maxBytes, onError: (c) => c.json({ error: "İstek çok büyük" }, 413) });

/**
 * IP başına istek sınırı (sabit pencere). Tek sunucuda çalıştığımız için bellekte tutulur; birden fazla makineye geçilirse
 * sayaç makine sayısıyla çarpılır, o zaman paylaşılan bir depoya taşınmalı.
 */
export function rateLimit(opts: { windowMs: number; max: number; now?: () => number }): MiddlewareHandler {
  const hits = new Map<string, { n: number; reset: number }>();
  const now = opts.now ?? Date.now;
  return async (c, next) => {
    const t = now();
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
      if (hits.size > 50_000) hits.clear();
    }
    const key = clientIp(c);
    let h = hits.get(key);
    if (!h || h.reset <= t) {
      h = { n: 0, reset: t + opts.windowMs };
      hits.set(key, h);
    }
    h.n++;
    if (h.n > opts.max) {
      c.header("retry-after", String(Math.max(1, Math.ceil((h.reset - t) / 1000))));
      return c.json({ error: "Çok fazla istek. Biraz sonra tekrar deneyin." }, 429);
    }
    await next();
  };
}

/** Tarayıcının CSP ihlal raporları: yalnızca kısa bir özet günlüğe yazılır, gövde saklanmaz */
export function cspReportRoutes() {
  const app = new Hono();
  app.post("/csp-report", limitBody(16 * 1024), rateLimit({ windowMs: 60_000, max: 30 }), async (c) => {
    const raw = (await c.req.json().catch(() => null)) as { "csp-report"?: Record<string, unknown> } | null;
    const r = raw?.["csp-report"];
    if (r && typeof r === "object") {
      const s = (k: string) => String(r[k] ?? "").replace(/[\r\n]/g, " ").slice(0, 120);
      console.info(`[csp] ${s("violated-directive")} engellenen=${s("blocked-uri")} sayfa=${s("document-uri")}`);
    }
    return c.body(null, 204);
  });
  return app;
}
