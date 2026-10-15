import { Hono } from "hono";
import type { Deps } from "../deps.ts";
import { type PanelEnv, requirePermission } from "./session.ts";
import { TenantSchema, type Tenant } from "../../domain/tenant.ts";
import { PLANS, isPlanId, type PlanId } from "../../domain/plans.ts";
import { findAddon, periodKey, planChange, upgradeCharge } from "../../domain/billing.ts";
import { spokenDate } from "../../domain/time.ts";
import { normalizePoolNumber, isTestNumber } from "../../store/phone-pool.ts";
import { mailOwnNumberRequest, mailPlanApplied, mailPlanScheduled, mailPurchase, mailQuota } from "../../notify/emails.ts";

export interface OrderRow {
  id: string;
  tenant_id: string;
  kind: "plan" | "addon";
  item: string;
  label: string;
  minutes: number;
  amount_usd: number;
  status: "pending" | "paid" | "failed";
  period: string;
  created_at: number;
  paid_at: number | null;
}

/** Firmanın planını yazar (canlı ayar + üyenin paketi). pending verilmezse bekleyen geçiş silinir. */
export function writeTenantPlan(deps: Deps, tenant: Tenant, plan: { id: PlanId; includedMinutes: number; pending?: { id: PlanId; effectiveAt: number } | undefined }): Tenant {
  const raw = structuredClone(deps.tenantStore.getLiveRaw(tenant.id) as Record<string, unknown>);
  raw.plan = { ...((raw.plan as object) ?? {}), id: plan.id, includedMinutes: plan.includedMinutes, pending: plan.pending };
  const next = TenantSchema.parse(raw);
  deps.tenantStore.publish(next);
  deps.tenants.set(next);
  deps.store.db.prepare("UPDATE users SET plan = ? WHERE tenant_id = ? AND role = 'owner'").run(plan.id, tenant.id);
  return next;
}

/** Bir sonraki dönemin (ayın) ilk anı: planı düşürme bu anda devreye girer */
export function nextPeriodStartMs(deps: Deps, tenant: Tenant): number {
  const today = deps.now().withTimeZone(tenant.timezone).toPlainDate();
  return today.with({ day: 1 }).add({ months: 1 }).toZonedDateTime(tenant.timezone).epochMilliseconds;
}

/** Vakti gelen paket düşürmelerini uygular. Saatlik zamanlayıcıdan ve panel isteklerinden çağrılır. */
export function applyScheduledPlans(deps: Deps): number {
  const now = deps.now().epochMilliseconds;
  let applied = 0;
  for (const t of deps.tenants.all()) {
    const pending = t.plan.pending;
    if (!pending || pending.effectiveAt > now) continue;
    writeTenantPlan(deps, t, { id: pending.id, includedMinutes: PLANS[pending.id].minutes });
    deps.store.audit({ tenantId: t.id, userId: null, action: "plan.applied", target: pending.id });
    mailPlanApplied(deps, t, pending.id);
    applied++;
  }
  return applied;
}

/** Bu dönem satın alınmış ek dakikalar */
export function addonMinutes(deps: Deps, tenantId: string, period: string): number {
  const row = deps.store.db.prepare("SELECT COALESCE(SUM(minutes), 0) AS n FROM orders WHERE tenant_id = ? AND kind = 'addon' AND status = 'paid' AND period = ?").get(tenantId, period) as { n: number };
  return row.n;
}

/**
 * Ödeme alınabilir mi: Polar bağlıysa evet (ödeme sayfası açılır, Polar webhook'u `fulfillOrder` çağırır);
 * Polar yokken yalnızca test modunda (ücret alınmadan) başarılı olur.
 */
export function chargeAvailable(deps: Deps): boolean {
  return !!deps.polar || !!deps.paymentTestMode;
}

