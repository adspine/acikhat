import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DemoCalls } from "../src/store/demo-calls.ts";
import { demoTenant, makeApp, MONDAY_9AM } from "./helpers.ts";
import type { FirebaseVerifier } from "../src/auth/firebase.ts";

const verifier = (email: string): FirebaseVerifier => ({ verify: async () => ({ uid: "uid-admin", email, emailVerified: true, name: "Yönetici" }) });

function setup(opts: { now?: Temporal.ZonedDateTime; fail?: string } = {}) {
  const started: { phone: string; demoId: string }[] = [];
  let n = 0;
  const ctx = makeApp(opts.now ?? MONDAY_9AM, {
    firebase: verifier("admin@ornek.com"),
    adminEmails: ["admin@ornek.com"],
    startDemoCall: async (_t, call) => {
      started.push(call);
      return opts.fail ? { ok: false as const, error: opts.fail } : { ok: true as const, conversationId: `conv-demo-${++n}` };
    },
  });
  const calls = new DemoCalls(ctx.store.db);
  const demo = async (body: unknown, ip = "1.1.1.1") => {
    const res = await ctx.app.request("/api/demo-call", { method: "POST", headers: { "content-type": "application/json", "fly-client-ip": ip }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as any };
  };
  const postCall = (event: unknown) => {
    const body = JSON.stringify(event);
    const t = Math.floor(Date.now() / 1000);
    const sig = `t=${t},v0=${createHmac("sha256", "wh-secret").update(`${t}.${body}`).digest("hex")}`;
    return ctx.app.request("/webhooks/elevenlabs/post-call", { method: "POST", body, headers: { "elevenlabs-signature": sig } });
  };
  return { ...ctx, calls, started, demo, postCall };
}

const ok = { phone: "0532 111 22 33", consent: true };

describe("landing test görüşmesi", () => {
  it("demo firma tanımlı değilse kapalıdır", async () => {
    const { app } = makeApp();
    const cfg = await app.request("/api/demo-call");
    expect(await cfg.json()).toMatchObject({ enabled: false });
    const res = await app.request("/api/demo-call", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ok) });
    expect(res.status).toBe(503);
  });

  it("geçerli istekte demo firmanın hattından aranır ve kalan hak döner", async () => {
    const { demo, started, app } = setup();
    expect(await (await app.request("/api/demo-call")).json()).toMatchObject({ enabled: true, maxSeconds: 120, maxPerNumber: 2 });
    const r = await demo(ok);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, remaining: 1, maxSeconds: 120, masked: "0532 *** ** 33" });
    expect(started).toHaveLength(1);
    expect(started[0]!.phone).toBe("+905321112233");
  });

  it("onay yoksa, geçersiz ya da cep olmayan numarada aranmaz", async () => {
    const { demo, started } = setup();
    expect((await demo({ phone: "0532 111 22 33" })).status).toBe(400);
    expect((await demo({ phone: "0532 111 22 33", consent: false })).status).toBe(400);
    expect((await demo({ phone: "12", consent: true })).status).toBe(422);
    expect((await demo({ phone: "0212 111 22 33", consent: true })).body.code).toBe("invalid_phone");
    expect(started).toHaveLength(0);
  });

  it("bal tuzağı dolu ise başarılı görünür ama aranmaz", async () => {
    const { demo, started } = setup();
    const r = await demo({ ...ok, website: "http://spam" });
    expect(r.status).toBe(200);
    expect(started).toHaveLength(0);
  });

  it("aynı numara en fazla 2 kez aranır, 3. denemede arama başlamaz", async () => {
    const { demo, started, calls } = setup();
    expect((await demo(ok)).status).toBe(200);
    // görüşme sürerken ikinci istek reddedilir
    expect((await demo(ok)).body.code).toBe("busy");
    calls.finish("conv-demo-1", { durationSecs: 40, endedBy: "agent", booked: false, atMs: 1 });
    const second = await demo(ok);
    expect(second.status).toBe(200);
    expect(second.body.remaining).toBe(0);
    calls.finish("conv-demo-2", { durationSecs: 40, endedBy: "caller", booked: false, atMs: 2 });
    const third = await demo(ok);
    expect(third.status).toBe(429);
    expect(third.body.code).toBe("limit");
    expect(started).toHaveLength(2);
  });

  it("başlatılamayan arama hakkı düşürmez ve kullanıcıya hata döner", async () => {
    const { demo, calls } = setup({ fail: "Arama başlatılamadı (500)" });
    const r = await demo(ok);
    expect(r.status).toBe(502);
    expect(r.body.error).toContain("hakkınız düşmedi");
    expect(calls.countForPhone("+905321112233")).toBe(0);
  });

  it("meşgul/ulaşılamayan numara anlaşılır hata verir ve hak düşmez", async () => {
    const { demo, calls } = setup({ fail: "INVITE failed: sip status: 486: User Busy (SIP 486)" });
    const r = await demo(ok);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("unreachable");
    expect(calls.countForPhone("+905321112233")).toBe(0);
  });

  it("gece saatlerinde aranmaz", async () => {
    const { demo, started } = setup({ now: Temporal.ZonedDateTime.from("2026-10-12T03:00[Europe/Istanbul]") });
    const r = await demo(ok);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("hours");
    expect(started).toHaveLength(0);
  });

  it("aynı IP'den günde en fazla 4 görüşme açılır", async () => {
    const { demo, calls } = setup();
    for (let i = 0; i < 4; i++) {
      const r = await demo({ phone: `053211122${30 + i}`, consent: true }, "9.9.9.9");
      expect(r.status).toBe(200);
      calls.finish(`conv-demo-${i + 1}`, { durationSecs: 10, endedBy: "caller", booked: false, atMs: 1 });
    }
    const blocked = await demo({ phone: "0532 111 22 99", consent: true }, "9.9.9.9");
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("ip");
    // başka IP etkilenmez
    expect((await demo({ phone: "0532 111 22 99", consent: true }, "8.8.8.8")).status).toBe(200);
  });

  it("görüşme bitince süre, kapatan taraf ve randevu bilgisi demo kaydına yazılır; yönetici izler", async () => {
    const { demo, postCall, app, calls } = setup();
    await demo(ok);
    await demo({ phone: "0533 222 33 44", consent: true });
    await demo({ phone: "0534 333 44 55", consent: true }, "7.7.7.7");
    const ev = (id: string, reason: string, booked: boolean) => ({
      type: "post_call_transcription",
      data: {
        conversation_id: id,
        agent_id: demoTenant.agentIds[0],
        metadata: { call_duration_secs: 75, start_time_unix_secs: 1_791_000_000, termination_reason: reason },
        analysis: { call_successful: "success", transcript_summary: "özet" },
        transcript: booked ? [{ role: "agent", tool_results: [{ tool_name: "book_appointment", result_value: JSON.stringify({ ok: true, appointment_id: "a1" }) }] }] : [],
        conversation_initiation_client_data: { dynamic_variables: { tenant_id: "demo-spa", caller_phone: "+905321112233" } },
      },
    });
    expect((await postCall(ev("conv-demo-1", "end_call tool was called.", true))).status).toBe(200);
    expect((await postCall(ev("conv-demo-2", "Client disconnected: 1000", false))).status).toBe(200);
    expect((await postCall({ type: "call_initiation_failure", data: { conversation_id: "conv-demo-3", failure_reason: "no-answer" } })).status).toBe(200);

    const rows = calls.list();
    const by = (c: string) => rows.find((r) => r.conversationId === c)!;
    expect(by("conv-demo-1")).toMatchObject({ status: "done", durationSecs: 75, endedBy: "agent", booked: true });
    expect(by("conv-demo-2")).toMatchObject({ status: "done", endedBy: "caller", booked: false });
    expect(by("conv-demo-3")).toMatchObject({ status: "unanswered" });

    // yönetici ekranı
    const fb = await app.request("/api/auth/firebase", { method: "POST", headers: { "content-type": "application/json", "x-panel": "1" }, body: JSON.stringify({ idToken: "x".repeat(30) }) });
    const cookie = fb.headers.get("set-cookie")!.split(";")[0]!;
    const res = await app.request("/api/admin/demo-calls?days=30", { headers: { cookie, "x-panel": "1" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.stats).toMatchObject({ calls: 3, uniquePhones: 3, answered: 2, unanswered: 1, reachedEnd: 1, booked: 1 });
    expect(body.rows).toHaveLength(3);
    // oturumsuz kullanıcı göremez
    expect((await app.request("/api/admin/demo-calls", { headers: { "x-panel": "1" } })).status).toBeGreaterThanOrEqual(401);
  });

  it("giden test araması gelen çağrı gibi kaydedilmez, arayan olarak aranan kişi yazılır", async () => {
    const { call, store } = setup();
    const r = await call("/webhooks/elevenlabs/init", { caller_id: demoTenant.phoneNumbers[0], called_number: "+905321112233", agent_id: demoTenant.agentIds[0], call_sid: "sid-out" });
    expect(r.status).toBe(200);
    expect(r.body.dynamic_variables.caller_phone).toBe("+905321112233");
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM call_log").get()).toMatchObject({ n: 0 });
  });
});
