import { describe, expect, it, vi } from "vitest";
import { makeApp, MONDAY_9AM } from "./helpers.ts";
import { createPasswordResetSender } from "../src/auth/firebase.ts";

const json = { "content-type": "application/json", "x-panel": "1" };

async function loggedIn() {
  const ctx = makeApp(MONDAY_9AM);
  await ctx.deps.users.create({ tenantId: null, email: "uye@ornek.com", name: "Üye", role: "owner", password: "sifre-12345", mustChangePassword: false });
  const login = await ctx.app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ email: "uye@ornek.com", password: "sifre-12345" }) });
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const post = async () => {
    const res = await ctx.app.request("/api/auth/password-reset", { method: "POST", headers: { ...json, cookie } });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { ...ctx, post };
}

describe("şifre değiştirme: Firebase şifre belirleme e-postası", () => {
  it("oturum açmış kullanıcının e-postasına bağlantı gönderilir; dakikada bir kez", async () => {
    const { post, resets } = await loggedIn();
    expect(await post()).toMatchObject({ status: 200, body: { ok: true, email: "uye@ornek.com" } });
    expect(resets).toEqual(["uye@ornek.com"]);
    expect((await post()).status).toBe(429);
    expect(resets).toHaveLength(1);
  });

  it("oturumsuz istek reddedilir", async () => {
    const { app, resets } = makeApp(MONDAY_9AM);
    const res = await app.request("/api/auth/password-reset", { method: "POST", headers: json });
    expect(res.status).toBe(401);
    expect(resets).toEqual([]);
  });

  it("gönderici hata verirse 502, özellik kapalıysa 503", async () => {
    const broken = await loggedIn();
    broken.deps.passwordReset = async () => { throw new Error("servis yok"); };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await broken.post()).status).toBe(502);
    spy.mockRestore();

    const off = await loggedIn();
    (off.deps as { passwordReset: unknown }).passwordReset = null;
    expect((await off.post()).status).toBe(503);
  });
});

describe("createPasswordResetSender", () => {
  const reply = (status: number, message?: string) => new Response(JSON.stringify(message ? { error: { message } } : {}), { status });

  it("kayıtlı hesaba doğrudan şifre sıfırlama e-postası ister", async () => {
    const fetchFn = vi.fn(async () => reply(200));
    await createPasswordResetSender({ apiKey: "k", fetchFn: fetchFn as unknown as typeof fetch })("a@b.com");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("accounts:sendOobCode?key=k");
    expect(JSON.parse(init.body as string)).toEqual({ requestType: "PASSWORD_RESET", email: "a@b.com" });
  });

  it("Firebase'de hesap yoksa önce açar, sonra e-postayı gönderir", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      const step = String(url).includes("signUp") ? "signUp" : "sendOobCode";
      calls.push(step);
      return calls.filter((c) => c === "sendOobCode").length === 1 && step === "sendOobCode" ? reply(400, "EMAIL_NOT_FOUND") : reply(200);
    });
    await createPasswordResetSender({ apiKey: "k", fetchFn: fetchFn as unknown as typeof fetch })("yeni@b.com");
    expect(calls).toEqual(["sendOobCode", "signUp", "sendOobCode"]);
  });

  it("servis hata dönerse istisna fırlatır", async () => {
    const fetchFn = vi.fn(async () => reply(400, "TOO_MANY_ATTEMPTS_TRY_LATER"));
    await expect(createPasswordResetSender({ apiKey: "k", fetchFn: fetchFn as unknown as typeof fetch })("a@b.com")).rejects.toThrow("TOO_MANY_ATTEMPTS");
  });
});
