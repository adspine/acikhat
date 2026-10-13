import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { makeApp } from "./helpers.ts";
import { normalizeTrPhone } from "../src/domain/phone.ts";
import { verifyElevenLabsSignature } from "../src/http/webhooks.ts";

const base = "/tools/demo-spa";

describe("araç uçları", () => {
  it("token olmadan reddeder", async () => {
    const { call } = makeApp();
    const res = await call(`${base}/check_availability`, { service_id: "klasik-masaj-60" }, { authorization: "Bearer yanlis" });
    expect(res.status).toBe(401);
  });

  it("uygunluk → randevu → SMS akışı", async () => {
    const { call, sms } = makeApp();
    const avail = await call(`${base}/check_availability`, { service_id: "klasik-masaj-60", date_from: "2026-10-12" });
    expect(avail.body.options).toHaveLength(3);
    expect(avail.body.options[0].when).toBe("12 Ekim Pazartesi, saat 10");

    const book = await call(`${base}/book_appointment`, {
      slot_id: avail.body.options[0].slot_id,
      customer_name: "Zeynep Kaya",
      customer_phone: "0532 111 22 33",
      confirmed_by_caller: true,
      conversation_id: "conv-1",
    });
    expect(book.body).toMatchObject({ ok: true, phone_spoken: "0532 111 22 33" });
    await Promise.resolve();
    expect(sms.sent[0]).toMatchObject({ to: "+905321112233", tenantId: "demo-spa" });
    expect(sms.sent[0]!.text).toBe("Lavanta Spa: Zeynep Kaya, Klasik masaj (60 dakika) randevunuz 12 Ekim Pazartesi, saat 10 (Ayşe) olarak alındı. Değişiklik için bizi arayabilirsiniz.");

    // Aynı görüşmede tekrar deneme (idempotent): yeni kayıt ve ikinci SMS yok
    const again = await call(`${base}/book_appointment`, {
      slot_id: avail.body.options[0].slot_id,
      customer_name: "Zeynep Kaya",
      customer_phone: "05321112233",
      confirmed_by_caller: true,
      conversation_id: "conv-1",
    });
    expect(again.body.appointment_id).toBe(book.body.appointment_id);
    expect(sms.sent).toHaveLength(1);
  });

  it("teyit edilmemiş randevuyu yazmaz", async () => {
    const { call } = makeApp();
    const avail = await call(`${base}/check_availability`, { service_id: "klasik-masaj-60" });
    const res = await call(`${base}/book_appointment`, {
      slot_id: avail.body.options[0].slot_id, customer_name: "Ali", customer_phone: "05321112233", confirmed_by_caller: false,
    });
    expect(res.body.error).toBe("not_confirmed");
  });

  it("uydurma / değiştirilmiş slot_id'yi reddeder", async () => {
    const { call } = makeApp();
    const avail = await call(`${base}/check_availability`, { service_id: "klasik-masaj-60" });
    const [body] = avail.body.options[0].slot_id.split(".");
    const forged = Buffer.from(JSON.stringify(["demo-spa", "klasik-masaj-60", "ayse", "oda-1", 0])).toString("base64url");
    for (const slot_id of [`${forged}.${"x".repeat(22)}`, `${body}.yanlis`, "2026-10-12T15:00"]) {
      const res = await call(`${base}/book_appointment`, { slot_id, customer_name: "Ali", customer_phone: "05321112233", confirmed_by_caller: true });
      expect(res.body.error).toBe("invalid_slot");
    }
  });

  it("aynı slotu iki farklı arayan alamaz; ikinciye alternatif döner", async () => {
    const { call } = makeApp();
    // Çift masajı: tek çift odası → aynı saat yalnızca bir kez satılabilir
    const avail = await call(`${base}/check_availability`, { service_id: "cift-masaj-60" });
    const slot_id = avail.body.options[0].slot_id;
    const first = await call(`${base}/book_appointment`, { slot_id, customer_name: "Ali", customer_phone: "05321112233", confirmed_by_caller: true, conversation_id: "a" });
    const second = await call(`${base}/book_appointment`, { slot_id, customer_name: "Veli", customer_phone: "05441112233", confirmed_by_caller: true, conversation_id: "b" });
    expect(first.body.ok).toBe(true);
    expect(second.body.error).toBe("slot_taken");
    expect(second.body.options.length).toBeGreaterThan(0);
  });

  it("sabit hat numarasıyla SMS'li randevu yazmaz", async () => {
    const { call } = makeApp();
    const avail = await call(`${base}/check_availability`, { service_id: "klasik-masaj-60" });
    const res = await call(`${base}/book_appointment`, {
      slot_id: avail.body.options[0].slot_id, customer_name: "Ali", customer_phone: "0216 111 22 33", confirmed_by_caller: true,
    });
    expect(res.body.error).toBe("invalid_phone");
  });

  it("bilinmeyen hizmette ne yapılacağını söyler", async () => {
    const { call } = makeApp();
    const res = await call(`${base}/check_availability`, { service_id: "sac-kesimi" });
    expect(res.body.error).toBe("unknown_service");
  });
});

