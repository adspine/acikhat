// Kurulum formu: sektöre göre özelleşen, adım adım doldurulan başvuru.
// Sektör tanımları sectors.js'te, bileşenler ui.js'te. Taslak yalnızca bu cihazda saklanır.
import { SECTORS, SECTOR_ORDER, ICONS, LANGUAGES, HOLIDAYS, CALENDARS } from "/sectors.js?v=33";
import { el, enhanceSelect, chipsInput, suggestChips } from "/ui.js?v=33";

const DRAFT_KEY = "acikhat-kurulum-taslak-v2";
const DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
const ROOM_LABELS = [["tek", "Tek kişilik"], ["cift", "Çift"], ["hamam", "Hamam"]];
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const form = $("[data-form]");
const state = {
  languages: ["Türkçe"],
  closed: [],
  payments: [],
  extras: {},
  faq: [],
  services: [],
  staff: [],
  hours: DAYS.map((_, i) => ({ day: i + 1, open: i < 6, from: "10:00", to: "20:00" })),
};
let api = { isMember: () => false, refresh: async () => {} };
// Taslaktan dönen "işletme yapısı" seçimi: seçenekler sektör seçilince oluştuğu için sonradan uygulanır
let restoredOperated = "";

const sectorId = () => form.elements["business.sector"].value;
const cfg = () => SECTORS[sectorId()] ?? null;
const fallback = SECTORS.diger;
const sc = () => cfg() ?? fallback;

/* ======================= Taslak ======================= */
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

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const ok = draft.save({ fields: readFields(), state, step: wizard.current });
    $("[data-draft-note]").textContent = ok
      ? "Doldurduklarınız bu cihazda otomatik saklanır."
      : "Bu tarayıcı taslak saklamaya izin vermiyor; formu tek seferde gönderin.";
  }, 300);
}

/* ======================= Basit alanlar (name="a.b") ======================= */
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
    f.__dd?.sync();
  }
  updateConditional();
}
function updateConditional() {
  for (const box of $$("[data-show-if]", form)) {
    const [name, value] = box.dataset.showIf.split("=");
    box.hidden = form.elements[name]?.value !== value;
  }
}
form.addEventListener("input", () => (updateConditional(), persist()));
form.addEventListener("change", () => (updateConditional(), persist()));

/* ======================= Sektör seçimi ======================= */
function renderSectors() {
  const grid = $("[data-sectors]");
  grid.innerHTML = "";
  for (const id of SECTOR_ORDER) {
    const s = SECTORS[id];
    const b = el("button", { type: "button", class: "sector", role: "radio", "aria-checked": "false", "data-sector": id });
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[id]}"/></svg>`;
    b.append(el("span", { class: "sector-text" }, el("strong", {}, s.label), el("span", {}, s.blurb)));
    b.addEventListener("click", () => chooseSector(id));
    grid.append(b);
  }
}

function chooseSector(id) {
  if (sectorId() === id) return;
  const hadSector = !!sectorId();
  form.elements["business.sector"].value = id;
  showFieldError($("[data-sectors]"), null);
  // Sektöre özel cevaplar başka sektörde anlamsız: sıfırlanır. Yazılmış hizmet ve ekip korunur.
  state.extras = {};
  const noAnswers = !state.faq.some((r) => r.a.trim());
  if (noAnswers || !hadSector) state.faq = SECTORS[id].faq.map((q) => ({ q, a: "" }));
  if (!state.services.some((s) => s.name.trim())) state.services = [blankService()];
  state.payments = state.payments.filter((p) => (SECTORS[id].payments ?? []).includes(p));
  applySector();
  persist();
}

