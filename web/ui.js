// Kurulum formunun ortak bileşenleri: özel açılır menü, etiketli çoklu seçim (chips), öneri düğmeleri.
// Hepsi form değerlerini mevcut alanlarla senkron tutar; kütüphane kullanılmaz.

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
export { el };

const CARET = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
let uid = 0;

/* ======================= Özel açılır menü ======================= */
// Yerel <select> gizlenir ama formda kalır; değer ve "change" olayı ona yazılır, eski kod aynen çalışır.
export function enhanceSelect(select) {
  if (select.__dd) return select.__dd;
  const id = `dd-${++uid}`;
  const label = select.closest("label, .field");
  const btn = el("button", { type: "button", class: "dd-btn", "aria-haspopup": "listbox", "aria-expanded": "false", id: `${id}-btn` });
  const text = el("span", { class: "dd-val" });
  btn.append(text);
  btn.insertAdjacentHTML("beforeend", CARET);
  const list = el("ul", { class: "dd-list", role: "listbox", tabindex: "-1", id: `${id}-list`, "aria-labelledby": btn.id });
  const root = el("div", { class: "dd" }, btn, list);
  select.hidden = true;
  select.after(root);
  // <label for> yoksa etiketi düğmeye bağla
  const lab = select.id ? document.querySelector(`label[for="${select.id}"]`) : null;
  if (lab) lab.addEventListener("click", (e) => { e.preventDefault(); btn.focus(); });
  if (select.getAttribute("aria-label")) btn.setAttribute("aria-label", select.getAttribute("aria-label"));

  let active = -1;
  const options = () => [...select.options];

  function rebuild() {
    list.innerHTML = "";
    options().forEach((o, i) => {
      const li = el("li", { role: "option", id: `${id}-o${i}`, "data-i": String(i), class: "dd-opt" }, o.textContent);
      if (!o.value) li.classList.add("is-placeholder");
      list.append(li);
    });
    sync();
  }
  function sync() {
    const o = select.selectedOptions[0];
    const empty = !o || !o.value;
    text.textContent = o ? o.textContent : "Seçin";
    btn.classList.toggle("is-empty", empty);
    list.querySelectorAll(".dd-opt").forEach((li, i) => li.setAttribute("aria-selected", String(options()[i]?.selected && !!options()[i].value)));
    btn.disabled = select.disabled;
  }
  function setActive(i) {
    const items = [...list.children];
    if (!items.length) return;
    active = Math.max(0, Math.min(items.length - 1, i));
    items.forEach((li, j) => li.classList.toggle("is-active", j === active));
    btn.setAttribute("aria-activedescendant", items[active].id);
    items[active].scrollIntoView({ block: "nearest" });
  }
  function open() {
    if (select.disabled || root.classList.contains("is-open")) return;
    document.dispatchEvent(new CustomEvent("dd-open", { detail: root }));
    root.classList.remove("dd-up");
    root.classList.add("is-open");
    btn.setAttribute("aria-expanded", "true");
    const r = btn.getBoundingClientRect();
    if (innerHeight - r.bottom < Math.min(280, list.scrollHeight + 16) && r.top > innerHeight - r.bottom) root.classList.add("dd-up");
    setActive(Math.max(0, select.selectedIndex));
  }
  function close(focus = false) {
    root.classList.remove("is-open");
    btn.setAttribute("aria-expanded", "false");
    btn.removeAttribute("aria-activedescendant");
    if (focus) btn.focus();
  }
  function choose(i) {
    const o = options()[i];
    if (!o) return;
    select.selectedIndex = i;
    sync();
    select.dispatchEvent(new Event("change", { bubbles: true }));
    select.dispatchEvent(new Event("input", { bubbles: true }));
    close(true);
  }

  btn.addEventListener("click", () => (root.classList.contains("is-open") ? close() : open()));
  list.addEventListener("click", (e) => {
    const li = e.target.closest(".dd-opt");
    if (li) choose(Number(li.dataset.i));
  });
  list.addEventListener("pointermove", (e) => {
    const li = e.target.closest(".dd-opt");
    if (li) setActive(Number(li.dataset.i));
  });
  btn.addEventListener("keydown", (e) => {
    const isOpen = root.classList.contains("is-open");
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key) && !isOpen) {
      e.preventDefault();
      open();
      return;
    }
    if (!isOpen) return;
    if (e.key === "ArrowDown") (e.preventDefault(), setActive(active + 1));
    else if (e.key === "ArrowUp") (e.preventDefault(), setActive(active - 1));
    else if (e.key === "Home") (e.preventDefault(), setActive(0));
    else if (e.key === "End") (e.preventDefault(), setActive(options().length - 1));
    else if (e.key === "Enter" || e.key === " ") (e.preventDefault(), choose(active));
    else if (e.key === "Escape") (e.preventDefault(), close(true));
    else if (e.key === "Tab") close();
    else if (e.key.length === 1) {
      const next = options().findIndex((o, i) => i > active && o.textContent.toLocaleLowerCase("tr").startsWith(e.key.toLocaleLowerCase("tr")));
      if (next >= 0) setActive(next);
    }
  });
  document.addEventListener("click", (e) => { if (!root.contains(e.target)) close(); });
  document.addEventListener("dd-open", (e) => { if (e.detail !== root) close(); });

  rebuild();
  select.__dd = { rebuild, sync };
  return select.__dd;
}

