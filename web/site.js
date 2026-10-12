// Açık Hat — tanıtım ve kurulum sitesi
// Marka adı geçicidir; tek yerden değişir.
const BRAND = "Açık Hat";
const DRAFT_KEY = "acikhat-kurulum-taslak-v1";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

for (const el of $$("[data-brand]")) el.textContent = BRAND;

/* ======================= Yönlendirme ======================= */
const routes = { "": "home", kurulum: "kurulum", rehber: "rehber", tamam: "tamam" };
const titles = {
  home: `${BRAND} — telefonunuzu yapay zekâ ile cevaplayın`,
  kurulum: `Kurulum formu — ${BRAND}`,
  rehber: `Kurulum rehberi — ${BRAND}`,
  tamam: `Bilgileriniz alındı — ${BRAND}`,
};

function route() {
  const key = location.hash.replace(/^#\/?/, "").split("/")[0];
  const view = routes[key] ?? "home";
  for (const v of $$("[data-view]")) v.hidden = v.dataset.view !== view;
  for (const a of $$("[data-nav]")) {
    if (a.dataset.nav === view) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  document.title = titles[view];
  if (view !== "home") demo.pause();
  window.scrollTo({ top: 0 });
  if (view === "kurulum") wizard.show(wizard.current);
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

/* ======================= Taslak saklama ======================= */
// Taslak yalnızca bu cihazda tutulur; erişilemezse form yine çalışır.
const draft = {
  load() {
    try {
      return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
    } catch {
      return null;
    }
  },
  save(data) {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  },
  clear() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {}
  },
};

/* ======================= Form ======================= */
const DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
const ROOM_TYPES = [
  ["tek", "Tek kişilik oda"],
  ["cift", "Çift oda"],
  ["hamam", "Hamam"],
  ["diger", "Diğer"],
];

const form = $("[data-form]");
const state = {
  services: [],
  staff: [],
  hours: DAYS.map((_, i) => ({ day: i + 1, open: i < 6, from: "10:00", to: "20:00" })),
};

const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, "");
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  n.append(...children.filter((c) => c != null));
  return n;
};

/* --- çalışma saatleri --- */
function renderHours() {
  const box = $("[data-hours]");
  box.innerHTML = "";
  state.hours.forEach((h, i) => {
    const row = el("div", { class: `hour${h.open ? "" : " is-closed"}` });
    const open = el("input", { type: "checkbox", id: `h-open-${i}`, checked: h.open });
    open.addEventListener("change", () => {
      h.open = open.checked;
      renderHours();
      persist();
    });
    const from = el("input", { type: "time", value: h.from, class: "hour-time", disabled: !h.open, "aria-label": `${DAYS[i]} açılış` });
    const to = el("input", { type: "time", value: h.to, class: "hour-time", disabled: !h.open, "aria-label": `${DAYS[i]} kapanış` });
    from.addEventListener("change", () => ((h.from = from.value), persist()));
    to.addEventListener("change", () => ((h.to = to.value), persist()));
    row.append(
      el("label", { class: "hour-day", for: `h-open-${i}` }, open, DAYS[i]),
      el("span", { class: "hour-sep hour-label" }, h.open ? "açılış" : "kapalı"),
      from,
      el("span", { class: "hour-sep" }, "–"),
      to,
    );
    box.append(row);
  });
}
$("[data-copy-hours]").addEventListener("click", () => {
  const [mon] = state.hours;
  for (const h of state.hours) if (h.open) Object.assign(h, { from: mon.from, to: mon.to });
  renderHours();
  persist();
});

/* --- hizmetler --- */
const blankService = () => ({ name: "", durationMin: "", price: "", bufferMin: "15", room: "tek", staffCount: "1" });

