import { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "../deps.ts";
import { type PanelEnv, requirePermission, teamPermissions } from "./session.ts";
import { temporaryPassword } from "../../auth/users.ts";
import { PERMISSIONS, PERMISSION_LABELS, permissionsFor } from "../../domain/permissions.ts";
import { terms } from "./views.ts";

export function userRoutes(deps: Deps) {
  const app = new Hono<PanelEnv>();

  /** Oturumdaki kullanıcı, firma, firmanın terimleri ve yetkiler: panel açılışta bunu çeker */
  app.get("/me", (c) => {
    const user = c.get("user");
    const tenant = c.get("tenant");
    return c.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword, notifyEmail: user.notifyEmail },
      tenant: { id: tenant.id, name: tenant.name, vertical: tenant.vertical, calendar: tenant.calendar.provider, suspended: tenant.suspended },
      terms: terms(tenant),
      permissions: [...c.get("permissions")],
      services: tenant.services.map((s) => ({ id: s.id, name: s.name, durationMin: s.durationMin, price: s.priceTRY, staffCount: s.staffCount })),
      staff: tenant.staff.map((s) => ({ id: s.id, name: s.name, services: s.services })),
      testCallEnabled: tenant.agentIds.length > 0,
    });
  });

  app.use("/users", requirePermission("users.manage"));
  app.use("/users/*", requirePermission("users.manage"));
  app.use("/team", requirePermission("users.manage"));

  app.get("/users", (c) => {
    const tenant = c.get("tenant");
    const t = terms(tenant);
    return c.json({
      users: deps.users.listForTenant(tenant.id).map((u) => ({
        id: u.id, name: u.name, email: u.email, role: u.role, disabled: u.disabled, lastLoginAt: u.lastLoginAt, isMe: u.id === c.get("user").id,
      })),
      roles: { owner: "Sahip", team: t.teamRoleLabel },
      team: { label: t.teamRoleLabel, permissions: teamPermissions(tenant) },
      permissions: PERMISSIONS.map((p) => ({ id: p, label: PERMISSION_LABELS[p] })),
    });
  });

  const NewUser = z.object({
    name: z.string().trim().min(2, "Adını yazın"),
    email: z.email("Geçerli bir e-posta yazın"),
    role: z.enum(["owner", "team"]),
  });

  /** Yeni kullanıcı: geçici şifre bir kez gösterilir, ilk girişte değiştirilir */
  app.post("/users", async (c) => {
    const tenant = c.get("tenant");
    const parsed = NewUser.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Eksik bilgi" }, 400);
    const password = temporaryPassword();
    try {
      const u = await deps.users.create({ tenantId: tenant.id, ...parsed.data, password });
      deps.store.audit({ tenantId: tenant.id, userId: c.get("user").id, action: "user.create", target: u.id, detail: { email: u.email, role: u.role } });
      return c.json({ id: u.id, temporaryPassword: password }, 201);
    } catch (err) {
      if (String(err).includes("UNIQUE")) return c.json({ error: "Bu e-posta ile kayıtlı bir kullanıcı var" }, 409);
      throw err;
    }
  });

  const owners = (tenantId: string) => deps.users.listForTenant(tenantId).filter((u) => u.role === "owner" && !u.disabled);

  app.patch("/users/:id", async (c) => {
    const tenant = c.get("tenant");
    const me = c.get("user");
    const target = deps.users.get(c.req.param("id"));
    if (!target || target.tenantId !== tenant.id) return c.json({ error: "Kullanıcı bulunamadı" }, 404);
    const parsed = z
      .object({ name: z.string().trim().min(2).optional(), role: z.enum(["owner", "team"]).optional(), disabled: z.boolean().optional() })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "Geçersiz değişiklik" }, 400);
    const p = parsed.data;
    if (target.id === me.id && (p.disabled || p.role === "team")) return c.json({ error: "Kendi hesabınızı kapatamaz veya yetkisini düşüremezsiniz" }, 400);
    const losingOwner = target.role === "owner" && (p.disabled || p.role === "team");
    if (losingOwner && owners(tenant.id).length <= 1) return c.json({ error: "Firmada en az bir sahip hesabı kalmalı" }, 400);
    deps.users.update(target.id, p);
    deps.store.audit({ tenantId: tenant.id, userId: me.id, action: "user.update", target: target.id, detail: p });
    return c.json({ ok: true });
  });

  app.post("/users/:id/reset-password", async (c) => {
    const tenant = c.get("tenant");
    const target = deps.users.get(c.req.param("id"));
    if (!target || target.tenantId !== tenant.id) return c.json({ error: "Kullanıcı bulunamadı" }, 404);
    const password = temporaryPassword();
    await deps.users.setPassword(target.id, password, { mustChange: true });
    deps.users.revokeAll(target.id);
    deps.store.audit({ tenantId: tenant.id, userId: c.get("user").id, action: "user.reset_password", target: target.id });
    return c.json({ temporaryPassword: password });
  });

  /** Ekip rolünün adı ve yetkileri: asistanı etkilemediği için yayınlamadan hemen uygulanır */
  app.put("/team", async (c) => {
    const tenant = c.get("tenant");
    const parsed = z
      .object({ label: z.string().trim().min(2).max(40), permissions: z.array(z.enum(PERMISSIONS)) })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "Rol adı ve yetkileri kontrol edin" }, 400);
    // Ekip rolü kullanıcı yönetemez: sahiplik devri gibi riskleri önler
    const permissions = parsed.data.permissions.filter((p) => p !== "users.manage");
    const next = deps.tenantStore.patchLive(tenant.id, "team", { label: parsed.data.label, permissions });
    if (!next) return c.json({ error: "Firma bulunamadı" }, 404);
    deps.tenants.set(next);
    deps.store.audit({ tenantId: tenant.id, userId: c.get("user").id, action: "team.update", detail: { label: parsed.data.label, permissions } });
    return c.json({ label: parsed.data.label, permissions: [...permissionsFor("team", permissions)] });
  });

  return app;
}
