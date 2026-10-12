import {
  createContext, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
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
  search: "M8.8 14.2a5.4 5.4 0 1 0 0-10.8 5.4 5.4 0 0 0 0 10.8zM12.8 12.8 16.5 16.5",
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
export const Select = ({ children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className="input" {...p}>{children}</select>
);
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
  return (
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
    </div>
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
