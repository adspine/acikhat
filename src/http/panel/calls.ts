import { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "../deps.ts";
import { type PanelEnv, requirePermission } from "./session.ts";
import { OUTCOME_LABELS } from "../../domain/call-outcome.ts";
import type { Tenant } from "../../domain/tenant.ts";
import { hhmm, phoneText, relativeDate, userName, zdt } from "./views.ts";

/** Dökümde araç çağrılarının panelde görünen hali */
const TOOL_EVENTS: Record<string, string> = {
  check_availability: "Uygun saatlere baktı",
  book_appointment: "Randevuyu yazdı",
  log_callback_request: "Geri arama notu bıraktı",
  transfer_to_number: "Yetkiliye aktardı",
  end_call: "Görüşmeyi bitirdi",
};

type CallRow = {
  conversation_id: string; started_at: number | null; duration_secs: number | null; outcome: string | null;
  summary: string | null; caller_phone: string | null; after_hours: number | null; appointment_id: string | null;
};
type MissedRow = { call_sid: string; started_at: number; caller_phone: string | null; result: string | null };

const MISSED_REASONS: Record<string, string> = {
  timeout: "Hat doluyken beklerken kapattı veya görüşme kurulamadı",
  busy: "Hat meşguldü",
  no_answer: "Cevap verilemedi",
  failed: "Bağlantı kurulamadı",
};

export function callView(tenant: Tenant, r: CallRow, nowMs: number) {
  const at = r.started_at ?? 0;
  const outcome = (r.outcome ?? "info") as keyof typeof OUTCOME_LABELS;
  return {
    id: r.conversation_id,
    kind: "call" as const,
    at,
    dayText: relativeDate(tenant, at, nowMs),
    timeText: hhmm(zdt(tenant, at)),
    callerPhone: r.caller_phone,
    phoneText: phoneText(r.caller_phone) ?? "Numara bilinmiyor",
    durationSecs: r.duration_secs,
    outcome,
    outcomeLabel: OUTCOME_LABELS[outcome],
    summary: r.summary,
    afterHours: r.after_hours === 1,
    appointmentId: r.appointment_id,
  };
}

export function missedView(tenant: Tenant, r: MissedRow, nowMs: number) {
  return {
    id: r.call_sid,
    kind: "missed" as const,
    at: r.started_at,
    dayText: relativeDate(tenant, r.started_at, nowMs),
    timeText: hhmm(zdt(tenant, r.started_at)),
    callerPhone: r.caller_phone,
    phoneText: phoneText(r.caller_phone) ?? "Gizli numara",
    durationSecs: null,
    outcome: "missed" as const,
    outcomeLabel: OUTCOME_LABELS.missed,
    summary: MISSED_REASONS[r.result ?? "timeout"] ?? r.result,
    afterHours: false,
    appointmentId: null,
  };
}

export function callRoutes(deps: Deps) {
  const app = new Hono<PanelEnv>();
  const db = deps.store.db;

  app.get("/calls", requirePermission("calls.view"), (c) => {
    const tenant = c.get("tenant");
    const nowMs = deps.now().epochMilliseconds;
    const today = deps.now().withTimeZone(tenant.timezone).toPlainDate();
    const from = Temporal.PlainDate.from(c.req.query("from") ?? today.subtract({ days: 6 }).toString());
    const to = Temporal.PlainDate.from(c.req.query("to") ?? today.toString());
    const fromMs = from.toZonedDateTime(tenant.timezone).epochMilliseconds;
    const toMs = to.add({ days: 1 }).toZonedDateTime(tenant.timezone).epochMilliseconds;
    const outcome = c.req.query("outcome");
    const digits = (c.req.query("q") ?? "").replace(/\D/g, "").replace(/^0/, "");

    const calls = (db
      .prepare(
        `SELECT conversation_id, started_at, duration_secs, outcome, summary, caller_phone, after_hours, appointment_id
         FROM calls WHERE tenant_id = ? AND started_at >= ? AND started_at < ? ORDER BY started_at DESC LIMIT 500`,
      )
      .all(tenant.id, fromMs, toMs) as unknown as CallRow[]).map((r) => callView(tenant, r, nowMs));
    const missed = (db
      .prepare(
        `SELECT call_sid, started_at, caller_phone, result FROM call_log
         WHERE tenant_id = ? AND status = 'missed' AND started_at >= ? AND started_at < ? ORDER BY started_at DESC LIMIT 500`,
      )
      .all(tenant.id, fromMs, toMs) as unknown as MissedRow[]).map((r) => missedView(tenant, r, nowMs));

    const items = [...calls, ...missed]
      .filter((x) => !outcome || x.outcome === outcome)
      .filter((x) => !digits || (x.callerPhone ?? "").includes(digits))
      .sort((a, b) => b.at - a.at);
    return c.json({ from: from.toString(), to: to.toString(), items });
  });

  app.get("/calls/:id", requirePermission("calls.view"), (c) => {
    const tenant = c.get("tenant");
    const row = db
      .prepare(
        `SELECT conversation_id, started_at, duration_secs, outcome, summary, caller_phone, after_hours, appointment_id, payload_json
         FROM calls WHERE tenant_id = ? AND conversation_id = ?`,
      )
      .get(tenant.id, c.req.param("id")) as (CallRow & { payload_json: string }) | undefined;
    if (!row) return c.json({ error: "Görüşme bulunamadı" }, 404);
    const data = (JSON.parse(row.payload_json) as { data?: { transcript?: unknown[] } }).data ?? {};
    const transcript: { role: "agent" | "user" | "event"; text: string; second: number }[] = [];
    for (const t of (data.transcript ?? []) as {
      role?: string; message?: string | null; time_in_call_secs?: number; tool_calls?: { tool_name?: string }[];
    }[]) {
      for (const call of t.tool_calls ?? []) {
        const text = TOOL_EVENTS[call.tool_name ?? ""];
        if (text) transcript.push({ role: "event", text, second: t.time_in_call_secs ?? 0 });
      }
      const msg = t.message?.trim();
      if (msg && msg !== "...") transcript.push({ role: t.role === "user" ? "user" : "agent", text: msg, second: t.time_in_call_secs ?? 0 });
    }
    return c.json({ ...callView(tenant, row, deps.now().epochMilliseconds), transcript });
  });

  // ---- geri aramalar ----
  type CallbackRow = {
    id: string; name: string | null; phone: string | null; reason: string; conversation_id: string | null;
    status: string; created_at: number; closed_at: number | null; closed_by: string | null; close_note: string | null;
  };
  const callbackView = (tenant: Tenant, r: CallbackRow, nowMs: number) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    phoneText: phoneText(r.phone),
    reason: r.reason,
    // Yalnızca dökümü olan görüşmeye bağlantı ver (kaçan çağrıda burada çağrı kimliği durur)
    conversationId:
      r.conversation_id && db.prepare("SELECT 1 FROM calls WHERE conversation_id = ?").get(r.conversation_id) ? r.conversation_id : null,
    status: r.status as "open" | "closed",
    at: r.created_at,
    dayText: relativeDate(tenant, r.created_at, nowMs),
    timeText: hhmm(zdt(tenant, r.created_at)),
    closedAt: r.closed_at,
    closedBy: userName(db, r.closed_by),
    closeNote: r.close_note,
  });

  app.get("/callbacks", requirePermission("calls.view"), (c) => {
    const tenant = c.get("tenant");
    const status = c.req.query("status") === "closed" ? "closed" : "open";
    const rows = db
      .prepare(`SELECT * FROM callback_requests WHERE tenant_id = ? AND status = ? ORDER BY created_at ${status === "open" ? "ASC" : "DESC"} LIMIT 300`)
      .all(tenant.id, status) as unknown as CallbackRow[];
    const nowMs = deps.now().epochMilliseconds;
    return c.json({ status, items: rows.map((r) => callbackView(tenant, r, nowMs)) });
  });

  app.post("/callbacks/:id/close", requirePermission("callbacks.edit"), async (c) => {
    const tenant = c.get("tenant");
    const user = c.get("user");
    const body = z.object({ note: z.string().trim().max(500).optional() }).safeParse(await c.req.json().catch(() => ({})));
    const id = c.req.param("id");
    const res = db
      .prepare("UPDATE callback_requests SET status = 'closed', closed_at = ?, closed_by = ?, close_note = ? WHERE tenant_id = ? AND id = ? AND status = 'open'")
      .run(Date.now(), user.id, (body.success && body.data.note) || null, tenant.id, id);
    if (!res.changes) return c.json({ error: "Kayıt bulunamadı veya zaten kapatılmış" }, 404);
    deps.store.audit({ tenantId: tenant.id, userId: user.id, action: "callback.close", target: id });
    const row = db.prepare("SELECT * FROM callback_requests WHERE id = ?").get(id) as unknown as CallbackRow;
    return c.json(callbackView(tenant, row, deps.now().epochMilliseconds));
  });

  app.post("/callbacks/:id/reopen", requirePermission("callbacks.edit"), (c) => {
    const tenant = c.get("tenant");
    const id = c.req.param("id");
    const res = db
      .prepare("UPDATE callback_requests SET status = 'open', closed_at = NULL, closed_by = NULL, close_note = NULL WHERE tenant_id = ? AND id = ?")
      .run(tenant.id, id);
    if (!res.changes) return c.json({ error: "Kayıt bulunamadı" }, 404);
    deps.store.audit({ tenantId: tenant.id, userId: c.get("user").id, action: "callback.reopen", target: id });
    const row = db.prepare("SELECT * FROM callback_requests WHERE id = ?").get(id) as unknown as CallbackRow;
    return c.json(callbackView(tenant, row, deps.now().epochMilliseconds));
  });

  return app;
}
