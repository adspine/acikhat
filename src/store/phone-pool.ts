import type { DatabaseSync } from "node:sqlite";
import { normalizeTrPhone } from "../domain/phone.ts";
import { POOL, type PoolStatus } from "../domain/phone-pool.ts";

const DAY = 86_400_000;

/** Deneme numaraları bu aralıktadır (0850 999 xxxx): gerçek bir hat değildir, havuza elle gerçek numara olarak eklenemez */
export const TEST_PREFIX = "+90850999";
export const isTestNumber = (n: string) => n.startsWith(TEST_PREFIX);

export interface PoolRow {
  number: string;
  kind: "real" | "test";
  status: PoolStatus;
  tenantId: string | null;
  note: string | null;
  addedAt: number;
  assignedAt: number | null;
  releasedAt: number | null;
  quarantineUntil: number | null;
  renewAt: number | null;
}

type Raw = { number: string; kind?: "real" | "test"; status: PoolStatus; tenant_id: string | null; note: string | null; added_at: number; assigned_at: number | null; released_at: number | null; quarantine_until: number | null; renew_at: number | null };
const toRow = (r: Raw): PoolRow => ({ number: r.number, kind: r.kind ?? "real", status: r.status, tenantId: r.tenant_id, note: r.note, addedAt: r.added_at, assignedAt: r.assigned_at, releasedAt: r.released_at, quarantineUntil: r.quarantine_until, renewAt: r.renew_at });

/** "0850 303 83 32", "+90 850 ..." ya da E.164 yazımını E.164'e çevirir; geçersizse null */
export function normalizePoolNumber(raw: string): string | null {
  const compact = raw.replace(/\s/g, "");
  return /^\+\d{10,15}$/.test(compact) ? compact : normalizeTrPhone(raw);
}

