import { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "../deps.ts";
import { type PanelEnv, requirePermission } from "./session.ts";
import { checkLineNumber } from "../phone-line.ts";
import { mailLineSubmitted } from "../../notify/emails.ts";

/** Başvuruda saklanan hat bildirimi (onboarding.ts ve admin.ts ile aynı alan) */
interface DeclaredLine { number: string; subscriptionType?: "onodemeli" | "faturali"; sipConfigured?: boolean; at?: number; approvedAt?: number }

const Line = z.object({
  number: z.string().trim().min(1, "Numaranızı yazın").max(32),
  subscriptionType: z.enum(["onodemeli", "faturali"], "Abonelik türünü seçin"),
  sipConfigured: z.literal(true, "Netgsm SIP ayarını yaptığınızı onaylayın"),
  ownerConfirmed: z.literal(true, "Numaranın sizin adınıza kayıtlı olduğunu onaylayın"),
});

/**
 * Panelde "Numara rehberi": firmanın asistan numarasının durumu ve numaranın bildirilmesi.
 * Numara firmaya yalnızca yönetici onayıyla yazılır (admin: approve-line); burada yalnızca bildirim saklanır.
 */
export function lineRoutes(deps: Deps) {
  const app = new Hono<PanelEnv>();
  const db = deps.store.db;
  const latest = (tenantId: string) =>
    db.prepare("SELECT reference, payload_json FROM onboarding_submissions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1").get(tenantId) as { reference: string; payload_json: string } | undefined;

  app.get("/line", (c) => {
    const tenant = deps.tenants.get(c.get("tenant").id) ?? c.get("tenant");
    const row = latest(tenant.id);
    const line = row ? (JSON.parse(row.payload_json) as { line?: DeclaredLine }).line : undefined;
    // Bildirilen numara firmaya yazıldıysa artık "bekleyen" değildir
    const pending = line && !tenant.phoneNumbers.includes(line.number) ? { number: line.number, subscriptionType: line.subscriptionType ?? null, sipConfigured: !!line.sipConfigured, at: line.at ?? null } : null;
    return c.json({ numbers: tenant.phoneNumbers, assistantReady: tenant.agentIds.length > 0, pending, canSubmit: !tenant.phoneNumbers.length });
  });

  app.post("/line", requirePermission("settings.edit"), async (c) => {
    const tenant = deps.tenants.get(c.get("tenant").id) ?? c.get("tenant");
    const user = c.get("user");
    if (tenant.phoneNumbers.length) return c.json({ error: "Firmanızın numarası zaten bağlı. Değiştirmek için \"Numaramı değiştirmek istiyorum\" talebini kullanın." }, 409);
    const parsed = Line.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Eksik bilgi" }, 422);
    const chk = checkLineNumber(deps, parsed.data.number, { tenantId: tenant.id, strict: true });
    if (!chk.ok) return c.json({ error: chk.error }, chk.status);
    const row = latest(tenant.id);
    if (!row) return c.json({ error: "Başvuru kaydınız bulunamadı. support@acikhat.si adresine yazın." }, 409);
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    payload.line = { number: chk.number, subscriptionType: parsed.data.subscriptionType, sipConfigured: true, source: "panel", at: Date.now() };
    db.prepare("UPDATE onboarding_submissions SET payload_json = ? WHERE reference = ?").run(JSON.stringify(payload), row.reference);
    deps.store.audit({ tenantId: tenant.id, userId: user.id, action: "line.declare", target: chk.number });
    mailLineSubmitted(deps, { reference: row.reference, number: chk.number, memberEmail: user.email, subscriptionType: parsed.data.subscriptionType, tenantName: tenant.name });
    return c.json({ ok: true, number: chk.number });
  });

  return app;
}
