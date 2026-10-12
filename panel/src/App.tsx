import { createContext, lazy, Suspense, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, authEvents, type Me, type Permission, type Today } from "./api.ts";
import { Link, useRouter } from "./router.tsx";
import { Button, Field, Icon, Input, Loading } from "./components/ui.tsx";
import { TodayPage } from "./pages/Today.tsx";
import { AppointmentsPage } from "./pages/Appointments.tsx";
import { CallsPage } from "./pages/Calls.tsx";
import { CallbacksPage } from "./pages/Callbacks.tsx";
import { ReportsPage } from "./pages/Reports.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { UsersPage } from "./pages/Users.tsx";
// Ses kütüphanesi büyük: yalnızca "Asistanı dene" açılınca yüklenir
const TestCallPage = lazy(() => import("./pages/TestCall.tsx").then((m) => ({ default: m.TestCallPage })));

const MeContext = createContext<Me | null>(null);
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("Oturum yok");
  return me;
}
export const can = (me: Me, p: Permission) => me.permissions.includes(p);

/** Bugün verisi menüdeki sayaçlar için de kullanılır; 30 sn'de bir yenilenir */
export const useToday = () => useQuery({ queryKey: ["today"], queryFn: () => api<Today>("/today"), refetchInterval: 30_000 });

export function App() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me"), retry: false });

  useEffect(() => {
    const out = () => qc.setQueryData(["me"], null);
    authEvents.addEventListener("logout", out);
    return () => authEvents.removeEventListener("logout", out);
  }, [qc]);

  if (me.isLoading) return <Loading label="Panel açılıyor" />;
  if (!me.data) return <LoginPage onDone={() => me.refetch()} />;
  if (me.data.user.mustChangePassword) return <ChangePasswordPage forced onDone={() => me.refetch()} />;
  return (
    <MeContext.Provider value={me.data}>
      <Shell />
    </MeContext.Provider>
  );
}

/* ---------------- giriş ---------------- */
function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth">
      <div className="auth-card">
        <p className="brand"><span className="brand-lamp" aria-hidden="true" />Açık Hat</p>
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}

