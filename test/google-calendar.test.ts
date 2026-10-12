import { describe, expect, it } from "vitest";
import { demoTenant, makeApp, MONDAY_9AM } from "./helpers.ts";
import { eventsToBlocks } from "../src/calendar/calendars.ts";
import { candidateSlots } from "../src/domain/slots.ts";
import type { CalendarApi, GoogleEvent, NewGoogleEvent } from "../src/integrations/google/client.ts";
import type { Tenant } from "../src/domain/tenant.ts";

const googleTenant: Tenant = {
  ...demoTenant,
  calendar: { provider: "google", google: { calendarId: "spa@ornek.com", staffCalendars: {}, matchStaffNames: true } },
};

const at = (hhmm: string, day = "2026-10-12") => `${day}T${hhmm}:00+03:00`;
const ev = (id: string, summary: string, from: string, to: string, extra: Partial<GoogleEvent> = {}): GoogleEvent => ({
  id, summary, start: { dateTime: at(from) }, end: { dateTime: at(to) }, ...extra,
});

/** Bellekte çalışan sahte Google Takvim */
class FakeCalendar implements CalendarApi {
  events: GoogleEvent[] = [];
  inserted: NewGoogleEvent[] = [];
  failList = false;
  failInsert = false;
  async listEvents() {
    if (this.failList) throw new Error("Google'a ulaşılamadı");
    return this.events;
  }
  async insertEvent(_id: string, e: NewGoogleEvent) {
    if (this.failInsert) throw new Error("yazılamadı");
    this.inserted.push(e);
    const id = `ev-${this.inserted.length}`;
    this.events.push({ id, summary: e.summary, start: { dateTime: `${e.start.dateTime}+03:00` }, end: { dateTime: `${e.end.dateTime}+03:00` }, extendedProperties: e.extendedProperties });
    return id;
  }
}

describe("Google etkinliklerini dolu zamana çevirme", () => {
  it("başlıkta adı geçen terapisti meşgul eder, adı geçmeyeni bilinmeyen kişi sayar", () => {
    const blocks = eventsToBlocks(googleTenant, [
      ev("1", "Ayşe - Zeynep Hanım masaj", "10:00", "11:00"),
      ev("2", "Selin K. aromaterapi", "12:00", "13:30"),
      ev("3", "İptal edilen", "14:00", "15:00", { status: "cancelled" }),
      ev("4", "Hatırlatma", "15:00", "15:30", { transparency: "transparent" }),
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ staffId: "ayse" });
    expect(blocks[0]!.roomId).toBeUndefined(); // oda bilinmiyor → bir oda dolu sayılır
    expect(blocks[1]!.staffId).toBeUndefined();
    expect(blocks[1]!.roomId).toBeUndefined();
    // elle girilen randevuya 15 dk hazırlık payı eklenir
    expect(blocks[1]!.endMs).toBe(Date.parse(at("13:45")));
  });

  it("adı geçmeyen tüm gün etkinliği günü kapatır; terapist adı geçen tüm gün yalnızca o kişiyi", () => {
    const allDay = (id: string, summary: string): GoogleEvent => ({ id, summary, start: { date: "2026-10-13" }, end: { date: "2026-10-14" } });
    const [closed, leave] = eventsToBlocks(googleTenant, [allDay("1", "Bakım - spa kapalı"), allDay("2", "Murat izinli")]);
    expect(closed).toMatchObject({ everything: true });
    expect(leave).toMatchObject({ staffId: "murat" });
    expect(closed!.endMs - closed!.startMs).toBe(24 * 3600_000);
  });

  it("asistanın yazdığı etkinlikte terapist, oda ve temizlik süresi gizli alanlardan okunur", () => {
    const [b] = eventsToBlocks(googleTenant, [
      ev("1", "Klasik masaj – Ali", "10:00", "11:00", {
        extendedProperties: { private: { acikhat_appointment: "x", acikhat_staff: "elif", acikhat_room: "oda-2", acikhat_block_end: String(Date.parse(at("11:15"))) } },
      }),
    ]);
    expect(b).toMatchObject({ staffId: "elif", roomId: "oda-2", endMs: Date.parse(at("11:15")) });
  });
});

