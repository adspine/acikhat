// Açık Hat — tanıtım ve kurulum sitesi
// Marka adı geçicidir; tek yerden değişir.
const BRAND = "Açık Hat";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

for (const el of $$("[data-brand]")) el.textContent = BRAND;

/* ======================= Hesap durumu ======================= */
// Oturum açık mı, firması var mı, kurulum yolculuğunda hangi adımda: sunucudan okunur.
// Üst çubuk ve onboarding ekranı buna göre değişir.
const account = { user: null, hasTenant: false, onboarding: null, paymentTestMode: false, ready: Promise.resolve() };
const defaultAuthHtml = $(".top-auth").innerHTML;
const goTo = (hash) => { location.hash = hash; };

function loadAccount() {
  account.ready = (async () => {
    try {
      const res = await fetch("/api/auth/session", { headers: { "x-panel": "1" }, credentials: "same-origin" });
      if (res.ok) Object.assign(account, await res.json());
      else Object.assign(account, { user: null, hasTenant: false, onboarding: null });
    } catch {
      /* bağlantı yoksa çıkış yapmış gibi davran */
    }
    renderChrome();
  })();
  return account.ready;
}

function renderChrome() {
  const bare = currentView === "giris" || currentView === "uye-ol";
  const onb = !!account.user && !account.hasTenant && (currentView === "hesap" || currentView === "kurulum");
  document.body.classList.toggle("is-bare", bare);
  document.body.classList.toggle("is-onboarding", onb);
  document.body.classList.add("is-ready");

  const bar = $("[data-onb-bar]");
  bar.hidden = !onb;
  if (onb) {
    const step = account.onboarding?.step ?? 1;
    for (const li of $$("[data-onb-step]", bar)) {
      const n = Number(li.dataset.onbStep);
      li.classList.toggle("is-done", n < step);
      li.classList.toggle("is-current", n === step);
      li.classList.toggle("is-working", n === 4 && step === 4);
    }
  }

  const slot = $(".top-auth");
  const step = account.onboarding?.step ?? 1;
  const key = account.user ? `${account.user.email}|${account.hasTenant}|${step}` : "";
  if (slot.dataset.rendered === key) return;
  slot.dataset.rendered = key;
  if (!account.user) {
    slot.innerHTML = defaultAuthHtml;
    return;
  }
  slot.innerHTML = `<div class="user-menu">
    <button class="user-chip" type="button" aria-haspopup="menu" aria-expanded="false" data-user-chip>
      <span class="user-avatar" data-u-initial></span><span class="user-name" data-u-name></span>
      <svg class="user-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
    </button>
    <div class="user-pop" role="menu">
      <p class="user-mail" data-u-mail></p>
      <a role="menuitem" href="#/hesap">${account.hasTenant || step === 4 ? "Hesabım" : "Kuruluma devam et"}</a>
      ${account.hasTenant ? `<a role="menuitem" href="/panel/">${account.user.role === "agency" ? "Yönetim paneli" : "Panele git"}</a>` : ""}
      <button role="menuitem" type="button" data-logout>Çıkış yap</button>
    </div>
  </div>`;
  const first = account.user.name?.trim().split(/\s+/)[0] || account.user.email;
  $("[data-u-initial]", slot).textContent = first[0].toLocaleUpperCase("tr");
  $("[data-u-name]", slot).textContent = first;
  $("[data-u-mail]", slot).textContent = account.user.email;
}

