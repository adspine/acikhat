import { createContext, lazy, Suspense, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, authEvents, getAdminTenant, setAdminTenant, type Me, type Permission, type Session, type Today, type Usage } from "./api.ts";
import { Link, useRouter } from "./router.tsx";
import { Sidebar, useSidebarCollapsed } from "./components/Sidebar.tsx";
import { AccountSettings, type AccountUser } from "./components/AccountSettings.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { Button, ErrorBox, Field, Icon, Input, Loading, useToast } from "./components/ui.tsx";
import { TodayPage } from "./pages/Today.tsx";
import { AppointmentsPage } from "./pages/Appointments.tsx";
import { CallsPage } from "./pages/Calls.tsx";
import { CallbacksPage } from "./pages/Callbacks.tsx";
import { ReportsPage } from "./pages/Reports.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { UsersPage } from "./pages/Users.tsx";
import { UsagePage } from "./pages/Usage.tsx";
import { AdminCustomersPage, AdminDemoCallsPage, AdminOverviewPage, AdminSubmissionsPage } from "./pages/Admin.tsx";
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
  // Önce kim olduğuna bakılır: yönetici (agency) kendi yönetim ekranını, müşteri kendi panosunu görür
  const session = useQuery({ queryKey: ["session"], queryFn: () => api<Session>("/api/auth/session"), retry: false });
  const tenantId = getAdminTenant();
  const isAgency = session.data?.user.role === "agency";
  const me = useQuery({
    queryKey: ["me", tenantId],
    queryFn: () => api<Me>("/me"),
    retry: false,
    enabled: !!session.data && session.data.hasTenant && (!isAgency || !!tenantId),
  });

  useEffect(() => {
    const out = () => {
      setAdminTenant(null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "session" });
      qc.setQueryData(["session"], null);
    };
    authEvents.addEventListener("logout", out);
    return () => authEvents.removeEventListener("logout", out);
  }, [qc]);

  // Yönetici bir firma seçmişken o firma bulunamazsa eski seçim silinip yönetim ekranına dönülür
  const staleTenant = isAgency && !!tenantId && me.error instanceof ApiError && [403, 404, 409].includes(me.error.status);
  useEffect(() => {
    if (staleTenant) {
      setAdminTenant(null);
      location.assign("/panel/");
    }
  }, [staleTenant]);

  if (session.isLoading) return <Loading label="Panel açılıyor" />;
  if (!session.data) return <RedirectToLogin />;
  if (staleTenant) return <Loading label="Yönetim ekranına dönülüyor" />;
  if (isAgency && !tenantId) return <AdminApp session={session.data} />;
  // Giriş yapmış ama henüz bir firmaya bağlanmamış üye (paket ve kurulum bekliyor)
  if (!session.data.hasTenant) return <NoTenantPage />;
  if (me.isLoading) return <Loading label="Panel açılıyor" />;
  if (!me.data) {
    return (
      <AuthLayout title="Panel açılamadı">
        <div className="stack">
          <ErrorBox error={me.error} onRetry={() => me.refetch()} />
          {isAgency && <Button type="button" variant="quiet" onClick={() => { setAdminTenant(null); location.assign("/panel/"); }}>Yönetime dön</Button>}
        </div>
      </AuthLayout>
    );
  }
  if (me.data.user.mustChangePassword) return <ChangePasswordPage forced onDone={() => me.refetch()} />;
  return (
    <MeContext.Provider value={me.data}>
      <Shell />
    </MeContext.Provider>
  );
}

