// Açık Hat: üye onboarding ekranı (hesap görünümü): 1 paket + ödeme → 2 kurulum formu → 3 numara alma (Netgsm) → 4 onay bekleniyor.
// Adım sunucuda tutulur: çıkış yapıp dönen üye kaldığı adımdan devam eder.
// Fiyat ve dakika sunucuda src/domain/plans.ts'te tutulur; buradakiler yalnızca gösterim içindir.
const PLANS = {
  baslangic: { name: "Başlangıç", price: 149, list: 199, minutes: 400 },
  standart: { name: "Standart", price: 299, list: 399, minutes: 1000 },
  pro: { name: "Pro", price: 599, list: 799, minutes: 2500 },
};
const fmtMinutes = (n) => n.toLocaleString("tr-TR");

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "x-panel": "1", ...(body && { "content-type": "application/json" }) },
    body: body && JSON.stringify(body),
    credentials: "same-origin",
  });
  return { res, data: await res.json().catch(() => ({})) };
}

function renderPlans(root, account) {
  const chosen = account.onboarding?.plan ?? null;
  for (const card of $$("[data-plan-card]", root)) {
    const on = card.dataset.planCard === chosen;
    card.classList.toggle("is-selected", on);
    const btn = $("[data-plan]", card);
    btn.textContent = on ? "Seçildi ✓" : `${PLANS[card.dataset.planCard].name}'ı seç`;
    btn.setAttribute("aria-pressed", String(on));
  }
  const box = $("[data-checkout]", root);
  box.hidden = !chosen;
  if (chosen) {
    const p = PLANS[chosen];
    $("[data-checkout-name]", root).textContent = p.name;
    $("[data-checkout-detail]", root).textContent = `$${p.price} / ay · ${fmtMinutes(p.minutes)} dk yapay zekâ kullanımı (liste fiyatı $${p.list})`;
    $("[data-pay-test]", root).hidden = !account.paymentTestMode;
  }
}

function bindPlans(root, account, ctx) {
  if (root.dataset.bound) return;
  root.dataset.bound = "1";
  const errorEl = $("[data-pay-error]", root);
  const say = (t) => {
    errorEl.hidden = !t;
    errorEl.textContent = t ?? "";
  };

  root.addEventListener("click", async (e) => {
    const pick = e.target.closest("[data-plan]");
    if (pick) {
      say("");
      const { res, data } = await post("/api/auth/plan", { plan: pick.dataset.plan });
      if (!res.ok) return say(data.error ?? "Paket seçilemedi.");
      Object.assign(account, data);
      renderPlans(root, account);
      $("[data-checkout]", root).scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    if (e.target.closest("[data-pay]")) {
      const btn = $("[data-pay]", root);
      say("");
      btn.disabled = true;
      try {
        const { res, data } = await post("/api/auth/pay");
        if (!res.ok) return say(data.error ?? "Ödeme tamamlanamadı.");
        if (data.checkoutUrl) {
          location.href = data.checkoutUrl; // güvenli ödeme sayfası (Polar)
          return;
        }
        Object.assign(account, data);
        await ctx.refresh();
        location.hash = "#/kurulum"; // paket ödendi: 2. adım
      } finally {
        btn.disabled = false;
      }
    }
  });
}

/** Fiyat kartından gelen üyenin seçtiği paketi (henüz seçim yapmadıysa) otomatik işaretler */
async function applyRememberedPlan(root, account) {
  let remembered = null;
  try {
    remembered = sessionStorage.getItem("acikhat-plan");
    sessionStorage.removeItem("acikhat-plan");
  } catch {}
  if (!remembered || account.onboarding?.plan || !PLANS[remembered]) return;
  const { res, data } = await post("/api/auth/plan", { plan: remembered });
  if (!res.ok) return;
  Object.assign(account, data);
  renderPlans(root, account);
}

/** Ödeme sayfasından dönüşte (?odeme=ok) Polar'ın bildirimi gelene kadar bekler, sonra kurulum adımına geçer */
async function awaitPayment(root, account, ctx) {
  const url = new URL(location.href);
  if (url.searchParams.get("odeme") !== "ok") return;
  url.searchParams.delete("odeme");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  const box = $("[data-pay-error]", root);
  box.hidden = false;
  box.textContent = "Ödemeniz doğrulanıyor, lütfen bekleyin…";
  for (let i = 0; i < 20; i++) {
    const r = await fetch("/api/auth/session", { credentials: "same-origin", headers: { "x-panel": "1" } });
    const data = await r.json().catch(() => ({}));
    if (data.onboarding?.paidAt) {
      Object.assign(account, data);
      await ctx.refresh();
      location.hash = "#/kurulum";
      return;
    }
    await new Promise((ok) => setTimeout(ok, 1500));
  }
  box.textContent = "Ödemeniz alındıysa birkaç dakika içinde hesabınıza yansır. Sayfayı yenileyin; sorun sürerse bize yazın.";
}

const showPhone = (e164) => {
  const d = (e164 ?? "").replace("+90", "");
  return d.length === 10 ? `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8)}` : e164 ?? "";
};

/** 3. adım: numara formu. Üye numarasını aldıktan sonra numara ve onaylarla gönderir; başarılıysa 4. adıma geçer. */
function bindLine(root, account, ctx) {
  const form = $("[data-line-form]", root);
  if (form.dataset.bound) return;
  form.dataset.bound = "1";
  const errorEl = $("[data-line-error]", root);
  const say = (t) => {
    errorEl.hidden = !t;
    errorEl.textContent = t ?? "";
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    say("");
    const btn = $("[data-line-submit]", root);
    btn.disabled = true;
    try {
      const { res, data } = await post("/api/onboarding/line", {
        number: form.elements.number.value,
        subscriptionType: form.elements.subscriptionType.value,
        sipConfigured: form.elements.sipConfigured.checked,
        ownerConfirmed: form.elements.ownerConfirmed.checked,
      });
      if (!res.ok) return say(data.error ?? "Numara gönderilemedi. Bağlantınızı kontrol edip tekrar deneyin.");
      account.editLine = false;
      await ctx.refresh();
      showHesap(account, ctx);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      say("Numara gönderilemedi. Bağlantınızı kontrol edip tekrar deneyin.");
    } finally {
      btn.disabled = false;
    }
  });
  $("[data-line-edit]", root).addEventListener("click", () => {
    account.editLine = true;
    showHesap(account, ctx);
  });
}

