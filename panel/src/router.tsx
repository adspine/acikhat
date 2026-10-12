import { createContext, useContext, useEffect, useState, type ReactNode, type MouseEvent } from "react";

/** Panelin küçük yönlendiricisi: /panel altındaki yollar, geri/ileri tuşları çalışır */
const BASE = "/panel";

interface Location {
  path: string; // "/randevular"
  query: URLSearchParams;
}

const read = (): Location => ({
  path: window.location.pathname.replace(BASE, "") || "/",
  query: new URLSearchParams(window.location.search),
});

const RouterContext = createContext<{ loc: Location; navigate: (to: string, opts?: { replace?: boolean }) => void } | null>(null);

export function Router({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const onPop = () => setLoc(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = (to: string, opts: { replace?: boolean } = {}) => {
    const url = to.startsWith("/") ? `${BASE}${to === "/" ? "/" : to}` : to;
    if (opts.replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
    setLoc(read());
    if (!opts.replace) window.scrollTo({ top: 0 });
  };
  return <RouterContext.Provider value={{ loc, navigate }}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("Router dışında");
  return ctx;
}

/** Sorgu parametresini durum gibi kullanır: ?tarih=2026-10-12 */
export function useQueryParam(name: string, fallback: string): [string, (v: string) => void] {
  const { loc, navigate } = useRouter();
  const value = loc.query.get(name) ?? fallback;
  const set = (v: string) => {
    const q = new URLSearchParams(loc.query);
    if (v === fallback) q.delete(name);
    else q.set(name, v);
    const qs = q.toString();
    navigate(`${loc.path}${qs ? `?${qs}` : ""}`, { replace: true });
  };
  return [value, set];
}

export function Link({ to, children, className, onClick, ...rest }: { to: string; children: ReactNode; className?: string; onClick?: () => void; "aria-current"?: "page" }) {
  const { navigate } = useRouter();
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onClick?.();
    navigate(to);
  };
  return (
    <a href={`${BASE}${to}`} className={className} onClick={handle} {...rest}>
      {children}
    </a>
  );
}