// Sayfa, oturum durumuna göre doğru yere yönlendirilir
function guard(view) {
  const u = account.user;
  const step = account.onboarding?.step;
  if ((view === "hesap" || view === "kurulum") && !u) return goTo("#/giris");
  if ((view === "giris" || view === "uye-ol") && u) return goTo("#/hesap");
  if (u && !account.hasTenant) {
    if (view === "kurulum" && step !== 2) return goTo("#/hesap");
    if (view === "hesap" && step === 2) return goTo("#/kurulum");
  }
  renderChrome();
  if (view === "hesap") {
    $('[data-view="hesap"]').hidden = false;
    import("/onboarding.js?v=34").then((m) => m.showHesap(account, { refresh: loadAccount }));
  }
  if (view === "giris" || view === "uye-ol") import("/auth.js?v=34").then((m) => m.mountAuth(view));
  if (view === "kurulum" && u) {
    // Üyenin adı ve e-postası forma hazır gelsin (boşsa)
    for (const [name, value] of [["contact.person", u.name], ["contact.email", u.email]]) {
      const input = $(`[name="${name}"]`);
      if (input && !input.value && value) { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); }
    }
  }
}

// Fiyat kartından gelen üye, paketi seçmiş sayılır: onboarding'te hazır işaretlenir
document.addEventListener("click", (e) => {
  const link = e.target.closest("[data-pick-plan]");
  if (link) try { sessionStorage.setItem("acikhat-plan", link.dataset.pickPlan); } catch {}
});

document.addEventListener("click", async (e) => {
  const chip = e.target.closest("[data-user-chip]");
  const menu = $(".user-menu");
  if (chip) {
    const open = menu.classList.toggle("is-open");
    chip.setAttribute("aria-expanded", String(open));
    return;
  }
  if (menu && !e.target.closest(".user-pop")) {
    menu.classList.remove("is-open");
    $("[data-user-chip]")?.setAttribute("aria-expanded", "false");
  }
  if (e.target.closest("[data-logout]")) {
    await fetch("/api/auth/logout", { method: "POST", headers: { "x-panel": "1" }, credentials: "same-origin" }).catch(() => {});
    import("/auth.js?v=34").then((m) => m.signOutFirebase()).catch(() => {});
    Object.assign(account, { user: null, hasTenant: false, onboarding: null });
    renderChrome();
    goTo("#/");
  }
});

/* ======================= Yönlendirme ======================= */
// Ana sayfadaki bölümler de kendi adresiyle açılır (#/fiyatlandirma gibi) ve o bölüme kayar.
const sections = ["nasil", "ozellikler", "fiyatlandirma", "sss", "iletisim"];
const routes = { "": "home", kurulum: "kurulum", rehber: "rehber", "numara-al": "numara-al", tamam: "tamam", yasal: "yasal", giris: "giris", "uye-ol": "uye-ol", hesap: "hesap", ...Object.fromEntries(sections.map((k) => [k, "home"])) };
const titles = {
  home: "Yapay Zeka Telefon Asistanı, Sesli Resepsiyonist | Açık Hat",
  kurulum: `Kurulum formu — ${BRAND}`,
  rehber: `Kurulum rehberi — ${BRAND}`,
  "numara-al": `Netgsm'den numara alma rehberi — ${BRAND}`,
  tamam: `Bilgileriniz alındı — ${BRAND}`,
  yasal: `Yasal — ${BRAND}`,
  giris: `Giriş yap — ${BRAND}`,
  "uye-ol": `Üye ol — ${BRAND}`,
  hesap: `Hesabım — ${BRAND}`,
};
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
let currentView = null;

