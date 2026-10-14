import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { BusyBlock } from "../domain/slots.ts";
import type { PendingRow } from "../calendar/calendars.ts";

export const splitIds = (s: string | null | undefined) => (s ? s.split(",").filter(Boolean) : []);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS appointments (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  service_id       TEXT NOT NULL,
  staff_id         TEXT NOT NULL,
  room_id          TEXT NOT NULL,
  start_ms         INTEGER NOT NULL,
  end_ms           INTEGER NOT NULL,
  block_end_ms     INTEGER NOT NULL,
  customer_name    TEXT NOT NULL,
  customer_phone   TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'confirmed',
  conversation_id  TEXT,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS appt_tenant_time ON appointments (tenant_id, status, start_ms);

CREATE TABLE IF NOT EXISTS callback_requests (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  name             TEXT,
  phone            TEXT,
  reason           TEXT NOT NULL,
  conversation_id  TEXT,
  status           TEXT NOT NULL DEFAULT 'open',
  created_at       INTEGER NOT NULL
);

-- Gelen her telefon çağrısı (init webhook anında). Biten görüşme post-call ile eşleşir;
-- eşleşmeyenler (kuyrukta kapatan, kurulamayan) "missed" olur.
CREATE TABLE IF NOT EXISTS call_log (
  call_sid         TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  agent_id         TEXT,
  caller_phone     TEXT,
  called_number    TEXT,
  status           TEXT NOT NULL DEFAULT 'started',   -- started | completed | missed
  result           TEXT,                              -- answered | busy | failed | no_answer | timeout ...
  conversation_id  TEXT,
  started_at       INTEGER NOT NULL,
  ended_at         INTEGER
);
CREATE INDEX IF NOT EXISTS call_log_open ON call_log (status, started_at);

-- Web sitesinden gelen firma bilgi formları. Kontrol edildikten sonra tenants/<id>.json'a dönüştürülür.
CREATE TABLE IF NOT EXISTS onboarding_submissions (
  reference        TEXT PRIMARY KEY,
  business_name    TEXT NOT NULL,
  contact_phone    TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'new',   -- new | reviewing | live
  payload_json     TEXT NOT NULL,
  created_at       INTEGER NOT NULL
);

-- İşlenmiş Polar webhook olayları (tekrar gelen olay ikinci kez işlenmesin); 30 günden eskisi silinir
CREATE TABLE IF NOT EXISTS webhook_events (
  id          TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);

-- Hat havuzu: Netgsm'den toplu alınan 0850 numaralarının envanteri. Çağrı eşlemesinin kaynağı yine tenant.phoneNumbers'tır;
-- bu tablo hangi numaranın boş, atanmış ya da karantinada olduğunu ve yıllık yenileme tarihini tutar.
CREATE TABLE IF NOT EXISTS phone_pool (
  number           TEXT PRIMARY KEY,                 -- E.164
  status           TEXT NOT NULL DEFAULT 'available', -- available | assigned | quarantine | retired
  tenant_id        TEXT,
  note             TEXT,
  added_at         INTEGER NOT NULL,
  assigned_at      INTEGER,
  released_at      INTEGER,
  quarantine_until INTEGER,
  renew_at         INTEGER,
  kind             TEXT NOT NULL DEFAULT 'real'       -- real | test (deneme numarası: gerçek değil, ElevenLabs'e bağlanmaz)
);
CREATE INDEX IF NOT EXISTS phone_pool_status ON phone_pool (status, added_at);
CREATE INDEX IF NOT EXISTS phone_pool_tenant ON phone_pool (tenant_id);

-- Müşteriye gönderilen tekrarsız bildirimler (kota uyarısı gibi): aynı uyarı aynı dönemde bir kez gider
CREATE TABLE IF NOT EXISTS notice_log (
  tenant_id  TEXT NOT NULL,
  kind       TEXT NOT NULL,
  period     TEXT NOT NULL,
  sent_at    INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, kind, period)
);

-- Panelden yapılan satın almalar: paket yükseltme ve ek dakika paketi (ödeme sağlayıcısı bağlanınca provider_ref dolar)
CREATE TABLE IF NOT EXISTS orders (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  user_id      TEXT,
  kind         TEXT NOT NULL,                 -- plan | addon
  item         TEXT NOT NULL,                 -- paket kimliği
  label        TEXT NOT NULL,
  minutes      INTEGER NOT NULL DEFAULT 0,    -- ek paketlerde eklenen dakika
  amount_usd   REAL NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | paid | failed
  period       TEXT NOT NULL,                 -- YYYY-MM: ek dakikanın geçerli olduğu fatura dönemi
  provider_ref TEXT,
  created_at   INTEGER NOT NULL,
  paid_at      INTEGER
);
CREATE INDEX IF NOT EXISTS orders_tenant ON orders (tenant_id, created_at);

-- Firma ayarları: canlı (asistanın kullandığı) ve taslak (panelde düzenlenen, yayınlanmamış)
CREATE TABLE IF NOT EXISTS tenants (
  id               TEXT PRIMARY KEY,
  config_live      TEXT NOT NULL,
  config_draft     TEXT,
  version          INTEGER NOT NULL DEFAULT 1,
  published_at     INTEGER,
  updated_at       INTEGER NOT NULL
);

-- Panel kullanıcıları. tenant_id boşsa ajans (yönetim) kullanıcısı.
CREATE TABLE IF NOT EXISTS users (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT,
  email                 TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name                  TEXT NOT NULL,
  role                  TEXT NOT NULL,          -- owner | team | agency
  password_hash         TEXT NOT NULL,
  must_change_password  INTEGER NOT NULL DEFAULT 1,
  disabled              INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL,
  last_login_at         INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Kim, ne zaman, neyi değiştirdi (randevu iptali, fiyat değişikliği, yayınlama...)
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   TEXT,
  user_id     TEXT,
  action      TEXT NOT NULL,
  target      TEXT,
  detail_json TEXT,
  at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_tenant ON audit_log (tenant_id, at);

-- Landing sayfasındaki "test görüşmesi": ziyaretçinin numarasını 0850 hattımızdan arayan demo çağrıları (yönetici panelinde izlenir)
CREATE TABLE IF NOT EXISTS demo_calls (
  id               TEXT PRIMARY KEY,
  phone            TEXT NOT NULL,
  ip               TEXT,
  status           TEXT NOT NULL,   -- calling | done | unanswered | failed | blocked
  block_reason     TEXT,            -- limit | busy | ip | daily | hours
  error            TEXT,
  conversation_id  TEXT,
  attempt          INTEGER,         -- bu numaranın kaçıncı denemesi
  duration_secs    INTEGER,
  ended_by         TEXT,            -- agent | caller | limit | other
  booked           INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  finished_at      INTEGER
);
CREATE INDEX IF NOT EXISTS demo_calls_phone ON demo_calls (phone, created_at);
CREATE INDEX IF NOT EXISTS demo_calls_time ON demo_calls (created_at);
CREATE INDEX IF NOT EXISTS demo_calls_conv ON demo_calls (conversation_id);

CREATE TABLE IF NOT EXISTS calls (
  conversation_id  TEXT PRIMARY KEY,
  tenant_id        TEXT,
  agent_id         TEXT,
  started_at       INTEGER,
  duration_secs    INTEGER,
  call_successful  TEXT,
  summary          TEXT,
  payload_json     TEXT NOT NULL,
  received_at      INTEGER NOT NULL
);
`;

export interface NewAppointment {
  tenantId: string;
  serviceId: string;
  staffId: string;
  /** Çok terapistli hizmette diğer terapistler (çift masajı) */
  extraStaffIds?: string[] | undefined;
  roomId: string;
  startMs: number;
  endMs: number;
  blockEndMs: number;
  customerName: string;
  customerPhone: string;
  conversationId?: string | undefined;
  source?: "assistant" | "panel";
  note?: string | undefined;
}

export interface AppointmentRow {
  id: string; tenant_id: string; service_id: string; staff_id: string; extra_staff_ids: string; room_id: string;
  start_ms: number; end_ms: number; block_end_ms: number; customer_name: string; customer_phone: string;
  status: string; conversation_id: string | null; calendar_event_id: string | null; source: string; note: string | null;
  cancelled_at: number | null; cancelled_by: string | null; created_at: number;
}

export interface Appointment {
  id: string; serviceId: string; staffId: string; extraStaffIds: string[]; roomId: string;
  startMs: number; endMs: number; blockEndMs: number; customerName: string; customerPhone: string;
  status: "confirmed" | "cancelled"; conversationId: string | null; calendarEventId: string | null;
  source: "assistant" | "panel"; note: string | null; cancelledAt: number | null; cancelledBy: string | null; createdAt: number;
}

export const toAppointment = (r: AppointmentRow): Appointment => ({
  id: r.id, serviceId: r.service_id, staffId: r.staff_id, extraStaffIds: splitIds(r.extra_staff_ids), roomId: r.room_id,
  startMs: r.start_ms, endMs: r.end_ms, blockEndMs: r.block_end_ms, customerName: r.customer_name, customerPhone: r.customer_phone,
  status: r.status as Appointment["status"], conversationId: r.conversation_id, calendarEventId: r.calendar_event_id,
  source: (r.source as Appointment["source"]) ?? "assistant", note: r.note, cancelledAt: r.cancelled_at, cancelledBy: r.cancelled_by,
  createdAt: r.created_at,
});

export type BookResult = { ok: true; id: string; duplicate: boolean } | { ok: false; reason: "conflict" };

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;");
    this.db.exec(SCHEMA);
    // Sonradan eklenen sütunlar (mevcut veritabanlarını bozmadan)
    this.addColumns("appointments", {
      calendar_event_id: "TEXT",
      extra_staff_ids: "TEXT NOT NULL DEFAULT ''", // virgülle ayrılmış ek terapistler (çift masajı)
      source: "TEXT NOT NULL DEFAULT 'assistant'", // assistant | panel
      note: "TEXT",
      cancelled_at: "INTEGER",
      cancelled_by: "TEXT",
    });
    this.addColumns("callback_requests", { closed_at: "INTEGER", closed_by: "TEXT", close_note: "TEXT" });
    this.addColumns("calls", {
      outcome: "TEXT", // booked | callback | transferred | info | missed
      caller_phone: "TEXT",
      appointment_id: "TEXT",
      after_hours: "INTEGER",
    });
    this.addColumns("users", { firebase_uid: "TEXT", plan: "TEXT", plan_paid_at: "INTEGER", onboarding_ref: "TEXT", notify_email: "INTEGER NOT NULL DEFAULT 1", polar_subscription_id: "TEXT" });
    this.addColumns("phone_pool", { kind: "TEXT NOT NULL DEFAULT 'real'" });
    this.addColumns("onboarding_submissions", { user_id: "TEXT", plan: "TEXT", tenant_id: "TEXT", admin_note: "TEXT" });
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_firebase_uid ON users (firebase_uid) WHERE firebase_uid IS NOT NULL");
    this.db.exec("CREATE INDEX IF NOT EXISTS calls_tenant_time ON calls (tenant_id, started_at)");
    this.db.exec("CREATE INDEX IF NOT EXISTS callbacks_tenant ON callback_requests (tenant_id, status, created_at)");
  }

  private addColumns(table: string, columns: Record<string, string>) {
    const have = new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
    for (const [name, type] of Object.entries(columns)) {
      if (!have.has(name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }

  /** unsyncedOnly: yalnızca dış takvime henüz yazılmamış randevular (Google firmalarında takvim asıl kaynaktır) */
  busyBlocks(tenantId: string, fromMs: number, toMs: number, opts: { unsyncedOnly?: boolean } = {}): BusyBlock[] {
    return this.db
      .prepare(
        `SELECT staff_id, extra_staff_ids, room_id, start_ms, block_end_ms FROM appointments
         WHERE tenant_id = ? AND status = 'confirmed' AND start_ms < ? AND block_end_ms > ?
         ${opts.unsyncedOnly ? "AND calendar_event_id IS NULL" : ""}`,
      )
      .all(tenantId, toMs, fromMs)
      .flatMap((r) => {
        const startMs = r.start_ms as number;
        const endMs = r.block_end_ms as number;
        // Oda yalnızca bir kez tutulur; ek terapistler odasız blok ("-" hiçbir odayla eşleşmez)
        return [
          { staffId: r.staff_id as string, roomId: r.room_id as string, startMs, endMs },
          ...splitIds(r.extra_staff_ids as string).map((staffId) => ({ staffId, roomId: "-", startMs, endMs })),
        ];
      });
  }

  /**
   * Uygunluğu işlem içinde yeniden kontrol edip yazar: iki eşzamanlı çağrı aynı slotu alamaz.
   * Aynı görüşmede aynı slot tekrar gönderilirse (araç yeniden denemesi) mevcut kaydı döner.
   */
  /**
   * ignoreSynced: dış takvime yazılmış randevuları çakışma kontrolünde sayma (onları takvim kontrolü
   * zaten gördü; takvimden silinen bir randevu burada yer tutmaya devam etmesin). Henüz yazılmamış
   * olanlar sayılır: aynı anda gelen iki çağrının aynı slotu alması böylece engellenir.
   */
  bookAtomic(a: NewAppointment, opts: { ignoreSynced?: boolean } = {}): BookResult {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (a.conversationId) {
        const dup = this.db
          .prepare(
            `SELECT id FROM appointments WHERE tenant_id = ? AND conversation_id = ? AND start_ms = ? AND status = 'confirmed'`,
          )
          .get(a.tenantId, a.conversationId, a.startMs);
        if (dup) {
          this.db.exec("COMMIT");
          return { ok: true, id: dup.id as string, duplicate: true };
        }
      }
      // Aynı aralıktaki randevularda bu terapistlerden biri veya bu oda var mı
      const ours = new Set([a.staffId, ...(a.extraStaffIds ?? [])]);
      const clash = (
        this.db
          .prepare(
            `SELECT staff_id, extra_staff_ids, room_id FROM appointments
             WHERE tenant_id = ? AND status = 'confirmed'
               ${opts.ignoreSynced ? "AND calendar_event_id IS NULL" : ""}
               AND start_ms < ? AND block_end_ms > ?`,
          )
          .all(a.tenantId, a.blockEndMs, a.startMs) as { staff_id: string; extra_staff_ids: string; room_id: string }[]
      ).some((r) => r.room_id === a.roomId || [r.staff_id, ...splitIds(r.extra_staff_ids)].some((id) => ours.has(id)));
      if (clash) {
        this.db.exec("ROLLBACK");
        return { ok: false, reason: "conflict" };
      }
      const id = randomUUID();
      this.db
        .prepare(
          `INSERT INTO appointments (id, tenant_id, service_id, staff_id, extra_staff_ids, room_id, start_ms, end_ms, block_end_ms,
             customer_name, customer_phone, conversation_id, source, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id, a.tenantId, a.serviceId, a.staffId, (a.extraStaffIds ?? []).join(","), a.roomId, a.startMs, a.endMs, a.blockEndMs,
          a.customerName, a.customerPhone, a.conversationId ?? null, a.source ?? "assistant", a.note ?? null, Date.now(),
        );
      this.db.exec("COMMIT");
      return { ok: true, id, duplicate: false };
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /** Aynı görüşmede aynı saate daha önce yazılmış randevu (araç tekrarı) */
  findDuplicate(tenantId: string, conversationId: string, startMs: number): string | null {
    const row = this.db
      .prepare("SELECT id FROM appointments WHERE tenant_id = ? AND conversation_id = ? AND start_ms = ? AND status = 'confirmed'")
      .get(tenantId, conversationId, startMs) as { id: string } | undefined;
    return row?.id ?? null;
  }

  /** Kim, neyi, ne zaman değiştirdi */
  audit(e: { tenantId: string | null; userId: string | null; action: string; target?: string | undefined; detail?: unknown }) {
    this.db
      .prepare("INSERT INTO audit_log (tenant_id, user_id, action, target, detail_json, at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(e.tenantId, e.userId, e.action, e.target ?? null, e.detail === undefined ? null : JSON.stringify(e.detail), Date.now());
  }

  auditFor(tenantId: string, opts: { target?: string; actionPrefix?: string; limit?: number } = {}) {
    return this.db
      .prepare(
        `SELECT a.action, a.target, a.detail_json, a.at, u.name AS user_name FROM audit_log a
         LEFT JOIN users u ON u.id = a.user_id
         WHERE a.tenant_id = ? AND (? IS NULL OR a.target = ?) AND (? IS NULL OR a.action LIKE ? || '%')
         ORDER BY a.at DESC LIMIT ?`,
      )
      .all(tenantId, opts.target ?? null, opts.target ?? null, opts.actionPrefix ?? null, opts.actionPrefix ?? null, opts.limit ?? 50) as {
      action: string; target: string | null; detail_json: string | null; at: number; user_name: string | null;
    }[];
  }

  getAppointment(tenantId: string, id: string): Appointment | null {
    const r = this.db.prepare("SELECT * FROM appointments WHERE tenant_id = ? AND id = ?").get(tenantId, id) as AppointmentRow | undefined;
    return r ? toAppointment(r) : null;
  }

  cancelAppointment(tenantId: string, id: string, by: string, atMs: number) {
    this.db
      .prepare("UPDATE appointments SET status = 'cancelled', cancelled_at = ?, cancelled_by = ? WHERE tenant_id = ? AND id = ? AND status = 'confirmed'")
      .run(atMs, by, tenantId, id);
  }

  setCalendarEventId(appointmentId: string, eventId: string) {
    this.db.prepare("UPDATE appointments SET calendar_event_id = ? WHERE id = ?").run(eventId, appointmentId);
  }

  /** Takvime yazılamamış, henüz geçmemiş randevular */
  unsyncedAppointments(nowMs = Date.now()) {
    return this.db
      .prepare(
        `SELECT id, tenant_id, service_id, staff_id, extra_staff_ids, room_id, start_ms, end_ms, block_end_ms, customer_name, customer_phone
         FROM appointments WHERE status = 'confirmed' AND calendar_event_id IS NULL AND start_ms > ?`,
      )
      .all(nowMs) as unknown as PendingRow[];
  }

  addCallback(r: { tenantId: string; name?: string | undefined; phone?: string | null | undefined; reason: string; conversationId?: string | undefined }) {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO callback_requests (id, tenant_id, name, phone, reason, conversation_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, r.tenantId, r.name ?? null, r.phone ?? null, r.reason, r.conversationId ?? null, Date.now());
    return id;
  }

  logCallStart(c: { callSid: string; tenantId: string; agentId?: string | undefined; callerPhone?: string | null | undefined; calledNumber?: string | undefined; atMs: number }) {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO call_log (call_sid, tenant_id, agent_id, caller_phone, called_number, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(c.callSid, c.tenantId, c.agentId ?? null, c.callerPhone ?? null, c.calledNumber ?? null, c.atMs);
  }

  /** Görüşme sonu kaydı geldi. Cevaplanmadıysa (busy/failed...) missed olarak işaretlenir. */
  logCallEnd(c: { callSid: string; conversationId?: string | undefined; result?: string | undefined; atMs: number }) {
    const answered = !c.result || c.result === "answered";
    return this.db
      .prepare(
        `UPDATE call_log SET status = ?, result = ?, conversation_id = COALESCE(?, conversation_id), ended_at = ?
         WHERE call_sid = ? AND status = 'started'`,
      )
      .run(answered ? "completed" : "missed", c.result ?? "answered", c.conversationId ?? null, c.atMs, c.callSid).changes;
  }

  /**
   * Başlayıp bitiş kaydı gelmeyen çağrıları "missed" yapar ve döndürür
   * (kuyrukta bekleyip kapatan, bağlantısı kurulamayan arayanlar).
   */
  sweepMissedCalls(olderThanMs: number, nowMs: number) {
    const rows = this.db
      .prepare(`SELECT call_sid, tenant_id, caller_phone, started_at FROM call_log WHERE status = 'started' AND started_at < ?`)
      .all(olderThanMs) as { call_sid: string; tenant_id: string; caller_phone: string | null; started_at: number }[];
    const mark = this.db.prepare(`UPDATE call_log SET status = 'missed', result = 'timeout', ended_at = ? WHERE call_sid = ?`);
    for (const r of rows) mark.run(nowMs, r.call_sid);
    return rows;
  }

  saveOnboarding(s: { businessName: string; contactPhone: string; payload: unknown; userId?: string | undefined; plan?: string | undefined }): string {
    // Telefonda okunabilir kısa referans: VR-7K3Q gibi
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const code = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => alphabet[b % alphabet.length]).join("");
    const prefix = s.businessName.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, "").slice(0, 2).toLocaleUpperCase("tr") || "FR";
    const reference = `${prefix}-${code}`;
    this.db
      .prepare(
        `INSERT INTO onboarding_submissions (reference, business_name, contact_phone, payload_json, created_at, user_id, plan)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(reference, s.businessName, s.contactPhone, JSON.stringify(s.payload), Date.now(), s.userId ?? null, s.plan ?? null);
    return reference;
  }

  /** startedAtMs: milisaniye (diğer tablolarla aynı birim) */
  saveCall(c: {
    conversationId: string;
    tenantId?: string | undefined;
    agentId?: string | undefined;
    startedAtMs?: number | undefined;
    durationSecs?: number | undefined;
    callSuccessful?: string | undefined;
    summary?: string | undefined;
    outcome?: string | undefined;
    callerPhone?: string | null | undefined;
    appointmentId?: string | null | undefined;
    afterHours?: boolean | null | undefined;
    payload: unknown;
  }) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO calls (conversation_id, tenant_id, agent_id, started_at, duration_secs,
           call_successful, summary, outcome, caller_phone, appointment_id, after_hours, payload_json, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.conversationId, c.tenantId ?? null, c.agentId ?? null, c.startedAtMs ?? null, c.durationSecs ?? null,
        c.callSuccessful ?? null, c.summary ?? null, c.outcome ?? null, c.callerPhone ?? null, c.appointmentId ?? null,
        c.afterHours == null ? null : c.afterHours ? 1 : 0, JSON.stringify(c.payload), Date.now(),
      );
  }

  /**
   * Eski çağrı kayıtlarını bir kez günceller: başlangıç zamanını saniyeden milisaniyeye çevirir,
   * sonuç/arayan/mesai dışı bilgisini dökümden çıkarır.
   */
  backfillCalls(analyze: (tenantId: string | null, payload: unknown) => { outcome: string; callerPhone: string | null; appointmentId: string | null; afterHours: boolean | null }) {
    this.db.exec("UPDATE calls SET started_at = started_at * 1000 WHERE started_at IS NOT NULL AND started_at < 100000000000");
    const rows = this.db.prepare("SELECT conversation_id, tenant_id, payload_json FROM calls WHERE outcome IS NULL").all() as {
      conversation_id: string; tenant_id: string | null; payload_json: string;
    }[];
    const upd = this.db.prepare("UPDATE calls SET outcome = ?, caller_phone = ?, appointment_id = ?, after_hours = ? WHERE conversation_id = ?");
    for (const r of rows) {
      const a = analyze(r.tenant_id, (JSON.parse(r.payload_json) as { data?: unknown }).data ?? {});
      upd.run(a.outcome, a.callerPhone, a.appointmentId, a.afterHours == null ? null : a.afterHours ? 1 : 0, r.conversation_id);
    }
    return rows.length;
  }
}