describe("kime ait olduğu bilinmeyen randevular", () => {
  const service = demoTenant.services.find((s) => s.id === "klasik-masaj-60")!;
  const day = MONDAY_9AM.toPlainDate();
  const tenAm = (slots: { start: Temporal.ZonedDateTime }[]) => slots.filter((s) => s.start.hour === 10 && s.start.minute === 0);

  it("tek bilinmeyen randevu bir oda tüketir; 2 tek kişilik oda varken 10:00 hâlâ boş", () => {
    const busy = [{ startMs: Date.parse(at("10:00")), endMs: Date.parse(at("11:00")) }];
    expect(tenAm(candidateSlots(demoTenant, { service, now: MONDAY_9AM, dateFrom: day, dateTo: day }, busy)).length).toBeGreaterThan(0);
  });

  it("iki bilinmeyen randevu iki odayı da doldurur; 10:00 önerilmez (çift randevu yok)", () => {
    const b = { startMs: Date.parse(at("10:00")), endMs: Date.parse(at("11:00")) };
    expect(tenAm(candidateSlots(demoTenant, { service, now: MONDAY_9AM, dateFrom: day, dateTo: day }, [b, { ...b }]))).toHaveLength(0);
  });
});

describe("Google Takvim kullanan firmada randevu akışı", () => {
  const base = "/tools/demo-spa";

  it("takvimdeki randevuyu görür, yeni randevuyu takvime yazar", async () => {
    const google = new FakeCalendar();
    google.events.push(ev("1", "Ayşe - müşteri", "10:00", "11:00"), ev("2", "Elif - müşteri", "10:00", "11:00"));
    const { call, store } = makeApp(MONDAY_9AM, { tenant: googleTenant, google });

    const avail = await call(`${base}/check_availability`, { service_id: "klasik-masaj-60", date_from: "2026-10-12" });
    // Ayşe ve Elif 10:00'da dolu; Murat pazartesi 14:00'te başlıyor → ilk seçenek 11:15 olmalı
    expect(avail.body.options[0].when).toBe("12 Ekim Pazartesi, saat 11.15");

    const book = await call(`${base}/book_appointment`, {
      slot_id: avail.body.options[0].slot_id, customer_name: "Zeynep Kaya", customer_phone: "05321112233", confirmed_by_caller: true, conversation_id: "c1",
    });
    expect(book.body.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(google.inserted).toHaveLength(1);
    expect(google.inserted[0]).toMatchObject({
      summary: expect.stringContaining("Klasik masaj (60 dakika) – Zeynep Kaya"),
      start: { dateTime: "2026-10-12T11:15:00", timeZone: "Europe/Istanbul" },
    });
    expect(google.inserted[0]!.extendedProperties!.private.acikhat_appointment).toBe(book.body.appointment_id);
    expect(store.db.prepare("SELECT calendar_event_id FROM appointments").get()).toMatchObject({ calendar_event_id: "ev-1" });
  });

  it("resepsiyon arada aynı saate elle randevu girdiyse yazmaz, alternatif önerir", async () => {
    const google = new FakeCalendar();
    const { call } = makeApp(MONDAY_9AM, { tenant: { ...googleTenant, staff: googleTenant.staff.filter((s) => s.id === "ayse") }, google });
    const avail = await call(`${base}/check_availability`, { service_id: "klasik-masaj-60", date_from: "2026-10-12" });
    expect(avail.body.options[0].when).toBe("12 Ekim Pazartesi, saat 10");

    google.events.push(ev("9", "Ayşe - telefonla gelen", "10:00", "11:00")); // resepsiyon elle girdi
    const book = await call(`${base}/book_appointment`, {
      slot_id: avail.body.options[0].slot_id, customer_name: "Ali Veli", customer_phone: "05321112233", confirmed_by_caller: true,
    });
    expect(book.body.error).toBe("slot_taken");
    expect(book.body.options.length).toBeGreaterThan(0);
    expect(google.inserted).toHaveLength(0);
  });

  it("takvime ulaşılamazsa randevu yazmaz, geri arama notu aldırır", async () => {
    const google = new FakeCalendar();
    const { call } = makeApp(MONDAY_9AM, { tenant: googleTenant, google });
    const avail = await call(`${base}/check_availability`, { service_id: "klasik-masaj-60" });
    google.failList = true;
    const book = await call(`${base}/book_appointment`, {
      slot_id: avail.body.options[0].slot_id, customer_name: "Ali Veli", customer_phone: "05321112233", confirmed_by_caller: true,
    });
    expect(book.body.error).toBe("calendar_unavailable");
    expect(book.body.instruction).toContain("log_callback_request");
  });

  it("takvime yazma başarısız olursa randevu kaybolmaz ve sonra yeniden yazılır", async () => {
    const google = new FakeCalendar();
    google.failInsert = true;
    const { call, store } = makeApp(MONDAY_9AM, { tenant: googleTenant, google });
    const avail = await call(`${base}/check_availability`, { service_id: "klasik-masaj-60" });
    const book = await call(`${base}/book_appointment`, {
      slot_id: avail.body.options[0].slot_id, customer_name: "Ali Veli", customer_phone: "05321112233", confirmed_by_caller: true,
    });
    expect(book.body.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(store.db.prepare("SELECT calendar_event_id FROM appointments").get()).toMatchObject({ calendar_event_id: null });

    // Yazılamayan randevu, takvimde görünmese de saati tutmaya devam eder
    const again = await call(`${base}/check_availability`, { service_id: "klasik-masaj-60", staff_id: avail.body.options[0].staff === "Ayşe" ? "ayse" : undefined });
    expect(again.body.options.map((o: any) => o.when)).not.toContain(avail.body.options[0].when);

    google.failInsert = false;
    const { Calendars } = await import("../src/calendar/calendars.ts");
    const calendars = new Calendars(store, google, { cacheMs: 0 });
    const written = await calendars.retryPending(
      () => googleTenant,
      (t, r) => ({
        id: r.id, serviceName: "Klasik masaj", staffId: r.staff_id, roomId: r.room_id, customerName: r.customer_name, customerPhone: r.customer_phone,
        start: Temporal.Instant.fromEpochMilliseconds(r.start_ms).toZonedDateTimeISO(t.timezone),
        end: Temporal.Instant.fromEpochMilliseconds(r.end_ms).toZonedDateTimeISO(t.timezone),
        blockEndMs: r.block_end_ms,
      }),
      MONDAY_9AM.epochMilliseconds,
    );
    expect(written).toBe(1);
    expect(google.inserted).toHaveLength(1);
    expect(store.db.prepare("SELECT calendar_event_id FROM appointments").get()).toMatchObject({ calendar_event_id: "ev-1" });
  });
});

describe("Google istemcisi (servis hesabı kimlik doğrulaması)", () => {
  it("doğru imzalı JWT ile token alır, token'ı önbelleğe alır ve isteklere ekler", async () => {
    const { generateKeyPairSync, createVerify } = await import("node:crypto");
    const { GoogleCalendarClient } = await import("../src/integrations/google/client.ts");
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const calls: { url: string; init: any }[] = [];
    const fakeFetch = (async (url: string, init: any) => {
      calls.push({ url, init });
      if (url.includes("oauth2")) {
        const body = new URLSearchParams(init.body);
        expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
        const [h, p, sig] = body.get("assertion")!.split(".");
        expect(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(sig!, "base64url"))).toBe(true);
        const claims = JSON.parse(Buffer.from(p!, "base64url").toString());
        expect(claims).toMatchObject({ iss: "takvim@proje.iam.gserviceaccount.com", scope: "https://www.googleapis.com/auth/calendar.events" });
        return new Response(JSON.stringify({ access_token: "tok-1", expires_in: 3600 }));
      }
      return new Response(JSON.stringify({ items: [{ id: "e1", start: { dateTime: "2026-10-12T10:00:00+03:00" }, end: { dateTime: "2026-10-12T11:00:00+03:00" } }] }));
    }) as unknown as typeof fetch;

    const client = new GoogleCalendarClient({ client_email: "takvim@proje.iam.gserviceaccount.com", private_key: pem }, fakeFetch);
    const events = await client.listEvents("spa@ornek.com", "2026-10-12T00:00:00Z", "2026-10-13T00:00:00Z");
    await client.listEvents("spa@ornek.com", "2026-10-12T00:00:00Z", "2026-10-13T00:00:00Z");

    expect(events).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1); // token önbellekte
    const apiCall = calls.find((c) => c.url.includes("/calendars/"))!;
    expect(apiCall.url).toContain("/calendars/spa%40ornek.com/events?");
    expect(apiCall.url).toContain("singleEvents=true");
    expect(apiCall.init.headers.authorization).toBe("Bearer tok-1");
  });
});

describe("Google Takvim'de çift masajı", () => {
  it("asistanın yazdığı çok terapistli etkinlik her terapisti ayrı meşgul eder, odayı bir kez tutar", () => {
    const blocks = eventsToBlocks(googleTenant, [
      ev("1", "Çift masajı – Ali (Ayşe ve Elif)", "10:00", "11:00", {
        extendedProperties: { private: { acikhat_appointment: "x", acikhat_staff: "ayse,elif", acikhat_room: "cift-1", acikhat_block_end: String(Date.parse(at("11:15"))) } },
      }),
    ]);
    expect(blocks).toEqual([
      expect.objectContaining({ staffId: "ayse", roomId: "cift-1" }),
      expect.objectContaining({ staffId: "elif", roomId: "-" }),
    ]);
  });
});