function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  const key = parts[0];
  const view = routes[key] ?? "home";
  const changed = view !== currentView;
  currentView = view;
  for (const v of $$("[data-view]")) v.hidden = v.dataset.view !== view;
  for (const a of $$("[data-nav]")) {
    if (a.dataset.nav === view) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  document.title = titles[view];
  if (view === "yasal") {
    // #/yasal/<sayfa>: ilgili metin açılır, bilinmeyen ad ilk metne düşer
    const arts = $$("[data-legal]");
    const art = arts.find((x) => x.dataset.legal === parts[1]) ?? arts[0];
    for (const x of arts) x.hidden = x !== art;
    for (const a of $$("[data-legal-link]")) {
      if (a.dataset.legalLink === art.dataset.legal) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    document.title = `${art.dataset.title} — ${BRAND}`;
  }
  if (view !== "home") demo.pause();
  setMenu(false);
  const target = view === "home" && sections.includes(key) ? document.getElementById(key) : null;
  if (target) target.scrollIntoView({ behavior: changed || reduceMotion.matches ? "instant" : "smooth", block: "start" });
  else window.scrollTo({ top: 0, behavior: changed || reduceMotion.matches ? "instant" : "smooth" });
  if (view === "kurulum") openForm();
  renderChrome();
  // Oturumla ilgili sayfalarda durum her seferinde sunucudan tazelenir
  const fresh = ["hesap", "kurulum", "giris", "uye-ol"].includes(view);
  if (view === "hesap") $('[data-view="hesap"]').hidden = true;
  (fresh ? loadAccount() : account.ready).then(() => { if (currentView === view) guard(view); });
  spy();
  effects.refresh();
}

/* ======================= Örnek görüşme ======================= */
const demo = (() => {
  const call = $(".call");
  const audio = $("[data-audio]");
  const list = $("[data-transcript]");
  const progress = $("[data-progress]");
  const timeEl = $("[data-time]");
  const durEl = $("[data-duration]");
  let lines = [];
  let duration = 0;

  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  fetch("/audio/demo.json")
    .then((r) => r.json())
    .then((data) => {
      lines = data.lines;
      duration = data.duration;
      durEl.textContent = fmt(duration);
      list.innerHTML = "";
      for (const l of lines) {
        const li = document.createElement("li");
        li.className = `line line-${l.who}`;
        const who = document.createElement("span");
        who.className = "line-who";
        who.textContent = l.who === "agent" ? "Asistan" : "Arayan";
        const text = document.createElement("span");
        text.className = "line-text";
        text.textContent = l.text;
        li.append(who, text);
        list.append(li);
      }
    })
    .catch(() => {
      list.innerHTML = '<li class="line is-said">Örnek görüşme yüklenemedi. Sayfayı yenileyin.</li>';
    });

  let lastNow = -1;
  function sync() {
    const t = audio.currentTime;
    progress.style.width = `${Math.min(100, (t / (audio.duration || duration || 1)) * 100)}%`;
    timeEl.textContent = fmt(t);
    const items = list.children;
    let now = -1;
    lines.forEach((l, i) => {
      const said = t >= l.start;
      if (said) now = i;
      items[i]?.classList.toggle("is-said", said && t > l.end);
    });
    for (let i = 0; i < items.length; i++) items[i].classList.toggle("is-now", i === now && t <= lines[i].end + 0.55);
    if (now !== lastNow && now >= 0) {
      lastNow = now;
      const item = items[now];
      list.scrollTo({ top: item.offsetTop - list.offsetTop - 40 });
    }
  }

  function toggle() {
    if (audio.paused) {
      if (audio.ended) audio.currentTime = 0;
      audio.play().catch(() => {});
    } else audio.pause();
  }

  $("[data-play]").addEventListener("click", toggle);
  audio.addEventListener("play", () => {
    call.classList.add("is-playing");
    $("[data-play]").setAttribute("aria-label", "Duraklat");
  });
  const stopped = () => {
    call.classList.remove("is-playing");
    $("[data-play]").setAttribute("aria-label", "Görüşmeyi dinle");
  };
  audio.addEventListener("pause", stopped);
  audio.addEventListener("ended", () => {
    stopped();
    for (const li of list.children) li.classList.add("is-said");
  });
  audio.addEventListener("timeupdate", sync);
  $(".bar").addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const d = audio.duration || duration;
    if (!d) return;
    audio.currentTime = ((e.clientX - r.left) / r.width) * d;
    if (audio.paused) sync();
  });

  return { pause: () => audio.pause() };
})();


