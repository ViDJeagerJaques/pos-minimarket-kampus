import type { ReactNode } from "react";
import type { AuthMode, SessionUser } from "../api/types";
import type { NavGroup, NavItem, PageId } from "../app/navigation";
import {
  IconBarChart,
  IconClipboardList,
  IconDashboard,
  IconDatabaseBackup,
  IconLogOut,
  IconPackage,
  IconPackageCheck,
  IconSliders,
  IconStore,
  IconUsers,
} from "./AdminIcons";
import { Button } from "./Button";
import { DemoBanner } from "./DemoBanner";

interface AppShellProps {
  user: SessionUser;
  authMode: AuthMode;
  navItems: readonly NavItem[];
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  onLogout: () => void;
  children: ReactNode;
}

const ROLE_LABEL = { ADMIN: "Administrator", CASHIER: "Kasir" } as const;

function renderAdminNavIcon(id: PageId) {
  switch (id) {
    case "dashboard":
      return <IconDashboard size={20} />;
    case "products":
      return <IconPackage size={20} />;
    case "product-list":
      return <IconClipboardList size={20} />;
    case "receiving":
      return <IconPackageCheck size={20} />;
    case "stock-adjustment":
      return <IconSliders size={20} />;
    case "reports":
      return <IconBarChart size={20} />;
    case "accounts":
      return <IconUsers size={20} />;
    case "backup":
      return <IconDatabaseBackup size={20} />;
    default:
      return <IconDashboard size={20} />;
  }
}

/** Kerangka aplikasi: sidebar putih enterprise untuk ADMIN, shell topbar tetap untuk CASHIER. */
export function AppShell({
  user,
  authMode,
  navItems,
  activePage,
  onNavigate,
  onLogout,
  children,
}: AppShellProps) {
  if (user.role === "ADMIN") {
    const groups: Array<{ group: NavGroup | null; items: NavItem[] }> = [];
    for (const item of navItems) {
      const groupKey = item.group ?? null;
      const last = groups[groups.length - 1];
      if (last && last.group === groupKey) {
        last.items.push(item);
      } else {
        groups.push({ group: groupKey, items: [item] });
      }
    }

    return (
      <div className="shell shell--admin">
        <aside className="admin-sidebar" aria-label="Sidebar Administrator">
          <div className="admin-sidebar__brand">
            <span className="admin-sidebar__logo">
              <IconStore size={20} />
            </span>
            <div className="admin-sidebar__brand-text">
              <span className="admin-sidebar__title">POS MINIMARKET</span>
              <span className="admin-sidebar__subtitle">Administrator</span>
            </div>
          </div>

          <nav className="admin-sidebar__nav" aria-label="Menu utama">
            {groups.map((section, idx) => (
              <div key={section.group ?? `group-${idx}`} className="admin-sidebar__group">
                {section.group && (
                  <span className="admin-sidebar__group-label">{section.group}</span>
                )}
                {section.items.map((item) => {
                  const isActive = item.id === activePage;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={
                        isActive
                          ? "admin-nav-item admin-nav-item--active"
                          : "admin-nav-item"
                      }
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => onNavigate(item.id)}
                    >
                      {renderAdminNavIcon(item.id)}
                      <span className="admin-nav-item__label">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="admin-sidebar__footer">
            <div className="admin-sidebar__status">
              <span className="chip chip--local">
                {authMode === "LOCAL_API" ? "Lokal · SQLite Offline" : "Lokal · Memori DEMO"}
              </span>
            </div>
            <div className="admin-sidebar__user">
              <div className="admin-sidebar__avatar" aria-hidden="true">
                {user.displayName.slice(0, 1).toUpperCase()}
              </div>
              <div className="admin-sidebar__user-meta">
                <span className="admin-sidebar__username">{user.displayName}</span>
                <span className="admin-sidebar__role">{ROLE_LABEL[user.role]}</span>
              </div>
            </div>
            <Button
              variant="secondary"
              block
              className="admin-sidebar__logout"
              onClick={onLogout}
            >
              <IconLogOut size={18} />
              <span>Keluar</span>
            </Button>
          </div>
        </aside>

        <div className="admin-workspace">
          <DemoBanner authMode={authMode} />
          <main className="admin-main">{children}</main>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <DemoBanner authMode={authMode} />
      <header className="shell__header">
        <span className="shell__brand">POS MINIMARKET</span>
        <span className="chip chip--local">
          {authMode === "LOCAL_API" ? "Lokal · login API, katalog DEMO" : "Lokal · data DEMO di memori"}
        </span>
        {user.role === "CASHIER" && (
          <span className="chip chip--warning">Shift: belum terhubung (DEMO)</span>
        )}
        <span className="shell__user">
          {user.displayName} · Kasir
        </span>
        <Button variant="secondary" onClick={onLogout}>
          Keluar
        </Button>
      </header>
      <nav className="shell__nav" aria-label="Menu utama">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === activePage ? "nav-item nav-item--active" : "nav-item"}
            aria-current={item.id === activePage ? "page" : undefined}
            onClick={() => onNavigate(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <main className="shell__main">{children}</main>
    </div>
  );
}
