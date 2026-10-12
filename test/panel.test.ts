import { describe, expect, it } from "vitest";
import { demoTenant, makeApp, MONDAY_9AM } from "./helpers.ts";
import type { Tenant } from "../src/domain/tenant.ts";

const otherTenant: Tenant = { ...demoTenant, id: "diger-spa", name: "Diğer Spa", agentIds: ["agent_diger"], phoneNumbers: ["+908501112233"] };

async function setup(opts: Parameters<typeof makeApp>[1] = {}) {
  const ctx = makeApp(MONDAY_9AM, { tenants: [demoTenant, otherTenant], ...opts });
  const { app, deps } = ctx;
  const owner = await deps.users.create({ tenantId: "demo-spa", email: "sahip@lavanta.com", name: "Ayla Sahip", role: "owner", password: "sifre-12345", mustChangePassword: false });
  const team = await deps.users.create({ tenantId: "demo-spa", email: "resepsiyon@lavanta.com", name: "Rana Resepsiyon", role: "team", password: "sifre-12345", mustChangePassword: false });
  const other = await deps.users.create({ tenantId: "diger-spa", email: "sahip@diger.com", name: "Diğer Sahip", role: "owner", password: "sifre-12345", mustChangePassword: false });

  const login = async (email: string, password = "sifre-12345") => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-panel": "1" },
      body: JSON.stringify({ email, password }),
    });
    const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
    return { status: res.status, cookie, body: (await res.json()) as any };
  };
  const as = (cookie: string) => async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api/panel${path}`, {
      method,
      headers: { "content-type": "application/json", "x-panel": "1", cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { ...ctx, owner, team, other, login, as };
}

describe("giriş ve oturum", () => {
  it("doğru şifreyle girer, HttpOnly çerez verir; yanlış şifrede 401", async () => {
    const { login, app } = await setup();
    expect((await login("sahip@lavanta.com", "yanlis-sifre")).status).toBe(401);
    const ok = await login("SAHIP@lavanta.com");
    expect(ok.status).toBe(200);
    const res = await app.request("/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json", "x-panel": "1" },
      body: JSON.stringify({ email: "sahip@lavanta.com", password: "sifre-12345" }),
    });
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(res.headers.get("set-cookie")).toMatch(/SameSite=Strict/i);
  });

  it("5 hatalı denemeden sonra doğru şifreyi de 15 dakika kabul etmez", async () => {
    const { login } = await setup();
    for (let i = 0; i < 5; i++) await login("resepsiyon@lavanta.com", "yanlis");
    expect((await login("resepsiyon@lavanta.com")).status).toBe(429);
  });

  it("oturumsuz istek 401, x-panel başlıksız değişiklik isteği 403", async () => {
    const { app, login } = await setup();
    expect((await app.request("/api/panel/today", { headers: { "x-panel": "1" } })).status).toBe(401);
    const { cookie } = await login("sahip@lavanta.com");
    const res = await app.request("/api/panel/callbacks/x/close", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it("geçici şifreyle giren kullanıcı şifresini değiştirmeden başka işlem yapamaz", async () => {
    const { deps, login, as, app } = await setup();
    await deps.users.create({ tenantId: "demo-spa", email: "yeni@lavanta.com", name: "Yeni", role: "team", password: "gecici-1234" });
    const { cookie, body } = await login("yeni@lavanta.com", "gecici-1234");
    expect(body.mustChangePassword).toBe(true);
    expect((await as(cookie)("GET", "/today")).status).toBe(403);
    expect((await as(cookie)("GET", "/me")).status).toBe(200);
    const ch = await app.request("/api/auth/password", {
      method: "POST", headers: { "content-type": "application/json", "x-panel": "1", cookie },
      body: JSON.stringify({ current: "gecici-1234", next: "yeni-guclu-sifre" }),
    });
    expect(ch.status).toBe(200);
    expect((await as(cookie)("GET", "/today")).status).toBe(200);
  });
});

describe("firma izolasyonu ve yetkiler", () => {
  it("bir firmanın kullanıcısı başka firmanın randevusunu göremez ve iptal edemez", async () => {
    const { login, as } = await setup();
    const owner = as((await login("sahip@lavanta.com")).cookie);
    const created = await owner("POST", "/appointments", {
      serviceId: "klasik-masaj-60", date: "2026-10-12", time: "11:00", customerName: "Ali Veli", customerPhone: "05321112233", notify: false,
    });
    expect(created.status).toBe(201);

    const other = as((await login("sahip@diger.com")).cookie);
    expect((await other("GET", `/appointments/${created.body.id}`)).status).toBe(404);
    expect((await other("POST", `/appointments/${created.body.id}/cancel`, {})).status).toBe(404);
    expect((await other("GET", "/appointments?from=2026-10-12&to=2026-10-12")).body.appointments).toHaveLength(0);
  });

  it("ekip rolü randevu yönetir ama ayar değiştiremez, rapor ve kullanıcıları göremez", async () => {
    const { login, as } = await setup();
    const team = as((await login("resepsiyon@lavanta.com")).cookie);
    expect((await team("GET", "/appointments")).status).toBe(200);
    expect((await team("GET", "/settings")).status).toBe(403);
    expect((await team("PUT", "/settings", { config: {} })).status).toBe(403);
    expect((await team("GET", "/reports")).status).toBe(403);
    expect((await team("GET", "/users")).status).toBe(403);
    const me = await team("GET", "/me");
    expect(me.body.permissions).not.toContain("settings.edit");
    expect(me.body.terms.teamRoleLabel).toBe("Resepsiyon");
  });

  it("sahip ekip rolüne rapor yetkisi verince hemen geçerli olur; kullanıcı yönetimi verilemez", async () => {
    const { login, as } = await setup();
    const owner = as((await login("sahip@lavanta.com")).cookie);
    const res = await owner("PUT", "/team", { label: "Ön büro", permissions: ["appointments.view", "calls.view", "reports.view", "users.manage"] });
    expect(res.body.permissions).toEqual(["appointments.view", "calls.view", "reports.view"]);
    const team = as((await login("resepsiyon@lavanta.com")).cookie);
    expect((await team("GET", "/reports")).status).toBe(200);
    expect((await team("GET", "/me")).body.terms.teamRoleLabel).toBe("Ön büro");
  });

  it("son sahip hesabı kapatılamaz", async () => {
    const { login, as, owner } = await setup();
    const o = as((await login("sahip@lavanta.com")).cookie);
    expect((await o("PATCH", `/users/${owner.id}`, { disabled: true })).status).toBe(400);
  });
});

describe("panelden randevu", () => {
  it("panelden girilen randevu asistanın aynı saati önermesini engeller", async () => {
    const { login, as, call } = await setup();
    const owner = as((await login("sahip@lavanta.com")).cookie);
    // Murat pazartesi 14:00'te başlıyor: klasik masajı 10:00'da yalnızca Ayşe ve Elif verebilir
    for (const staffId of ["ayse", "elif"]) {
      const r = await owner("POST", "/appointments", {
        serviceId: "klasik-masaj-60", date: "2026-10-12", time: "10:00", staffId, customerName: "Kapıdan Gelen", customerPhone: "0216 111 22 33", notify: false,
      });
      expect(r.status).toBe(201);
      expect(r.body.source).toBe("panel");
    }
    const tool = await call("/tools/demo-spa/check_availability", { service_id: "klasik-masaj-60", date_from: "2026-10-12", date_to: "2026-10-12", preferred_time: "10:00" });
    expect(tool.body.requested_time).toEqual({ time: "10:00", available: false });
  });

  it("dolu saate panelden randevu verilmez, alternatif önerilir", async () => {
    const { login, as } = await setup();
    const owner = as((await login("sahip@lavanta.com")).cookie);
    const body = { serviceId: "cift-masaj-60", date: "2026-10-12", time: "10:00", customerName: "A B", customerPhone: "05321112233", notify: false };
    expect((await owner("POST", "/appointments", body)).status).toBe(201);
    const again = await owner("POST", "/appointments", { ...body, customerName: "C D" });
    expect(again.status).toBe(409);
    expect(again.body.reason).toBe("slot_taken");
    expect(again.body.alternatives.length).toBeGreaterThan(0);
  });

  it("iptal edilen randevunun saati yeniden boşalır ve kim iptal ettiği kaydedilir", async () => {
    const { login, as } = await setup();
    const owner = as((await login("sahip@lavanta.com")).cookie);
    const body = { serviceId: "cift-masaj-60", date: "2026-10-12", time: "10:00", customerName: "A B", customerPhone: "05321112233", notify: false };
    const a = await owner("POST", "/appointments", body);
    const cancelled = await owner("POST", `/appointments/${a.body.id}/cancel`, { notify: false });
    expect(cancelled.body).toMatchObject({ status: "cancelled", cancelledBy: "Ayla Sahip" });
    expect((await owner("POST", "/appointments", body)).status).toBe(201);
    const detail = await owner("GET", `/appointments/${a.body.id}`);
    expect(detail.body.history.map((h: any) => h.action)).toEqual(["appointment.cancel", "appointment.create"]);
  });

  it("boş saatler listesi aynı saatteki personeli birlikte gösterir", async () => {
    const { login, as } = await setup();
    const owner = as((await login("sahip@lavanta.com")).cookie);
    const r = await owner("GET", "/availability?serviceId=klasik-masaj-60&date=2026-10-12");
    const ten = r.body.times.find((t: any) => t.time === "10:00");
    expect(ten.staff.map((s: any) => s.name).sort()).toEqual(["Ayşe", "Elif"]);
  });
});

describe("ayarlar: taslak → yayınla", () => {
  const editPrice = (config: any, price: number) => ({
    ...config,
    services: config.services.map((s: any) => (s.id === "klasik-masaj-60" ? { ...s, priceTRY: price } : s)),
  });

  it("fiyat değişikliği taslakta bekler, yayınlanınca asistanın aracına ve ajana gider", async () => {
    const { login, as, call, published } = await setup();
    const owner = as((await login("sahip@lavanta.com")).cookie);
    const s = await owner("GET", "/settings");
    const saved = await owner("PUT", "/settings", { config: editPrice(s.body.config, 2750) });
    expect(saved.body.changes).toEqual(["Hizmetler ve fiyatlar"]);
    // Yayınlanmadan canlı fiyat değişmez
    expect((await call("/tools/demo-spa/check_availability", { service_id: "klasik-masaj-60" })).body.price_try).toBe(2500);
    const pub = await owner("POST", "/settings/publish");
    expect(pub.status).toBe(200);
    expect(published.at(-1)!.services.find((x) => x.id === "klasik-masaj-60")!.priceTRY).toBe(2750);
    expect((await call("/tools/demo-spa/check_availability", { service_id: "klasik-masaj-60" })).body.price_try).toBe(2750);
    expect((await owner("GET", "/settings")).body.hasDraft).toBe(false);
  });

  it("korunan alanlar (telefon hattı, ajan) panelden değiştirilemez", async () => {
    const { login, as, deps } = await setup();
    const owner = as((await login("sahip@lavanta.com")).cookie);
    const s = await owner("GET", "/settings");
    await owner("PUT", "/settings", { config: { ...editPrice(s.body.config, 2600), phoneNumbers: ["+908509999999"], agentIds: ["agent_kotu"] } });
    await owner("POST", "/settings/publish");
    expect(deps.tenants.get("demo-spa")!.phoneNumbers).toEqual(demoTenant.phoneNumbers);
    expect(deps.tenants.get("demo-spa")!.agentIds).toEqual(demoTenant.agentIds);
  });

  it("hatalı taslak yayınlanmaz, canlı ayar ve ajan değişmez", async () => {
    const { login, as, deps, published } = await setup();
    const owner = as((await login("sahip@lavanta.com")).cookie);
    const s = await owner("GET", "/settings");
    // Çift odayı sil: çift masajı için oda kalmaz
    const bad = { ...s.body.config, rooms: s.body.config.rooms.filter((r: any) => r.type !== "cift") };
    const saved = await owner("PUT", "/settings", { config: bad });
    expect(saved.body.issues[0].message).toContain("Çift oda tanımlı değil");
    const pub = await owner("POST", "/settings/publish");
    expect(pub.status).toBe(422);
    expect(published).toHaveLength(0);
    expect(deps.tenants.get("demo-spa")!.rooms.some((r) => r.type === "cift")).toBe(true);
  });

  it("asistan güncellenemezse canlı ayar değişmez ve hata gösterilir", async () => {
    const { login, as, call } = await setup({ publishAgent: async () => ({ ok: false, error: "Asistan güncellenemedi (500)" }) });
    const owner = as((await login("sahip@lavanta.com")).cookie);
    const s = await owner("GET", "/settings");
    await owner("PUT", "/settings", { config: editPrice(s.body.config, 9999) });
    const pub = await owner("POST", "/settings/publish");
    expect(pub.status).toBe(502);
    expect(pub.body.error).toContain("Asistan güncellenemedi");
    expect((await call("/tools/demo-spa/check_availability", { service_id: "klasik-masaj-60" })).body.price_try).toBe(2500);
    expect((await owner("GET", "/settings")).body.hasDraft).toBe(true);
  });

  it("yeni hizmet ve personele kimlik verilir", async () => {
    const { login, as } = await setup();
    const owner = as((await login("sahip@lavanta.com")).cookie);
    const s = await owner("GET", "/settings");
    const config = {
      ...s.body.config,
      services: [...s.body.config.services, { name: "Bali masajı", durationMin: 75, bufferMin: 15, priceTRY: 3000, roomType: "tek", aliases: [] }],
      staff: [...s.body.config.staff, { name: "Şule Ünal", gender: "kadin", services: ["bali-masaji-75"] }],
    };
    const saved = await owner("PUT", "/settings", { config });
    expect(saved.body.config.services.at(-1).id).toBe("bali-masaji-75");
    expect(saved.body.config.staff.at(-1).id).toBe("sule-unal");
    expect(saved.body.issues).toEqual([]);
  });
});

describe("çağrılar, geri aramalar ve rapor", () => {
  it("tamamlanan ve kaçan çağrılar tek listede; rapor sayıları tutarlı", async () => {
    const { login, as, store } = await setup();
    const owner = as((await login("sahip@lavanta.com")).cookie);
    const t0 = MONDAY_9AM.epochMilliseconds;
    // Mesai dışı (08:00) asistan randevusu
    const book = await owner("POST", "/appointments", {
      serviceId: "klasik-masaj-60", date: "2026-10-12", time: "15:00", customerName: "Gece Arayan", customerPhone: "05321112233", notify: false,
    });
    store.db.prepare("UPDATE appointments SET source = 'assistant', created_at = ? WHERE id = ?").run(t0 - 3600_000, book.body.id);
    store.saveCall({
      conversationId: "c-1", tenantId: "demo-spa", startedAtMs: t0 - 3600_000, durationSecs: 90, summary: "Randevu alındı",
      outcome: "booked", callerPhone: "+905321112233", appointmentId: book.body.id, afterHours: true,
      payload: { data: { transcript: [
        { role: "agent", message: "Merhaba", time_in_call_secs: 0 },
        { role: "agent", message: null, tool_calls: [{ tool_name: "book_appointment" }], time_in_call_secs: 50 },
      ] } },
    });
    store.saveCall({ conversationId: "c-2", tenantId: "demo-spa", startedAtMs: t0 - 1800_000, durationSecs: 30, outcome: "info", payload: {} });
    store.logCallStart({ callSid: "s-1", tenantId: "demo-spa", callerPhone: "+905441112233", atMs: t0 - 600_000 });
    store.logCallEnd({ callSid: "s-1", result: "busy", atMs: t0 - 590_000 });

    const calls = await owner("GET", "/calls?from=2026-10-12&to=2026-10-12");
    expect(calls.body.items.map((x: any) => x.outcome)).toEqual(["missed", "info", "booked"]);
    expect(calls.body.items[2]).toMatchObject({ phoneText: "0532 111 22 33", afterHours: true, timeText: "08:00" });
    const detail = await owner("GET", "/calls/c-1");
    expect(detail.body.transcript).toEqual([
      { role: "agent", text: "Merhaba", second: 0 },
      { role: "event", text: "Randevuyu yazdı", second: 50 },
    ]);
    expect((await owner("GET", "/calls?from=2026-10-12&to=2026-10-12&q=0544")).body.items).toHaveLength(1);

    const r = await owner("GET", "/reports?from=2026-10-12&to=2026-10-12");
    expect(r.body.totals).toMatchObject({
      incoming: 3, answered: 2, missed: 1, assistantBookings: 1, afterHoursBookings: 1, afterHoursRevenue: 2500, assistantRevenue: 2500, minutesUsed: 2,
    });
    expect(r.body.byHour[8].calls).toBe(2); // 08:00 ve 08:30
  });

  it("geri arama kapatılır, kim kapattığı görünür; diğer firma kapatamaz", async () => {
    const { login, as, store } = await setup();
    const id = store.addCallback({ tenantId: "demo-spa", phone: "+905321112233", reason: "İptal talebi" });
    const other = as((await login("sahip@diger.com")).cookie);
    expect((await other("POST", `/callbacks/${id}/close`, {})).status).toBe(404);
    const team = as((await login("resepsiyon@lavanta.com")).cookie);
    expect((await team("GET", "/callbacks")).body.items).toHaveLength(1);
    const closed = await team("POST", `/callbacks/${id}/close`, { note: "Arandı, perşembeye alındı" });
    expect(closed.body).toMatchObject({ status: "closed", closedBy: "Rana Resepsiyon", closeNote: "Arandı, perşembeye alındı" });
    expect((await team("GET", "/callbacks")).body.items).toHaveLength(0);
  });

  it("Bugün ekranı sayıları ve uyarıları döner", async () => {
    const { login, as, store } = await setup();
    store.addCallback({ tenantId: "demo-spa", phone: "+905321112233", reason: "Soru" });
    const owner = as((await login("sahip@lavanta.com")).cookie);
    const t = await owner("GET", "/today");
    expect(t.body).toMatchObject({ dateText: "12 Ekim Pazartesi", open: true });
    expect(t.body.counts.openCallbacks).toBe(1);
    expect(t.body.staff.find((s: any) => s.id === "murat")).toMatchObject({ working: true, hours: [["14:00", "21:00"]] });
  });
});