/** Seçili sektöre göre tüm sektör bağımlı alanları günceller */
function applySector() {
  const s = cfg();
  const c = sc();
  for (const b of $$("[data-sector]")) b.setAttribute("aria-checked", String(b.dataset.sector === sectorId()));

  // işletme yapısı
  const op = $("[data-operated]");
  const current = op.value || restoredOperated;
  op.innerHTML = "";
  op.append(el("option", { value: "" }, s ? "Seçin" : "Önce işletme türünü seçin"));
  for (const t of c.structures) op.append(el("option", { value: t, selected: t === current }, t));
  op.__dd ? op.__dd.rebuild() : enhanceSelect(op);

  // adım başlıkları
  setStepTitle("hizmetler", c.services.title);
  setStepTitle("ekip", c.team.title);
  setStepTitle("detaylar", c.detailsTitle);
  for (const n of $$("[data-noun]")) n.textContent = c.noun;
  $("[data-247]").hidden = !c.hours247;

  // hizmetler
  $("[data-svc-title]").textContent = c.services.title;
  $("[data-svc-help]").textContent = c.services.help;
  $("[data-add-service]").textContent = c.services.add;
  renderServices();

  // ekip
  $("[data-team-title]").textContent = c.team.title;
  $("[data-team-help]").textContent = c.team.help;
  $("[data-add-staff]").textContent = c.team.add;
  const roomsOn = !!c.team.rooms;
  $("[data-rooms]").hidden = !roomsOn;
  renderStaff();

  // detaylar
  $("[data-details-title]").textContent = c.detailsTitle;
  const noun = c.noun[0].toLocaleUpperCase("tr") + c.noun.slice(1);
  $("[data-cal-label]").textContent = `${noun} kayıtlarınızı şu an nerede tutuyorsunuz?`;
  renderExtras();

  // kurallar
  const cancelField = $("[data-cancel-field]");
  cancelField.hidden = c.cancel === null;
  if (c.cancel) suggestChips($("#f-cancel"), c.cancel);
  $("[data-payment-field]").hidden = c.payments === null;
  mountPayments();
  $("[data-rules-field]").hidden = false;
  $("[data-rules-label]").textContent = c.rules.label;
  $("#f-health").placeholder = c.rules.ph;
  suggestChips($("#f-health"), c.rules.suggest);
  renderFaq();
}

/* ======================= Adım başlıkları ======================= */
function setStepTitle(name, title) {
  const i = wizard.index(name);
  const step = $$(".step", form)[i];
  step.dataset.title = title;
  const btn = $$("[data-stepper] button")[i];
  if (btn) btn.textContent = title;
}

/* ======================= Çalışma saatleri ======================= */
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
$("[data-247]").addEventListener("click", () => {
  for (const h of state.hours) Object.assign(h, { open: true, from: "00:00", to: "23:59" });
  renderHours();
  persist();
});

/* ======================= Dil, kapalı gün, ödeme (chips) ======================= */
const languagesInput = chipsInput({ options: LANGUAGES, value: state.languages, ariaLabel: "Konuşulan diller", placeholder: "Dil seçin veya yazın", onChange: (v) => ((state.languages = v), persist()) });
$("[data-languages]").append(languagesInput.root);

const closedInput = chipsInput({ options: HOLIDAYS, value: state.closed, ariaLabel: "Kapalı günler", placeholder: "Resmî tatil seçin veya yazın", onChange: (v) => ((state.closed = v), persist()) });
$("[data-closed]").append(closedInput.root);
{
  const date = el("input", { type: "date", class: "date-pick", "aria-label": "Kapalı olunacak tarihi seçin" });
  const btn = el("button", { type: "button", class: "btn btn-quiet btn-small" }, "Takvimden tarih ekle");
  btn.addEventListener("click", () => (date.showPicker ? date.showPicker() : date.focus()));
  date.addEventListener("change", () => {
    if (!date.value) return;
    const d = new Date(`${date.value}T12:00:00`);
    closedInput.add(d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }));
    date.value = "";
  });
  $("[data-closed]").append(el("div", { class: "quick" }, btn, date));
}

const paymentsInput = { host: $("[data-payments]"), instance: null };
function mountPayments() {
  const c = sc();
  paymentsInput.host.innerHTML = "";
  if (c.payments === null) return;
  paymentsInput.instance = chipsInput({
    options: c.payments,
    value: state.payments,
    ariaLabel: "Ödeme yöntemleri",
    placeholder: "Yöntem seçin veya yazın",
    onChange: (v) => ((state.payments = v), persist()),
  });
  paymentsInput.host.append(paymentsInput.instance.root);
}

/* ======================= Hizmetler ======================= */
const blankService = () => ({ name: "", durationMin: "", price: "", bufferMin: "15", room: "", staffCount: "1", capacity: "", note: "" });