/* ======================= Üst çubuk, menü ve kaydırma efektleri ======================= */
const top = $("[data-top]");
const menuBtn = $("[data-menu]");
function setMenu(open) {
  top.classList.toggle("is-open", open);
  menuBtn.setAttribute("aria-expanded", String(open));
  menuBtn.setAttribute("aria-label", open ? "Menüyü kapat" : "Menüyü aç");
}
menuBtn.addEventListener("click", () => setMenu(menuBtn.getAttribute("aria-expanded") !== "true"));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });
document.addEventListener("click", (e) => { if (!top.contains(e.target)) setMenu(false); });

// Hangi bölümdeysek menüde o bağlantı vurgulanır
function spy() {
  let active = null;
  if (currentView === "home") {
    active = "top";
    const line = innerHeight * 0.4;
    for (const sec of $$("[data-section]")) if (sec.getBoundingClientRect().top <= line) active = sec.dataset.section;
  }
  for (const a of $$("[data-spy]")) a.classList.toggle("is-current", a.dataset.spy === active);
  for (const a of $$("[data-nav]")) a.classList.toggle("is-current", a.dataset.nav === currentView && currentView !== "home");
}

const effects = (() => {
  document.documentElement.classList.add("js");
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  let parallax = [];
  let slides = [];
  let lagging = [];
  let ticking = false;

  const reveal = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-in"); reveal.unobserve(e.target); }
  }, { threshold: 0.15, rootMargin: "0px 0px -6% 0px" });

  // Kurulum adımları: ekranın ortasına gelen kart yanar
  const cards = $$(".how-card");
  const dots = $$(".how-dots li");
  const stepIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const i = cards.indexOf(e.target);
      cards.forEach((c, n) => c.classList.toggle("is-active", n === i));
      dots.forEach((d, n) => d.classList.toggle("is-on", n === i));
    }
  }, { rootMargin: "-45% 0px -45% 0px" });
  cards.forEach((c) => stepIO.observe(c));

  function frame() {
    ticking = false;
    const vh = innerHeight;
    top.classList.toggle("is-scrolled", scrollY > 24);
    spy();
    if (reduceMotion.matches || currentView !== "home") return;
    for (const el of parallax) {
      const r = el.getBoundingClientRect();
      if (r.bottom < -200 || r.top > vh + 200) continue;
      const d = r.top + r.height / 2 - vh / 2;
      el.style.translate = `0 ${(-d * el.__speed).toFixed(1)}px`;
    }
    // yüzen kartlar: sayfanın en üstünde yerinde, kaydırdıkça biraz geriden gelir
    for (const el of lagging) el.style.translate = `0 ${(Math.min(scrollY, vh) * el.__lag).toFixed(1)}px`;
    for (const el of slides) {
      const r = el.parentElement.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) continue;
      const p = clamp((vh - r.top) / (vh + r.height), 0, 1) - 0.5;
      const w = el.scrollWidth - innerWidth;
      el.style.translate = `${(p * -el.__dir * Math.max(w, innerWidth * 0.6)).toFixed(1)}px 0`;
    }
  }
  const request = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
  addEventListener("scroll", request, { passive: true });
  addEventListener("resize", request);

  return {
    refresh() {
      parallax = $$("[data-parallax]").map((el) => ((el.__speed = parseFloat(el.dataset.parallax)), el));
      lagging = $$("[data-lag]").map((el) => ((el.__lag = parseFloat(el.dataset.lag)), el));
      slides = $$("[data-slide]").map((el) => ((el.__dir = parseFloat(el.dataset.slide)), el));
      $$("[data-reveal]:not(.is-in)").forEach((el, i) => {
        el.style.setProperty("--d", `${(i % 3) * 0.08}s`);
        reveal.observe(el);
      });
      request();
    },
  };
})();

