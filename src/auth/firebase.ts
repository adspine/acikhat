import { createPublicKey, verify, type JsonWebKeyInput, type KeyObject } from "node:crypto";
import { randomBytes } from "node:crypto";

/**
 * Firebase Authentication kimlik belgesi (ID token) doğrulaması.
 * Gizli anahtar gerekmez: belge Google'ın herkese açık anahtarlarıyla imzalıdır, biz imzayı ve iddiaları denetleriz.
 * Kütüphanesiz tutuldu (proje bağımlılıkları az); kural: https://firebase.google.com/docs/auth/admin/verify-id-tokens
 */
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const CLOCK_SKEW_S = 300;

export interface FirebaseIdentity {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

export interface FirebaseVerifier {
  verify(idToken: string): Promise<FirebaseIdentity>;
}

export class FirebaseAuthError extends Error {}

type Jwks = { keys: (JsonWebKeyInput["key"] & { kid: string })[] };
export type JwksFetcher = () => Promise<{ jwks: Jwks; maxAgeMs: number }>;

const fetchGoogleJwks: JwksFetcher = async () => {
  const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Google anahtarları alınamadı (${res.status})`);
  const maxAge = /max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1];
  return { jwks: (await res.json()) as Jwks, maxAgeMs: (maxAge ? Number(maxAge) : 3600) * 1000 };
};

const b64 = (s: string) => Buffer.from(s, "base64url");
const parseJson = (s: string) => {
  try {
    return JSON.parse(b64(s).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new FirebaseAuthError("Geçersiz kimlik belgesi");
  }
};

export function createFirebaseVerifier(opts: {
  projectId: string;
  fetchJwks?: JwksFetcher;
  now?: () => number;
}): FirebaseVerifier {
  const fetchJwks = opts.fetchJwks ?? fetchGoogleJwks;
  const now = opts.now ?? Date.now;
  let keys = new Map<string, KeyObject>();
  let expires = 0;

  async function refresh() {
    const { jwks, maxAgeMs } = await fetchJwks();
    keys = new Map(jwks.keys.map((k) => [k.kid, createPublicKey({ key: k, format: "jwk" })]));
    expires = now() + maxAgeMs;
  }

  async function keyFor(kid: string): Promise<KeyObject> {
    if (!keys.size || now() > expires) await refresh();
    let key = keys.get(kid);
    // Google anahtarı yeni döndürmüş olabilir: bilinmeyen kid için bir kez daha çek
    if (!key) {
      await refresh();
      key = keys.get(kid);
    }
    if (!key) throw new FirebaseAuthError("Kimlik belgesi anahtarı tanınmıyor");
    return key;
  }

  return {
    async verify(idToken) {
      const parts = idToken.split(".");
      if (parts.length !== 3 || idToken.length > 8192) throw new FirebaseAuthError("Geçersiz kimlik belgesi");
      const [h, p, s] = parts as [string, string, string];
      const header = parseJson(h);
      if (header.alg !== "RS256" || typeof header.kid !== "string") throw new FirebaseAuthError("Geçersiz kimlik belgesi");

      const key = await keyFor(header.kid);
      if (!verify("RSA-SHA256", Buffer.from(`${h}.${p}`), key, b64(s))) throw new FirebaseAuthError("İmza doğrulanamadı");

      const c = parseJson(p);
      const nowS = Math.floor(now() / 1000);
      const num = (v: unknown) => (typeof v === "number" ? v : NaN);
      if (!(num(c.exp) > nowS)) throw new FirebaseAuthError("Kimlik belgesinin süresi dolmuş");
      if (!(num(c.iat) <= nowS + CLOCK_SKEW_S)) throw new FirebaseAuthError("Geçersiz kimlik belgesi");
      if (!(num(c.auth_time) <= nowS + CLOCK_SKEW_S)) throw new FirebaseAuthError("Geçersiz kimlik belgesi");
      if (c.aud !== opts.projectId || c.iss !== `https://securetoken.google.com/${opts.projectId}`) {
        throw new FirebaseAuthError("Kimlik belgesi bu uygulamaya ait değil");
      }
      if (typeof c.sub !== "string" || !c.sub || c.sub.length > 128) throw new FirebaseAuthError("Geçersiz kimlik belgesi");
      if (typeof c.email !== "string" || !c.email) throw new FirebaseAuthError("Hesapta e-posta yok");

      return {
        uid: c.sub,
        email: c.email,
        emailVerified: c.email_verified === true,
        name: typeof c.name === "string" && c.name.trim() ? c.name.trim() : undefined,
      };
    },
  };
}

/**
 * Şifre belirleme e-postası: Firebase'in kendi e-postası gönderilir, bağlantıdaki sayfada kullanıcı yeni şifresini yazar.
 * Hesap Firebase'de yoksa (eski panelden gelen kullanıcı) önce rastgele şifreyle açılır, sonra e-posta gönderilir.
 * Yalnızca herkese açık web anahtarı kullanılır; yönetici yetkisi gerekmez.
 */
export function createPasswordResetSender(opts: { apiKey: string; fetchFn?: typeof fetch }): (email: string) => Promise<void> {
  const doFetch = opts.fetchFn ?? fetch;
  const call = async (path: string, body: unknown): Promise<string | null> => {
    const res = await doFetch(`https://identitytoolkit.googleapis.com/v1/accounts:${path}?key=${opts.apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return null;
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return json.error?.message ?? `HTTP ${res.status}`;
  };
  return async (email) => {
    let err = await call("sendOobCode", { requestType: "PASSWORD_RESET", email });
    if (err === "EMAIL_NOT_FOUND") {
      const made = await call("signUp", { email, password: randomBytes(24).toString("base64url"), returnSecureToken: false });
      if (made && made !== "EMAIL_EXISTS") throw new Error(`Firebase hesabı açılamadı: ${made}`);
      err = await call("sendOobCode", { requestType: "PASSWORD_RESET", email });
    }
    if (err) throw new Error(`Şifre e-postası gönderilemedi: ${err}`);
  };
}
