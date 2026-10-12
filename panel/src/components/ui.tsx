import { createPortal } from "react-dom";
import {
  Children, createContext, isValidElement, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent as ReactKeyEvent, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from "react";
import type { Outcome } from "../api.ts";

/* ---------------- simgeler (yalın çizgi, 20px) ---------------- */
const paths: Record<string, string> = {
  today: "M4 6h12M4 10h12M4 14h7",
  calendar: "M4 6.5h12v9.5H4zM4 9.5h12M7.5 4v3M12.5 4v3",
  phone: "M6.5 3.5 8.6 7l-1.6 1.6a8 8 0 0 0 4.4 4.4L13 11.4l3.5 2.1-1 2.6c-6.2.4-11.1-4.5-10.7-10.7z",
  callback: "M15.5 7.5A6 6 0 1 0 16 11M15.5 3.5v4h-4",
  chart: "M4 16V9M8.5 16V5M13 16v-5M16.5 16H3.5",
  settings: "M10 7.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zM10 2.8v2M10 15.2v2M2.8 10h2M15.2 10h2M4.9 4.9l1.4 1.4M13.7 13.7l1.4 1.4M4.9 15.1l1.4-1.4M13.7 6.3l1.4-1.4",
  users: "M7.5 9a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4zM2.8 16a4.7 4.7 0 0 1 9.4 0M13 9.2a2.4 2.4 0 1 0 0-4.8M14.2 11.4A4.4 4.4 0 0 1 17.2 16",
  mic: "M10 3a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0v-4A2.5 2.5 0 0 1 10 3zM5.5 9.5a4.5 4.5 0 0 0 9 0M10 14v3",
  plus: "M10 4.5v11M4.5 10h11",
  close: "M5.5 5.5l9 9M14.5 5.5l-9 9",
  left: "M12 4.5 6.5 10l5.5 5.5",
  right: "M8 4.5l5.5 5.5L8 15.5",
  more: "M5 10h.01M10 10h.01M15 10h.01",
  logout: "M8 4H4.5v12H8M11.5 6.5 15 10l-3.5 3.5M15 10H7.5",
  check: "M4.5 10.5 8 14l7.5-8",
  gauge: "M3.5 14.5a6.5 6.5 0 1 1 13 0M10 14.5l3-4.2",
  play: "M7 4.5v11l9-5.5z",
  stop: "M5.5 5.5h9v9h-9z",
  search: "M8.8 14.2a5.4 5.4 0 1 0 0-10.8 5.4 5.4 0 0 0 0 10.8zM12.8 12.8 16.5 16.5",
  sidebar: "M3.5 5.5a1.5 1.5 0 0 1 1.5-1.5h10a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5zM8 4v12",
  chevron: "M5 12l5-5 5 5",
  lock: "M5.5 9h9v7h-9zM7.5 9V7a2.5 2.5 0 0 1 5 0v2",
  shield: "M10 3l6 2v5c0 3.5-2.5 5.8-6 7-3.5-1.2-6-3.5-6-7V5z",
  spark: "M10 3v4M10 13v4M3 10h4M13 10h4M5.5 5.5l2.5 2.5M12 12l2.5 2.5M5.5 14.5 8 12M12 8l2.5-2.5",
};
export function Icon({ name, size = 20 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? ""} />
    </svg>
  );
}

