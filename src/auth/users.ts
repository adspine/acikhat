import type { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Role } from "../domain/permissions.ts";

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
}

type Row = {
  id: string; tenant_id: string | null; email: string; name: string; role: Role;
  must_change_password: number; disabled: number; last_login_at: number | null; password_hash: string;
};
const toUser = (r: Row): User => ({
  id: r.id, tenantId: r.tenant_id, email: r.email, name: r.name, role: r.role,
  mustChangePassword: !!r.must_change_password, disabled: !!r.disabled, lastLoginAt: r.last_login_at,
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