/* ---------------- yönetim ekranı (yalnızca agency) ---------------- */
function AdminApp({ session }: { session: Session }) {
  const { loc, navigate } = useRouter();
  const [collapsed, toggleSide] = useSidebarCollapsed();
  const sendPasswordLink = usePasswordLink();
  const { openAccount, accountModal } = useAccountSettings({ name: session.user.name, email: session.user.email, notifyEmail: session.user.notifyEmail });
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ["admin", "overview"], queryFn: () => api<{ submissions: { new: number } }>("/api/admin/overview"), refetchInterval: 60_000 });
  const pending = overview.data?.submissions.new ?? 0;
  const items = [
    { to: "/", label: "Genel bakış", icon: "chart" },
    { to: "/basvurular", label: "Başvurular", icon: "callback", badge: pending },
    { to: "/musteriler", label: "Müşteriler", icon: "users" },
    { to: "/test-aramalari", label: "Test aramaları", icon: "phone" },
    { to: "/asistani-dene", label: "Asistanı dene", icon: "mic" },
  ];
  const active = (to: string) => (to === "/" ? loc.path === "/" : loc.path.startsWith(to));
  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    authEvents.dispatchEvent(new Event("logout"));
  };
  const page = loc.path.startsWith("/basvurular") ? (
    <AdminSubmissionsPage initialStatus={loc.query.get("durum") ?? ""} />
  ) : loc.path.startsWith("/musteriler") ? (
    <AdminCustomersPage />
  ) : loc.path.startsWith("/test-aramalari") ? (
    <AdminDemoCallsPage />
  ) : loc.path.startsWith("/asistani-dene") ? (
    <Suspense fallback={<Loading />}><TestCallPage /></Suspense>
  ) : (
    <AdminOverviewPage go={navigate} />
  );
  return (
    <div className={`shell${collapsed ? " is-collapsed" : ""}`}>
      <Sidebar
        brand="Açık Hat"
        navLabel="Yönetim menüsü"
        items={items}
        isActive={active}
        collapsed={collapsed}
        onToggle={toggleSide}
        user={{ name: session.user.name, email: session.user.email, role: "Yönetici" }}
        actions={[{ label: "Hesap ayarları", icon: "settings", onClick: openAccount }, { label: "Şifre değiştir", icon: "lock", onClick: sendPasswordLink }, { label: "Çıkış yap", icon: "logout", onClick: logout, danger: true }]}
      />
      <header className="topbar">
        <span className="brand-lamp" aria-hidden="true" />
        <span className="topbar-name">Yönetim</span>
      </header>
      <main className="main" id="icerik"><ErrorBoundary key={loc.path}>{page}</ErrorBoundary></main>
      {accountModal}
      <nav className="tabbar" aria-label="Alt menü">
        {items.map((i) => (
          <Link key={i.to} to={i.to} className="tab" {...(active(i.to) && { "aria-current": "page" as const })}>
            <Icon name={i.icon} />
            <span>{i.label}</span>
            {!!i.badge && <span className="nav-badge">{i.badge}</span>}
          </Link>
        ))}
        <button className="tab" onClick={openAccount}>
          <Icon name="settings" />
          <span>Hesap</span>
        </button>
        <button className="tab" onClick={logout}>
          <Icon name="logout" />
          <span>Çıkış</span>
        </button>
      </nav>
    </div>
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

function NoTenantPage() {
  const qc = useQueryClient();
  const out = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    qc.setQueryData(["session"], null);
  };
  return (
    <AuthLayout title="Hesabınız hazır">
      <div className="stack">
        <p className="muted">Hesabınıza henüz bir firma bağlanmadı. Paketinizi seçip kurulum formunu doldurduktan sonra asistanınız hazırlanır ve panel açılır.</p>
        <a className="btn btn-primary btn-md" href="/#/hesap">Sonraki adımlar</a>
        <Button type="button" variant="quiet" onClick={out}>Çıkış yap</Button>
      </div>
    </AuthLayout>
  );
}

/** Hesap ayarları penceresi: menüden açılır, pencere öğesi sayfaya eklenir */
function useAccountSettings(user: AccountUser) {
  const [open, setOpen] = useState(false);
  return { openAccount: () => setOpen(true), accountModal: <AccountSettings open={open} onClose={() => setOpen(false)} user={user} /> };
}