function LoginPage({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api("/api/auth/login", { method: "POST", body: { email, password } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Giriş yapılamadı");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout title="Panele giriş">
      <form onSubmit={submit} className="stack">
        <Field label="E-posta">{(id) => <Input id={id} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
        <Field label="Şifre">{(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}</Field>
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" busy={busy}>Giriş yap</Button>
        <p className="muted small">Şifrenizi unuttuysanız bizi arayın; yeni geçici şifre verelim.</p>
      </form>
    </AuthLayout>
  );
}

export function ChangePasswordPage({ forced, onDone }: { forced?: boolean; onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== again) return setError("Yeni şifreler aynı değil");
    setBusy(true);
    setError(undefined);
    try {
      await api("/api/auth/password", { method: "POST", body: { current, next } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Şifre değiştirilemedi");
    } finally {
      setBusy(false);
    }
  };
  const form = (
    <form onSubmit={submit} className="stack">
      {forced && <p className="muted">Size verilen geçici şifreyle giriş yaptınız. Devam etmek için kendi şifrenizi belirleyin.</p>}
      <Field label={forced ? "Geçici şifre" : "Mevcut şifre"}>{(id) => <Input id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />}</Field>
      <Field label="Yeni şifre" hint="En az 10 karakter">{(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required />}</Field>
      <Field label="Yeni şifre (tekrar)">{(id) => <Input id={id} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />}</Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button type="submit" busy={busy}>Şifreyi kaydet</Button>
    </form>
  );
  return forced ? <AuthLayout title="Şifrenizi belirleyin">{form}</AuthLayout> : form;
}

/* ---------------- kabuk ---------------- */
interface NavItem { to: string; label: string; icon: string; perm?: Permission; mobile?: boolean; badge?: number }

function Shell() {
  const me = useMe();
  const { loc } = useRouter();
  const qc = useQueryClient();
  const today = useToday();
  const [moreOpen, setMoreOpen] = useState(false);
  const openCallbacks = today.data?.counts.openCallbacks ?? 0;

  const all: NavItem[] = [
    { to: "/", label: "Bugün", icon: "today", mobile: true },
    { to: "/randevular", label: "Randevular", icon: "calendar", perm: "appointments.view", mobile: true },
    { to: "/cagrilar", label: "Çağrılar", icon: "phone", perm: "calls.view", mobile: true },
    { to: "/geri-aramalar", label: "Geri aramalar", icon: "callback", perm: "calls.view", mobile: true, badge: openCallbacks },
    { to: "/raporlar", label: "Raporlar", icon: "chart", perm: "reports.view" },
    { to: "/ayarlar", label: "Ayarlar", icon: "settings", perm: "settings.edit" },
    { to: "/kullanicilar", label: "Kullanıcılar", icon: "users", perm: "users.manage" },
    { to: "/asistani-dene", label: "Asistanı dene", icon: "mic", perm: "settings.edit" },
  ];
  const items = all.filter((i) => !i.perm || can(me, i.perm));
  const active = (to: string) => (to === "/" ? loc.path === "/" : loc.path.startsWith(to));

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    qc.clear();
    qc.setQueryData(["me"], null);
  };

  const page = (() => {
    const p = loc.path;
    if (p === "/") return <TodayPage />;
    if (p.startsWith("/randevular")) return <AppointmentsPage />;
    if (p.startsWith("/cagrilar")) return <CallsPage />;
    if (p.startsWith("/geri-aramalar")) return <CallbacksPage />;
    if (p.startsWith("/raporlar")) return <ReportsPage />;
    if (p.startsWith("/ayarlar")) return <SettingsPage />;
    if (p.startsWith("/kullanicilar")) return <UsersPage />;
    if (p.startsWith("/asistani-dene")) return <Suspense fallback={<Loading />}><TestCallPage /></Suspense>;
    if (p.startsWith("/sifre")) return <section className="page narrow"><h1 className="page-title">Şifre değiştir</h1><ChangePasswordPage onDone={() => history.back()} /></section>;
    return <TodayPage />;
  })();

  const roleLabel = me.user.role === "owner" ? "Sahip" : me.user.role === "agency" ? "Ajans" : me.terms.teamRoleLabel;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-lamp" aria-hidden="true" />
          <span>{me.tenant.name}</span>
        </div>
        <nav aria-label="Panel menüsü">
          {items.map((i) => (
            <Link key={i.to} to={i.to} className="nav-item" {...(active(i.to) && { "aria-current": "page" as const })}>
              <Icon name={i.icon} />
              <span>{i.label}</span>
              {!!i.badge && <span className="nav-badge" aria-label={`${i.badge} bekleyen`}>{i.badge}</span>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-user">
          <p className="sidebar-user-name">{me.user.name}</p>
          <p className="sidebar-user-role">{roleLabel}</p>
          <div className="sidebar-user-actions">
            <Link to="/sifre" className="link-quiet">Şifre</Link>
            <button className="link-quiet" onClick={logout}>Çıkış</button>
          </div>
        </div>
      </aside>

      <header className="topbar">
        <span className="brand-lamp" aria-hidden="true" />
        <span className="topbar-name">{me.tenant.name}</span>
      </header>

      <main className="main" id="icerik">{page}</main>

      <nav className="tabbar" aria-label="Alt menü">
        {items.filter((i) => i.mobile).map((i) => (
          <Link key={i.to} to={i.to} className="tab" {...(active(i.to) && { "aria-current": "page" as const })}>
            <Icon name={i.icon} />
            <span>{i.label === "Geri aramalar" ? "Geri ara" : i.label}</span>
            {!!i.badge && <span className="nav-badge">{i.badge}</span>}
          </Link>
        ))}
        <button className="tab" onClick={() => setMoreOpen(true)} aria-haspopup="dialog">
          <Icon name="more" />
          <span>Daha fazla</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="sheet-wrap" onClick={() => setMoreOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Diğer bölümler" onClick={(e) => e.stopPropagation()}>
            {items.filter((i) => !i.mobile).map((i) => (
              <Link key={i.to} to={i.to} className="sheet-item" onClick={() => setMoreOpen(false)}>
                <Icon name={i.icon} />
                {i.label}
              </Link>
            ))}
            <Link to="/sifre" className="sheet-item" onClick={() => setMoreOpen(false)}><Icon name="settings" />Şifre değiştir</Link>
            <button className="sheet-item" onClick={logout}><Icon name="logout" />Çıkış yap</button>
          </div>
        </div>
      )}
    </div>
  );
}
