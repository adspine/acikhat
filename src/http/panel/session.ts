import { Hono, type Context, type MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import type { Deps } from "../deps.ts";
import type { User } from "../../auth/users.ts";
import { MIN_PASSWORD } from "../../auth/users.ts";
import { permissionsFor, type Permission } from "../../domain/permissions.ts";
import type { Tenant } from "../../domain/tenant.ts";
import { loadVertical } from "../../domain/vertical.ts";

export type PanelEnv = {
  Variables: {
    user: User;
    /** İsteğin ait olduğu firma: her zaman oturumdan (ajans için seçili firma başlığından) gelir */
    tenant: Tenant;
    permissions: Set<Permission>;
    sessionToken: string;
  };
};

const cookieName = (secure: boolean) => (secure ? "__Host-oturum" : "oturum");

/** Değişiklik isteklerinde başka siteden gelen form gönderimlerini engeller (SameSite=Strict'e ek) */
export const requirePanelHeader: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.header("x-panel") !== "1") {
    return c.json({ error: "İstek reddedildi" }, 403);
  }
  await next();
};

/** Giriş denemesi sınırı: aynı e-posta + IP için 15 dakikada 5 hatalı deneme */
function loginLimiter() {
  const attempts = new Map<string, { count: number; until: number }>();
  return {
    blocked(key: string) {
      const a = attempts.get(key);
      return !!a && a.count >= 5 && a.until > Date.now();
    },
    fail(key: string) {
      const a = attempts.get(key);
      if (!a || a.until < Date.now()) attempts.set(key, { count: 1, until: Date.now() + 15 * 60_000 });
      else a.count++;
    },
    reset(key: string) {
      attempts.delete(key);
    },
  };
}

export function teamPermissions(tenant: Tenant): Permission[] {
  return tenant.team.permissions ?? loadVertical(tenant.vertical).teamPermissions;
}

/** Oturumu doğrular, kullanıcıyı ve firmayı bağlama yerleştirir */
export function requireSession(deps: Deps): MiddlewareHandler<PanelEnv> {
  return async (c, next) => {
    const token = getCookie(c, cookieName(deps.secureCookies));
    const user = token ? deps.users.userForSession(token) : null;
    if (!user || !token) return c.json({ error: "Oturum açmanız gerekiyor" }, 401);
    // Ajans kullanıcısı x-tenant başlığıyla bir firmanın panelini görebilir; firma kullanıcısı yalnızca kendi firmasını
    const tenantId = user.role === "agency" ? c.req.header("x-tenant") : user.tenantId;
    const tenant = tenantId ? deps.tenants.get(tenantId) : undefined;
    if (!tenant) return c.json({ error: user.role === "agency" ? "Firma seçin" : "Firma bulunamadı" }, user.role === "agency" ? 409 : 403);
    c.set("user", user);
    c.set("tenant", tenant);
    c.set("permissions", permissionsFor(user.role, teamPermissions(tenant)));
    c.set("sessionToken", token);
    await next();
  };
}

export function can(c: Context<PanelEnv>, p: Permission): boolean {
  return c.get("permissions").has(p);
}

/** Yetki yoksa 403 döner */
export function requirePermission(p: Permission): MiddlewareHandler<PanelEnv> {
  return async (c, next) => {
    if (!can(c, p)) return c.json({ error: "Bu işlem için yetkiniz yok" }, 403);
    await next();
  };
}

const Login = z.object({ email: z.string().trim().min(3), password: z.string().min(1) });
const ChangePassword = z.object({ current: z.string().min(1), next: z.string().min(MIN_PASSWORD, `Yeni şifre en az ${MIN_PASSWORD} karakter olmalı`) });

export function authRoutes(deps: Deps) {
  const app = new Hono<PanelEnv>();
  const limiter = loginLimiter();
  app.use("*", requirePanelHeader);

  app.post("/login", async (c) => {
    const parsed = Login.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "E-posta ve şifrenizi yazın" }, 400);
    const ip = c.req.header("fly-client-ip") ?? c.req.header("x-forwarded-for") ?? "local";
    const key = `${parsed.data.email.toLowerCase()}|${ip}`;
    if (limiter.blocked(key)) return c.json({ error: "Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin." }, 429);
    const user = await deps.users.authenticate(parsed.data.email, parsed.data.password);
    if (!user) {
      limiter.fail(key);
      return c.json({ error: "E-posta veya şifre hatalı" }, 401);
    }
    limiter.reset(key);
    const session = deps.users.createSession(user.id);
    setCookie(c, cookieName(deps.secureCookies), session.token, {
      httpOnly: true,
      secure: deps.secureCookies,
      sameSite: "Strict",
      path: "/",
      expires: new Date(session.expiresAt),
    });
    return c.json({ ok: true, mustChangePassword: user.mustChangePassword });
  });

  app.post("/logout", (c) => {
    const token = getCookie(c, cookieName(deps.secureCookies));
    if (token) deps.users.revoke(token);
    deleteCookie(c, cookieName(deps.secureCookies), { path: "/", secure: deps.secureCookies });
    return c.json({ ok: true });
  });

  app.post("/password", async (c) => {
    const token = getCookie(c, cookieName(deps.secureCookies));
    const user = token ? deps.users.userForSession(token) : null;
    if (!user || !token) return c.json({ error: "Oturum açmanız gerekiyor" }, 401);
    const parsed = ChangePassword.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Geçersiz şifre" }, 400);
    if (!(await deps.users.authenticate(user.email, parsed.data.current))) return c.json({ error: "Mevcut şifre hatalı" }, 400);
    await deps.users.setPassword(user.id, parsed.data.next);
    // Diğer cihazlardaki oturumları kapat, bu oturum açık kalsın
    deps.users.revokeAll(user.id, token);
    return c.json({ ok: true });
  });

  return app;
}