/* ======================= SSS akordiyonu ======================= */
// <details> varsayılan olarak anında açılır; yüksekliği kendimiz akıtırız.
// Niyet (wantOpen) ayrı tutulur: animasyon sürerken tekrar tıklanırsa kutu bulunduğu yükseklikten tersine döner.
for (const d of $$(".faq details")) {
  const sum = d.querySelector("summary");
  let anim = null;
  let wantOpen = d.open;

  sum.addEventListener("click", (e) => {
    e.preventDefault();
    wantOpen = !wantOpen;
    if (reduceMotion.matches) { d.open = wantOpen; return; }

    const from = d.getBoundingClientRect().height;
    if (anim) {
      // eski animasyonun bitiş kodu yeni durumu bozmasın
      anim.onfinish = anim.oncancel = null;
      anim.cancel();
      anim = null;
    }
    d.style.height = "";
    d.classList.toggle("is-closing", !wantOpen);
    if (wantOpen) d.open = true;
    const to = wantOpen ? d.getBoundingClientRect().height : sum.getBoundingClientRect().height + 1;

    const mine = d.animate(
      { height: [from + "px", to + "px"] },
      { duration: wantOpen ? 560 : 520, easing: wantOpen ? "cubic-bezier(.25,.8,.25,1)" : "cubic-bezier(.45,.05,.2,1)" },
    );
    anim = mine;
    mine.onfinish = () => {
      if (anim !== mine) return;
      anim = null;
      d.style.height = "";
      if (!wantOpen) {
        d.open = false;
        d.classList.remove("is-closing");
      }
    };
  });
}

/* ======================= Kurulum formu ======================= */
// Form büyük olduğu için yalnızca açılınca yüklenir (web/form.js)
function openForm() {
  import("/form.js?v=35").then((m) => {
    m.initForm({ isMember: () => !!account.user && !account.hasTenant, refresh: loadAccount });
    m.showForm();
  });
}

/* ======================= Rehber sekmeleri ======================= */
for (const tabs of $$("[data-tabs]")) {
  const buttons = $$('[role="tab"]', tabs);
  const select = (b) => {
    for (const x of buttons) {
      const on = x === b;
      x.setAttribute("aria-selected", String(on));
      x.tabIndex = on ? 0 : -1;
      document.getElementById(x.getAttribute("aria-controls")).hidden = !on;
    }
  };
  buttons.forEach((b, i) => {
    b.addEventListener("click", () => select(b));
    b.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const next = buttons[(i + (e.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length];
      select(next);
      next.focus();
    });
  });
}

