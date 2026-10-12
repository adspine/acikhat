import { useCallback, useEffect, useState } from "react";

/**
 * Panel teması: Açık / Koyu / Sistem. Yalnızca panelde geçerlidir; tanıtım sitesi her zaman açık kalır.
 * Tercih bu cihazda saklanır (localStorage). Sayfa ilk boyanmadan önce panel/index.html içindeki küçük betik
 * aynı kuralı uygular; böylece koyu temada açık renkli bir an görünmez.
 */
export type ThemePref = "light" | "dark" | "system";
const KEY = "acikhat-theme";

const readPref = (): ThemePref => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
};

const systemDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

export function applyTheme(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && systemDark());
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0b1512" : "#13332d");
}

export function useTheme(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPrefState] = useState<ThemePref>(readPref);

  // Sistem teması değişirse ve tercih "Sistem" ise anında uyum sağlanır
  useEffect(() => {
    if (pref !== "system" || typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [pref]);

  const setPref = useCallback((p: ThemePref) => {
    try {
      localStorage.setItem(KEY, p);
    } catch {
      /* tarayıcı depolamaya izin vermiyorsa tercih yalnızca bu oturumda geçerli */
    }
    setPrefState(p);
    applyTheme(p);
  }, []);

  return [pref, setPref];
}