/** Hat havuzunun veri erişimi. Atama ve bırakma tek işlemde (transaction) yapılır: aynı numara iki firmaya verilemez. */
export class PhonePool {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }

  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  list(): PoolRow[] {
    return (this.db.prepare("SELECT * FROM phone_pool ORDER BY CASE kind WHEN 'real' THEN 0 ELSE 1 END, CASE status WHEN 'assigned' THEN 0 WHEN 'available' THEN 1 WHEN 'quarantine' THEN 2 ELSE 3 END, added_at, number").all() as Raw[]).map(toRow);
  }

  get(number: string): PoolRow | undefined {
    const r = this.db.prepare("SELECT * FROM phone_pool WHERE number = ?").get(number) as Raw | undefined;
    return r && toRow(r);
  }

  forTenant(tenantId: string): PoolRow | undefined {
    const r = this.db.prepare("SELECT * FROM phone_pool WHERE tenant_id = ? AND status = 'assigned' ORDER BY assigned_at LIMIT 1").get(tenantId) as Raw | undefined;
    return r && toRow(r);
  }

  /** Gerçek numaraların durum sayıları (deneme numaraları stok sayılmaz, ayrıca `test` olarak verilir) */
  stats(): Record<PoolStatus, number> & { total: number; test: number } {
    const out = { available: 0, assigned: 0, quarantine: 0, retired: 0, total: 0, test: 0 };
    for (const r of this.db.prepare("SELECT status, COUNT(*) AS n FROM phone_pool WHERE kind = 'real' GROUP BY status").all() as { status: PoolStatus; n: number }[]) {
      out[r.status] = r.n;
      out.total += r.n;
    }
    out.test = (this.db.prepare("SELECT COUNT(*) AS n FROM phone_pool WHERE kind = 'test'").get() as { n: number }).n;
    return out;
  }

  /** Numaraları havuza ekler. `inUse`, başka bir firmanın elle atanmış numarasını eklemeyi engeller. */
  add(raws: string[], opts: { nowMs: number; note?: string | undefined; renewAt?: number | undefined; inUse?: (n: string) => boolean }): { added: string[]; skipped: { input: string; reason: string }[] } {
    const added: string[] = [];
    const skipped: { input: string; reason: string }[] = [];
    this.tx(() => {
      const seen = new Set<string>();
      for (const input of raws.map((x) => x.trim()).filter(Boolean)) {
        const n = normalizePoolNumber(input);
        if (!n) skipped.push({ input, reason: "Geçersiz numara" });
        else if (isTestNumber(n)) skipped.push({ input, reason: "Deneme numarası aralığı (0850 999 xxxx) ayrılmış" });
        else if (seen.has(n) || this.get(n)) skipped.push({ input, reason: "Havuzda zaten var" });
        else if (opts.inUse?.(n)) skipped.push({ input, reason: "Bir firmaya elle atanmış" });
        else {
          this.db.prepare("INSERT INTO phone_pool (number, status, note, added_at, renew_at) VALUES (?, 'available', ?, ?, ?)").run(n, opts.note?.trim() || null, opts.nowMs, opts.renewAt ?? null);
          seen.add(n);
          added.push(n);
        }
      }
    });
    return { added, skipped };
  }

  /** Süresi dolan karantinadaki numaralar yeniden müsait olur */
  promoteExpired(nowMs: number): number {
    return Number(this.db.prepare("UPDATE phone_pool SET status = 'available', released_at = NULL, quarantine_until = NULL WHERE status = 'quarantine' AND quarantine_until <= ?").run(nowMs).changes);
  }

  /**
   * Firmaya havuzdan numara verir: en eski müsait numara. Firmanın zaten havuz numarası varsa aynısını döner (tekrar çağrılabilir).
   * Boşsa null.
   */
  assign(tenantId: string, nowMs: number): { number: string; created: boolean } | null {
    return this.tx(() => {
      const have = this.forTenant(tenantId);
      if (have) return { number: have.number, created: false };
      const row = this.db.prepare("SELECT number FROM phone_pool WHERE status = 'available' AND kind = 'real' ORDER BY added_at, number LIMIT 1").get() as { number: string } | undefined;
      if (!row) return null;
      this.db.prepare("UPDATE phone_pool SET status = 'assigned', tenant_id = ?, assigned_at = ?, released_at = NULL, quarantine_until = NULL WHERE number = ? AND status = 'available'").run(tenantId, nowMs, row.number);
      return { number: row.number, created: true };
    });
  }

  /**
   * Firmaya **deneme numarası** verir (canlı satın alma akışını gerçek numara almadan denemek için). Numara sanaldır:
   * ElevenLabs'e bağlanmaz, arama karşılamaz, otomatik atamada hiç seçilmez. Firmanın zaten numarası varsa aynısını döner.
   */
  assignTest(tenantId: string, nowMs: number): { number: string; created: boolean } {
    return this.tx(() => {
      const have = this.forTenant(tenantId);
      if (have) return { number: have.number, created: false };
      const last = this.db.prepare("SELECT MAX(number) AS n FROM phone_pool WHERE kind = 'test'").get() as { n: string | null };
      const seq = last.n ? Number(last.n.slice(TEST_PREFIX.length)) + 1 : 1;
      const number = `${TEST_PREFIX}${String(seq).padStart(4, "0")}`;
      this.db.prepare("INSERT INTO phone_pool (number, kind, status, tenant_id, note, added_at, assigned_at) VALUES (?, 'test', 'assigned', ?, 'Deneme numarası (gerçek değil)', ?, ?)").run(number, tenantId, nowMs, nowMs);
      return { number, created: true };
    });
  }

  /** Yöneticinin elle yazdığı numara havuzda müsaitse atanmış olarak işaretlenir (envanter doğru kalsın) */
  markAssigned(number: string, tenantId: string, nowMs: number): boolean {
    return Number(this.db.prepare("UPDATE phone_pool SET status = 'assigned', tenant_id = ?, assigned_at = ?, released_at = NULL, quarantine_until = NULL WHERE number = ? AND status = 'available'").run(tenantId, nowMs, number).changes) > 0;
  }

  /** Atanmış numarayı karantinaya alır (kimseye verilmez, süre dolunca müsait olur). Deneme numarası karantinaya girmez, silinir. */
  release(number: string, nowMs: number): boolean {
    const row = this.get(number);
    if (row?.kind === "test") return row.status === "assigned" && Number(this.db.prepare("DELETE FROM phone_pool WHERE number = ? AND kind = 'test'").run(number).changes) > 0;
    return Number(this.db.prepare("UPDATE phone_pool SET status = 'quarantine', tenant_id = NULL, released_at = ?, quarantine_until = ? WHERE number = ? AND status = 'assigned'").run(nowMs, nowMs + POOL.quarantineDays * DAY, number).changes) > 0;
  }

  /** Müsait ya da karantinadaki numarayı kalıcı olarak havuzdan çıkarır (Netgsm'de aboneliği bırakılan numara) */
  retire(number: string): boolean {
    return Number(this.db.prepare("UPDATE phone_pool SET status = 'retired', tenant_id = NULL, quarantine_until = NULL WHERE number = ? AND status IN ('available', 'quarantine')").run(number).changes) > 0;
  }

  setMeta(number: string, meta: { note?: string | null; renewAt?: number | null }): boolean {
    const cur = this.get(number);
    if (!cur) return false;
    this.db.prepare("UPDATE phone_pool SET note = ?, renew_at = ? WHERE number = ?").run(meta.note === undefined ? cur.note : meta.note, meta.renewAt === undefined ? cur.renewAt : meta.renewAt, number);
    return true;
  }

  /** Yenilemesi yaklaşan (ya da geçmiş) numaralar; emekli olanlar sayılmaz */
  renewalsDue(nowMs: number): PoolRow[] {
    return (this.db.prepare("SELECT * FROM phone_pool WHERE kind = 'real' AND renew_at IS NOT NULL AND renew_at <= ? AND status != 'retired' ORDER BY renew_at").all(nowMs + POOL.renewalReminderDays * DAY) as Raw[]).map(toRow);
  }
}
