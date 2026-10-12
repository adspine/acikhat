import { mailMembershipPaid } from "../../notify/emails.ts";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import type { Deps } from "../deps.ts";
import type { User } from "../../auth/users.ts";
import { MIN_PASSWORD } from "../../auth/users.ts";
import { FirebaseAuthError, type FirebaseIdentity } from "../../auth/firebase.ts";
import { permissionsFor, type Permission } from "../../domain/permissions.ts";
import type { Tenant } from "../../domain/tenant.ts";
import { loadVertical } from "../../domain/vertical.ts";
import { PLANS, isPlanId } from "../../domain/plans.ts";

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

/** Çerezdeki oturumun kullanıcısı (tanıtım sitesi uçları için; firma gerektirmez) */
export function userFromCookie(c: Context, deps: Deps): User | null {
  const token = getCookie(c, cookieName(deps.secureCookies));
  return token ? deps.users.userForSession(token) : null;
}

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

  /** Oturumu kaydeder ve çerezi yazar (şifreli ve Firebase girişi ortak) */
  const startSession = (c: Context, userId: string) => {
    const session = deps.users.createSession(userId);
    setCookie(c, cookieName(deps.secureCookies), session.token, {
      httpOnly: true,
      secure: deps.secureCookies,
      sameSite: "Strict",
      path: "/",
      expires: new Date(session.expiresAt),
    });
  };
  const clientIp = (c: Context) => c.req.header("fly-client-ip") ?? c.req.header("x-forwarded-for") ?? "local";

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
    startSession(c, user.id);
    return c.json({ ok: true, mustChangePassword: user.mustChangePassword });
  });

  /**
   * Firebase ile giriş (Google veya e-posta/şifre): tarayıcı Firebase'den aldığı kimlik belgesini gönderir,
   * biz imzasını doğrulayıp kendi oturum çerezimizi açarız. Rol ve firma bağlantısı kendi veritabanımızda kalır.
   */
  const firebaseLimiter = loginLimiter();
  app.post("/firebase", async (c) => {
    if (!deps.firebase) return c.json({ error: "Bu giriş yöntemi şu an kapalı" }, 503);
    const parsed = z.object({ idToken: z.string().min(20).max(8192) }).safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "Giriş belgesi eksik" }, 400);
    const key = `firebase|${clientIp(c)}`;
    if (firebaseLimiter.blocked(key)) return c.json({ error: "Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin." }, 429);

    let identity: FirebaseIdentity;
    try {
      identity = await deps.firebase.verify(parsed.data.idToken);
    } catch (err) {
      if (err instanceof FirebaseAuthError) {
        firebaseLimiter.fail(key);
        return c.json({ error: "Giriş doğrulanamadı. Lütfen tekrar deneyin." }, 401);
      }
      return c.json({ error: "Giriş şu an doğrulanamıyor. Biraz sonra tekrar deneyin." }, 503);
    }
    // Doğrulanmamış e-posta başkasının adına hesap açmak için kullanılabilir: kabul etmeyiz
    if (!identity.emailVerified) {
      return c.json({ error: "E-posta adresinizi doğrulamanız gerekiyor. Gelen kutunuzdaki bağlantıya tıklayın.", needsVerification: true }, 403);
    }

    let user = deps.users.findByFirebaseUid(identity.uid);
    if (!user) {
      const existing = deps.users.findByEmail(identity.email);
      if (existing) {
        // Aynı (doğrulanmış) e-posta: mevcut panel hesabına bağlanır. Başka bir Firebase hesabına bağlıysa reddedilir.
        if (existing.firebaseUid && existing.firebaseUid !== identity.uid) return c.json({ error: "Bu e-posta başka bir hesaba bağlı" }, 409);
        deps.users.linkFirebase(existing.id, identity.uid);
        user = existing;
      } else {
        user = deps.users.createFromFirebase({ uid: identity.uid, email: identity.email, name: identity.name ?? identity.email.split("@")[0]! });
      }
    }
    if (user.disabled) return c.json({ error: "Bu hesap kapatılmış. Bizimle iletişime geçin." }, 403);
    // Yönetici e-postaları: Firebase'in doğruladığı adres listede ise hesap yönetici olur (şifre veya rol elle girilmez)
    if (user.role !== "agency" && deps.adminEmails?.includes(identity.email.toLowerCase())) {
      deps.users.update(user.id, { role: "agency" });
      user = { ...user, role: "agency" };
    }

    firebaseLimiter.reset(key);
    deps.users.touchLogin(user.id);
    startSession(c, user.id);
    return c.json({ ok: true, hasTenant: user.role === "agency" || !!user.tenantId, mustChangePassword: false });
  });

  /** Tanıtım sitesi için: giriş yapılmış mı, firması var mı, kurulum yolculuğunda hangi adımda */
  const accountOf = (user: User) => ({
    user: { name: user.name, email: user.email, role: user.role },
    hasTenant: user.role === "agency" || !!user.tenantId,
    onboarding: deps.users.onboardingOf(user.id),
    paymentTestMode: !!deps.paymentTestMode,
  });
  app.get("/session", (c) => {
    const user = userFromCookie(c, deps);
    if (!user) return c.json({ error: "Oturum açmanız gerekiyor" }, 401);
    return c.json(accountOf(user));
  });

  /** Paket seçimi (ödemeden önce değiştirilebilir) */
  app.post("/plan", async (c) => {
    const user = userFromCookie(c, deps);
    if (!user) return c.json({ error: "Oturum açmanız gerekiyor" }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { plan?: unknown };
    if (!isPlanId(body.plan)) return c.json({ error: "Geçersiz paket" }, 400);
    if (!deps.users.selectPlan(user.id, body.plan)) return c.json({ error: "Paketiniz zaten ödenmiş" }, 409);
    return c.json(accountOf(user));
  });

  /**
   * Ödeme. Gerçek ödeme sağlayıcısı bağlanana kadar yalnızca test modunda ("ödenmiş say") çalışır;
   * canlıda PAYMENT_TEST_MODE=1 verilmedikçe kapalıdır.
   */
  app.post("/pay", (c) => {
    const user = userFromCookie(c, deps);
    if (!user) return c.json({ error: "Oturum açmanız gerekiyor" }, 401);
    if (!deps.paymentTestMode) return c.json({ error: "Online ödeme çok yakında. Şimdilik bizimle iletişime geçin." }, 501);
    const o = deps.users.onboardingOf(user.id);
    if (!o.plan) return c.json({ error: "Önce bir paket seçin" }, 400);
    if (!o.paidAt && deps.users.markPaid(user.id)) mailMembershipPaid(deps, user, o.plan);
    console.info(`[ödeme:test] ${user.email} → ${PLANS[o.plan].name} (test, ücret alınmadı)`);
    return c.json(accountOf(user));
  });

  /** Şifre değiştirme: Firebase şifre belirleme e-postası gönderilir (şifre Firebase'de tutulur). Dakikada bir kez. */
  const lastReset = new Map<string, number>();
  app.post("/password-reset", async (c) => {
    const user = userFromCookie(c, deps);
    if (!user) return c.json({ error: "Oturum açmanız gerekiyor" }, 401);
    if (!deps.passwordReset) return c.json({ error: "Şifre e-postası şu an gönderilemiyor" }, 503);
    const last = lastReset.get(user.id);
    if (last && Date.now() - last < 60_000) return c.json({ error: "Bağlantıyı az önce gönderdik. Bir dakika sonra tekrar deneyin." }, 429);
    try {
      await deps.passwordReset(user.email);
    } catch (err) {
      console.error(`[şifre] e-posta gönderilemedi (${user.email}): ${(err as Error).message}`);
      return c.json({ error: "Şifre e-postası gönderilemedi. Biraz sonra tekrar deneyin." }, 502);
    }
    lastReset.set(user.id, Date.now());
    return c.json({ ok: true, email: user.email });
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
