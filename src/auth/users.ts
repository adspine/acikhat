import type { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Role } from "../domain/permissions.ts";
import { isPlanId, type PlanId } from "../domain/plans.ts";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_DAYS = 30;
export const MIN_PASSWORD = 10;

export interface User {
  id: string;
  tenantId: string | null;
  email: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
  disabled: boolean;
  lastLoginAt: number | null;
  /** Kota ve paket gibi bilgilendirme e-postalarını alsın mı (işlem onayları her zaman gider) */
  notifyEmail: boolean;
}

type Row = {
  id: string; tenant_id: string | null; email: string; name: string; role: Role;
  must_change_password: number; disabled: number; last_login_at: number | null; password_hash: string;
  firebase_uid?: string | null;
  notify_email?: number;
  plan?: string | null; plan_paid_at?: number | null; onboarding_ref?: string | null;
};

/**
 * Üyenin kurulum yolculuğu (sunucuda tutulur; çıkış yapıp dönünce kaldığı adımdan devam eder):
 * 1 paket ve ödeme, 2 kurulum formu, 3 numara alma (numarası yoksa), 4 onay bekleniyor. Firma oluşunca yolculuk biter.
 */
export interface Onboarding {
  plan: PlanId | null;
  paidAt: number | null;
  reference: string | null;
  /** Üyenin bildirdiği asistan hattı (E.164); henüz bildirmediyse null */
  lineNumber: string | null;
  step: 1 | 2 | 3 | 4;
}
const toUser = (r: Row): User => ({
  id: r.id, tenantId: r.tenant_id, email: r.email, name: r.name, role: r.role,
  mustChangePassword: !!r.must_change_password, disabled: !!r.disabled, lastLoginAt: r.last_login_at,
  notifyEmail: r.notify_email !== 0,
});

/** "scrypt$N$r$p$tuz$özet" biçiminde saklanır; parametreler değişirse eski özetler çalışmaya devam eder */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return timingSafeEqual(expected, actual);
}

