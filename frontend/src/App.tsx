import { useState } from "react";
import type { PosDataSource, SessionUser } from "./api/types";
import { defaultPage, isPageAllowed, NAV_BY_ROLE, type PageId } from "./app/navigation";
import { AppShell } from "./components/AppShell";
import { CashierPage } from "./pages/CashierPage";
import { LoginPage } from "./pages/LoginPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { ProductsPage } from "./pages/ProductsPage";

interface AppProps {
  dataSource: PosDataSource;
  /** Dipanggil setelah logout untuk membersihkan state; default memuat ulang halaman. */
  onAfterLogout?: () => void;
}

const PLACEHOLDER_REASON: Record<Exclude<PageId, "cashier" | "products">, { title: string; reason: string }> = {
  history: { title: "Riwayat/Struk", reason: "Menunggu penjualan tersimpan dan cetak (TASK-016, TASK-021)." },
  shift: { title: "Shift", reason: "Endpoint shift masih BLOCKED oleh konflik izin TASK-001 K-01/K-02 (TASK-014)." },
  dashboard: { title: "Dashboard", reason: "Menunggu query laporan (TASK-026, TASK-040). Tidak ada angka palsu." },
  receiving: { title: "Penerimaan", reason: "Menunggu TASK-025/TASK-027." },
  "stock-adjustment": { title: "Koreksi Stok", reason: "Menunggu TASK-039 dan kunci idempotensi (TASK-001 K-11)." },
  reports: { title: "Laporan", reason: "Menunggu TASK-026/TASK-027." },
  accounts: { title: "Akun", reason: "Menunggu TASK-009/TASK-011 dan kontrak endpoint akun (TASK-001 K-12)." },
  backup: { title: "Backup", reason: "Menunggu TASK-028." },
};

export function App({ dataSource, onAfterLogout = () => window.location.reload() }: AppProps) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [page, setPage] = useState<PageId>("cashier");

  function handleLoggedIn(nextUser: SessionUser) {
    setUser(nextUser);
    setPage(defaultPage(nextUser.role));
  }

  async function handleLogout() {
    try {
      await dataSource.logout();
    } finally {
      // Bersihkan seluruh state klien, lalu muat ulang (keranjang draft ikut terbuang).
      setUser(null);
      setPage("cashier");
      onAfterLogout();
    }
  }

  if (!user) {
    return <LoginPage dataSource={dataSource} onLoggedIn={handleLoggedIn} />;
  }

  // Penjaga navigasi UI saja; otorisasi sesungguhnya di backend (DEC-014).
  const activePage = isPageAllowed(user.role, page) ? page : defaultPage(user.role);

  function renderPage() {
    if (activePage === "cashier") {
      return <CashierPage dataSource={dataSource} />;
    }
    if (activePage === "products") {
      return <ProductsPage dataSource={dataSource} />;
    }
    const info = PLACEHOLDER_REASON[activePage];
    return <PlaceholderPage title={info.title} reason={info.reason} />;
  }

  return (
    <AppShell
      user={user}
      navItems={NAV_BY_ROLE[user.role]}
      activePage={activePage}
      onNavigate={setPage}
      onLogout={handleLogout}
    >
      {renderPage()}
    </AppShell>
  );
}

