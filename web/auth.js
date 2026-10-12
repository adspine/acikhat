// Açık Hat: giriş, üye ol ve hesap sayfaları.
// Firebase yalnızca "bu kişi kim" sorusunu cevaplar; sonuç kimlik belgesini sunucuya veririz,
// sunucu doğrulayıp kendi oturum çerezini açar. Firebase tarayıcıda kalıcı kayıt tutmaz (bellek içi oturum).
// Bu değerler gizli değildir; Firebase web yapılandırması her ziyaretçide görünür.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBAW7N5g4Ihfl6-jULFjybon7AH3skBXNY",
  authDomain: "acikhat-ai.firebaseapp.com",
  projectId: "acikhat-ai",
  storageBucket: "acikhat-ai.firebasestorage.app",
  messagingSenderId: "633692441463",
  appId: "1:633692441463:web:60a6ec34fdc6462ffaef72",
};
const SDK = "https://www.gstatic.com/firebasejs/11.10.0";
const MIN_PASSWORD = 10;

const $ = (sel, root = document) => root.querySelector(sel);

/* ---------- Firebase'i yalnızca bu sayfalara girilince yükle ---------- */
let sdkPromise = null;
function loadSdk() {
  sdkPromise ??= (async () => {
    const [appMod, auth] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`)]);
    const au = auth.getAuth(appMod.initializeApp(FIREBASE_CONFIG));
    await auth.setPersistence(au, auth.inMemoryPersistence);
    au.languageCode = "tr";
    return { auth, au };
  })();
  sdkPromise.catch(() => (sdkPromise = null));
  return sdkPromise;
}

/* ---------- sunucu ---------- */
async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "x-panel": "1", ...(body && { "content-type": "application/json" }) },
    body: body && JSON.stringify(body),
    credentials: "same-origin",
  });
  return { res, data: await res.json().catch(() => ({})) };
}

const MESSAGES = {
  "auth/invalid-credential": "E-posta veya şifre hatalı.",
  "auth/wrong-password": "E-posta veya şifre hatalı.",
  "auth/user-not-found": "E-posta veya şifre hatalı.",
  "auth/invalid-email": "E-posta adresi geçerli görünmüyor.",
  "auth/email-already-in-use": "Bu e-posta ile zaten bir hesap var. Giriş yapmayı deneyin.",
  "auth/weak-password": `Şifre en az ${MIN_PASSWORD} karakter olmalı.`,
  "auth/too-many-requests": "Çok fazla deneme yapıldı. Biraz bekleyip tekrar deneyin.",
  "auth/user-disabled": "Bu hesap kapatılmış. Bizimle iletişime geçin.",
  "auth/network-request-failed": "Bağlantı kurulamadı. İnternetinizi kontrol edin.",
  "auth/account-exists-with-different-credential": "Bu e-posta başka bir yöntemle kayıtlı. O yöntemle giriş yapın.",
  "auth/operation-not-allowed": "Bu giriş yöntemi şu an kapalı.",
};
const SILENT = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request"]);
const messageFor = (err) => MESSAGES[err?.code] ?? (err?.message && !err.code ? err.message : "Bir sorun oluştu. Lütfen tekrar deneyin.");

/* ---------- eski hesaplar ---------- */
// Eski panelden açılan hesapların şifresi yalnızca sunucuda tutulur. Doğru şifreyle girerse oturum açılır ve aynı e-posta
// ile Firebase hesabı da açılır (şifre aynı kalır); doğrulama e-postası gönderilir. Sonraki girişler Firebase'den yapılır.
const LEGACY_FALLBACK = new Set(["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"]);

async function legacyLogin(email, password, auth, au) {
  const { res, data } = await post("/api/auth/login", { email, password });
  if (res.status === 429) throw new Error(data.error ?? "Çok fazla deneme yapıldı.");
  if (!res.ok) return false;
  // Geçici şifre ile girenlerde Firebase hesabı açılmaz: önce kendi şifrelerini belirlerler (panel ister)
  if (!data.mustChangePassword) {
    try {
      const { user } = await auth.createUserWithEmailAndPassword(au, email, password);
      await auth.sendEmailVerification(user);
    } catch {
      /* Firebase hesabı zaten varsa ya da açılamadıysa giriş yine de geçerlidir */
    }
    await auth.signOut(au).catch(() => {});
  }
  location.assign(data.hasTenant ? "/panel/" : "#/hesap");
  return true;
}

/* ---------- sayfa bağlama ---------- */
function bind(root) {
  if (root.dataset.bound) return;
  root.dataset.bound = "1";
  const kind = root.dataset.view === "uye-ol" ? "signup" : "login";
  const form = $("[data-auth-form]", root);
  const errorEl = $("[data-auth-error]", root);
  const verifyBox = $("[data-verify]", root);
  const verifyError = $("[data-verify-error]", root) ?? errorEl;
  const submit = $("[data-auth-submit]", root);
  const googleBtn = $("[data-google]", root);
  let current = null; // doğrulama bekleyen Firebase kullanıcısı

  const say = (el, text, info = false) => {
    el.hidden = !text;
    el.textContent = text ?? "";
    el.classList.toggle("is-info", info);
  };
  const busy = (on) => {
    for (const b of [submit, googleBtn, ...root.querySelectorAll("[data-verified],[data-resend],[data-forgot]")]) if (b) b.disabled = on;
    root.classList.toggle("is-busy", on);
  };

  const showVerify = (user) => {
    current = user;
    form.hidden = true;
    verifyBox.hidden = false;
  };

  // Kimlik belgesini sunucuya ver; oturum çerezi açılır
  async function finish(user) {
    const idToken = await user.getIdToken(true);
    const { res, data } = await post("/api/auth/firebase", { idToken });
    if (res.status === 403 && data.needsVerification) {
      showVerify(user);
      say(verifyError, "E-posta adresiniz henüz doğrulanmamış görünüyor.");
      return;
    }
    if (!res.ok) throw new Error(data.error ?? "Giriş yapılamadı.");
    location.assign(data.hasTenant ? "/panel/" : "#/hesap");
  }

  const run = async (fn) => {
    busy(true);
    say(errorEl, "");
    say(verifyError, "");
    try {
      await fn();
    } catch (err) {
      if (!SILENT.has(err?.code)) say(verifyBox.hidden ? errorEl : verifyError, messageFor(err));
    } finally {
      busy(false);
    }
  };

  googleBtn.addEventListener("click", () =>
    run(async () => {
      const { auth, au } = await loadSdk();
      const { user } = await auth.signInWithPopup(au, new auth.GoogleAuthProvider());
      await finish(user);
    }),
  );

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const email = String(f.get("email") ?? "").trim();
    const password = String(f.get("password") ?? "");
    if (!email || !password) return say(errorEl, "E-posta ve şifrenizi yazın.");
    if (kind === "signup") {
      const name = String(f.get("name") ?? "").trim();
      if (!name) return say(errorEl, "Adınızı ve soyadınızı yazın.");
      if (password.length < MIN_PASSWORD) return say(errorEl, `Şifre en az ${MIN_PASSWORD} karakter olmalı.`);
      if (!f.get("consent")) return say(errorEl, "Devam etmek için koşulları ve aydınlatma metnini onaylayın.");
      run(async () => {
        const { auth, au } = await loadSdk();
        const { user } = await auth.createUserWithEmailAndPassword(au, email, password);
        await auth.updateProfile(user, { displayName: name });
        await auth.sendEmailVerification(user);
        showVerify(user);
      });
    } else {
      run(async () => {
        const { auth, au } = await loadSdk();
        let user;
        try {
          ({ user } = await auth.signInWithEmailAndPassword(au, email, password));
        } catch (err) {
          // Firebase'de hesabı yoksa: eski panelden açılmış (yerel şifreli) hesap olabilir
          if (LEGACY_FALLBACK.has(err?.code) && (await legacyLogin(email, password, auth, au))) return;
          throw err;
        }
        if (!user.emailVerified) {
          // Eski panelden taşınmış hesap henüz e-postasını doğrulamadıysa, yerel şifresiyle girmesi engellenmez
          if (await legacyLogin(email, password, auth, au)) return;
          showVerify(user);
          say(verifyError, "E-posta adresinizi doğrulamanız gerekiyor.");
          return;
        }
        await finish(user);
      });
    }
  });

  $("[data-verified]", root)?.addEventListener("click", () =>
    run(async () => {
      if (!current) return;
      await current.reload();
      if (!current.emailVerified) throw new Error("Henüz doğrulanmamış görünüyor. Bağlantıya tıkladıktan sonra tekrar deneyin.");
      await finish(current);
    }),
  );

  $("[data-resend]", root)?.addEventListener("click", () =>
    run(async () => {
      const { auth } = await loadSdk();
      if (!current) return;
      await auth.sendEmailVerification(current);
      say(verifyError, "Doğrulama bağlantısını yeniden gönderdik.", true);
    }),
  );

  $("[data-forgot]", root)?.addEventListener("click", () =>
    run(async () => {
      const email = String(new FormData(form).get("email") ?? "").trim();
      if (!email) throw new Error("Önce e-posta adresinizi yazın.");
      const { auth, au } = await loadSdk();
      await auth.sendPasswordResetEmail(au, email).catch((err) => {
        // Kayıtlı olup olmadığını sızdırmamak için "kullanıcı yok" hatası da aynı yanıtı verir
        if (err?.code !== "auth/user-not-found") throw err;
      });
      say(errorEl, "Bu adres kayıtlıysa şifre sıfırlama bağlantısı gönderildi.", true);
    }),
  );
}

/** giris / uye-ol görünümü açıldığında: Firebase'i önceden yükle ve formları bağla */
export function mountAuth(view) {
  const root = document.querySelector(`[data-view="${view}"]`);
  if (!root) return;
  bind(root);
  loadSdk().catch(() => {});
  $("input", root)?.focus({ preventScroll: true });
}

/** Çıkışta Firebase oturumunu da kapat (yüklenmediyse yapacak bir şey yok) */
export async function signOutFirebase() {
  if (!sdkPromise) return;
  const { auth, au } = await sdkPromise;
  await auth.signOut(au);
}
