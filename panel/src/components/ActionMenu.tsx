import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./ui.tsx";
import { usePopover } from "./popover.ts";

export interface MenuAction {
  label: string;
  icon?: string;
  onClick: () => void;
  danger?: boolean;
}

/**
 * Satır işlemleri için ⋮ düğmesi ve cam görünümlü açılır menü (tablo satırlarında, kartlarda).
 * Menü sayfanın üstüne açılır; satırın kendi tıklamasını tetiklemez. Klavye: ↑ ↓ gezinir, Enter seçer, Esc kapatır.
 */
export function ActionMenu({ actions, label }: { actions: MenuAction[]; label: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const close = useCallback(() => setOpen(false), []);
  const { pop, mounted, shown, pos } = usePopover(open, close, btn, { minWidth: 230, maxWidth: 280, maxHeight: 320 });
  const id = useId();

  // açılınca ilk öğeye odaklan
  useEffect(() => {
    if (shown) pop.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.focus();
  }, [shown, active, pop]);

  const choose = (a: MenuAction) => {
    setOpen(false);
    btn.current?.focus();
    a.onClick();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % actions.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + actions.length) % actions.length); }
    else if (e.key === "Tab") setOpen(false);
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="action-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => { e.stopPropagation(); setActive(0); setOpen((v) => !v); }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Icon name="moreV" size={18} />
      </button>
      {mounted && createPortal(
        <div
          ref={pop}
          id={id}
          role="menu"
          aria-label={label}
          className={`select-pop action-pop${shown ? " is-open" : ""}`}
          style={{ left: pos.left, width: pos.width, ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }) }}
          onKeyDown={onKey}
        >
          {actions.map((a, i) => (
            <button key={a.label} type="button" role="menuitem" data-i={i} tabIndex={i === active ? 0 : -1} className={`select-opt action-item${a.danger ? " is-danger" : ""}`} onClick={() => choose(a)} onMouseEnter={() => setActive(i)}>
              {a.icon && <Icon name={a.icon} size={18} />}
              <span>{a.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
