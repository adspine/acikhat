import { Hono } from "hono";
import type { Deps } from "./deps.ts";
import { spokenDate } from "../domain/time.ts";
import { PLANS, isPlanId } from "../domain/plans.ts";
import { fulfillOrder, type OrderRow } from "./panel/billing.ts";
import { TenantSchema, type Tenant } from "../domain/tenant.ts";
import { mailBillingSuspension, mailMembershipPaid, mailPaymentFailed, mailRenewal, mailSubscriptionCanceled, mailSubscriptionIssue } from "../notify/emails.ts";

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
    billing_reason?: string;
    total_amount?: number;
    current_period_end?: string | null;
    ends_at?: string | null;
  };
}

/**
 * Polar webhook'u. Paketi/ek dakikayı "ödenmiş" yapan tek yer burasıdır; imza doğrulanmadan hiçbir şey yazılmaz.
 * Olaylar tekrar gelebilir: işlemler tekrarlanınca etkisizdir (markPaid / fulfillOrder koşullu güncellemedir).
 */
export function polarWebhookRoutes(deps: Deps) {
  const app = new Hono();
  const BILLING_MARK = "billing-suspended";

  const tenantOfSubscription = (subscriptionId: string | undefined): Tenant | null => {
    const owner = subscriptionId ? deps.users.byPolarSubscription(subscriptionId) : null;
    return (owner?.tenantId && deps.tenants.get(owner.tenantId)) || null;
  };

  /** Ödeme nedeniyle askıya alma/açma. Yalnızca kendi koyduğumuz askıyı kaldırırız; yöneticinin elle askıya aldığı firmaya dokunmaz. */
  const setBillingSuspension = (tenant: Tenant, suspended: boolean) => {
    const db = deps.store.db;
    if (suspended) {
      if (tenant.suspended) return;
      const raw = structuredClone(deps.tenantStore.getLiveRaw(tenant.id) as Record<string, unknown>);
      raw.suspended = true;
      const next = TenantSchema.parse(raw);
      deps.tenantStore.publish(next);
      deps.tenants.set(next);
      db.prepare("INSERT OR REPLACE INTO notice_log (tenant_id, kind, period, sent_at) VALUES (?, ?, 'active', ?)").run(tenant.id, BILLING_MARK, Date.now());
      deps.store.audit({ tenantId: tenant.id, userId: null, action: "billing.suspend", target: tenant.id });
      mailBillingSuspension(deps, next, true);
      return;
    }
    const marked = db.prepare("DELETE FROM notice_log WHERE tenant_id = ? AND kind = ?").run(tenant.id, BILLING_MARK).changes > 0;
    if (!marked || !tenant.suspended) return;
    const raw = structuredClone(deps.tenantStore.getLiveRaw(tenant.id) as Record<string, unknown>);
    raw.suspended = false;
    const next = TenantSchema.parse(raw);
    deps.tenantStore.publish(next);
    deps.tenants.set(next);
    deps.store.audit({ tenantId: tenant.id, userId: null, action: "billing.unsuspend", target: tenant.id });
    mailBillingSuspension(deps, next, false);
  };

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
      if (d.billing_reason === "subscription_cycle") {
        const tenant = tenantOfSubscription(subscriptionId);
        if (tenant) {
          setBillingSuspension(tenant, false);
          mailRenewal(deps, tenant, { amountUsd: (d.total_amount ?? 0) / 100, planName: tenant.plan.id ? PLANS[tenant.plan.id].name : "Aylık paket" });
        }
      }
      return c.json({ ok: true });
    }

    const subTenant = event.type.startsWith("subscription.") ? tenantOfSubscription(subscriptionId) : null;
    if (event.type === "subscription.active" && subTenant) setBillingSuspension(subTenant, false);
    if (event.type === "subscription.revoked" && subTenant) setBillingSuspension(subTenant, true);
    if (event.type === "subscription.past_due" && subTenant) mailPaymentFailed(deps, subTenant);
    if (event.type === "subscription.canceled" && d.cancel_at_period_end && subTenant) {
      const end = d.ends_at ?? d.current_period_end;
      mailSubscriptionCanceled(deps, subTenant, end ? spokenDate(Temporal.Instant.from(end).toZonedDateTimeISO(subTenant.timezone).toPlainDate()) : null);
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
