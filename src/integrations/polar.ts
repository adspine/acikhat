import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Polar.sh (Merchant of Record) bağlantısı. Bağımlılık eklemeden fetch ile konuşur.
 * Ürün kimlikleri `POLAR_PRODUCTS` ortam değişkeninde JSON olarak verilir (scripts/setup-polar.ts üretir):
 * {"baslangic":"<uuid>","standart":"…","pro":"…","ek-100":"…","ek-300":"…","ek-600":"…"}
 */
export interface Polar {
  /** Paket veya ek dakika ürünü için ödeme sayfası açar */
  createCheckout(o: { item: string; externalCustomerId: string; email: string; metadata: Record<string, string>; successUrl: string; locale?: "tr" | "en" }): Promise<{ id: string; url: string }>;
  /** Mevcut aboneliğin paketini değiştirir: yükseltme farkı hemen faturalanır, düşürme sonraki dönemde başlar */
  changePlan(subscriptionId: string, item: string, when: "now" | "next_period"): Promise<void>;
  /** Müşterinin kendi aboneliğini yönettiği (kart değiştirme, iptal, makbuzlar) Polar portalı için tek kullanımlık adres */
  portalUrl(externalCustomerId: string): Promise<string>;
  /** Webhook gövdesini imzaya göre doğrular */
  verifyWebhook(headers: { id?: string; timestamp?: string; signature?: string }, rawBody: string): boolean;
  /** Polar ürün kimliğinden bizim paket/ek paket kimliği (ters arama) */
  itemOf(productId: string): string | undefined;
}

export interface PolarConfig {
  accessToken: string;
  webhookSecret: string;
  server: "sandbox" | "production";
  products: Record<string, string>;
  fetch?: typeof fetch;
  nowSec?: () => number;
}

const BASE = { sandbox: "https://sandbox-api.polar.sh", production: "https://api.polar.sh" } as const;

/**
 * Standard Webhooks: imza = base64(HMAC-SHA256(anahtar, `${id}.${zaman}.${gövde}`)), başlık "v1,<imza> v1,<imza>".
 * Gizli anahtar 8 Eylül 2026 öncesi üretildiyse HMAC anahtarı `whsec_…` metninin kendisidir; sonrasında
 * `whsec_` öneki atılıp base64 çözülür. Hangisi olduğu bilinmediğinden ikisi de denenir.
 */
export function verifyStandardWebhook(secret: string, h: { id?: string; timestamp?: string; signature?: string }, rawBody: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  if (!secret || !h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > toleranceSec) return false;
  const keys = [Buffer.from(secret, "utf8")];
  if (secret.startsWith("whsec_")) keys.push(Buffer.from(secret.slice(6), "base64"));
  const given = h.signature.split(" ").map((s) => s.split(",", 2)).filter((p) => p[0] === "v1" && p[1]).map((p) => Buffer.from(p[1]!));
  return keys.some((key) => {
    const expected = Buffer.from(createHmac("sha256", key).update(`${h.id}.${h.timestamp}.${rawBody}`).digest("base64"));
    return given.some((g) => g.length === expected.length && timingSafeEqual(g, expected));
  });
}

export function createPolar(cfg: PolarConfig): Polar {
  const doFetch = cfg.fetch ?? fetch;
  const base = BASE[cfg.server];
  const productFor = (item: string) => {
    const id = cfg.products[item];
    if (!id) throw new Error(`Polar ürünü tanımlı değil: ${item}`);
    return id;
  };
  const call = async (method: string, path: string, body: unknown) => {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${cfg.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Polar ${method} ${path} → ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  };
  return {
    async createCheckout(o) {
      const r = await call("POST", "/v1/checkouts/", {
        products: [productFor(o.item)],
        external_customer_id: o.externalCustomerId,
        customer_email: o.email,
        metadata: o.metadata,
        success_url: o.successUrl,
        locale: o.locale ?? "tr",
      });
      if (typeof r.url !== "string" || typeof r.id !== "string") throw new Error("Polar ödeme sayfası adresi dönmedi");
      return { id: r.id, url: r.url };
    },
    async changePlan(subscriptionId, item, when) {
      await call("PATCH", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, { product_id: productFor(item), proration_behavior: when === "now" ? "invoice" : "next_period" });
    },
    async portalUrl(externalCustomerId) {
      const r = await call("POST", "/v1/customer-sessions/", { external_customer_id: externalCustomerId });
      if (typeof r.customer_portal_url !== "string") throw new Error("Polar portal adresi dönmedi");
      return r.customer_portal_url;
    },
    verifyWebhook: (headers, rawBody) => verifyStandardWebhook(cfg.webhookSecret, headers, rawBody, cfg.nowSec?.()),
    itemOf: (productId) => Object.entries(cfg.products).find(([, id]) => id === productId)?.[0],
  };
}

/** Ortam değişkenlerinden kurar; erişim anahtarı veya ürün listesi yoksa ödeme kapalıdır (null) */
export function polarFromEnv(env: NodeJS.ProcessEnv): Polar | null {
  if (!env.POLAR_ACCESS_TOKEN || !env.POLAR_PRODUCTS) return null;
  if (!env.POLAR_WEBHOOK_SECRET) throw new Error("POLAR_ACCESS_TOKEN verilmiş ama POLAR_WEBHOOK_SECRET yok: ödemeler doğrulanamaz");
  return createPolar({
    accessToken: env.POLAR_ACCESS_TOKEN,
    webhookSecret: env.POLAR_WEBHOOK_SECRET,
    server: env.POLAR_SERVER === "sandbox" ? "sandbox" : "production",
    products: JSON.parse(env.POLAR_PRODUCTS) as Record<string, string>,
  });
}