function renderServices() {
  const box = $("[data-services]");
  box.innerHTML = "";
  if (!state.services.length) box.append(el("p", { class: "empty" }, "Henüz hizmet yok. Fiyat listenizdeki her hizmet için bir satır ekleyin."));
  state.services.forEach((s, i) => {
    const input = (key, label, attrs = {}) => {
      const inp = el("input", { value: s[key] ?? "", ...attrs });
      inp.addEventListener("input", () => {
        s[key] = inp.value;
        persist();
        if (key === "name") renderStaff();
      });
      return el("label", {}, label, inp);
    };
    const room = el("select", {}, ...ROOM_TYPES.map(([v, t]) => el("option", { value: v, selected: s.room === v }, t)));
    room.addEventListener("change", () => ((s.room = room.value), persist()));
    const team = el("select", {}, ...[["1", "1 kişi"], ["2", "2 kişi (çift)"], ["3", "3 kişi"]].map(([v, t]) => el("option", { value: v, selected: (s.staffCount ?? "1") === v }, t)));
    team.addEventListener("change", () => ((s.staffCount = team.value), persist()));
    box.append(
      el(
        "div",
        { class: "item" },
        el(
          "div",
          { class: "item-grid" },
          input("name", "Hizmet adı", { placeholder: "Örn. Klasik masaj" }),
          input("durationMin", "Süre (dk)", { type: "number", min: "5", inputmode: "numeric", placeholder: "60" }),
          input("price", "Fiyat", { placeholder: "2500 TL" }),
          input("bufferMin", "Hazırlık (dk)", { type: "number", min: "0", inputmode: "numeric" }),
          el("label", {}, "Nerede yapılıyor", room),
          el("label", {}, "Kaç terapist", team),
        ),
        el("button", { type: "button", class: "item-remove", onclick: () => (state.services.splice(i, 1), renderServices(), renderStaff(), persist()) }, "Hizmeti kaldır"),
      ),
    );
  });
}
$("[data-add-service]").addEventListener("click", () => {
  state.services.push(blankService());
  renderServices();
  $$("[data-services] .item").at(-1)?.querySelector("input")?.focus();
  persist();
});

/* --- ekip --- */
const blankStaff = () => ({ name: "", gender: "", services: [] });

function renderStaff() {
  const box = $("[data-staff]");
  box.innerHTML = "";
  const serviceNames = state.services.map((s) => s.name.trim()).filter(Boolean);
  if (!state.staff.length) box.append(el("p", { class: "empty" }, "Randevu veren her kişi için bir satır ekleyin."));
  state.staff.forEach((p, i) => {
    const name = el("input", { value: p.name, placeholder: "Örn. Ayşe" });
    name.addEventListener("input", () => ((p.name = name.value), persist()));
    const gender = el(
      "select",
      {},
      el("option", { value: "" }, "Seçin"),
      el("option", { value: "kadin", selected: p.gender === "kadin" }, "Kadın"),
      el("option", { value: "erkek", selected: p.gender === "erkek" }, "Erkek"),
    );
    gender.addEventListener("change", () => ((p.gender = gender.value), persist()));
    const tags = el("div", { class: "tags", role: "group", "aria-label": "Yaptığı hizmetler" });
    if (!serviceNames.length) tags.append(el("span", { class: "hint" }, "Önce hizmetleri ekleyin; burada seçebileceksiniz."));
    for (const sn of serviceNames) {
      const cb = el("input", { type: "checkbox", checked: p.services.includes(sn) });
      cb.addEventListener("change", () => {
        p.services = cb.checked ? [...new Set([...p.services, sn])] : p.services.filter((x) => x !== sn);
        persist();
      });
      tags.append(el("label", { class: "tag" }, cb, sn));
    }
    box.append(
      el(
        "div",
        { class: "item" },
        el("div", { class: "item-grid staff-grid" }, el("label", {}, "Adı", name), el("label", {}, "Cinsiyeti", gender)),
        el("div", { class: "field" }, el("span", { class: "mini" }, "Yaptığı hizmetler"), tags),
        el("button", { type: "button", class: "item-remove", onclick: () => (state.staff.splice(i, 1), renderStaff(), persist()) }, "Kişiyi kaldır"),
      ),
    );
  });
}
$("[data-add-staff]").addEventListener("click", () => {
  state.staff.push(blankStaff());
  renderStaff();
  $$("[data-staff] .item").at(-1)?.querySelector("input")?.focus();
  persist();
});

