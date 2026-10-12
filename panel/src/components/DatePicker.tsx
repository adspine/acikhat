import { useCallback, useId, useRef, useState, type KeyboardEvent as ReactKeyEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./ui.tsx";
import { usePopover } from "./popover.ts";

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

/* Tarihler "YYYY-MM-DD" metnidir. Hesaplar UTC üzerinden yapılır; saat dilimi kaymaz. */
interface Ymd { y: number; m: number; d: number }
const pad = (n: number) => String(n).padStart(2, "0");
const parse = (s: string): Ymd | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
};
const fmt = (t: Ymd) => `${t.y}-${pad(t.m)}-${pad(t.d)}`;
const shiftDays = (t: Ymd, n: number): Ymd => {
  const d = new Date(Date.UTC(t.y, t.m - 1, t.d + n));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
};
const shiftMonths = (t: Ymd, n: number): Ymd => {
  const first = new Date(Date.UTC(t.y, t.m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return { y: first.getUTCFullYear(), m: first.getUTCMonth() + 1, d: Math.min(t.d, last) };
};
const weekdayIdx = (t: Ymd) => (new Date(Date.UTC(t.y, t.m - 1, t.d)).getUTCDay() + 6) % 7; // 0 = Pazartesi
const todayYmd = (): Ymd => {
  const n = new Date();
  return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() };
};
const label = (s: string) => {
  const t = parse(s);
  return t ? `${pad(t.d)}.${pad(t.m)}.${t.y}` : "";
};

/** 6 hafta x 7 gün: ayın ilk gününün bulunduğu haftanın pazartesisinden başlar */
function monthGrid(view: Ymd): Ymd[] {
  const first = { y: view.y, m: view.m, d: 1 };
  const start = shiftDays(first, -weekdayIdx(first));
  return Array.from({ length: 42 }, (_, i) => shiftDays(start, i));
}

/**
 * Tarih seçici: tarayıcının kendi takvimi yerine cam görünümlü, Türkçe, pazartesi başlangıçlı bir takvim açar.
 * Kullanımı <input type="date"> ile aynıdır: value "YYYY-MM-DD", onChange(e.target.value).
 * Klavye: ← → ↑ ↓ gün, PageUp/PageDown ay, Home/End haftanın başı/sonu, Enter seç, Esc kapat.
 */
export function DatePicker({ value, onChange, id, className, placeholder = "Tarih seç", clearable = false, disabled, ...rest }: {
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  id?: string;
  className?: string;
  placeholder?: string;
  /** Seçimi temizleme düğmesi gösterilsin mi */
  clearable?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
  required?: boolean;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState<Ymd>(() => parse(value) ?? todayYmd());
  const close = useCallback(() => setOpen(false), []);
  const { pop, mounted, shown, pos } = usePopover(open, close, btn, { minWidth: 300, maxWidth: 328, maxHeight: 420 });
  const gridId = useId();

  const today = todayYmd();
  const days = monthGrid(cursor);

  const openCal = () => {
    setCursor(parse(value) ?? todayYmd());
    setOpen(true);
  };
  const pick = (t: Ymd) => {
    setOpen(false);
    btn.current?.focus();
    if (fmt(t) !== value) onChange({ target: { value: fmt(t) } });
  };
  const onKey = (e: ReactKeyEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); openCal(); }
      return;
    }
    const move = (t: Ymd) => { e.preventDefault(); setCursor(t); };
    switch (e.key) {
      case "ArrowLeft": return move(shiftDays(cursor, -1));
      case "ArrowRight": return move(shiftDays(cursor, 1));
      case "ArrowUp": return move(shiftDays(cursor, -7));
      case "ArrowDown": return move(shiftDays(cursor, 7));
      case "PageUp": return move(shiftMonths(cursor, -1));
      case "PageDown": return move(shiftMonths(cursor, 1));
      case "Home": return move(shiftDays(cursor, -weekdayIdx(cursor)));
      case "End": return move(shiftDays(cursor, 6 - weekdayIdx(cursor)));
      case "Enter":
      case " ": e.preventDefault(); return pick(cursor);
      case "Escape": e.preventDefault(); return close();
      case "Tab": return close();
    }
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        id={id}
        className={`input select-btn date-btn${className ? ` ${className}` : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={gridId}
        aria-describedby={rest["aria-describedby"]}
        aria-label={rest["aria-label"]}
        disabled={disabled}
        onClick={() => (open ? close() : openCal())}
        onKeyDown={onKey}
      >
        <span className={`select-val${value ? "" : " is-placeholder"}`}>{value ? label(value) : placeholder}</span>
        <span className="date-ico" aria-hidden="true"><Icon name="calendar" size={18} /></span>
      </button>
      {mounted && createPortal(
        <div ref={pop} className={`select-pop cal-pop${shown ? " is-open" : ""}`} role="dialog" aria-label="Takvim" style={{ left: pos.left, width: pos.width, ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }) }}>
          <div className="cal-head">
            <button type="button" className="icon-btn" aria-label="Önceki ay" onMouseDown={(e) => e.preventDefault()} onClick={() => setCursor(shiftMonths(cursor, -1))}><Icon name="left" size={18} /></button>
            <p className="cal-title" aria-live="polite">{MONTHS[cursor.m - 1]} {cursor.y}</p>
            <button type="button" className="icon-btn" aria-label="Sonraki ay" onMouseDown={(e) => e.preventDefault()} onClick={() => setCursor(shiftMonths(cursor, 1))}><Icon name="right" size={18} /></button>
          </div>
          <div className="cal-week" aria-hidden="true">{WEEKDAYS.map((w) => <span key={w}>{w}</span>)}</div>
          <div id={gridId} className="cal-grid" role="grid" aria-label={`${MONTHS[cursor.m - 1]} ${cursor.y}`}>
            {days.map((t) => {
              const f = fmt(t);
              const cls = ["cal-day", t.m !== cursor.m && "is-out", f === value && "is-selected", fmt(today) === f && "is-today", fmt(cursor) === f && "is-cursor"].filter(Boolean).join(" ");
              return (
                <button key={f} type="button" tabIndex={-1} role="gridcell" aria-selected={f === value} aria-label={`${t.d} ${MONTHS[t.m - 1]} ${t.y}`} className={cls} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(t)}>
                  {t.d}
                </button>
              );
            })}
          </div>
          <div className="cal-foot">
            <button type="button" className="link-quiet" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(today)}>Bugün</button>
            {clearable && value && <button type="button" className="link-quiet" onMouseDown={(e) => e.preventDefault()} onClick={() => { close(); onChange({ target: { value: "" } }); }}>Temizle</button>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
