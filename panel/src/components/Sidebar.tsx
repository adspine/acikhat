import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "../router.tsx";
import { Icon } from "./ui.tsx";

const KEY = "acikhat-sidebar";

/** Sol menünün daralmış/açık durumu; tarayıcıda hatırlanır (yönetim ve müşteri paneli aynı tercihi paylaşır) */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(KEY, next ? "1" : "0");
      } catch {
        /* tarayıcı depolamaya izin vermiyorsa tercih yalnızca bu oturumda geçerli */
      }
      return next;
    });
  return [collapsed, toggle];
}

export interface SideItem {
  to: string;
  label: string;
  icon: string;
  badge?: number | undefined;
}

export interface ProfileAction {
  label: string;
  icon: string;
  to?: string;
  onClick?: () => void;
  danger?: boolean;
}

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toLocaleUpperCase("tr") ?? "")
    .join("") || "?";

/** Profil düğmesi: avatar, ad ve rol; tıklayınca işlem menüsü açılır */
function Profile({ name, email, role, actions, collapsed }: { name: string; email?: string | undefined; role: string; actions: ProfileAction[]; collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="profile" ref={ref}>
      <div className={`profile-pop${open ? " is-open" : ""}`} role="menu" aria-hidden={!open}>
        <div className="profile-pop-head">
          <p className="profile-pop-name">{name}</p>
          {email && <p className="profile-pop-mail">{email}</p>}
        </div>
        {actions.map((a) => {
          const body = (
            <>
              <Icon name={a.icon} size={18} />
              <span>{a.label}</span>
            </>
          );
          const cls = `profile-pop-item${a.danger ? " is-danger" : ""}`;
          return a.to ? (
            <Link key={a.label} to={a.to} className={cls} onClick={() => setOpen(false)}>{body}</Link>
          ) : (
            <button key={a.label} type="button" role="menuitem" className={cls} tabIndex={open ? 0 : -1} onClick={() => { setOpen(false); a.onClick?.(); }}>{body}</button>
          );
        })}
      </div>
      <button type="button" className="profile-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} {...(collapsed && { title: name })}>
        <span className="avatar" aria-hidden="true">{initials(name)}</span>
        <span className="profile-text lbl">
          <strong>{name}</strong>
          <small>{role}</small>
        </span>
        <span className="profile-caret lbl" aria-hidden="true"><Icon name="chevron" size={16} /></span>
      </button>
    </div>
  );
}

/**
 * Sol menü (masaüstü): daraltılabilir, altında kullanım özeti ve profil.
 * Daraltılınca yalnızca simgeler kalır; ad bilgisi ipucu olarak görünür.
 */
export function Sidebar({ brand, navLabel, items, isActive, collapsed, onToggle, usage, user, actions }: {
  brand: string;
  navLabel: string;
  items: SideItem[];
  isActive: (to: string) => boolean;
  collapsed: boolean;
  onToggle: () => void;
  usage?: ReactNode;
  user: { name: string; email?: string | undefined; role: string };
  actions: ProfileAction[];
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="sidebar-brand">
          <span className="brand-lamp" aria-hidden="true" />
          <span className="sidebar-brand-name lbl">{brand}</span>
        </div>
        <button type="button" className="side-toggle" onClick={onToggle} aria-expanded={!collapsed} aria-label={collapsed ? "Menüyü genişlet" : "Menüyü daralt"} title={collapsed ? "Menüyü genişlet" : "Menüyü daralt"}>
          <Icon name="sidebar" size={18} />
        </button>
      </div>
      <nav aria-label={navLabel}>
        {items.map((i) => (
          <Link key={i.to} to={i.to} className="nav-item" data-tip={i.label} aria-label={collapsed ? i.label : ""} {...(isActive(i.to) && { "aria-current": "page" as const })}>
            <span className="nav-ico"><Icon name={i.icon} /></span>
            <span className="lbl">{i.label}</span>
            {!!i.badge && <span className="nav-badge" aria-label={`${i.badge} bekleyen`}>{i.badge}</span>}
          </Link>
        ))}
      </nav>
      <div className="sidebar-bottom">
        {usage}
        <Profile name={user.name} email={user.email} role={user.role} actions={actions} collapsed={collapsed} />
      </div>
    </aside>
  );
}