/* --- basit alanlar (name="a.b") --- */
function readFields() {
  const out = {};
  for (const f of $$("input[name], select[name], textarea[name]", form)) {
    if (f.name === "company_fax") continue;
    if (f.type === "radio" && !f.checked) continue;
    if (f.type === "checkbox" && f.name === "notifications.channels") {
      out[f.name] ??= [];
      if (f.checked) out[f.name].push(f.value);
      continue;
    }
    out[f.name] = f.type === "checkbox" ? f.checked : f.value;
  }
  return out;
}
function writeFields(values) {
  for (const f of $$("input[name], select[name], textarea[name]", form)) {
    const v = values?.[f.name];
    if (v === undefined) continue;
    if (f.type === "radio") f.checked = f.value === v;
    else if (f.type === "checkbox" && Array.isArray(v)) f.checked = v.includes(f.value);
    else if (f.type === "checkbox") f.checked = !!v;
    else f.value = v;
  }
  updateConditional();
}
function updateConditional() {
  for (const box of $$("[data-show-if]", form)) {
    const [name, value] = box.dataset.showIf.split("=");
    box.hidden = form.elements[name]?.value !== value;
  }
}

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const ok = draft.save({ fields: readFields(), ...state, step: wizard.current });
    $("[data-draft-note]").textContent = ok
      ? "Doldurduklarınız bu cihazda otomatik saklanır."
      : "Bu tarayıcı taslak saklamaya izin vermiyor; formu tek seferde gönderin.";
  }, 300);
}
form.addEventListener("input", () => (updateConditional(), persist()));
form.addEventListener("change", () => (updateConditional(), persist()));

/* --- gönderilecek veri --- */
const num = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? undefined : Number(v));
const clean = (v) => (typeof v === "string" ? v.trim() || undefined : v);

function buildPayload() {
  const f = readFields();
  return {
    company_fax: f.company_fax,
    business: { name: clean(f["business.name"]) ?? "", address: clean(f["business.address"]), website: clean(f["business.website"]), operatedBy: clean(f["business.operatedBy"]) },
    contact: { person: clean(f["contact.person"]) ?? "", phone: clean(f["contact.phone"]) ?? "", email: clean(f["contact.email"]) ?? "" },
    phone: { publicNumber: clean(f["phone.publicNumber"]), when: clean(f["phone.when"]), transferNumber: clean(f["phone.transferNumber"]), languages: clean(f["phone.languages"]) },
    hours: state.hours.map((h) => (h.open ? { day: h.day, open: true, from: h.from, to: h.to } : { day: h.day, open: false })),
    closedDates: clean(f.closedDates),
    booking: { minLeadMinutes: num(f["booking.minLeadMinutes"]), maxDaysAhead: num(f["booking.maxDaysAhead"]) },
    services: state.services
      .filter((s) => s.name.trim())
      .map((s) => ({ name: s.name.trim(), durationMin: num(s.durationMin), price: clean(s.price), bufferMin: num(s.bufferMin), room: s.room, staffCount: num(s.staffCount) ?? 1 })),
    staff: state.staff
      .filter((p) => p.name.trim())
      .map((p) => ({ name: p.name.trim(), gender: p.gender || undefined, services: p.services.join(", ") || undefined })),
    rooms: { tek: num(f["rooms.tek"]), cift: num(f["rooms.cift"]), hamam: num(f["rooms.hamam"]), diger: clean(f["rooms.diger"]) },
    calendar: { current: clean(f["calendar.current"]), software: clean(f["calendar.software"]) },
    policies: { cancellation: clean(f["policies.cancellation"]), payment: clean(f["policies.payment"]), health: clean(f["policies.health"]), faq: clean(f["policies.faq"]) },
    notifications: { channels: f["notifications.channels"] ?? [] },
    agent: { name: clean(f["agent.name"]), voice: clean(f["agent.voice"]), greetingNote: clean(f["agent.greetingNote"]) },
    consent: { kvkk: f["consent.kvkk"] === true, signer: clean(f["consent.signer"]) },
  };
}