/* ---------------- düğmeler ---------------- */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "quiet" | "danger" | "ghost"; size?: "md" | "sm"; busy?: boolean };
export function Button({ variant = "primary", size = "md", busy, children, className = "", disabled, ...rest }: BtnProps) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${className}`} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {children}
    </button>
  );
}

/* ---------------- form alanları ---------------- */
interface FieldProps { label: ReactNode; hint?: ReactNode; error?: string | undefined; children: (id: string, describedBy?: string) => ReactNode; optional?: boolean }
export function Field({ label, hint, error, children, optional }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label} {optional && <span className="field-optional">(isteğe bağlı)</span>}
      </label>
      {children(id, [hintId, errId].filter(Boolean).join(" ") || undefined)}
      {hint && <p id={hintId} className="field-hint">{hint}</p>}
      {error && <p id={errId} className="field-error">{error}</p>}
    </div>
  );
}
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input className="input" {...p} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className="input" {...p} />;

/**
 * Açılır seçim listesi. Tarayıcının kendi menüsü yerine tasarım diline uygun, cam görünümlü bir liste açar.
 * Kullanımı <select> ile aynıdır: <option> çocukları ve onChange(e.target.value). Klavye: ↑ ↓ Home End Enter Boşluk Esc.
 * Liste sayfanın üstüne (portal) açıldığı için yan panel ve modal içinde kesilmez.
 */
export function Select({ children, value, onChange, disabled, id, name, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  const options = Children.toArray(children).flatMap((el) => {
    if (!isValidElement(el)) return [];
    const p = el.props as { value?: string | number; children?: ReactNode; disabled?: boolean };
    return [{ value: String(p.value ?? p.children ?? ""), label: p.children as ReactNode, disabled: !!p.disabled }];
  });
  const current = options.find((o) => o.value === String(value ?? ""));
  const listId = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number }>({ left: 0, width: 0, maxHeight: 280 });

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 200 && above > below;
    setPos({ left: r.left, width: r.width, maxHeight: Math.min(300, up ? above : below), ...(up ? { bottom: window.innerHeight - r.top + 8 } : { top: r.bottom + 8 }) });
  }, []);

  useEffect(() => {
    if (open) {
      place();
      setMounted(true);
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 200);
    return () => clearTimeout(t);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    const onMove = () => place();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (shown) pop.current?.querySelector<HTMLElement>("[data-active='true']")?.scrollIntoView({ block: "nearest" });
  }, [shown, active]);

  const choose = (v: string) => {
    setOpen(false);
    btn.current?.focus();
    if (v !== String(value ?? "")) onChange?.({ target: { value: v, name }, currentTarget: { value: v, name } } as unknown as React.ChangeEvent<HTMLSelectElement>);
  };
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const move = (dir: 1 | -1 | "first" | "last") => {
    if (!enabled.length) return;
    if (dir === "first") return setActive(enabled[0]!);
    if (dir === "last") return setActive(enabled[enabled.length - 1]!);
    const at = enabled.indexOf(active);
    setActive(enabled[Math.min(enabled.length - 1, Math.max(0, (at < 0 ? 0 : at) + dir))]!);
  };
  const openList = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === String(value ?? ""))));
    setOpen(true);
  };
  const onKey = (e: ReactKeyEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); openList(); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Home") { e.preventDefault(); move("first"); }
    else if (e.key === "End") { e.preventDefault(); move("last"); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); const o = options[active]; if (o && !o.disabled) choose(o.value); }
    else if (e.key === "Tab") setOpen(false);
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        id={id}
        className={`input select-btn${className ? ` ${className}` : ""}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-describedby={rest["aria-describedby"]}
        aria-label={rest["aria-label"]}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKey}
      >
        <span className={`select-val${current ? "" : " is-placeholder"}`}>{current ? current.label : "Seçin"}</span>
        <span className="select-caret" aria-hidden="true"><Icon name="chevron" size={16} /></span>
      </button>
      {mounted && createPortal(
        <ul
          ref={pop}
          id={listId}
          role="listbox"
          className={`select-pop${shown ? " is-open" : ""}`}
          style={{ left: pos.left, width: pos.width, maxHeight: pos.maxHeight, ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }) }}
        >
          {options.map((o, i) => (
            <li
              key={`${o.value}-${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === String(value ?? "")}
              aria-disabled={o.disabled || undefined}
              data-active={i === active}
              className={`select-opt${o.value === String(value ?? "") ? " is-selected" : ""}${o.disabled ? " is-disabled" : ""}`}
              onMouseEnter={() => !o.disabled && setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => !o.disabled && choose(o.value)}
            >
              <span>{o.label}</span>
              {o.value === String(value ?? "") && <Icon name="check" size={16} />}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </>
  );
}
export function Checkbox({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="check-hint">{hint}</span>}
      </span>
    </label>
  );
}

/** Birden çok seçenek arasında tek seçim (Gün / Hafta / Liste gibi) */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- sonuç etiketi ---------------- */
export function OutcomePill({ outcome, label }: { outcome: Outcome; label: string }) {
  return <span className={`pill pill-${outcome}`}>{label}</span>;
}

/* ---------------- yan panel (masaüstünde sağdan, telefonda tam ekran) ---------------- */
export function Drawer({ open, title, onClose, children, footer, wide }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("[data-autofocus], input, select, textarea, button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="drawer-wrap">
      <div className="drawer-backdrop" onClick={onClose} />
      <div ref={ref} className={`drawer${wide ? " drawer-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="drawer-head">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Kapat">
            <Icon name="close" />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- durumlar ---------------- */
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <p className="empty-text">{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ label = "Yükleniyor" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="loading-bar" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="banner banner-error" role="alert">
      <p>{error instanceof Error ? error.message : "Bir hata oluştu"}</p>
      {onRetry && <Button variant="quiet" size="sm" onClick={onRetry}>Tekrar dene</Button>}
    </div>
  );
}

/* ---------------- bildirim (kısa onay mesajları) ---------------- */
const ToastContext = createContext<(text: string, kind?: "ok" | "error") => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; text: string; kind: "ok" | "error" }[]>([]);
  const show = useCallback((text: string, kind: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

/* ---------------- biçimler ---------------- */
export const tl = (n: number) => `${new Intl.NumberFormat("tr-TR").format(Math.round(n))} TL`;
export const duration = (secs: number | null) =>
  secs == null ? "" : secs < 60 ? `${secs} sn` : `${Math.floor(secs / 60)} dk ${String(secs % 60).padStart(2, "0")} sn`;
export const percent = (x: number) => `%${Math.round(x * 100)}`;

/* ---------------- modal (ortada, cam görünümlü; sayfa yerleşimini oynatmaz) ---------------- */
/**
 * Satın alma, onay gibi kısa işlemler için. Sayfanın üzerine biner, arka planı bulanıklaştırır; sayfada yer açmaz.
 * Kapanırken de kısa bir çıkış animasyonu oynar. Esc ve dışarı tıklama ile kapanır (dismissible=false ise yalnızca düğmeyle).
 */
export function Modal({ open, onClose, title, children, footer, dismissible = true, size = "sm" }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  dismissible?: boolean;
  size?: "sm" | "md";
}) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      setMounted(true);
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 280);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!mounted || !open) return;
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(ref.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])") ?? []);
    window.setTimeout(() => (ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0] ?? ref.current)?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) return onClose();
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
      prev?.focus?.();
    };
  }, [mounted, open, dismissible, onClose]);

  if (!mounted) return null;
  return createPortal(
    <div className={`modal-root${shown ? " is-open" : ""}`}>
      <div className="modal-backdrop" onClick={dismissible ? onClose : undefined} />
      <div ref={ref} className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          {dismissible && (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Kapat"><Icon name="close" /></button>
          )}
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
