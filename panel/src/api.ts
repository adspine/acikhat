/** Sunucu uçları ve veri tipleri (src/http/panel/* ile aynı biçim) */

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : "Beklenmeyen bir hata oluştu");
    this.status = status;
    this.body = body;
  }
}

/** Yönetici bir müşterinin panelini açtığında seçili firma (yalnızca bu sekmede). Sunucu başlığı yalnızca agency rolünde dikkate alır. */
const TENANT_KEY = "acikhat-admin-tenant";
export const getAdminTenant = (): string | null => {
  try {
    return sessionStorage.getItem(TENANT_KEY);
  } catch {
    return null;
  }
};
export const setAdminTenant = (id: string | null) => {
  try {
    if (id) sessionStorage.setItem(TENANT_KEY, id);
    else sessionStorage.removeItem(TENANT_KEY);
  } catch {
    /* yok say */
  }
};

/** Oturum durumu (tanıtım sitesiyle ortak uç): kim, firması var mı */
export interface Session {
  user: { name: string; email: string; role: "owner" | "team" | "agency"; notifyEmail: boolean };
  hasTenant: boolean;
}

/** Oturum düşerse uygulama girişe döner (App bunu dinler) */
export const authEvents = new EventTarget();

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path.startsWith("/api") ? path : `/api/panel${path}`, {
    method: init.method ?? "GET",
    // x-panel: başka sitelerden gelen form gönderimlerine karşı (sunucu değişiklik isteklerinde arar)
    headers: { "x-panel": "1", ...(getAdminTenant() && { "x-tenant": getAdminTenant()! }), ...(init.body !== undefined && { "content-type": "application/json" }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) authEvents.dispatchEvent(new Event("logout"));
  if (res.status === 403 && body.mustChangePassword) authEvents.dispatchEvent(new Event("must-change-password"));
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export type Permission =
  | "appointments.view" | "appointments.edit" | "calls.view" | "callbacks.edit" | "reports.view" | "settings.edit" | "users.manage";

export interface Me {
  user: { id: string; name: string; email: string; role: "owner" | "team" | "agency"; mustChangePassword: boolean; notifyEmail: boolean };
  tenant: { id: string; name: string; vertical: string; calendar: string; suspended: boolean; voiceId: string | null };
  terms: { staffTerm: string; staffLabel: string; roomLabel: string; roomLabelPlural: string; roomTypes: Record<string, string>; teamRoleLabel: string };
  permissions: Permission[];
  services: { id: string; name: string; durationMin: number; price: number; staffCount: number }[];
  staff: { id: string; name: string; services: string[] }[];
  testCallEnabled: boolean;
}

export interface Appointment {
  id: string;
  serviceId: string;
  serviceName: string;
  price: number | null;
  staff: { id: string; name: string }[];
  room: { id: string; label: string } | null;
  date: string;
  dateText: string;
  start: string;
  end: string;
  blockEnd: string;
  startText: string;
  endText: string;
  customerName: string;
  customerPhone: string;
  phoneText: string | null;
  source: "assistant" | "panel";
  status: "confirmed" | "cancelled";
  note: string | null;
  conversationId: string | null;
  syncedToCalendar: boolean;
  createdAt: number;
  cancelledAt: number | null;
  cancelledBy: string | null;
  history?: { action: string; at: number; user: string | null; detail: Record<string, unknown> | null }[];
}

export type Outcome = "booked" | "callback" | "transferred" | "info" | "missed";

export interface CallItem {
  id: string;
  kind: "call" | "missed";
  at: number;
  dayText: string;
  timeText: string;
  callerPhone: string | null;
  phoneText: string;
  durationSecs: number | null;
  outcome: Outcome;
  outcomeLabel: string;
  summary: string | null;
  afterHours: boolean;
  appointmentId: string | null;
  /** Konuşma içinde arama yapıldıysa eşleşen yerin çevresi */
  snippet?: string;
}

export interface CallDetail extends CallItem {
  transcript: { role: "agent" | "user" | "event"; text: string; second: number }[];
}

export interface Callback {
  id: string;
  name: string | null;
  phone: string | null;
  phoneText: string | null;
  reason: string;
  conversationId: string | null;
  status: "open" | "closed";
  at: number;
  dayText: string;
  timeText: string;
  closedAt: number | null;
  closedBy: string | null;
  closeNote: string | null;
}

export interface Today {
  date: string;
  dateText: string;
  nowTime: string;
  open: boolean;
  hours: [string, string][];
  staff: { id: string; name: string; working: boolean; hours: [string, string][] }[];
  appointments: Appointment[];
  counts: { openCallbacks: number; missedToday: number; callsToday: number; bookedToday: number; appointmentsToday: number };
  recent: CallItem[];
  alerts: { level: "info" | "warning" | "error"; text: string }[];
}

export interface Report {
  from: string;
  to: string;
  fromText: string;
  toText: string;
  totals: {
    incoming: number; answered: number; missed: number; missedRate: number;
    assistantBookings: number; assistantBookingsCancelled: number; panelBookings: number;
    assistantRevenue: number; afterHoursBookings: number; afterHoursRevenue: number;
    conversionRate: number; avgDurationSecs: number; minutesUsed: number; includedMinutes: number | null;
  };
  byOutcome: Record<string, number>;
  days: { date: string; label: string; calls: number; booked: number; missed: number }[];
  byHour: { hour: number; calls: number }[];
  byWeekday: { day: number; calls: number }[];
  topServices: { name: string; count: number; revenue: number }[];
  callers: { unique: number; returning: number; fresh: number };
  missedReasons: { label: string; count: number }[];
  afterHoursCalls: number;
  /** Aynı uzunluktaki önceki dönem (karşılaştırma için) */
  previous: { incoming: number; answered: number; missed: number; booked: number; conversionRate: number; avgDurationSecs: number; minutesUsed: number };
}

export interface VoiceOption {
  id: string;
  name: string;
  gender: "female" | "male" | "neutral";
  tags: string[];
  previewUrl: string | null;
}

export interface Usage {
  plan: { id: string; name: string; priceUsd: number } | null;
  includedMinutes: number | null;
  usedMinutes: number;
  remainingMinutes: number | null;
  projectedMinutes: number;
  overageMinutes: number;
  overageUsd: number;
  projectedOverageUsd: number;
  overagePerMinuteUsd: number;
  periodText: string;
  daysLeft: number;
  perDay: { date: string; label: string; minutes: number }[];
  suspended: boolean;
  planMinutes: number | null;
  addonMinutes: number;
  testMode: boolean;
  renewsText: string;
  pending: { plan: string; name: string; effectiveText: string } | null;
  packs: { id: string; name: string; minutes: number; priceUsd: number }[];
  plans: { id: string; name: string; priceUsd: number; minutes: number; relation: "same" | "upgrade" | "downgrade"; chargeUsd: number }[];
}

export interface OrderItem {
  id: string;
  kind: "plan" | "addon";
  label: string;
  minutes: number;
  amountUsd: number;
  paidAt: number;
}

/** Firma ayarı (sunucudaki TenantSchema'nın panelde düzenlenen kısmı) */
export interface TenantConfig {
  id: string;
  name: string;
  agent: { name: string; greeting?: string; voiceId?: string };
  hours: Record<"1" | "2" | "3" | "4" | "5" | "6" | "7", [string, string][]>;
  closedDates: string[];
  slotStepMinutes: number;
  minLeadMinutes: number;
  maxDaysAhead: number;
  services: { id?: string; name: string; aliases: string[]; durationMin: number; bufferMin: number; priceTRY: number; roomType: string; staffCount: number }[];
  staff: { id?: string; name: string; gender: "kadin" | "erkek"; services: string[]; hours?: TenantConfig["hours"] }[];
  rooms: { id?: string; type: string }[];
  handoff: { transferNumber?: string };
  notifications: { channels: ("sms" | "whatsapp")[]; confirmationTemplate?: string };
  calls: { maxConcurrent: number; queueWaitSeconds: number; callbackOnMissed: boolean };
  faq: { q: string; a: string }[];
  [key: string]: unknown;
}

export interface SettingsResponse {
  config: TenantConfig;
  hasDraft: boolean;
  changes: string[];
  issues: { path: string; message: string }[];
  version: number;
  publishedAt: number | null;
  meta: {
    staffTerm: string; staffLabel: string; roomLabel: string; roomLabelPlural: string; roomTypes: Record<string, string>;
    defaultGreeting: string; defaultConfirmation: string;
  };
}

export interface UsersResponse {
  users: { id: string; name: string; email: string; role: "owner" | "team"; disabled: boolean; lastLoginAt: number | null; isMe: boolean }[];
  roles: { owner: string; team: string };
  team: { label: string; permissions: Permission[] };
  permissions: { id: Permission; label: string }[];
}