/* --- doğrulama (yalnızca gerçekten zorunlu olanlar) --- */
const phoneOk = (v) => {
  let d = (v || "").replace(/\D/g, "");
  if (d.startsWith("90") && d.length === 12) d = d.slice(2);
  if (d.startsWith("0") && d.length === 11) d = d.slice(1);
  return d.length === 10 && !d.startsWith("0");
};
const required = {
  "business.name": (v) => (v.trim().length >= 2 ? null : "İşletmenin adını yazın."),
  "contact.person": (v) => (v.trim().length >= 2 ? null : "Yetkili kişinin adını yazın."),
  "contact.phone": (v) => (phoneOk(v) ? null : "Telefonu 05xx xxx xx xx biçiminde yazın."),
  "contact.email": (v) => (!v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : "E-posta adresini kontrol edin."),
};

function showFieldError(input, message) {
  const field = input.closest(".field");
  field?.querySelector(".field-error")?.remove();
  input.removeAttribute("aria-invalid");
  input.removeAttribute("aria-describedby");
  if (!message) return;
  const id = `${input.id || input.name.replace(/\W/g, "-")}-hata`;
  input.setAttribute("aria-invalid", "true");
  input.setAttribute("aria-describedby", id);
  field?.append(el("p", { class: "field-error", id }, message));
}

function validateStep(step) {
  let first = null;
  for (const [name, check] of Object.entries(required)) {
    const input = form.elements[name];
    if (!input || !step.contains(input)) continue;
    const msg = check(input.value);
    showFieldError(input, msg);
    if (msg && !first) first = input;
  }
  first?.focus();
  return !first;
}

/* --- adımlar --- */
const wizard = (() => {
  const steps = $$(".step", form);
  const stepper = $("[data-stepper]");
  const done = new Set();
  let current = 0;

  steps.forEach((s, i) => {
    const b = el("button", { type: "button" }, s.dataset.title);
    b.addEventListener("click", () => {
      if (i > current && !validateStep(steps[current])) return;
      show(i);
    });
    stepper.append(el("li", {}, b));
  });

  function show(i) {
    current = Math.max(0, Math.min(steps.length - 1, i));
    steps.forEach((s, j) => (s.hidden = j !== current));
    $$("button", stepper).forEach((b, j) => {
      if (j === current) b.setAttribute("aria-current", "step");
      else b.removeAttribute("aria-current");
      b.classList.toggle("is-done", done.has(j) && j !== current);
    });
    // Mobilde adımlar yatay kayar: aktif adımı görünür yap (sayfayı dikey kaydırmadan)
    const active = $$("button", stepper)[current];
    stepper.scrollTo({ left: active.offsetLeft - stepper.clientWidth / 2 + active.clientWidth / 2 });
    $("[data-prev]", form).style.visibility = current === 0 ? "hidden" : "visible";
    const last = current === steps.length - 1;
    $("[data-next]", form).hidden = last;
    $("[data-submit]", form).hidden = !last;
    $("[data-form-error]").hidden = true;
    if (last) renderReview();
    persist();
  }

  $("[data-next]", form).addEventListener("click", () => {
    if (!validateStep(steps[current])) return;
    done.add(current);
    show(current + 1);
    $(".form-wrap").scrollIntoView({ block: "start" });
    steps[current].querySelector("input, select, textarea")?.focus({ preventScroll: true });
  });
  $("[data-prev]", form).addEventListener("click", () => {
    show(current - 1);
    $(".form-wrap").scrollIntoView({ block: "start" });
  });

  return {
    show,
    get current() {
      return current;
    },
    goTo: (name) => show(steps.findIndex((s) => s.dataset.step === name)),
    markAllDone: (upto) => steps.forEach((_, j) => j < upto && done.add(j)),
  };
})();