/** Ödemesi alınan siparişin etkisini uygular (tekrar çağrılırsa bir şey yapmaz) */
export function fulfillOrder(deps: Deps, tenant: Tenant, orderId: string): boolean {
  const res = deps.store.db.prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ? AND status = 'pending'").run(Date.now(), orderId);
  if (!res.changes) return false;
  const order = deps.store.db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId) as unknown as OrderRow;
  if (order.kind === "plan" && isPlanId(order.item)) writeTenantPlan(deps, tenant, { id: order.item, includedMinutes: PLANS[order.item].minutes });
  mailPurchase(deps, tenant, { label: order.label, amountUsd: order.amount_usd, kind: order.kind, minutes: order.minutes });
  return true;
}

/** Bu ay (firma saatiyle) kullanılan dakika ve kota */
export function monthQuota(deps: Deps, tenant: Tenant): { used: number; quota: number | null; period: string } {
  const now = deps.now().withTimeZone(tenant.timezone);
  const start = now.toPlainDate().with({ day: 1 }).toZonedDateTime(tenant.timezone).epochMilliseconds;
  const secs = (deps.store.db.prepare("SELECT COALESCE(SUM(duration_secs), 0) AS n FROM calls WHERE tenant_id = ? AND started_at >= ?").get(tenant.id, start) as { n: number }).n;
  const period = periodKey(now);
  const addon = addonMinutes(deps, tenant.id, period);
  const quota = tenant.plan.includedMinutes === undefined && !addon ? null : (tenant.plan.includedMinutes ?? 0) + addon;
  return { used: Math.round(secs / 60), quota, period };
}

/** Kota %80 ve %100'e ulaşınca müşteriye bir kez haber verir (kota değişirse yeni uyarı hakkı doğar) */
export function checkQuotaNotices(deps: Deps, tenantId: string): void {
  const tenant = deps.tenants.get(tenantId);
  if (!tenant || tenant.suspended) return;
  const { used, quota, period } = monthQuota(deps, tenant);
  if (!quota) return;
  const level = used >= quota ? "100" : used >= quota * 0.8 ? "80" : null;
  if (!level) return;
  const res = deps.store.db.prepare("INSERT OR IGNORE INTO notice_log (tenant_id, kind, period, sent_at) VALUES (?, ?, ?, ?)").run(tenant.id, `quota${level}:${quota}`, period, Date.now());
  if (res.changes) mailQuota(deps, tenant, level, used, quota);
}