describe("webhook'lar", () => {
  it("init: tarih tablosu ve arayan numarasını döner", async () => {
    const { call } = makeApp();
    const res = await call("/webhooks/elevenlabs/init", { caller_id: "+905321112233", called_number: "+908503038332", agent_id: "x" });
    expect(res.body.type).toBe("conversation_initiation_client_data");
    const v = res.body.dynamic_variables;
    expect(v.tenant_id).toBe("demo-spa");
    expect(v.caller_phone_spoken).toBe("0532 111 22 33");
    expect(v.date_table.split("\n")[0]).toBe("Bugün: 12 Ekim Pazartesi = 2026-10-12");
    expect(v.date_table).toContain("16 Ekim Cuma = 2026-10-16");
  });

  it("post-call: imzasız isteği reddeder, imzalıyı kaydeder", async () => {
    const { app, store } = makeApp();
    const body = JSON.stringify({
      type: "post_call_transcription",
      data: {
        conversation_id: "conv-9",
        agent_id: "ag",
        metadata: { call_duration_secs: 95 },
        analysis: { call_successful: "success", transcript_summary: "Randevu alındı" },
        conversation_initiation_client_data: { dynamic_variables: { tenant_id: "demo-spa" } },
      },
    });
    const t = Math.floor(Date.now() / 1000);
    const sig = `t=${t},v0=${createHmac("sha256", "wh-secret").update(`${t}.${body}`).digest("hex")}`;

    const bad = await app.request("/webhooks/elevenlabs/post-call", { method: "POST", body, headers: { "elevenlabs-signature": "t=1,v0=00" } });
    expect(bad.status).toBe(401);

    const ok = await app.request("/webhooks/elevenlabs/post-call", { method: "POST", body, headers: { "elevenlabs-signature": sig } });
    expect(ok.status).toBe(200);
    const row = store.db.prepare("SELECT tenant_id, duration_secs, summary FROM calls WHERE conversation_id = 'conv-9'").get();
    expect(row).toMatchObject({ tenant_id: "demo-spa", duration_secs: 95, summary: "Randevu alındı" });
  });

  it("eski zaman damgalı imzayı reddeder (replay)", () => {
    const sig = `t=1000,v0=${createHmac("sha256", "s").update("1000.{}").digest("hex")}`;
    expect(verifyElevenLabsSignature(sig, "{}", "s", 1000)).toBe(true);
    expect(verifyElevenLabsSignature(sig, "{}", "s", 1000 + 3600)).toBe(false);
  });
});

describe("telefon", () => {
  it.each([
    ["0532 111 22 33", "+905321112233"],
    ["+90 (532) 111-22-33", "+905321112233"],
    ["905321112233", "+905321112233"],
    ["5321112233", "+905321112233"],
    ["0216 111 22 33", "+902161112233"],
    ["12345", null],
    ["", null],
  ])("%s → %s", (input, out) => expect(normalizeTrPhone(input)).toBe(out));
});

describe("bildirim kanalları", () => {
  it("firmanın kanal sırasını dener: WhatsApp başarısızsa SMS'e düşer", async () => {
    const { ConsoleChannel, Notifier } = await import("../src/integrations/notify.ts");
    const { demoTenant } = await import("./helpers.ts");
    const sms = new ConsoleChannel("sms");
    const broken = { send: async () => { throw new Error("numarada WhatsApp yok"); } };
    const notifier = new Notifier({ whatsapp: broken, sms });
    const tenant = { ...demoTenant, notifications: { channels: ["whatsapp", "sms"] as ("whatsapp" | "sms")[] } };
    expect(await notifier.send("+905321112233", "test", tenant)).toBe("sms");
    expect(sms.sent).toHaveLength(1);
  });

  it("SMS kanalı seçilip SMS başlığı yoksa firma ayarını reddeder", async () => {
    const { TenantSchema } = await import("../src/domain/tenant.ts");
    const { demoTenant } = await import("./helpers.ts");
    const { sms: _, ...noSms } = demoTenant;
    expect(TenantSchema.safeParse(noSms).success).toBe(false);
    expect(TenantSchema.safeParse({ ...noSms, notifications: { channels: ["whatsapp"] } }).success).toBe(true);
  });
});

