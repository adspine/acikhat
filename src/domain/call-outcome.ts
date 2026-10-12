import type { Tenant, WeekHours } from "./tenant.ts";
import { normalizeTrPhone } from "./phone.ts";

export type CallOutcome = "booked" | "callback" | "transferred" | "info";

export const OUTCOME_LABELS: Record<CallOutcome | "missed", string> = {
  booked: "Randevu alındı",
  callback: "Geri arama istendi",
  transferred: "Yetkiliye aktarıldı",
  info: "Bilgi verildi",
  missed: "Kaçan çağrı",
};

interface TranscriptTurn {
  role?: string;
  tool_calls?: { tool_name?: string }[];
  tool_results?: { tool_name?: string; result_value?: string; is_error?: boolean }[];
}

export interface PostCallData {
  conversation_id?: string;
  agent_id?: string;
  transcript?: TranscriptTurn[];
  metadata?: {
    start_time_unix_secs?: number;
    call_duration_secs?: number;
    phone_call?: { external_number?: string; call_sid?: string; call_result?: string | null } | null;
  };
  conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> };
}

/** Çalışma saatleri dışında mı (kapalı gün dahil) */
export function isAfterHours(tenant: Tenant, startMs: number): boolean {
  const z = Temporal.Instant.fromEpochMilliseconds(startMs).toZonedDateTimeISO(tenant.timezone);
  if (tenant.closedDates.includes(z.toPlainDate().toString())) return true;
  const windows = tenant.hours[String(z.dayOfWeek) as keyof WeekHours];
  const t = z.toPlainTime();
  return !windows.some(
    ([from, to]) => Temporal.PlainTime.compare(Temporal.PlainTime.from(from), t) <= 0 && Temporal.PlainTime.compare(t, Temporal.PlainTime.from(to)) < 0,
  );
}

/**
 * Görüşme dökümündeki araç çağrılarından sonucu çıkarır.
 * Öncelik: randevu > aktarma > geri arama > bilgi (bir görüşmede birden fazlası olabilir).
 */
export function analyzeCall(tenant: Tenant | undefined, d: PostCallData) {
  let appointmentId: string | null = null;
  let transferred = false;
  let callback = false;
  for (const turn of d.transcript ?? []) {
    for (const call of turn.tool_calls ?? []) {
      if (call.tool_name === "transfer_to_number") transferred = true;
      if (call.tool_name === "log_callback_request") callback = true;
    }
    for (const r of turn.tool_results ?? []) {
      if (r.tool_name !== "book_appointment" || r.is_error) continue;
      try {
        const v = JSON.parse(r.result_value ?? "{}") as { ok?: boolean; appointment_id?: string };
        if (v.ok && v.appointment_id) appointmentId = v.appointment_id;
      } catch {
        // araç cevabı JSON değilse yok say
      }
    }
  }
  const outcome: CallOutcome = appointmentId ? "booked" : transferred ? "transferred" : callback ? "callback" : "info";
  const vars = d.conversation_initiation_client_data?.dynamic_variables ?? {};
  const callerPhone = normalizeTrPhone(d.metadata?.phone_call?.external_number ?? (vars.caller_phone as string | undefined));
  const startMs = d.metadata?.start_time_unix_secs ? d.metadata.start_time_unix_secs * 1000 : null;
  return {
    outcome,
    appointmentId,
    callerPhone,
    afterHours: tenant && startMs ? isAfterHours(tenant, startMs) : null,
  };
}