export function billingRoutes(deps: Deps) {
  const app = new Hono<PanelEnv>();
  const db = deps.store.db;

  const createOrder = (tenant: Tenant, userId: string, o: { kind: "plan" | "addon"; item: string; label: string; minutes: number; amountUsd: number; period: string }) => {
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO orders (id, tenant_id, user_id, kind, item, label, minutes, amount_usd, period, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      id, tenant.id, userId, o.kind, o.item, o.label, o.minutes, o.amountUsd, o.period, Date.now(),
    );
    return id;
  };

  /** Ek dakika paketi satın al */
  app.post("/addons", requirePermission("settings.edit"), async (c) => {
    const tenant = c.get("tenant");
    const body = (await c.req.json().catch(() => ({}))) as { pack?: unknown; locale?: unknown };
    const pack = findAddon(body.pack);
    if (!pack) return c.json({ error: "Geçersiz paket" }, 400);
    if (tenant.suspended) return c.json({ error: "Hizmetiniz askıda; satın alma yapılamıyor" }, 409);
    if (!chargeAvailable(deps)) return c.json({ error: "Ödeme altyapısı henüz etkin değil" }, 503);
    const period = periodKey(deps.now().withTimeZone(tenant.timezone));
    const id = createOrder(tenant, c.get("user").id, { kind: "addon", item: pack.id, label: pack.name, minutes: pack.minutes, amountUsd: pack.priceUsd, period });
    if (deps.polar) {
      try {
        const checkout = await deps.polar.createCheckout({
          item: pack.id,
          externalCustomerId: c.get("user").id,
          email: c.get("user").email,
          metadata: { kind: "addon", order_id: id, tenant_id: tenant.id },
          successUrl: `${deps.baseUrl ?? ""}/panel/paketim?odeme=ok`,
          locale: body.locale === "en" ? "en" : "tr",
        });
        db.prepare("UPDATE orders SET provider_ref = ? WHERE id = ?").run(checkout.id, id);
        return c.json({ ok: true, checkoutUrl: checkout.url });
      } catch (err) {
        db.prepare("UPDATE orders SET status = 'failed' WHERE id = ?").run(id);
        console.error(`[ödeme] Polar ödeme sayfası açılamadı (${tenant.id}): ${(err as Error).message}`);
        return c.json({ error: "Ödeme sayfası şu an açılamadı. Biraz sonra tekrar deneyin." }, 502);
      }
    }
    fulfillOrder(deps, tenant, id);
    deps.store.audit({ tenantId: tenant.id, userId: c.get("user").id, action: "billing.addon", target: pack.id, detail: { amountUsd: pack.priceUsd } });
    return c.json({ ok: true, minutes: pack.minutes, chargedUsd: pack.priceUsd });
  });

  /**
   * Paket değiştir. Yükseltme: kalan günlere oranlanmış fark ödenir, paket hemen değişir.
   * Düşürme: ücret yok; paket bir sonraki dönemin başında kendiliğinden değişir (o aya kadar mevcut kota geçerli).
   * Mevcut paketi seçmek, bekleyen düşürmeyi iptal eder.
   */
  app.post("/plan-change", requirePermission("settings.edit"), async (c) => {
    const tenant = c.get("tenant");
    const user = c.get("user");
    const target = ((await c.req.json().catch(() => ({}))) as { plan?: unknown }).plan;
    if (!isPlanId(target)) return c.json({ error: "Geçersiz paket" }, 400);
    if (tenant.suspended) return c.json({ error: "Hizmetiniz askıda; paket değiştirilemez" }, 409);
    const current = tenant.plan.id;
    const kind = planChange(current, target);

    const subscriptionId = deps.polar ? deps.users.polarSubscriptionOfTenant(tenant.id) : null;
    if (deps.polar && !subscriptionId) return c.json({ error: "Aboneliğiniz ödeme sistemine bağlı değil. Lütfen bizimle iletişime geçin." }, 409);
    const polarChange = async (item: PlanId, when: "now" | "next_period") => {
      if (!deps.polar || !subscriptionId) return null;
      try {
        await deps.polar.changePlan(subscriptionId, item, when);
        return null;
      } catch (err) {
        console.error(`[ödeme] Polar paket değişikliği başarısız (${tenant.id}): ${(err as Error).message}`);
        return c.json({ error: "Paket değişikliği ödeme sisteminde tamamlanamadı. Biraz sonra tekrar deneyin." }, 502);
      }
    };

    if (kind === "same") {
      if (!tenant.plan.pending) return c.json({ error: "Zaten bu paketi kullanıyorsunuz" }, 409);
      const failed = await polarChange(current!, "next_period");
      if (failed) return failed;
      writeTenantPlan(deps, tenant, { id: current!, includedMinutes: tenant.plan.includedMinutes ?? PLANS[current!].minutes });
      deps.store.audit({ tenantId: tenant.id, userId: user.id, action: "billing.plan-cancel", target });
      return c.json({ ok: true, kind: "cancelled" });
    }

    if (kind === "downgrade") {
      const failed = await polarChange(target, "next_period");
      if (failed) return failed;
      const effectiveAt = nextPeriodStartMs(deps, tenant);
      writeTenantPlan(deps, tenant, { id: current!, includedMinutes: tenant.plan.includedMinutes ?? PLANS[current!].minutes, pending: { id: target, effectiveAt } });
      deps.store.audit({ tenantId: tenant.id, userId: user.id, action: "billing.plan-downgrade", target, detail: { effectiveAt } });
      const effectiveText = spokenDate(deps.now().withTimeZone(tenant.timezone).toPlainDate().with({ day: 1 }).add({ months: 1 }));
      mailPlanScheduled(deps, tenant, target, effectiveText);
      return c.json({ ok: true, kind, effectiveText });
    }

    if (!chargeAvailable(deps)) return c.json({ error: "Ödeme altyapısı henüz etkin değil" }, 503);
    const failedUpgrade = await polarChange(target, "now");
    if (failedUpgrade) return failedUpgrade;
    const today = deps.now().withTimeZone(tenant.timezone);
    const amountUsd = upgradeCharge(current, target, { day: today.day, daysInMonth: today.daysInMonth });
    const id = createOrder(tenant, user.id, { kind: "plan", item: target, label: `${PLANS[target].name} paketine geçiş`, minutes: 0, amountUsd, period: periodKey(today) });
    fulfillOrder(deps, tenant, id);
    deps.store.audit({ tenantId: tenant.id, userId: user.id, action: "billing.plan-upgrade", target, detail: { amountUsd } });
    return c.json({ ok: true, kind, chargedUsd: amountUsd });
  });

  /** Aboneliği yönet: Polar müşteri portalına tek kullanımlık giriş adresi (kart değiştirme, iptal, makbuzlar). Askıdayken de açılır. */
  app.post("/portal", requirePermission("settings.edit"), async (c) => {
    const tenant = c.get("tenant");
    const payer = deps.polar ? deps.users.polarPayerOfTenant(tenant.id) : null;
    if (!deps.polar || !payer) return c.json({ error: "Aboneliğiniz ödeme sistemine bağlı değil. Lütfen bizimle iletişime geçin." }, 409);
    try {
      return c.json({ url: await deps.polar.portalUrl(payer) });
    } catch (err) {
      console.error(`[ödeme] Polar portal adresi alınamadı (${tenant.id}): ${(err as Error).message}`);
      return c.json({ error: "Abonelik sayfası şu an açılamadı. Biraz sonra tekrar deneyin." }, 502);
    }
  });

  /** Müşteri kendi 0850 numarasını kullanmak istediğini bildirir. Numara kendiliğinden değişmez; yöneticiye e-posta gider ve kayda geçer. */
  app.post("/phone-request", requirePermission("settings.edit"), async (c) => {
    const tenant = c.get("tenant");
    const user = c.get("user");
    const body = (await c.req.json().catch(() => null)) as { number?: unknown; note?: unknown } | null;
    const number = typeof body?.number === "string" ? normalizePoolNumber(body.number) : null;
    if (!number || isTestNumber(number)) return c.json({ error: "Geçerli bir numara yazın (örneğin 0850 000 00 00)" }, 422);
    const note = typeof body?.note === "string" ? body.note.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    // günde en fazla bir talep: yöneticiye e-posta yağdırılamasın
    const today = deps.now().toPlainDate().toString();
    const fresh = Number(db.prepare("INSERT OR IGNORE INTO notice_log (tenant_id, kind, period, sent_at) VALUES (?, 'own-number-request', ?, ?)").run(tenant.id, today, Date.now()).changes) > 0;
    if (!fresh) return c.json({ error: "Bugün zaten bir talep ilettiniz. Ekibimiz en kısa sürede dönecek." }, 429);
    deps.store.audit({ tenantId: tenant.id, userId: user.id, action: "phone.own-number-request", target: number });
    mailOwnNumberRequest(deps, tenant, user.email, number, note);
    return c.json({ ok: true });
  });

  /** Satın alma geçmişi */
  app.get("/orders", (c) => {
    const rows = db.prepare("SELECT * FROM orders WHERE tenant_id = ? AND status = 'paid' ORDER BY created_at DESC LIMIT 20").all(c.get("tenant").id) as unknown as OrderRow[];
    return c.json({ orders: rows.map((r) => ({ id: r.id, kind: r.kind, label: r.label, minutes: r.minutes, amountUsd: r.amount_usd, paidAt: r.paid_at })) });
  });

  return app;
}