const SERVICE_FIELDS = {
  duration: (c) => ["durationMin", "Süre (dk)", { type: "number", min: "5", inputmode: "numeric", placeholder: "60" }],
  price: (c) => ["price", c.services.priceLabel ?? "Fiyat", { placeholder: c.services.pricePh ?? "2500 TL" }],
  buffer: () => ["bufferMin", "Hazırlık (dk)", { type: "number", min: "0", inputmode: "numeric" }],
  capacity: (c) => ["capacity", c.services.capacityLabel ?? "Kapasite (kişi)", { type: "number", min: "1", inputmode: "numeric", placeholder: "2" }],
  note: () => ["note", "Not", { placeholder: "İsteğe bağlı" }],
};

function selectField(label, options, value, onPick) {
  const sel = el("select", {}, ...options.map(([v, t]) => el("option", { value: v, selected: value === v }, t)));
  sel.addEventListener("change", () => onPick(sel.value));
  const wrap = el("label", {}, label, sel);
  queueMicrotask(() => enhanceSelect(sel));
  return wrap;
}

function renderServices() {
  const c = sc();
  const box = $("[data-services]");
  box.innerHTML = "";
  if (!state.services.length) box.append(el("p", { class: "empty" }, c.services.empty));
  state.services.forEach((s, i) => {
    const input = (key, label, attrs = {}) => {
      const inp = el("input", { value: s[key] ?? "", ...attrs });
      inp.addEventListener("input", () => {
        s[key] = inp.value;
        persist();
        if (key === "name") renderStaff();
      });
      return el("label", { class: key === "name" ? "wide" : "" }, label, inp);
    };
    const cells = [input("name", c.services.nameLabel, { placeholder: c.services.namePh })];
    for (const f of c.services.fields) {
      if (f === "room") cells.push(selectField(c.services.roomLabel, [["", "Seçin"], ...c.services.rooms], s.room, (v) => ((s.room = v), persist())));
      else if (f === "staffCount") cells.push(selectField(c.services.staffCountLabel, [["1", "1 kişi"], ["2", "2 kişi (çift)"], ["3", "3 kişi"]], s.staffCount ?? "1", (v) => ((s.staffCount = v), persist())));
      else {
        const [key, label, attrs] = SERVICE_FIELDS[f](c);
        cells.push(input(key, label, attrs));
      }
    }
    box.append(
      el(
        "div",
        { class: "item" },
        el("div", { class: "item-grid" }, ...cells),
        el("button", { type: "button", class: "item-remove", onclick: () => (state.services.splice(i, 1), renderServices(), renderStaff(), persist()) }, "Kaldır"),
      ),
    );
  });
  renderServiceSuggestions();
}

function renderServiceSuggestions() {
  const c = sc();
  const host = $("[data-svc-suggest]");
  const list = $("[data-svc-suggest-list]");
  const have = new Set(state.services.map((s) => s.name.trim().toLocaleLowerCase("tr")));
  const items = (c.services.suggest ?? []).filter((t) => !have.has(t.toLocaleLowerCase("tr")));
  list.innerHTML = "";
  host.hidden = !items.length;
  for (const t of items) {
    const b = el("button", { type: "button", class: "suggest-chip" }, `+ ${t}`);
    b.addEventListener("click", () => {
      const blank = state.services.findIndex((s) => !s.name.trim() && !s.price && !s.durationMin);
      const row = { ...blankService(), name: t };
      if (blank >= 0) state.services[blank] = row;
      else state.services.push(row);
      renderServices();
      renderStaff();
      persist();
    });
    list.append(b);
  }
}
$("[data-add-service]").addEventListener("click", () => {
  state.services.push(blankService());
  renderServices();
  $$("[data-services] .item").at(-1)?.querySelector("input")?.focus();
  persist();
});

/* ======================= Ekip ======================= */
const blankStaff = () => ({ name: "", title: "", phone: "", gender: "", services: [] });

