import { useCallback, useRef, useState } from "react";
import type { PosDataSource, SessionUser } from "./api/types";
import { defaultPage, isPageAllowed, NAV_BY_ROLE, type PageId } from "./app/navigation";
import { AppShell } from "./components/AppShell";
import type { CartLine } from "./domain/cart";
import { AccountsPage } from "./pages/AccountsPage";
import { CashierPage } from "./pages/CashierPage";
import { ForbiddenPage } from "./pages/ForbiddenPage";
import { LoginPage } from "./pages/LoginPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { ProductsPage } from "./pages/ProductsPage";

interface AppProps {
  dataSource: PosDataSource;
  /** Dipanggil setelah logout untuk membersihkan state; default memuat ulang halaman. */
  onAfterLogout?: () => void;
}

const PAGE_LABEL: Record<PageId, string> = {
  cashier: "Kasir",
  history: "Riwayat/Struk",
  shift: "Shift",
  dashboard: "Dashboard",
  products: "Barang/Stok",
  receiving: "Penerimaan",
  "stock-adjustment": "Koreksi Stok",
  reports: "Laporan",
  accounts: "Akun",
  backup: "Backup",
};

const ROLE_LABEL = { ADMIN: "Admin", CASHIER: "Kasir" } as const;

const PLACEHOLDER_REASON: Record<Exclude<PageId, "cashier" | "products" | "accounts">, { title: string; reason: string }> = {
  history: { title: "Riwayat/Struk", reason: "Menunggu penjualan tersimpan dan cetak (TASK-016, TASK-021)." },
  shift: { title: "Shift", reason: "Endpoint shift masih BLOCKED oleh konflik izin TASK-001 K-01/K-02 (TASK-014)." },
  dashboard: { title: "Dashboard", reason: "Menunggu query laporan (TASK-026, TASK-040). Tidak ada angka palsu." },
  receiving: { title: "Penerimaan", reason: "Menunggu TASK-025/TASK-027." },
  "stock-adjustment": { title: "Koreksi Stok", reason: "Menunggu TASK-039 dan kunci idempotensi (TASK-001 K-11)." },
  reports: { title: "Laporan", reason: "Menunggu TASK-026/TASK-027." },
  backup: { title: "Backup", reason: "Menunggu TASK-028." },
};

export function App({ dataSource, onAfterLogout = () => window.location.reload() }: AppProps) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [page, setPage] = useState<PageId>("cashier");
  const [notice, setNotice] = useState<string | null>(null);
  // Draft keranjang disimpan di App agar tidak hilang saat berpindah halaman.
  const [draftLines, setDraftLines] = useState<CartLine[]>([]);
  const sessionEpochRef = useRef(0);

  const handleLoggedIn = useCallback((nextUser: SessionUser) => {
    sessionEpochRef.current += 1;
    setDraftLines([]);
    setNotice(null);
    setUser(nextUser);
    setPage(defaultPage(nextUser.role));
  }, []);

  const handleSessionExpired = useCallback(() => {
    sessionEpochRef.current += 1;
    setDraftLines([]);
    setUser(null);
    setPage("cashier");
    setNotice("Sesi berakhir atau tidak lagi valid. Silakan masuk kembali.");
    // Bersihkan token di memori klien; kegagalan revoke server ditangani TTL backend.
    void dataSource.logout();
  }, [dataSource]);

  async function handleLogout() {
    sessionEpochRef.current += 1;
    // Sembunyikan halaman terlindungi dan bersihkan state klien seketika
    // tanpa menunggu respons backend.
    setDraftLines([]);
    setUser(null);
    setPage("cashier");
    setNotice(null);
    try {
      await dataSource.logout();
    } finally {
      onAfterLogout();
    }
  }

  if (!user) {
    return <LoginPage dataSource={dataSource} onLoggedIn={handleLoggedIn} notice={notice} />;
  }
  const currentUser = user;

  // Penjaga navigasi UI saja; otorisasi sesungguhnya di backend (DEC-014).
  if (!isPageAllowed(currentUser.role, page)) {
    return (
      <AppShell
        user={currentUser}
        authMode={dataSource.authMode}
        navItems={NAV_BY_ROLE[currentUser.role]}
        activePage={defaultPage(currentUser.role)}
        onNavigate={setPage}
        onLogout={handleLogout}
      >
        <ForbiddenPage
          attemptedLabel={PAGE_LABEL[page]}
          roleLabel={ROLE_LABEL[currentUser.role]}
          onBack={() => setPage(defaultPage(currentUser.role))}
        />
      </AppShell>
    );
  }

  const activePage = page;

  function renderPage() {
    if (activePage === "cashier") {
      return (
        <CashierPage
          dataSource={dataSource}
          lines={draftLines}
          onLinesChange={setDraftLines}
          sessionEpoch={sessionEpochRef.current}
        />
      );
    }
    if (activePage === "products") {
      return <ProductsPage dataSource={dataSource} />;
    }
    if (activePage === "accounts") {
      const expectedEpoch = sessionEpochRef.current;
      return (
        <AccountsPage
          dataSource={dataSource}
          currentUser={currentUser}
          onSessionExpired={() => {
            if (sessionEpochRef.current === expectedEpoch) {
              handleSessionExpired();
            }
          }}
        />
      );
    }
    const info = PLACEHOLDER_REASON[activePage];
    return <PlaceholderPage title={info.title} reason={info.reason} />;
  }

  return (
    <AppShell
      user={currentUser}
      authMode={dataSource.authMode}
      navItems={NAV_BY_ROLE[currentUser.role]}
      activePage={activePage}
      onNavigate={setPage}
      onLogout={handleLogout}
    >
      {renderPage()}
    </AppShell>
  );
}