describe("çağrı kaydı ve kaçan çağrılar", () => {
  const sign = (body: string) => {
    const t = Math.floor(Date.now() / 1000);
    return `t=${t},v0=${createHmac("sha256", "wh-secret").update(`${t}.${body}`).digest("hex")}`;
  };
  const postCall = (app: any, event: unknown) => {
    const body = JSON.stringify(event);
    return app.request("/webhooks/elevenlabs/post-call", { method: "POST", body, headers: { "elevenlabs-signature": sign(body) } });
  };
  const init = (call: any, sid: string, caller?: string) =>
    call("/webhooks/elevenlabs/init", { caller_id: caller, called_number: "+908503038332", agent_id: "x", call_sid: sid });
  const row = (store: any, sid: string) => store.db.prepare("SELECT status, result FROM call_log WHERE call_sid = ?").get(sid);
  const callbacks = (store: any) => store.db.prepare("SELECT phone, reason FROM callback_requests").all();

  it("cevaplanan çağrı: başlar ve tamamlanır, geri arama notu açılmaz", async () => {
    const { app, call, store } = makeApp();
    await init(call, "sid-1", "+905321112233");
    expect(row(store, "sid-1")).toMatchObject({ status: "started" });
    await postCall(app, {
      type: "post_call_transcription",
      data: { conversation_id: "c1", agent_id: "x", metadata: { phone_call: { call_sid: "sid-1", call_result: "answered" } } },
    });
    expect(row(store, "sid-1")).toMatchObject({ status: "completed", result: "answered" });
    expect(callbacks(store)).toHaveLength(0);
  });

  it("kurulamayan çağrı: kaçan çağrı olur ve geri arama notu açılır", async () => {
    const { app, call, store } = makeApp();
    await init(call, "sid-2", "05441112233");
    await postCall(app, { type: "call_initiation_failure", data: { agent_id: "x", failure_reason: "busy", metadata: { body: { call_sid: "sid-2" } } } });
    expect(row(store, "sid-2")).toMatchObject({ status: "missed", result: "busy" });
    expect(callbacks(store)[0]).toMatchObject({ phone: "+905441112233" });
    expect(callbacks(store)[0].reason).toContain("hat meşguldü");
  });

  it("bitiş kaydı hiç gelmeyen çağrı (kuyrukta kapatma) süre dolunca kaçan çağrı olur", async () => {
    const { call, store } = makeApp();
    const { sweepMissedCalls } = await import("../src/domain/missed-calls.ts");
    const { TenantRegistry } = await import("../src/store/tenants.ts");
    const { demoTenant, MONDAY_9AM } = await import("./helpers.ts");
    await init(call, "sid-3", "+905551112233");
    const tenants = new TenantRegistry([demoTenant]);
    expect(sweepMissedCalls({ store, tenants }, MONDAY_9AM.epochMilliseconds + 5 * 60_000)).toBe(0);
    expect(sweepMissedCalls({ store, tenants }, MONDAY_9AM.epochMilliseconds + 16 * 60_000)).toBe(1);
    expect(row(store, "sid-3")).toMatchObject({ status: "missed", result: "timeout" });
    expect(callbacks(store)).toHaveLength(1);
  });

  it("gizli numaradan kaçan çağrı kaydedilir ama geri arama notu açılmaz", async () => {
    const { call, store } = makeApp();
    const { sweepMissedCalls } = await import("../src/domain/missed-calls.ts");
    const { TenantRegistry } = await import("../src/store/tenants.ts");
    const { demoTenant, MONDAY_9AM } = await import("./helpers.ts");
    await init(call, "sid-4");
    sweepMissedCalls({ store, tenants: new TenantRegistry([demoTenant]) }, MONDAY_9AM.epochMilliseconds + 20 * 60_000);
    expect(row(store, "sid-4")).toMatchObject({ status: "missed" });
    expect(callbacks(store)).toHaveLength(0);
  });
});

