import type { ReactNode } from "react";
import type { SessionUser } from "../api/types";
import type { NavItem, PageId } from "../app/navigation";
import { Button } from "./Button";
import { DemoBanner } from "./DemoBanner";

interface AppShellProps {
  user: SessionUser;
  navItems: readonly NavItem[];
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  onLogout: () => void;
  children: ReactNode;
}

const ROLE_LABEL = { ADMIN: "Admin", CASHIER: "Kasir" } as const;

/** Kerangka aplikasi: identitas, status lokal, info shift, navigasi role. */
export function AppShell({ user, navItems, activePage, onNavigate, onLogout, children }: AppShellProps) {
  return (
    <div className="shell">
      <DemoBanner />
      <header className="shell__header">
        <span className="shell__brand">POS MINIMARKET</span>
        <span className="chip chip--local">Lokal · data DEMO di memori</span>
        {user.role === "CASHIER" && (
          // Shift BELUM terhubung: endpoint shift BLOCKED (TASK-001 K-01/K-02, TASK-014).
          <span className="chip chip--warning">Shift: belum terhubung (DEMO)</span>
        )}
        <span className="shell__user">
          {user.displayName} · {ROLE_LABEL[user.role]}
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