/* --- gözden geçir --- */
function renderReview() {
  const p = buildPayload();
  const box = $("[data-review]");
  box.innerHTML = "";
  const section = (title, step, items, missing) => {
    const s = el(
      "section",
      {},
      el("h3", {}, title, el("button", { type: "button", onclick: () => wizard.goTo(step) }, "Düzenle")),
    );
    const list = items.filter(Boolean);
    if (list.length) s.append(el("ul", {}, ...list.map((t) => el("li", {}, t))));
    if (missing) s.append(el("p", { class: "missing" }, missing));
    box.append(s);
  };
  const whenText = { "mesgul-cevapsiz": "Siz açamadığınızda", "mesai-disi": "Yalnızca mesai dışında", "her-zaman": "Her zaman" };

  section("İşletme ve iletişim", "isletme", [p.business.name, `${p.contact.person}, ${p.contact.phone}`, p.contact.email]);
  section(
    "Telefon",
    "telefon",
    [
      p.phone.publicNumber && `Aranan numara: ${p.phone.publicNumber}`,
      p.phone.when && `Asistan: ${whenText[p.phone.when]}`,
      p.phone.transferNumber ? `Aktarma: ${p.phone.transferNumber}` : "Aktarma yok, geri arama notu alınacak",
    ],
    !p.phone.publicNumber ? "Müşterilerin aradığı numarayı yazarsanız kurulum hızlanır." : null,
  );
  section(
    "Çalışma saatleri",
    "saatler",
    p.hours.map((h) => `${DAYS[h.day - 1]}: ${h.open ? `${h.from}–${h.to}` : "kapalı"}`),
  );
  section(
    "Hizmetler",
    "hizmetler",
    p.services.map((s) => [s.name, s.durationMin && `${s.durationMin} dk`, s.price, s.staffCount > 1 && `${s.staffCount} terapist`].filter(Boolean).join(", ")),
    p.services.length ? (p.services.some((s) => !s.durationMin) ? "Bazı hizmetlerin süresi eksik. Asistan süreyi bilmeden saat öneremez." : null) : "Hizmet eklemediniz. Kurulum sırasında sizinle birlikte tamamlarız.",
  );
  section(
    "Ekip ve odalar",
    "ekip",
    [...p.staff.map((s) => `${s.name}${s.services ? `: ${s.services}` : ""}`), [p.rooms.tek && `${p.rooms.tek} tek`, p.rooms.cift && `${p.rooms.cift} çift`, p.rooms.hamam && `${p.rooms.hamam} hamam`].filter(Boolean).join(", ")],
    p.staff.length ? null : "Ekip bilgisi eksik.",
  );
  section("Asistan ve bildirimler", "asistan", [
    p.notifications.channels.length ? `Onay: ${p.notifications.channels.map((c) => (c === "sms" ? "SMS" : "WhatsApp")).join(", sonra ")}` : "Onay mesajı gönderilmeyecek",
    p.agent.name && `Asistanın adı: ${p.agent.name}`,
  ]);
}

/* --- gönder --- */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorBox = $("[data-form-error]");
  errorBox.hidden = true;
  const payload = buildPayload();
  if (!payload.consent.kvkk) {
    errorBox.textContent = "Göndermek için onay kutusunu işaretleyin.";
    errorBox.hidden = false;
    form.elements["consent.kvkk"].focus();
    return;
  }
  const btn = $("[data-submit]", form);
  btn.disabled = true;
  btn.textContent = "Gönderiliyor";
  try {
    const res = await fetch("/api/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      const field = json.fields?.[0];
      errorBox.textContent = field ? `${field.message}. İlgili adıma dönüp düzeltin.` : json.error || "Bilgiler gönderilemedi. Bağlantınızı kontrol edip tekrar deneyin.";
      errorBox.hidden = false;
      return;
    }
    draft.clear();
    $("[data-ref]").textContent = json.reference;
    location.hash = "#/tamam";
  } catch {
    errorBox.textContent = "Bilgiler gönderilemedi. İnternet bağlantınızı kontrol edip tekrar deneyin; doldurduklarınız kaybolmadı.";
    errorBox.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Bilgileri gönder";
  }
});

/* --- taslağı geri yükle --- */
{
  const saved = draft.load();
  if (saved) {
    if (Array.isArray(saved.services)) state.services = saved.services;
    if (Array.isArray(saved.staff)) state.staff = saved.staff;
    if (Array.isArray(saved.hours) && saved.hours.length === 7) state.hours = saved.hours;
    writeFields(saved.fields);
  }
  if (!state.services.length) state.services.push(blankService());
  renderHours();
  renderServices();
  renderStaff();
  if (saved?.step) {
    wizard.markAllDone(saved.step);
    wizard.show(saved.step);
  } else wizard.show(0);
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

window.addEventListener("hashchange", route);
route();