describe("kurulum formu", () => {
  const send = (call: any, body: unknown) => call("/api/onboarding", body, { authorization: "" });
  const valid = {
    business: { name: "Kardelen Spa" },
    contact: { person: "Ayla Kılıç", phone: "0532 111 22 33", email: "" },
    services: [{ name: "Klasik masaj", durationMin: 60, price: "2500 TL", room: "tek" }],
    notifications: { channels: ["whatsapp", "sms"] },
    consent: { kvkk: true },
  };

  it("geçerli başvuruyu kaydeder ve okunabilir bir referans döner", async () => {
    const { call, store } = makeApp();
    const res = await send(call, valid);
    expect(res.body.ok).toBe(true);
    expect(res.body.reference).toMatch(/^KA-[A-Z2-9]{4}$/);
    const row = store.db.prepare("SELECT business_name, contact_phone, status FROM onboarding_submissions").get();
    expect(row).toMatchObject({ business_name: "Kardelen Spa", contact_phone: "+905321112233", status: "new" });
  });

  it("eksik zorunlu alanları ve KVKK onayını Türkçe olarak bildirir", async () => {
    const { call } = makeApp();
    const res = await send(call, { ...valid, contact: { person: "O", phone: "123" }, consent: { kvkk: false } });
    expect(res.status).toBe(422);
    const paths = res.body.fields.map((f: any) => f.path);
    expect(paths).toEqual(expect.arrayContaining(["contact.person", "contact.phone", "consent.kvkk"]));
  });

  it("bot tuzağı dolu gelirse kaydetmez", async () => {
    const { call, store } = makeApp();
    await send(call, { ...valid, company_fax: "spam" });
    expect(store.db.prepare("SELECT COUNT(*) n FROM onboarding_submissions").get()).toMatchObject({ n: 0 });
  });

  it("site ana sayfası ve ses dosyası doğru türle sunulur", async () => {
    const { app } = makeApp();
    expect((await app.request("/")).headers.get("content-type")).toContain("text/html");
    expect((await app.request("/audio/demo.m4a")).headers.get("content-type")).toBe("audio/mp4");
  });
});

describe("çift masajı randevusu", () => {
  it("iki terapisti de meşgul eder: aynı saatte onlarla başka randevu verilmez", async () => {
    const { call, sms, store } = makeApp();
    const avail = await call("/tools/demo-spa/check_availability", { service_id: "cift-masaj-60", date_from: "2026-10-12" });
    expect(avail.body.options[0]).toMatchObject({ when: "12 Ekim Pazartesi, saat 10", staff: "Ayşe ve Elif" });
    const book = await call("/tools/demo-spa/book_appointment", {
      slot_id: avail.body.options[0].slot_id, customer_name: "Ali Veli", customer_phone: "05321112233", confirmed_by_caller: true,
    });
    expect(book.body.ok).toBe(true);
    expect(store.db.prepare("SELECT staff_id, extra_staff_ids FROM appointments").get()).toMatchObject({ staff_id: "ayse", extra_staff_ids: "elif" });
    await Promise.resolve();
    expect(sms.sent[0]!.text).toContain("(Ayşe ve Elif)");

    // Klasik masajı Ayşe, Elif ve Murat yapıyor; Murat pazartesi 14:00'te başlıyor → 10:00 dolu olmalı
    const klasik = await call("/tools/demo-spa/check_availability", { service_id: "klasik-masaj-60", date_from: "2026-10-12", preferred_time: "10:00" });
    expect(klasik.body.options.map((o: any) => o.when)).not.toContain("12 Ekim Pazartesi, saat 10");
  });
});

describe("istenen saat", () => {
  it("'öğleden sonra saat 18' isteğinde 18'i eler değil, uygun olduğunu açıkça söyler", async () => {
    const { call } = makeApp();
    const res = await call("/tools/demo-spa/check_availability", {
      service_id: "cift-masaj-60", date_from: "2026-10-12", date_to: "2026-10-12", part_of_day: "ogle", preferred_time: "18:00",
    });
    expect(res.body.requested_time).toEqual({ time: "18:00", available: true });
    expect(res.body.options[0].when).toBe("12 Ekim Pazartesi, saat 18");
    expect(res.body.instruction).toContain("UYGUN");
  });

  it("istenen saat doluysa bunu araç söyler, model tahmin etmez", async () => {
    const { call } = makeApp();
    // Çift odası tek: 18:00'i doldur
    const first = await call("/tools/demo-spa/check_availability", { service_id: "cift-masaj-60", date_from: "2026-10-12", preferred_time: "18:00" });
    await call("/tools/demo-spa/book_appointment", { slot_id: first.body.options[0].slot_id, customer_name: "Ali Veli", customer_phone: "05321112233", confirmed_by_caller: true });
    const res = await call("/tools/demo-spa/check_availability", { service_id: "cift-masaj-60", date_from: "2026-10-12", date_to: "2026-10-12", preferred_time: "18:00" });
    expect(res.body.requested_time).toEqual({ time: "18:00", available: false });
    expect(res.body.instruction).toContain("uygun değil");
    expect(res.body.options.map((o: any) => o.when)).not.toContain("12 Ekim Pazartesi, saat 18");
  });
});
