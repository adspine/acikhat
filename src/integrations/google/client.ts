import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Google Calendar REST istemcisi (kütüphanesiz). Servis hesabı ile kimlik doğrular:
 * firma takvimini servis hesabının e-postasıyla "Etkinliklerde değişiklik yapma" yetkisiyle paylaşır.
 * Kurulum: docs/google-takvim-kurulumu.md
 */
export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  transparency?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

export interface NewGoogleEvent {
  summary: string;
  description?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  extendedProperties?: { private: Record<string, string> };
}

/** Testlerde sahte istemci verilebilsin diye arayüz */
export interface CalendarApi {
  listEvents(calendarId: string, timeMin: string, timeMax: string): Promise<GoogleEvent[]>;
  insertEvent(calendarId: string, event: NewGoogleEvent): Promise<string>;
  deleteEvent?(calendarId: string, eventId: string): Promise<void>;
}

const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const API = "https://www.googleapis.com/calendar/v3";

/** Anahtar: GOOGLE_SERVICE_ACCOUNT_JSON (sunucuda, şifreli ortam değişkeni) veya GOOGLE_SERVICE_ACCOUNT_FILE (yerelde) */
export function loadServiceAccount(env: NodeJS.ProcessEnv): ServiceAccount | null {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON ?? (env.GOOGLE_SERVICE_ACCOUNT_FILE && readFileSync(env.GOOGLE_SERVICE_ACCOUNT_FILE, "utf8"));
  if (!raw) return null;
  const sa = JSON.parse(raw) as ServiceAccount;
  if (!sa.client_email || !sa.private_key) throw new Error("Google servis hesabı anahtarı geçersiz (client_email/private_key yok)");
  return sa;
}

export class GoogleCalendarClient implements CalendarApi {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly sa: ServiceAccount;
  private readonly fetchFn: typeof fetch;

  constructor(sa: ServiceAccount, fetchFn: typeof fetch = fetch) {
    this.sa = sa;
    this.fetchFn = fetchFn;
  }

  get email() {
    return this.sa.client_email;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const now = Math.floor(Date.now() / 1000);
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({
      iss: this.sa.client_email,
      scope: SCOPE,
      aud: this.sa.token_uri ?? "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(this.sa.private_key).toString("base64url");
    const res = await this.fetchFn(this.sa.token_uri ?? "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
    });
    const json = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!res.ok || !json.access_token) throw new Error(`Google kimlik doğrulama başarısız: ${json.error_description ?? res.status}`);
    this.token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchFn(`${API}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${await this.accessToken()}`, "content-type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(4000),
    });
    const text = await res.text();
    if (!res.ok) {
      const hint = res.status === 404 ? " (takvim servis hesabıyla paylaşılmamış olabilir)" : res.status === 403 ? " (paylaşım yetkisi yetersiz)" : "";
      throw new Error(`Google Calendar ${res.status}${hint}: ${text.slice(0, 300)}`);
    }
    return JSON.parse(text) as T;
  }

  async listEvents(calendarId: string, timeMin: string, timeMax: string): Promise<GoogleEvent[]> {
    const out: GoogleEvent[] = [];
    let pageToken: string | undefined;
    do {
      const q = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "2500", ...(pageToken && { pageToken }) });
      const page = await this.call<{ items?: GoogleEvent[]; nextPageToken?: string }>(`/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
      out.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return out;
  }

  async insertEvent(calendarId: string, event: NewGoogleEvent): Promise<string> {
    const res = await this.call<{ id: string }>(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: "POST",
      body: JSON.stringify(event),
    });
    return res.id;
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    const res = await this.fetchFn(`${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${await this.accessToken()}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok && res.status !== 410) throw new Error(`Google Calendar silme ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