function renderStaff() {
  const c = sc();
  const box = $("[data-staff]");
  box.innerHTML = "";
  const serviceNames = state.services.map((s) => s.name.trim()).filter(Boolean);
  if (!state.staff.length) box.append(el("p", { class: "empty" }, c.team.empty));
  state.staff.forEach((p, i) => {
    const text = (key, label, attrs) => {
      const inp = el("input", { value: p[key] ?? "", ...attrs });
      inp.addEventListener("input", () => ((p[key] = inp.value), persist()));
      return el("label", {}, label, inp);
    };
    const cells = [text("name", `${c.team.person} adı`, { placeholder: "Ad soyad" }), text("title", c.team.titleLabel, { placeholder: c.team.titlePh })];
    if (c.team.gender) cells.push(selectField("Cinsiyeti", [["", "Seçin"], ["kadin", "Kadın"], ["erkek", "Erkek"]], p.gender, (v) => ((p.gender = v), persist())));
    if (c.team.phone) cells.push(text("phone", "Cep telefonu", { inputmode: "tel", placeholder: "05xx xxx xx xx" }));
    const item = el("div", { class: "item" }, el("div", { class: "item-grid" }, ...cells));
    if (c.team.linkServices) {
      const tags = el("div", { class: "tags", role: "group", "aria-label": "Yaptığı işlemler" });
      if (!serviceNames.length) tags.append(el("span", { class: "hint" }, "Önce hizmetleri ekleyin; burada seçebileceksiniz."));
      for (const sn of serviceNames) {
        const cb = el("input", { type: "checkbox", checked: p.services.includes(sn) });
        cb.addEventListener("change", () => {
          p.services = cb.checked ? [...new Set([...p.services, sn])] : p.services.filter((x) => x !== sn);
          persist();
        });
        tags.append(el("label", { class: "tag" }, cb, sn));
      }
      item.append(el("div", { class: "field" }, el("span", { class: "mini" }, "Yaptığı işlemler"), tags));
    }
    item.append(el("button", { type: "button", class: "item-remove", onclick: () => (state.staff.splice(i, 1), renderStaff(), persist()) }, "Kaldır"));
    box.append(item);
  });
}
$("[data-add-staff]").addEventListener("click", () => {
  state.staff.push(blankStaff());
  renderStaff();
  $$("[data-staff] .item").at(-1)?.querySelector("input")?.focus();
  persist();
});
// oda sayıları (yalnızca spa gibi odaya bağlı sektörler)
for (const [key, label] of ROOM_LABELS) {
  $("[data-rooms-grid]").append(el("label", { class: "mini" }, el("span", {}, label), el("input", { name: `rooms.${key}`, type: "number", min: "0", inputmode: "numeric" })));
}
$("[data-rooms-label]").textContent = "Oda sayısı";

/* ======================= Sektör detayları ======================= */
function renderExtras() {
  const c = sc();
  const box = $("[data-extras]");
  box.innerHTML = "";
  const set = (id, v) => {
    if (v === "" || (Array.isArray(v) && !v.length)) delete state.extras[id];
    else state.extras[id] = v;
    persist();
  };
  for (const e of c.extras) {
    const field = el("div", { class: "field" });
    const labelId = `x-${Math.random().toString(36).slice(2, 8)}`;
    field.append(el("span", { class: "label", id: labelId }, e.id, e.required ? "" : el("span", { class: "opt" }, " (isteğe bağlı)")));
    if (e.type === "chips") {
      const ci = chipsInput({ options: e.options, value: state.extras[e.id] ?? [], free: e.free ?? true, ariaLabel: e.id, placeholder: e.ph ?? "Seçin veya yazın", onChange: (v) => set(e.id, v) });
      field.append(ci.root);
    } else if (e.type === "select") {
      const sel = el("select", { "aria-labelledby": labelId }, el("option", { value: "" }, "Seçin"), ...e.options.map((o) => el("option", { value: o, selected: state.extras[e.id] === o }, o)));
      sel.addEventListener("change", () => set(e.id, sel.value));
      field.append(sel);
      queueMicrotask(() => enhanceSelect(sel));
    } else if (e.type === "yesno") {
      const seg = el("div", { class: "seg", role: "radiogroup", "aria-labelledby": labelId });
      for (const v of ["Evet", "Hayır"]) {
        const b = el("button", { type: "button", role: "radio", "aria-checked": String(state.extras[e.id] === v) }, v);
        b.addEventListener("click", () => {
          const next = state.extras[e.id] === v ? "" : v;
          set(e.id, next);
          for (const x of $$("button", seg)) x.setAttribute("aria-checked", String(x.textContent === next));
        });
        seg.append(b);
      }
      field.append(seg);
    } else {
      const inp = el("input", { type: e.type === "time" ? "time" : e.type === "number" ? "number" : "text", value: state.extras[e.id] ?? "", placeholder: e.ph ?? "", inputmode: e.type === "number" ? "numeric" : null, "aria-labelledby": labelId, "data-extra": e.id, ...(e.required && { required: true }) });
      inp.addEventListener("input", () => set(e.id, e.type === "number" && inp.value !== "" ? Number(inp.value) : inp.value));
      field.append(inp);
    }
    if (e.hint) field.append(el("p", { class: "hint" }, e.hint));
    box.append(field);
  }
}

