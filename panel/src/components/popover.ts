import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export interface PopPos {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/**
 * Bir düğmeye bağlı açılır yüzeyin ortak davranışı: konumlandırma (sığmazsa yukarı açılır), giriş/çıkış animasyonu için
 * mounted/shown durumları, dışarı tıklayınca ve kaydırınca/yeniden boyutlanınca ilgilenme.
 * Yüzey sayfanın üstüne (portal) çizilir; bu yüzden fixed konum kullanılır.
 */
export function usePopover(open: boolean, onClose: () => void, anchor: RefObject<HTMLElement | null>, opts: { minWidth?: number; maxHeight?: number } = {}) {
  const pop = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [pos, setPos] = useState<PopPos>({ left: 0, width: 0, maxHeight: 360 });
  const maxH = opts.maxHeight ?? 360;
  const minW = opts.minWidth ?? 0;

  const place = useCallback(() => {
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(r.width, minW);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < Math.min(maxH, 320) && above > below;
    setPos({ left, width, maxHeight: Math.min(maxH, up ? above : below), ...(up ? { bottom: window.innerHeight - r.top + 8 } : { top: r.bottom + 8 }) });
  }, [anchor, minW, maxH]);

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
      if (!anchor.current?.contains(t) && !pop.current?.contains(t)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place, onClose, anchor]);

  return { pop, mounted, shown, pos };
}
