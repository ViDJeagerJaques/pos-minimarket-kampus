import type { ReactNode } from "react";
import type { AuthMode, SessionUser } from "../api/types";
import type { NavGroup, NavItem, PageId } from "../app/navigation";
import {
  IconBarChart,
  IconClipboardList,
  IconClock,
  IconDashboard,
  IconDatabaseBackup,
  IconHistory,
  IconKey,
  IconLogOut,
  IconPackage,
  IconPackageCheck,
  IconShoppingCart,
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
  shiftActive?: boolean | null;
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
function renderCashierNavIcon(id: PageId) {
  switch (id) {
    case "cashier":
      return <IconShoppingCart size={16} />;
    case "history":
      return <IconHistory size={16} />;
    case "shift":
      return <IconClock size={16} />;
    case "password":
      return <IconKey size={16} />;
    default:
      return null;
  }
}

export function AppShell({
  user,
  authMode,
  navItems,
  activePage,
  onNavigate,
  onLogout,
  shiftActive,
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

  const shiftBadge =
    authMode === "DEMO"
      ? { cls: "cashier-chip cashier-chip--warning", text: "Shift: DEMO" }
      : shiftActive === true
        ? { cls: "cashier-chip cashier-chip--success", text: "Shift Aktif" }
        : shiftActive === false
          ? { cls: "cashier-chip cashier-chip--warning", text: "Belum Ada Shift" }
          : { cls: "cashier-chip cashier-chip--neutral", text: "Memeriksa Shift..." };

  return (
    <div className="cashier-shell">
      <DemoBanner authMode={authMode} />
      <header className="cashier-topbar">
        <div className="cashier-topbar__left">
          <span className="cashier-topbar__brand">
            <span className="cashier-topbar__brand-mark" aria-hidden="true">
              <IconStore size={16} />
            </span>
            <span>POS MINIMARKET</span>
          </span>
          <span className="cashier-chip cashier-chip--neutral">
            {authMode === "LOCAL_API" ? "Mode Lokal" : "Lokal · data DEMO"}
          </span>
          {user.role === "CASHIER" && (
            <span className={shiftBadge.cls}>{shiftBadge.text}</span>
          )}
        </div>
        <div className="cashier-topbar__right">
          <span className="cashier-topbar__user">
            {user.displayName} · {ROLE_LABEL[user.role]}
          </span>
          <Button variant="secondary" onClick={onLogout}>
            <IconLogOut size={15} /> Keluar
          </Button>
        </div>
      </header>
      <nav className="cashier-nav" aria-label="Menu utama">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={
              item.id === activePage
                ? "cashier-nav__item cashier-nav__item--active"
                : "cashier-nav__item"
            }
            aria-current={item.id === activePage ? "page" : undefined}
            onClick={() => onNavigate(item.id)}
          >
            {renderCashierNavIcon(item.id)}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <main className="cashier-main">{children}</main>
    </div>
  );
}