// takvim seçenekleri (sektörden bağımsız)
{
  const sel = $("#f-cal");
  sel.append(el("option", { value: "" }, "Seçin"), ...CALENDARS.map(([v, t]) => el("option", { value: v }, t)));
  enhanceSelect(sel);
}

/* ======================= Sık sorulan sorular ======================= */
function renderFaq() {
  const box = $("[data-faq]");
  box.innerHTML = "";
  state.faq.forEach((row, i) => {
    const q = el("input", { value: row.q, "aria-label": "Soru", class: "faq-q" });
    const a = el("textarea", { rows: "2", placeholder: "Cevabınız (boş bırakırsanız atlanır)", "aria-label": "Cevap" }, row.a);
    q.addEventListener("input", () => ((row.q = q.value), persist()));
    a.addEventListener("input", () => ((row.a = a.value), persist()));
    box.append(
      el(
        "div",
        { class: "faq-row" },
        q,
        a,
        el("button", { type: "button", class: "item-remove", onclick: () => (state.faq.splice(i, 1), renderFaq(), persist()) }, "Kaldır"),
      ),
    );
  });
}
$("[data-add-faq]").addEventListener("click", () => {
  state.faq.push({ q: "", a: "" });
  renderFaq();
  $$("[data-faq] .faq-q").at(-1)?.focus();
  persist();
});

/* ======================= Gönderilecek veri ======================= */
const num = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? undefined : Number(v));
const clean = (v) => (typeof v === "string" ? v.trim() || undefined : v);

function buildPayload() {
  const f = readFields();
  const c = sc();
  const has = (field) => c.services.fields.includes(field);
  const faq = state.faq
    .filter((r) => r.q.trim() && r.a.trim())
    .map((r) => `${r.q.trim().replace(/\?*$/, "?")} ${r.a.trim().replace(/\s*\n\s*/g, " ")}`)
    .join("\n");
  const extras = {};
  for (const [k, v] of Object.entries(state.extras)) if (v !== "" && v != null && !(Array.isArray(v) && !v.length)) extras[k] = v;
  return {
    company_fax: f.company_fax,
    business: { sector: f["business.sector"] || undefined, name: clean(f["business.name"]) ?? "", address: clean(f["business.address"]), website: clean(f["business.website"]), operatedBy: clean(f["business.operatedBy"]) },
    contact: { person: clean(f["contact.person"]) ?? "", phone: clean(f["contact.phone"]) ?? "", email: clean(f["contact.email"]) ?? "" },
    phone: { publicNumber: clean(f["phone.publicNumber"]), when: clean(f["phone.when"]), transferNumber: clean(f["phone.transferNumber"]), languages: state.languages.join(", ") || undefined },
    hours: state.hours.map((h) => (h.open ? { day: h.day, open: true, from: h.from, to: h.to } : { day: h.day, open: false })),
    closedDates: state.closed.join(", ") || undefined,
    booking: { minLeadMinutes: num(f["booking.minLeadMinutes"]), maxDaysAhead: num(f["booking.maxDaysAhead"]) },
    services: state.services
      .filter((s) => s.name.trim())
      .map((s) => ({
        name: s.name.trim(),
        durationMin: has("duration") ? num(s.durationMin) : undefined,
        price: has("price") ? clean(s.price) : undefined,
        bufferMin: has("buffer") ? num(s.bufferMin) : undefined,
        room: has("room") ? s.room || undefined : undefined,
        staffCount: has("staffCount") ? num(s.staffCount) ?? 1 : undefined,
        capacity: has("capacity") ? num(s.capacity) : undefined,
        note: has("note") ? clean(s.note) : undefined,
      })),
    staff: state.staff
      .filter((p) => p.name.trim())
      .map((p) => ({ name: p.name.trim(), title: clean(p.title), gender: p.gender || undefined, phone: clean(p.phone), services: p.services.join(", ") || undefined })),
    rooms: c.team.rooms ? { tek: num(f["rooms.tek"]), cift: num(f["rooms.cift"]), hamam: num(f["rooms.hamam"]), diger: clean(f["rooms.diger"]) } : {},
    extras,
    calendar: { current: clean(f["calendar.current"]), software: clean(f["calendar.software"]) },
    policies: { cancellation: c.cancel === null ? undefined : clean(f["policies.cancellation"]), payment: state.payments.join(", ") || undefined, health: clean(f["policies.health"]), faq: faq || undefined },
    notifications: { channels: f["notifications.channels"] ?? [] },
    agent: { name: clean(f["agent.name"]), voice: clean(f["agent.voice"]), greetingNote: clean(f["agent.greetingNote"]) },
    consent: { kvkk: f["consent.kvkk"] === true, signer: clean(f["consent.signer"]) },
  };
}