/** Kurulumda verilecek, okunması kolay geçici şifre (karışan harfler yok) */
export function temporaryPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export class Users {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async create(u: { tenantId: string | null; email: string; name: string; role: Role; password: string; mustChangePassword?: boolean }): Promise<User> {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO users (id, tenant_id, email, name, role, password_hash, must_change_password, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, u.tenantId, u.email.trim(), u.name.trim(), u.role, await hashPassword(u.password), u.mustChangePassword === false ? 0 : 1, Date.now());
    return this.get(id)!;
  }

  get(id: string): User | null {
    const r = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined;
    return r ? toUser(r) : null;
  }

  listForTenant(tenantId: string): User[] {
    return (this.db.prepare("SELECT * FROM users WHERE tenant_id = ? ORDER BY created_at").all(tenantId) as Row[]).map(toUser);
  }

  // ---- Firebase ile giriş ----
  findByFirebaseUid(uid: string): User | null {
    const r = this.db.prepare("SELECT * FROM users WHERE firebase_uid = ?").get(uid) as Row | undefined;
    return r ? toUser(r) : null;
  }

  findByEmail(email: string): (User & { firebaseUid: string | null }) | null {
    const r = this.db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim()) as Row | undefined;
    return r ? { ...toUser(r), firebaseUid: r.firebase_uid ?? null } : null;
  }

  linkFirebase(userId: string, uid: string) {
    this.db.prepare("UPDATE users SET firebase_uid = ? WHERE id = ?").run(uid, userId);
  }

  /** Kendi kendine üye olan kişi: henüz bir firmaya bağlı değil (paket ve kurulum sonrası bağlanır). Şifresi yok; yalnızca Firebase ile girer. */
  createFromFirebase(u: { uid: string; email: string; name: string }): User {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO users (id, tenant_id, email, name, role, password_hash, must_change_password, created_at, firebase_uid)
         VALUES (?, NULL, ?, ?, 'owner', 'firebase', 0, ?, ?)`,
      )
      .run(id, u.email.trim(), u.name.trim(), Date.now(), u.uid);
    return this.get(id)!;
  }

  onboardingOf(userId: string): Onboarding {
    const r = this.db.prepare("SELECT plan, plan_paid_at, onboarding_ref FROM users WHERE id = ?").get(userId) as Row | undefined;
    const plan = r && isPlanId(r.plan) ? r.plan : null;
    const paidAt = r?.plan_paid_at ?? null;
    const reference = r?.onboarding_ref ?? null;
    const lineNumber = reference ? this.declaredLine(reference) : null;
    return { plan, paidAt, reference, lineNumber, step: !paidAt ? 1 : !reference ? 2 : !lineNumber ? 3 : 4 };
  }

  /** Başvuruda üyenin bildirdiği hat numarası (payload.line.number) */
  private declaredLine(reference: string): string | null {
    const r = this.db.prepare("SELECT payload_json FROM onboarding_submissions WHERE reference = ?").get(reference) as { payload_json: string } | undefined;
    if (!r) return null;
    try {
      const n = (JSON.parse(r.payload_json) as { line?: { number?: unknown } }).line?.number;
      return typeof n === "string" && n ? n : null;
    } catch {
      return null;
    }
  }

  /** Ödeme yapılana kadar plan değiştirilebilir */
  selectPlan(userId: string, plan: PlanId): boolean {
    return this.db.prepare("UPDATE users SET plan = ? WHERE id = ? AND plan_paid_at IS NULL").run(plan, userId).changes > 0;
  }

  markPaid(userId: string): boolean {
    return this.db.prepare("UPDATE users SET plan_paid_at = ? WHERE id = ? AND plan IS NOT NULL AND plan_paid_at IS NULL").run(Date.now(), userId).changes > 0;
  }

  /** Polar abonelik kimliği (üyenin aylık paketi); ödeme webhook'u yazar */
  setPolarSubscription(userId: string, subscriptionId: string) {
    this.db.prepare("UPDATE users SET polar_subscription_id = ? WHERE id = ?").run(subscriptionId, userId);
  }

  polarSubscriptionOf(userId: string): string | null {
    return ((this.db.prepare("SELECT polar_subscription_id AS s FROM users WHERE id = ?").get(userId) as { s: string | null } | undefined)?.s) ?? null;
  }

  /** Firmanın sahibinin Polar aboneliği (paket yükseltme/düşürme bunun üzerinden yapılır) */
  polarSubscriptionOfTenant(tenantId: string): string | null {
    return ((this.db.prepare("SELECT polar_subscription_id AS s FROM users WHERE tenant_id = ? AND role = 'owner' AND polar_subscription_id IS NOT NULL LIMIT 1").get(tenantId) as { s: string } | undefined)?.s) ?? null;
  }

  /** Bu aboneliğin sahibi üye (webhook olaylarını firmaya bağlamak için) */
  byPolarSubscription(subscriptionId: string): User | null {
    const r = this.db.prepare("SELECT * FROM users WHERE polar_subscription_id = ?").get(subscriptionId) as Row | undefined;
    return r ? toUser(r) : null;
  }

  /** Firmanın aboneliğini ödeyen üye (Polar müşterisi bu üyenin kimliğiyle açılmıştır) */
  polarPayerOfTenant(tenantId: string): string | null {
    return ((this.db.prepare("SELECT id FROM users WHERE tenant_id = ? AND role = 'owner' AND polar_subscription_id IS NOT NULL LIMIT 1").get(tenantId) as { id: string } | undefined)?.id) ?? null;
  }

  setOnboardingRef(userId: string, reference: string) {
    this.db.prepare("UPDATE users SET onboarding_ref = ? WHERE id = ?").run(reference, userId);
  }

  /** Üyeyi onaylanmış firmaya bağlar: bundan sonra kendi panosunu görür */
  assignTenant(userId: string, tenantId: string) {
    this.db.prepare("UPDATE users SET tenant_id = ? WHERE id = ?").run(tenantId, userId);
  }

  touchLogin(userId: string) {
    this.db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(Date.now(), userId);
  }

  /** E-posta + şifre doğruysa kullanıcıyı döner (kapatılmış hesap giremez) */
  async authenticate(email: string, password: string): Promise<User | null> {
    const r = this.db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim()) as Row | undefined;
    // Kullanıcı yoksa da aynı süreyi harca: e-postanın kayıtlı olup olmadığı zamanlamadan anlaşılmasın
    const ok = await verifyPassword(password, r?.password_hash ?? "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    if (!r || !ok || r.disabled) return null;
    this.db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(Date.now(), r.id);
    return toUser(r);
  }

  async setPassword(userId: string, password: string, opts: { mustChange?: boolean } = {}) {
    this.db
      .prepare("UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?")
      .run(await hashPassword(password), opts.mustChange ? 1 : 0, userId);
  }

  /** Kullanıcının kendi profil tercihleri */
  updateProfile(userId: string, patch: { name?: string; notifyEmail?: boolean }) {
    const u = this.get(userId);
    if (!u) return;
    this.db.prepare("UPDATE users SET name = ?, notify_email = ? WHERE id = ?").run(patch.name ?? u.name, (patch.notifyEmail ?? u.notifyEmail) ? 1 : 0, userId);
  }

  update(userId: string, patch: { name?: string; role?: Role; disabled?: boolean }) {
    const u = this.get(userId);
    if (!u) return;
    this.db
      .prepare("UPDATE users SET name = ?, role = ?, disabled = ? WHERE id = ?")
      .run(patch.name ?? u.name, patch.role ?? u.role, (patch.disabled ?? u.disabled) ? 1 : 0, userId);
    if (patch.disabled) this.revokeAll(userId);
  }

  // ---- oturumlar ----
  createSession(userId: string): { token: string; expiresAt: number } {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + SESSION_DAYS * 86_400_000;
    this.db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(tokenHash(token), userId, expiresAt, Date.now());
    return { token, expiresAt };
  }

  userForSession(token: string): User | null {
    const s = this.db.prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?").get(tokenHash(token)) as
      | { user_id: string; expires_at: number }
      | undefined;
    if (!s || s.expires_at < Date.now()) return null;
    const u = this.get(s.user_id);
    return u && !u.disabled ? u : null;
  }

  revoke(token: string) {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
  }

  revokeAll(userId: string, exceptToken?: string) {
    if (exceptToken) this.db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(userId, tokenHash(exceptToken));
    else this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }

  purgeExpiredSessions() {
    this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  }
}
