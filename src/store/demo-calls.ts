import type { DatabaseSync } from "node:sqlite";

export type DemoStatus = "calling" | "done" | "unanswered" | "failed" | "blocked";
export type DemoEnd = "agent" | "caller" | "limit" | "other";

export interface DemoCallRow {
  id: string;
  phone: string;
  ip: string | null;
  status: DemoStatus;
  blockReason: string | null;
  error: string | null;
  conversationId: string | null;
  attempt: number | null;
  durationSecs: number | null;
  endedBy: DemoEnd | null;
  booked: boolean;
  createdAt: number;
  finishedAt: number | null;
}

interface Raw {
  id: string; phone: string; ip: string | null; status: string; block_reason: string | null; error: string | null;
  conversation_id: string | null; attempt: number | null; duration_secs: number | null; ended_by: string | null;
  booked: number; created_at: number; finished_at: number | null;
}

const map = (r: Raw): DemoCallRow => ({
  id: r.id, phone: r.phone, ip: r.ip, status: r.status as DemoStatus, blockReason: r.block_reason, error: r.error,
  conversationId: r.conversation_id, attempt: r.attempt, durationSecs: r.duration_secs, endedBy: r.ended_by as DemoEnd | null,
  booked: r.booked === 1, createdAt: r.created_at, finishedAt: r.finished_at,
});

/** Gerçekten aranan (veya aranmaya çalışılıp ulaşılamayan) çağrılar: sınırlara sayılır. "failed" bizim hatamızdır, "blocked" hiç aranmamıştır. */
const COUNTED = "('calling','done','unanswered')";

/** Landing sayfası test görüşmeleri: kayıt ve sınır sayaçları */
export class DemoCalls {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /** Bu numaraya daha önce kaç kez arama yapıldı */
  countForPhone(phone: string): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM demo_calls WHERE phone = ? AND status IN ${COUNTED}`).get(phone) as { n: number }).n;
  }

  /** Bu numarada şu an süren (henüz sonucu gelmemiş) arama var mı */
  hasActive(phone: string, sinceMs: number): boolean {
    return !!this.db.prepare(`SELECT 1 FROM demo_calls WHERE phone = ? AND status = 'calling' AND created_at > ?`).get(phone, sinceMs);
  }

  countForIp(ip: string, sinceMs: number): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM demo_calls WHERE ip = ? AND created_at > ? AND status IN ${COUNTED}`).get(ip, sinceMs) as { n: number }).n;
  }

  /** Bir IP'nin sonuç fark etmeksizin (engellenenler dahil) yaptığı istek sayısı: tekrar tekrar deneyen botları keser */
  attemptsForIp(ip: string, sinceMs: number): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM demo_calls WHERE ip = ? AND created_at > ?`).get(ip, sinceMs) as { n: number }).n;
  }

  countSince(sinceMs: number): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM demo_calls WHERE created_at > ? AND status IN ${COUNTED}`).get(sinceMs) as { n: number }).n;
  }

  insert(r: { id: string; phone: string; ip?: string | null; status: DemoStatus; blockReason?: string; attempt?: number; atMs: number }) {
    this.db
      .prepare(`INSERT INTO demo_calls (id, phone, ip, status, block_reason, attempt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(r.id, r.phone, r.ip ?? null, r.status, r.blockReason ?? null, r.attempt ?? null, r.atMs);
  }

  /** Arama başlatılamadı (bizim hatamız): sayaca girmez */
  markFailed(id: string, error: string, atMs: number) {
    this.db.prepare(`UPDATE demo_calls SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`).run(error.slice(0, 300), atMs, id);
  }

  setConversation(id: string, conversationId: string) {
    this.db.prepare(`UPDATE demo_calls SET conversation_id = ? WHERE id = ?`).run(conversationId, id);
  }

  /** Görüşme bitti (post-call): süre, kim kapattı, randevu alındı mı */
  finish(conversationId: string, f: { durationSecs: number | undefined; endedBy: DemoEnd; booked: boolean; atMs: number }): boolean {
    const r = this.db
      .prepare(`UPDATE demo_calls SET status = 'done', duration_secs = ?, ended_by = ?, booked = ?, finished_at = ? WHERE conversation_id = ?`)
      .run(f.durationSecs ?? null, f.endedBy, f.booked ? 1 : 0, f.atMs, conversationId);
    return Number(r.changes) > 0;
  }

  /** Telefon açılmadı / meşgul / ulaşılamadı */
  markUnanswered(conversationId: string, reason: string, atMs: number): boolean {
    const r = this.db
      .prepare(`UPDATE demo_calls SET status = 'unanswered', error = ?, finished_at = ? WHERE conversation_id = ? AND status = 'calling'`)
      .run(reason.slice(0, 200), atMs, conversationId);
    return Number(r.changes) > 0;
  }

  list(limit = 200): DemoCallRow[] {
    return (this.db.prepare(`SELECT * FROM demo_calls ORDER BY created_at DESC LIMIT ?`).all(limit) as unknown as Raw[]).map(map);
  }

  stats(sinceMs: number, staleMs: number, nowMs: number) {
    const q = (sql: string, ...args: (string | number)[]) => (this.db.prepare(sql).get(...args) as { n: number }).n;
    const base = `FROM demo_calls WHERE created_at > ?`;
    return {
      requests: q(`SELECT COUNT(*) AS n ${base}`, sinceMs),
      calls: q(`SELECT COUNT(*) AS n ${base} AND status IN ${COUNTED}`, sinceMs),
      uniquePhones: q(`SELECT COUNT(DISTINCT phone) AS n ${base} AND status IN ${COUNTED}`, sinceMs),
      answered: q(`SELECT COUNT(*) AS n ${base} AND status = 'done'`, sinceMs),
      unanswered: q(`SELECT COUNT(*) AS n ${base} AND status = 'unanswered'`, sinceMs),
      reachedEnd: q(`SELECT COUNT(*) AS n ${base} AND status = 'done' AND ended_by IN ('agent','limit')`, sinceMs),
      booked: q(`SELECT COUNT(*) AS n ${base} AND status = 'done' AND booked = 1`, sinceMs),
      blocked: q(`SELECT COUNT(*) AS n ${base} AND status = 'blocked'`, sinceMs),
      failed: q(`SELECT COUNT(*) AS n ${base} AND status = 'failed'`, sinceMs),
      // Sonucu hiç gelmeyen (post-call kaybolmuş) aramalar
      unknown: q(`SELECT COUNT(*) AS n ${base} AND status = 'calling' AND created_at < ?`, sinceMs, nowMs - staleMs),
      totalSecs: q(`SELECT COALESCE(SUM(duration_secs), 0) AS n ${base} AND status = 'done'`, sinceMs),
    };
  }
}