/* ======================= Doğrulama ======================= */
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
  field?.querySelector(":scope > .field-error")?.remove();
  input.removeAttribute("aria-invalid");
  input.removeAttribute("aria-describedby");
  if (!message) return;
  const id = `${input.id || (input.name ?? "alan").replace(/\W/g, "-")}-hata`;
  input.setAttribute("aria-invalid", "true");
  input.setAttribute("aria-describedby", id);
  field?.append(el("p", { class: "field-error", id }, message));
}

function validateStep(step) {
  let first = null;
  if (step.dataset.step === "isletme") {
    const grid = $("[data-sectors]");
    const msg = sectorId() ? null : "İşletmenizin türünü seçin.";
    showFieldError(grid, msg);
    if (msg) first = $("[data-sector]");
  }
  for (const [name, check] of Object.entries(required)) {
    const input = form.elements[name];
    if (!input || !step.contains(input)) continue;
    const msg = check(input.value);
    showFieldError(input, msg);
    if (msg && !first) first = input;
  }
  for (const input of $$("[data-extra][required]", step)) {
    const msg = input.value.trim() ? null : "Bu bilgiyi yazın.";
    showFieldError(input, msg);
    if (msg && !first) first = input;
  }
  first?.focus();
  return !first;
}

/* ======================= Adımlar ======================= */
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
    steps[current].querySelector("input:not([type=hidden]), button.dd-btn, textarea")?.focus({ preventScroll: true });
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
    index: (name) => steps.findIndex((s) => s.dataset.step === name),
    goTo: (name) => show(steps.findIndex((s) => s.dataset.step === name)),
    markAllDone: (upto) => steps.forEach((_, j) => j < upto && done.add(j)),
  };
})();

