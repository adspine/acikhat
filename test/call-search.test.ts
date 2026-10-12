import { describe, expect, it } from "vitest";
import { demoTenant, makeApp, MONDAY_9AM } from "./helpers.ts";

const json = { "content-type": "application/json", "x-panel": "1" };

async function setup() {
  const ctx = makeApp(MONDAY_9AM, { tenant: demoTenant });
  await ctx.deps.users.create({ tenantId: demoTenant.id, email: "sahip@lavanta.com", name: "Ayla", role: "owner", password: "sifre-12345", mustChangePassword: false });
  const login = await ctx.app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ email: "sahip@lavanta.com", password: "sifre-12345" }) });
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const get = async (path: string) => {
    const res = await ctx.app.request(`/api/panel${path}`, { headers: { ...json, cookie } });
    return { status: res.status, body: (await res.json()) as any };
  };
  const t0 = MONDAY_9AM.epochMilliseconds;
  const call = (id: string, hoursAgo: number, summary: string, turns: [string, string, number][], outcome = "info") =>
    ctx.store.saveCall({
      conversationId: id, tenantId: demoTenant.id, startedAtMs: t0 - hoursAgo * 3600_000, durationSecs: 120, outcome, summary, callerPhone: "+905321112233",
      payload: { data: { transcript: turns.map(([role, message, at]) => ({ role, message, time_in_call_secs: at })) } },
    });
  call("a", 2, "Arayan masaj fiyatını sordu.", [["agent", "Merhaba, size nasıl yardımcı olabilirim?", 1], ["user", "İpek hanım için çift masaj randevusu istiyorum", 6], ["agent", "Tabii, uygun saatlere bakıyorum.", 9]], "booked");
  call("b", 3, "Çalışma saatleri soruldu.", [["user", "Pazar günü açık mısınız?", 2], ["agent", "Pazar günleri 10:00-18:00 arası açığız.", 5]]);
  call("c", 4, "Özet yok", [["user", "...", 1]]);
  return { ...ctx, get };
}

describe("çağrılarda konuşma içinde arama", () => {
  it("döküm metninde arar; Türkçe büyük/küçük harf duyarsızdır ve eşleşen yerin çevresini verir", async () => {
    const { get } = await setup();
    const r = (await get("/calls?ara=" + encodeURIComponent("İPEK"))).body;
    expect(r.searched).toBe(true);
    expect(r.items.map((x: any) => x.id)).toEqual(["a"]);
    expect(r.items[0].snippet).toContain("Arayan:");
    expect(r.items[0].snippet.toLocaleLowerCase("tr")).toContain("ipek hanım");
  });

  it("özet metninde de arar; eşleşme yoksa boş döner; tek harflik aramada süzme yapılmaz", async () => {
    const { get } = await setup();
    expect((await get("/calls?ara=saatleri")).body.items.map((x: any) => x.id)).toEqual(["b"]);
    expect((await get("/calls?ara=yokboyleKelime")).body.items).toEqual([]);
    expect((await get("/calls?ara=a")).body.items.length).toBeGreaterThanOrEqual(3);
  });

  it("sonuç süzgeciyle birlikte çalışır ve araç/olay satırlarında aramaz", async () => {
    const { get } = await setup();
    expect((await get("/calls?ara=masaj&outcome=booked")).body.items.map((x: any) => x.id)).toEqual(["a"]);
    expect((await get("/calls?ara=masaj&outcome=callback")).body.items).toEqual([]);
  });

  it("görüşme detayı döküm satırlarını zamanıyla verir, boş '...' satırlarını atar", async () => {
    const { get } = await setup();
    const a = (await get("/calls/a")).body;
    expect(a.transcript).toEqual([
      { role: "agent", text: "Merhaba, size nasıl yardımcı olabilirim?", second: 1 },
      { role: "user", text: "İpek hanım için çift masaj randevusu istiyorum", second: 6 },
      { role: "agent", text: "Tabii, uygun saatlere bakıyorum.", second: 9 },
    ]);
    expect((await get("/calls/c")).body.transcript).toEqual([]);
  });
});