/** Şifre değiştirme: Firebase şifre belirleme bağlantısı kullanıcının e-postasına gönderilir */
function usePasswordLink() {
  const toast = useToast();
  return async () => {
    try {
      const r = await api<{ email: string }>("/api/auth/password-reset", { method: "POST" });
      toast(`Şifre belirleme bağlantısını ${r.email} adresine gönderdik`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Bağlantı gönderilemedi", "error");
    }
  };
}

/** Oturum yoksa kullanıcı sitenin giriş sayfasına yönlendirilir (tek giriş yeri) */
function RedirectToLogin() {
  useEffect(() => {
    location.replace("/#/giris");
  }, []);
  return <Loading label="Giriş sayfasına yönlendiriliyor" />;
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

/** Sol alt köşede, profilin hemen üstünde: bu ayın kota kullanımı */
function SidebarUsage({ canOpen }: { canOpen: boolean }) {
  const q = useQuery({ queryKey: ["usage"], queryFn: () => api<Usage>("/usage"), refetchInterval: 60_000, retry: false });
  const u = q.data;
  if (!u || u.includedMinutes === null) return null;
  const pct = u.includedMinutes ? Math.min(100, Math.round((u.usedMinutes / u.includedMinutes) * 100)) : 0;
  const level = u.usedMinutes > u.includedMinutes ? "over" : pct >= 90 ? "high" : "ok";
  const nf = new Intl.NumberFormat("tr-TR");
  const body = (
    <>
      <span className="side-usage-text">
        <span className="side-usage-top">
          <span>Bu ay</span>
          <strong>{nf.format(u.usedMinutes)} / {nf.format(u.includedMinutes)} dk</strong>
        </span>
      </span>
      <span className="side-usage-bar" role="img" aria-label={`Kotanın %${pct}'i kullanıldı`}><span style={{ width: `${pct}%` }} /></span>
      <span className="side-usage-text">
        <span className="side-usage-note">
          {level === "over" ? "Kota aşıldı; ek dakika alın" : level === "high" ? "Kota dolmak üzere" : `${nf.format(u.remainingMinutes ?? 0)} dk kaldı`}
          {u.addonMinutes > 0 && ` · +${nf.format(u.addonMinutes)} dk ek paket`}
        </span>
      </span>
    </>
  );
  return canOpen ? (
    <Link to="/paketim" className={`side-usage is-${level}`} aria-label="Kullanım limitleri, Paketim sayfasını aç">{body}</Link>
  ) : (
    <div className={`side-usage is-${level}`}>{body}</div>
  );
}

function Shell() {
  const me = useMe();
  const [collapsed, toggleSide] = useSidebarCollapsed();
  const sendPasswordLink = usePasswordLink();
  const { openAccount, accountModal } = useAccountSettings({ name: me.user.name, email: me.user.email, notifyEmail: me.user.notifyEmail });
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
    { to: "/paketim", label: "Paketim", icon: "gauge", perm: "settings.edit" },
    { to: "/kurulum", label: "Kurulum", icon: "settings", perm: "settings.edit" },
    { to: "/kullanicilar", label: "Kullanıcılar", icon: "users", perm: "users.manage" },
  ];
  const items = all.filter((i) => !i.perm || can(me, i.perm));
  const active = (to: string) => (to === "/" ? loc.path === "/" : loc.path.startsWith(to));

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    authEvents.dispatchEvent(new Event("logout"));
  };

  const page = (() => {
    const p = loc.path;
    if (p === "/") return <TodayPage />;
    if (p.startsWith("/randevular")) return <AppointmentsPage />;
    if (p.startsWith("/cagrilar")) return <CallsPage />;
    if (p.startsWith("/geri-aramalar")) return <CallbacksPage />;
    if (p.startsWith("/raporlar")) return <ReportsPage />;
    if (p.startsWith("/paketim")) return <UsagePage />;
    if (p.startsWith("/kurulum") || p.startsWith("/ayarlar")) return <SettingsPage />;
    if (p.startsWith("/kullanicilar")) return <UsersPage />;
    return <TodayPage />;
  })();

  const roleLabel = me.user.role === "owner" ? "Sahip" : me.user.role === "agency" ? "Yönetici" : me.terms.teamRoleLabel;
  const exitTenant = () => {
    setAdminTenant(null);
    location.assign("/panel/");
  };

  return (
    <div className={`shell${collapsed ? " is-collapsed" : ""}`}>
      <Sidebar
        brand={me.tenant.name}
        navLabel="Panel menüsü"
        items={items}
        isActive={active}
        collapsed={collapsed}
        onToggle={toggleSide}
        usage={<SidebarUsage canOpen={me.permissions.includes("settings.edit")} />}
        user={{ name: me.user.name, email: me.user.email, role: roleLabel }}
        actions={[
          { label: "Hesap ayarları", icon: "settings", onClick: openAccount },
          { label: "Şifre değiştir", icon: "lock", onClick: sendPasswordLink },
          ...(me.user.role === "agency" ? [{ label: "Yönetime dön", icon: "left", onClick: exitTenant }] : []),
          { label: "Çıkış yap", icon: "logout", onClick: logout, danger: true },
        ]}
      />

      <header className="topbar">
        <span className="brand-lamp" aria-hidden="true" />
        <span className="topbar-name">{me.tenant.name}</span>
      </header>

      <main className="main" id="icerik">
        {me.tenant.suspended && (
          <p className="suspended-banner" role="alert">
            Hizmetiniz şu an askıda; asistan gelen aramaları karşılamıyor. Açılması için <a href="mailto:support@adspine.app">support@adspine.app</a> adresine yazın.
          </p>
        )}
        <ErrorBoundary key={loc.path}>{page}</ErrorBoundary>
      </main>

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

      {accountModal}
      {moreOpen && (
        <div className="sheet-wrap" onClick={() => setMoreOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Diğer bölümler" onClick={(e) => e.stopPropagation()}>
            {items.filter((i) => !i.mobile).map((i) => (
              <Link key={i.to} to={i.to} className="sheet-item" onClick={() => setMoreOpen(false)}>
                <Icon name={i.icon} />
                {i.label}
              </Link>
            ))}
            {me.user.role === "agency" && <button className="sheet-item" onClick={exitTenant}><Icon name="chart" />Yönetime dön</button>}
            <button className="sheet-item" onClick={() => { setMoreOpen(false); openAccount(); }}><Icon name="settings" />Hesap ayarları</button>
            <button className="sheet-item" onClick={() => { setMoreOpen(false); sendPasswordLink(); }}><Icon name="lock" />Şifre değiştir</button>
            <button className="sheet-item" onClick={logout}><Icon name="logout" />Çıkış yap</button>
          </div>
        </div>
      )}
    </div>
  );
}