/* ======================= Gözden geçir ======================= */
function renderReview() {
  const p = buildPayload();
  const c = sc();
  const box = $("[data-review]");
  box.innerHTML = "";
  const section = (title, step, items, missing) => {
    const s = el("section", {}, el("h3", {}, title, el("button", { type: "button", onclick: () => wizard.goTo(step) }, "Düzenle")));
    const list = items.filter(Boolean);
    if (list.length) s.append(el("ul", {}, ...list.map((t) => el("li", {}, t))));
    if (missing) s.append(el("p", { class: "missing" }, missing));
    box.append(s);
  };
  const whenText = { "mesgul-cevapsiz": "Siz açamadığınızda", "mesai-disi": "Yalnızca mesai dışında", "her-zaman": "Her zaman" };
  const extraLines = Object.entries(p.extras).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`);

  section("İşletme ve iletişim", "isletme", [SECTORS[p.business.sector]?.label, p.business.name, p.business.operatedBy, `${p.contact.person}, ${p.contact.phone}`, p.contact.email]);
  section(
    "Telefon",
    "telefon",
    [p.phone.publicNumber && `Aranan numara: ${p.phone.publicNumber}`, p.phone.when && `Asistan: ${whenText[p.phone.when]}`, p.phone.transferNumber ? `Aktarma: ${p.phone.transferNumber}` : "Aktarma yok, geri arama notu alınacak", p.phone.languages && `Diller: ${p.phone.languages}`],
    !p.phone.publicNumber ? "Müşterilerin aradığı numarayı yazarsanız kurulum hızlanır." : null,
  );
  section("Çalışma saatleri", "saatler", [...p.hours.map((h) => `${DAYS[h.day - 1]}: ${h.open ? `${h.from}–${h.to}` : "kapalı"}`), p.closedDates && `Kapalı günler: ${p.closedDates}`]);
  section(
    c.services.title,
    "hizmetler",
    p.services.map((s) => [s.name, s.durationMin && `${s.durationMin} dk`, s.capacity && `${s.capacity} kişi`, s.price, s.staffCount > 1 && `${s.staffCount} kişi`].filter(Boolean).join(", ")),
    p.services.length ? (c.services.fields.includes("duration") && p.services.some((s) => !s.durationMin) ? "Bazı kalemlerin süresi eksik. Asistan süreyi bilmeden saat öneremez." : null) : "Henüz bir şey eklemediniz. Kurulum sırasında sizinle birlikte tamamlarız.",
  );
  section(
    c.team.title,
    "ekip",
    [...p.staff.map((s) => [s.name, s.title, s.services && `(${s.services})`].filter(Boolean).join(" · ")), p.rooms.tek || p.rooms.cift || p.rooms.hamam ? [p.rooms.tek && `${p.rooms.tek} tek`, p.rooms.cift && `${p.rooms.cift} çift`, p.rooms.hamam && `${p.rooms.hamam} hamam`].filter(Boolean).join(", ") : null],
    p.staff.length ? null : "Ekip bilgisi eksik.",
  );
  section(c.detailsTitle, "detaylar", [...extraLines, p.calendar.current && `Kayıtlar: ${CALENDARS.find(([v]) => v === p.calendar.current)?.[1] ?? p.calendar.current}${p.calendar.software ? ` (${p.calendar.software})` : ""}`]);
  section("Kurallar ve sorular", "kurallar", [p.policies.cancellation && `İptal: ${p.policies.cancellation.replace(/\n/g, "; ")}`, p.policies.payment && `Ödeme: ${p.policies.payment}`, p.policies.faq && `${p.policies.faq.split("\n").length} soru cevaplandı`]);
  section("Asistan ve bildirimler", "asistan", [
    p.notifications.channels.length ? `Onay: ${p.notifications.channels.map((x) => (x === "sms" ? "SMS" : "WhatsApp")).join(", sonra ")}` : "Onay mesajı gönderilmeyecek",
    p.agent.name && `Asistanın adı: ${p.agent.name}`,
  ]);
}

/* ======================= Gönder ======================= */
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
    const ref = $("[data-ref]");
    if (ref) ref.textContent = json.reference;
    // Üyeyse yolculuğun 3. adımına, değilse eski "bilgileriniz alındı" sayfasına
    if (api.isMember()) {
      await api.refresh();
      location.hash = "#/hesap";
    } else location.hash = "#/tamam";
  } catch {
    errorBox.textContent = "Bilgiler gönderilemedi. İnternet bağlantınızı kontrol edip tekrar deneyin; doldurduklarınız kaybolmadı.";
    errorBox.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Bilgileri gönder";
  }
});

/* ======================= Başlangıç ======================= */
renderSectors();
for (const sel of $$("select", form)) enhanceSelect(sel);
{
  const saved = draft.load();
  if (saved?.state) {
    for (const k of Object.keys(state)) if (saved.state[k] !== undefined) state[k] = saved.state[k];
    if (!Array.isArray(state.hours) || state.hours.length !== 7) state.hours = DAYS.map((_, i) => ({ day: i + 1, open: i < 6, from: "10:00", to: "20:00" }));
    languagesInput.set(state.languages);
    closedInput.set(state.closed);
    restoredOperated = saved.fields?.["business.operatedBy"] ?? "";
    writeFields(saved.fields);
  }
  renderHours();
  applySector();
  if (saved?.step) {
    wizard.markAllDone(saved.step);
    wizard.show(saved.step);
  } else wizard.show(0);
}

/** Dışarıdan: oturum bilgisi ver, formu göster */
export function initForm(options) {
  api = { ...api, ...options };
}
export function showForm() {
  wizard.show(wizard.current);
}