/* ======================= Etiketli çoklu seçim (chips) ======================= */
// options: öneri listesi; free: listede olmayan değer yazılabilir; onChange(dizi)
export function chipsInput({ options = [], value = [], free = true, placeholder = "Seçin veya yazın", ariaLabel = "", onChange = () => {} }) {
  const id = `chips-${++uid}`;
  let values = [...value];
  const input = el("input", { class: "chips-input", type: "text", autocomplete: "off", placeholder, role: "combobox", "aria-expanded": "false", "aria-controls": `${id}-list`, "aria-label": ariaLabel || placeholder });
  const box = el("div", { class: "chips-box" });
  const pop = el("ul", { class: "chips-pop", role: "listbox", id: `${id}-list` });
  const root = el("div", { class: "chips" }, box, pop);
  let active = -1;

  const emit = () => onChange([...values]);
  const norm = (s) => s.toLocaleLowerCase("tr").trim();

  function renderChips() {
    box.innerHTML = "";
    for (const v of values) {
      const x = el("button", { type: "button", class: "chip-x", "aria-label": `${v} seçimini kaldır` });
      x.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';
      x.addEventListener("click", () => remove(v));
      box.append(el("span", { class: "chip" }, v, x));
    }
    box.append(input);
  }
  function add(v) {
    v = v.trim();
    if (!v || values.some((x) => norm(x) === norm(v))) return;
    values.push(v);
    input.value = "";
    renderChips();
    emit();
    renderPop();
    input.focus();
  }
  function remove(v) {
    values = values.filter((x) => x !== v);
    renderChips();
    emit();
    renderPop();
    input.focus();
  }
  function renderPop() {
    const q = norm(input.value);
    const rest = options.filter((o) => !values.some((x) => norm(x) === norm(o)) && (!q || norm(o).includes(q)));
    pop.innerHTML = "";
    for (const o of rest) pop.append(el("li", { role: "option", class: "chips-opt" }, o));
    if (free && q && !options.some((o) => norm(o) === q) && !values.some((x) => norm(x) === q)) {
      pop.append(el("li", { role: "option", class: "chips-opt is-new", "data-new": input.value.trim() }, `"${input.value.trim()}" ekle`));
    }
    active = pop.children.length ? 0 : -1;
    [...pop.children].forEach((li, i) => li.classList.toggle("is-active", i === active));
    const show = pop.children.length > 0 && document.activeElement === input;
    root.classList.toggle("is-open", show);
    input.setAttribute("aria-expanded", String(show));
  }
  function move(d) {
    const items = [...pop.children];
    if (!items.length) return;
    active = (active + d + items.length) % items.length;
    items.forEach((li, i) => li.classList.toggle("is-active", i === active));
    items[active].scrollIntoView({ block: "nearest" });
  }
  const pick = (li) => add(li.dataset.new ?? li.textContent);

  input.addEventListener("focus", renderPop);
  input.addEventListener("input", renderPop);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") (e.preventDefault(), move(1));
    else if (e.key === "ArrowUp") (e.preventDefault(), move(-1));
    else if (e.key === "Enter" || e.key === ",") {
      if (!input.value.trim() && e.key === "Enter") return;
      e.preventDefault();
      const li = pop.children[active];
      if (li && (root.classList.contains("is-open") || !free)) pick(li);
      else if (free) add(input.value);
    } else if (e.key === "Backspace" && !input.value && values.length) remove(values.at(-1));
    else if (e.key === "Escape") root.classList.remove("is-open");
  });
  // pointerdown: input odağını kaybetmeden seç
  pop.addEventListener("pointerdown", (e) => {
    const li = e.target.closest(".chips-opt");
    if (li) (e.preventDefault(), pick(li));
  });
  input.addEventListener("blur", () => setTimeout(() => (root.classList.remove("is-open"), input.setAttribute("aria-expanded", "false")), 120));
  box.addEventListener("click", (e) => { if (e.target === box) input.focus(); });

  renderChips();
  return {
    root,
    get: () => [...values],
    set(v) {
      values = [...v];
      renderChips();
    },
    add,
  };
}

/* ======================= Öneri düğmeleri (metin alanları için) ======================= */
// Tıklanan öneri alana satır olarak eklenir; tekrar tıklanınca çıkarılır.
export function suggestChips(textarea, items = []) {
  textarea.parentElement.querySelector(".suggest")?.remove();
  if (!items.length) return;
  const row = el("div", { class: "suggest", role: "group", "aria-label": "Öneriler" });
  const lines = () => textarea.value.split("\n").map((l) => l.trim());
  const refresh = () => row.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(lines().includes(b.dataset.text))));
  for (const text of items) {
    const b = el("button", { type: "button", class: "suggest-chip", "data-text": text, "aria-pressed": "false" }, text);
    b.addEventListener("click", () => {
      const cur = lines().filter(Boolean);
      textarea.value = (cur.includes(text) ? cur.filter((l) => l !== text) : [...cur, text]).join("\n");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      refresh();
    });
    row.append(b);
  }
  textarea.after(row);
  textarea.addEventListener("input", refresh);
  refresh();
  return refresh;
}
