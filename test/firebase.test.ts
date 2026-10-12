import { generateKeyPairSync, sign, type JsonWebKeyInput } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createFirebaseVerifier, FirebaseAuthError } from "../src/auth/firebase.ts";
import { demoTenant, makeApp, MONDAY_9AM } from "./helpers.ts";

const PROJECT = "acikhat-test";
const NOW_MS = MONDAY_9AM.epochMilliseconds;
const NOW_S = Math.floor(NOW_MS / 1000);

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = (pair: typeof keys, kid: string) => ({ ...(pair.publicKey.export({ format: "jwk" }) as object), kid }) as JsonWebKeyInput["key"] & { kid: string };

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
function token(claims: Record<string, unknown> = {}, opts: { pair?: typeof keys; kid?: string; alg?: string } = {}) {
  const header = b64({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1", typ: "JWT" });
  const payload = b64({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: "uid-1",
    iat: NOW_S - 10,
    auth_time: NOW_S - 10,
    exp: NOW_S + 3600,
    email: "yeni@lavanta.com",
    email_verified: true,
    name: "Yeni Üye",
    ...claims,
  });
  const sig = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), (opts.pair ?? keys).privateKey).toString("base64url");
  return `${header}.${payload}.${sig}`;
}

function verifier() {
  let fetches = 0;
  const v = createFirebaseVerifier({
    projectId: PROJECT,
    now: () => NOW_MS,
    fetchJwks: async () => (fetches++, { jwks: { keys: [jwk(keys, "k1")] }, maxAgeMs: 3_600_000 }),
  });
  return { v, fetches: () => fetches };
}

describe("Firebase kimlik belgesi doğrulaması", () => {
  it("geçerli belgeyi kabul eder ve kimliği döner", async () => {
    const { v } = verifier();
    expect(await v.verify(token())).toEqual({ uid: "uid-1", email: "yeni@lavanta.com", emailVerified: true, name: "Yeni Üye" });
  });

  it("anahtarları önbelleğe alır", async () => {
    const { v, fetches } = verifier();
    await v.verify(token());
    await v.verify(token());
    expect(fetches()).toBe(1);
  });

  it.each([
    ["başka anahtarla imzalı", () => token({}, { pair: otherKeys })],
    ["süresi dolmuş", () => token({ exp: NOW_S - 1 })],
    ["başka projenin belgesi", () => token({ aud: "baska-proje", iss: "https://securetoken.google.com/baska-proje" })],
    ["yanlış yayıncı", () => token({ iss: "https://evil.example" })],
    ["gelecekte üretilmiş", () => token({ iat: NOW_S + 3600, auth_time: NOW_S + 3600 })],
    ["konu (sub) boş", () => token({ sub: "" })],
    ["e-postasız", () => token({ email: undefined })],
    ["RS256 dışı algoritma", () => token({}, { alg: "none" })],
    ["bilinmeyen anahtar kimliği", () => token({}, { kid: "yok" })],
    ["bozuk biçim", () => "a.b"],
  ])("reddeder: %s", async (_ad, make) => {
    const { v } = verifier();
    await expect(v.verify(make())).rejects.toBeInstanceOf(FirebaseAuthError);
  });
});

describe("POST /api/auth/firebase", () => {
  const post = (app: ReturnType<typeof makeApp>["app"], idToken: string) =>
    app.request("/api/auth/firebase", {
      method: "POST",
      headers: { "content-type": "application/json", "x-panel": "1" },
      body: JSON.stringify({ idToken }),
    });
  const ctx = () => makeApp(MONDAY_9AM, { firebase: verifier().v });

  it("yeni üyeyi firmasız sahip olarak oluşturur ve oturum çerezi verir", async () => {
    const { app, deps } = ctx();
    const res = await post(app, token());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, hasTenant: false });
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    const u = deps.users.findByEmail("yeni@lavanta.com")!;
    expect(u).toMatchObject({ role: "owner", tenantId: null, name: "Yeni Üye", firebaseUid: "uid-1", mustChangePassword: false });
  });

  it("aynı kişi tekrar girince ikinci hesap açılmaz", async () => {
    const { app, store } = ctx();
    await post(app, token());
    await post(app, token());
    expect((store.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n).toBe(1);
  });

  it("doğrulanmış e-postayla mevcut panel hesabına bağlanır", async () => {
    const { app, deps } = ctx();
    const owner = await deps.users.create({ tenantId: demoTenant.id, email: "sahip@lavanta.com", name: "Ayla", role: "owner", password: "sifre-12345", mustChangePassword: false });
    const res = await post(app, token({ email: "SAHIP@lavanta.com" }));
    expect(await res.json()).toMatchObject({ ok: true, hasTenant: true });
    expect(deps.users.findByFirebaseUid("uid-1")?.id).toBe(owner.id);
  });

  it("e-postası doğrulanmamış belgeyi reddeder, hesap açmaz", async () => {
    const { app, deps } = ctx();
    const res = await post(app, token({ email_verified: false }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ needsVerification: true });
    expect(deps.users.findByEmail("yeni@lavanta.com")).toBeNull();
  });

  it("başka bir Firebase hesabına bağlı e-postayı reddeder", async () => {
    const { app } = ctx();
    await post(app, token({ sub: "uid-1" }));
    const res = await post(app, token({ sub: "uid-2" }));
    expect(res.status).toBe(409);
  });

  it("kapatılmış hesap giremez", async () => {
    const { app, deps } = ctx();
    await post(app, token());
    deps.users.update(deps.users.findByEmail("yeni@lavanta.com")!.id, { disabled: true });
    expect((await post(app, token())).status).toBe(403);
  });

  it("sahte belgeyi 401 ile reddeder; art arda denemelerde 429", async () => {
    const { app } = ctx();
    for (let i = 0; i < 5; i++) expect((await post(app, token({}, { pair: otherKeys }))).status).toBe(401);
    expect((await post(app, token())).status).toBe(429);
  });

  it("Firebase kapalıysa 503, x-panel başlığı yoksa 403", async () => {
    const closed = makeApp(MONDAY_9AM);
    expect((await post(closed.app, token())).status).toBe(503);
    const { app } = ctx();
    const noHeader = await app.request("/api/auth/firebase", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: token() }) });
    expect(noHeader.status).toBe(403);
  });

  it("firmasız üye /api/auth/session ile görünür", async () => {
    const { app } = ctx();
    const cookie = (await post(app, token())).headers.get("set-cookie")!.split(";")[0]!;
    const res = await app.request("/api/auth/session", { headers: { cookie, "x-panel": "1" } });
    expect(await res.json()).toMatchObject({ user: { email: "yeni@lavanta.com", role: "owner" }, hasTenant: false });
    expect((await app.request("/api/auth/session")).status).toBe(401);
  });
});
