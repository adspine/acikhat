import { describe, expect, it } from "vitest";
import { demoTenant, makeApp, MONDAY_9AM } from "./helpers.ts";
import type { Voice } from "../src/integrations/voices.ts";

const voices: Voice[] = [
  { id: "v1", name: "Duygu Eris", gender: "female", tags: ["Genç"], previewUrl: "https://ornek/v1.mp3" },
  { id: "v2", name: "Ozan Karaca", gender: "male", tags: ["Orta yaş"], previewUrl: null },
];

async function setup(opts: { voices?: () => Promise<Voice[]> | null } = {}) {
  const tenant = { ...demoTenant, plan: { includedMinutes: 100, id: "baslangic" as const } };
  const ctx = makeApp(MONDAY_9AM, { tenant, ...(opts.voices && { voices: opts.voices as () => Promise<Voice[]> }) });
  const { app, deps } = ctx;
  await deps.users.create({ tenantId: tenant.id, email: "sahip@lavanta.com", name: "Ayla", role: "owner", password: "sifre-12345", mustChangePassword: false });
  const login = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-panel": "1" }, body: JSON.stringify({ email: "sahip@lavanta.com", password: "sifre-12345" }) });
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const owner = async (method: string, path: string) => {
    const res = await app.request(`/api/panel${path}`, { method, headers: { cookie, "x-panel": "1" } });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { ...ctx, owner, tenant };
}

describe("Paketim: dakika kullanımı", () => {
  it("bu ayki dakikayı, kalanı, tahmini ve aşımı hesaplar", async () => {
    const { owner, store, tenant } = await setup();
    const t0 = MONDAY_9AM.epochMilliseconds;
    // Pazartesi 12 Ekim: bu ayın 12. günü. 3 çağrı: 40 + 50 + 30 dk = 120 dk
    for (const [i, mins] of [40, 50, 30].entries()) store.saveCall({ conversationId: `u-${i}`, tenantId: tenant.id, startedAtMs: t0 - (i + 1) * 3600_000, durationSecs: mins * 60, outcome: "info", payload: {} });
    // Geçen ay: sayılmamalı
    store.saveCall({ conversationId: "eski", tenantId: tenant.id, startedAtMs: t0 - 20 * 86_400_000, durationSecs: 600, outcome: "info", payload: {} });
    const r = (await owner("GET", "/usage")).body;
    expect(r).toMatchObject({ includedMinutes: 100, usedMinutes: 120, remainingMinutes: 0, overageMinutes: 20, overageUsd: 6, plan: { id: "baslangic", name: "Başlangıç" } });
    expect(r.perDay).toHaveLength(12);
    expect(r.projectedMinutes).toBe(Math.round((120 / 12) * 31));
    expect(r.daysLeft).toBe(19);
  });

  it("çağrı yokken sıfır ve aşım yok", async () => {
    const { owner } = await setup();
    expect((await owner("GET", "/usage")).body).toMatchObject({ usedMinutes: 0, remainingMinutes: 100, overageMinutes: 0, overageUsd: 0 });
  });
});

describe("rapor: önceki dönem karşılaştırması", () => {
  it("aynı uzunluktaki önceki dönemin rakamlarını verir", async () => {
    const { owner, store, tenant } = await setup();
    const t0 = MONDAY_9AM.epochMilliseconds;
    store.saveCall({ conversationId: "bu", tenantId: tenant.id, startedAtMs: t0 - 3600_000, durationSecs: 60, outcome: "booked", payload: {} });
    store.saveCall({ conversationId: "onceki-1", tenantId: tenant.id, startedAtMs: t0 - 86_400_000 - 3600_000, durationSecs: 120, outcome: "booked", payload: {} });
    store.saveCall({ conversationId: "onceki-2", tenantId: tenant.id, startedAtMs: t0 - 86_400_000 - 7200_000, durationSecs: 60, outcome: "info", payload: {} });
    const r = (await owner("GET", "/reports?from=2026-10-12&to=2026-10-12")).body;
    expect(r.totals.answered).toBe(1);
    expect(r.previous).toMatchObject({ answered: 2, booked: 1, missed: 0, avgDurationSecs: 90, minutesUsed: 3 });
  });
});

describe("rapor: ek analizler", () => {
  it("haftanın günü, arayan türü, mesai dışı oranı ve kaçan nedenlerini verir", async () => {
    const { owner, store, tenant } = await setup();
    const t0 = MONDAY_9AM.epochMilliseconds;
    const call = (id: string, at: number, phone: string, afterHours = false) =>
      store.saveCall({ conversationId: id, tenantId: tenant.id, startedAtMs: at, durationSecs: 60, outcome: "info", callerPhone: phone, afterHours, payload: {} });
    call("eski", t0 - 5 * 86_400_000, "+905551110000"); // önceki dönemde de aramış
    call("a", t0 - 3600_000, "+905551110000"); // tekrar arayan
    call("b", t0 - 7200_000, "+905552220000", true); // yeni arayan, mesai dışı
    call("c", t0 - 10_800_000, "+905552220000"); // aynı kişi bu dönemde ikinci kez: tekrar sayılır
    call("d", t0 - 14_400_000, "+905553330000"); // yeni arayan
    store.logCallStart({ callSid: "k1", tenantId: tenant.id, callerPhone: "+905554440000", atMs: t0 - 3600_000 });
    store.logCallEnd({ callSid: "k1", result: "busy", atMs: t0 - 3500_000 });
    const r = (await owner("GET", "/reports?from=2026-10-12&to=2026-10-12")).body;
    expect(r.byWeekday).toHaveLength(7);
    expect(r.byWeekday[0].calls).toBe(4); // 12 Ekim 2026 Pazartesi
    expect(r.callers).toEqual({ unique: 3, returning: 2, fresh: 1 });
    expect(r.afterHoursCalls).toBe(1);
    expect(r.missedReasons).toEqual([{ label: "Hat meşguldü", count: 1 }]);
    expect(r.topServices).toEqual([]);
  });
});

describe("asistan sesleri", () => {
  it("Türkçe ses listesini verir", async () => {
    const { owner } = await setup({ voices: async () => voices });
    const r = await owner("GET", "/voices");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ enabled: true });
    expect(r.body.voices.map((v: Voice) => v.id)).toEqual(["v1", "v2"]);
  });

  it("ses servisi kapalıysa boş liste, hata verirse 502", async () => {
    const off = await setup();
    expect((await off.owner("GET", "/voices")).body).toMatchObject({ voices: [], enabled: false });
    const broken = await setup({ voices: async () => { throw new Error("yok"); } });
    expect((await broken.owner("GET", "/voices")).status).toBe(502);
  });
});
