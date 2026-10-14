import { Hono } from "hono";
import type { Deps } from "./deps.ts";
import { PLANS, isPlanId } from "../domain/plans.ts";
import { fulfillOrder, type OrderRow } from "./panel/billing.ts";
import { mailMembershipPaid, mailSubscriptionIssue } from "../notify/emails.ts";

type Meta = Record<string, unknown>;
interface PolarEvent {
  type: string;
  data: {
    id?: string;
    status?: string;
    metadata?: Meta;
    subscription_id?: string | null;
    subscription?: { id?: string; metadata?: Meta } | null;
    customer?: { external_id?: string | null; email?: string } | null;
    cancel_at_period_end?: boolean;
  };
}

/**
 * Polar webhook'u. Paketi/ek dakikayı "ödenmiş" yapan tek yer burasıdır; imza doğrulanmadan hiçbir şey yazılmaz.
 * Olaylar tekrar gelebilir: işlemler tekrarlanınca etkisizdir (markPaid / fulfillOrder koşullu güncellemedir).
 */
export function polarWebhookRoutes(deps: Deps) {
  const app = new Hono();

  app.post("/polar", async (c) => {
    if (!deps.polar) return c.json({ error: "Ödeme altyapısı kapalı" }, 404);
    const raw = await c.req.text();
    const ok = deps.polar.verifyWebhook({ id: c.req.header("webhook-id"), timestamp: c.req.header("webhook-timestamp"), signature: c.req.header("webhook-signature") }, raw);
    if (!ok) return c.json({ error: "İmza geçersiz" }, 403);

    let event: PolarEvent;
    try {
      event = JSON.parse(raw);
    } catch {
      return c.json({ error: "Gövde okunamadı" }, 400);
    }
    const d = event.data ?? {};
    // Metadata ödeme sayfasından siparişe ve aboneliğe kopyalanır; yenileme siparişlerinde yalnızca abonelikte olabilir
    const meta: Meta = { ...(d.subscription?.metadata ?? {}), ...(d.metadata ?? {}) };
    const subscriptionId = d.subscription_id ?? d.subscription?.id ?? (event.type.startsWith("subscription.") ? d.id : undefined) ?? undefined;

    if (event.type === "order.paid") {
      if (meta.kind === "membership" && typeof meta.user_id === "string" && isPlanId(meta.plan)) {
        const user = deps.users.get(meta.user_id);
        if (!user) {
          console.error(`[polar] üyelik ödemesi için kullanıcı yok: ${meta.user_id}`);
          return c.json({ ok: true });
        }
        if (subscriptionId) deps.users.setPolarSubscription(user.id, subscriptionId);
        deps.users.selectPlan(user.id, meta.plan);
        if (deps.users.markPaid(user.id)) {
          mailMembershipPaid(deps, user, meta.plan);
          console.info(`[polar] üyelik ödendi: ${user.email} → ${PLANS[meta.plan].name}`);
        }
      } else if (meta.kind === "addon" && typeof meta.order_id === "string") {
        const order = deps.store.db.prepare("SELECT * FROM orders WHERE id = ?").get(meta.order_id) as unknown as OrderRow | undefined;
        const tenant = order && deps.tenants.get(order.tenant_id);
        if (order && tenant && fulfillOrder(deps, tenant, order.id)) {
          deps.store.audit({ tenantId: tenant.id, userId: null, action: "billing.addon", target: order.item, detail: { amountUsd: order.amount_usd, polar: d.id } });
        }
      }
      return c.json({ ok: true });
    }

    if (event.type === "subscription.revoked" || event.type === "subscription.past_due" || (event.type === "subscription.canceled" && !d.cancel_at_period_end)) {
      const who = d.customer?.email ?? String(meta.user_id ?? d.customer?.external_id ?? "?");
      console.warn(`[polar] ${event.type}: ${who} (${subscriptionId ?? "?"})`);
      mailSubscriptionIssue(deps, { event: event.type, who, detail: `abonelik ${subscriptionId ?? "?"}, durum ${d.status ?? "?"}` });
    }
    return c.json({ ok: true });
  });

  return app;
}