/* ======================= Hero: canlı test görüşmesi ======================= */
// Numarayı sunucu arar (en fazla 2 dk, numara başına 2 deneme). Süre ve hak sınırı sunucuda uygulanır;
// buradaki sayaç yalnızca ziyaretçiye ne kadar zaman kaldığını gösterir.
(() => {
  const root = $("[data-try]");
  if (!root) return;
  const form = $("[data-try-form]", root);
  const live = $("[data-try-live]", root);
  const input = $("#try-phone", root);
  const submit = $("[data-try-submit]", root);
  const errorEl = $("[data-try-error]", root);
  const title = $("[data-try-title]", root);
  const text = $("[data-try-text]", root);
  const bar = $("[data-try-bar]", root);
  const time = $("[data-try-time]", root);
  const after = $("[data-try-after]", root);
  const again = $("[data-try-again]", root);
  let maxSeconds = 120;
  let timer = 0;

  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
  const showError = (msg, withSignup = false) => {
    errorEl.textContent = msg;
    if (msg && withSignup) {
      const a = document.createElement("a");
      a.href = "#/uye-ol";
      a.textContent = "Hemen başlayın";
      errorEl.append(" ", a);
    }
    errorEl.hidden = !msg;
    input.setAttribute("aria-invalid", msg ? "true" : "false");
  };

  // Yazarken 0532 111 22 33 biçimine getirir
  input.addEventListener("input", () => {
    const d = input.value.replace(/\D/g, "").slice(0, 11);
    input.value = [d.slice(0, 4), d.slice(4, 7), d.slice(7, 9), d.slice(9, 11)].filter(Boolean).join(" ");
    if (errorEl.textContent) showError("");
  });

  // Sunucuda kapalıysa kart boş kalmaz: form yerine kısa bir açıklama gösterilir
  function closed() {
    form.hidden = true;
    $("[data-try-off]", root).hidden = false;
  }

  // Sunucu yeniden başlıyorsa (deploy) birkaç saniye cevap vermeyebilir: pes etmeden 3 kez dener.
  // Yalnızca sunucu "kapalı" derse kart kapalı gösterilir.
  async function loadConfig(attempt = 0) {
    try {
      const r = await fetch("/api/demo-call", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const cfg = await r.json();
      if (!cfg.enabled) return closed();
      maxSeconds = cfg.maxSeconds || 120;
      if (cfg.name) for (const el of $$("[data-try-name]", root)) el.textContent = cfg.name;
    } catch {
      if (attempt < 3) setTimeout(() => loadConfig(attempt + 1), 2000 * (attempt + 1));
      else closed();
    }
  }
  loadConfig();

  const stop = () => { clearInterval(timer); timer = 0; };

  function startCountdown(masked, remaining, name) {
    form.hidden = true;
    live.hidden = false;
    root.classList.add("is-playing");
    after.hidden = true;
    again.hidden = true;
    title.textContent = "Telefonunuz çalıyor";
    text.textContent = `${masked} numarasını arıyoruz. Açtığınızda ${name || "Demo işletme"} asistanı sizi karşılayacak. Bir randevu almayı deneyin.`;
    title.focus();
    const t0 = Date.now();
    // Arama birkaç sn içinde çalmaya başlar; sayaç görüşme süresi dolana kadar kalan zamanı gösterir
    const total = maxSeconds + 15;
    const tick = () => {
      const used = Math.floor((Date.now() - t0) / 1000);
      const left = total - used;
      bar.style.width = `${Math.min(100, (used / total) * 100)}%`;
      if (left > 0) {
        time.textContent = `Görüşme en fazla ${mmss(maxSeconds)} sürer. Kalan süre ${mmss(left)}`;
        return;
      }
      stop();
      root.classList.remove("is-playing");
      title.textContent = "Görüşme bitti";
      text.textContent = "Asistanı kendi işletmeniz için kurmak 15 dakika sürer. Numaranız değişmez, müşterileriniz bildikleri numarayı aramaya devam eder.";
      time.textContent = remaining > 0 ? "Bir hakkınız daha var." : "Bu numaranın test hakkı doldu.";
      after.hidden = false;
      again.hidden = remaining <= 0;
    };
    tick();
    timer = setInterval(tick, 1000);
  }

  again.addEventListener("click", () => {
    stop();
    root.classList.remove("is-playing");
    live.hidden = true;
    form.hidden = false;
    submit.disabled = false;
    input.focus();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    const data = new FormData(form);
    const phone = String(data.get("phone") || "").trim();
    if (phone.replace(/\D/g, "").length < 10) {
      showError("Cep numaranızı 05xx xxx xx xx biçiminde yazın.");
      input.focus();
      return;
    }
    if (!data.get("consent")) {
      showError("Aranmak için onay kutusunu işaretleyin.");
      return;
    }
    submit.disabled = true;
    submit.textContent = "Aranıyor";
    try {
      const res = await fetch("/api/demo-call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, consent: true, website: String(data.get("website") || "") }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Hak dolduysa yapılacak şey artık denemek değil, kurmaktır
        showError(body.error || "Arama başlatılamadı. Biraz sonra tekrar deneyin.", body.code === "limit");
        return;
      }
      maxSeconds = body.maxSeconds || maxSeconds;
      startCountdown(body.masked || "Numaranızı", body.remaining ?? 0, $("[data-try-name]", root)?.textContent);
    } catch {
      showError("Bağlantı kurulamadı. İnternetinizi kontrol edip tekrar deneyin.");
    } finally {
      submit.disabled = false;
      submit.textContent = "Beni arayın";
    }
  });
})();

window.addEventListener("hashchange", route);
loadAccount();
route();