/** hesap görünümü: giriş ve yönlendirme kontrolleri site.js'te yapılır, burası yalnızca içeriği doldurur */
export function showHesap(account, ctx) {
  const root = $('[data-view="hesap"]');
  const first = account.user.name?.trim().split(/\s+/)[0];
  $("[data-account-name]", root).textContent = first ? `, ${first}` : "";
  $("[data-account-mail]", root).textContent = account.user.email;
  $("[data-panel-link]", root).hidden = !account.hasTenant;

  const step = account.onboarding?.step;
  // 4. adımdaki üye "numarayı değiştir" derse numara formu yeniden açılır
  const which = account.hasTenant ? "done" : step === 4 ? (account.editLine ? "3" : "4") : step === 3 ? "3" : "1";
  for (const p of $$("[data-onb-panel]", root)) p.hidden = p.dataset.onbPanel !== which;
  $(".onb-hello", root).hidden = which === "done";

  if (which === "1") {
    bindPlans(root, account, ctx);
    renderPlans(root, account);
    applyRememberedPlan(root, account);
    awaitPayment(root, account, ctx);
  }
  if (which === "3" || which === "4") {
    for (const el of $$("[data-onb-ref]", root)) el.textContent = account.onboarding.reference ?? "—";
    bindLine(root, account, ctx);
  }
  if (which === "3") {
    const form = $("[data-line-form]", root);
    if (account.onboarding.lineNumber && !form.elements.number.value) form.elements.number.value = showPhone(account.onboarding.lineNumber);
  }
  if (which === "4") {
    const plan = PLANS[account.onboarding.plan];
    $("[data-onb-plan]", root).textContent = plan ? `${plan.name}: ${fmtMinutes(plan.minutes)} dk yapay zekâ kullanımı, aylık $${plan.price}` : "";
    $("[data-onb-line]", root).textContent = account.onboarding.lineNumber ? `${showPhone(account.onboarding.lineNumber)}. Kontrol edip asistana bağlayacağız.` : "—";
  }
}
