import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ApiError } from "./api/errors";
import type { PosDataSource, ReceiveGoodsInput, SessionUser } from "./api/types";
import { defaultPage, isPageAllowed, NAV_BY_ROLE, type PageId } from "./app/navigation";
import { AppShell } from "./components/AppShell";
import { StatusMessage } from "./components/StatusMessage";
import type { CartLine } from "./domain/cart";
import { isUnresolvedReceipt, type ReceiptAttempt } from "./domain/receivingAttempt";
import { hasPendingClose } from "./domain/shiftCloseRecovery";
import { AccountsPage } from "./pages/AccountsPage";
import { CashierPage } from "./pages/CashierPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ForbiddenPage } from "./pages/ForbiddenPage";
import { LoginPage } from "./pages/LoginPage";
import { SetupAdminPage } from "./pages/SetupAdminPage";
import { StockAdjustmentPage } from "./pages/StockAdjustmentPage";
import { BackupPage } from "./pages/BackupPage";
import { ProductsPage } from "./pages/ProductsPage";
import { ReceiptPage } from "./pages/ReceiptPage";
import { ReceivingPage } from "./pages/ReceivingPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ShiftDemoPage } from "./pages/ShiftDemoPage";

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
  "product-list": "Daftar Barang",
  receiving: "Penerimaan",
  "stock-adjustment": "Koreksi Stok",
  reports: "Laporan",
  accounts: "Akun",
  backup: "Backup",
};

const ROLE_LABEL = { ADMIN: "Admin", CASHIER: "Kasir" } as const;

function newDraftId(): string {
  return globalThis.crypto.randomUUID();
}

export function App({ dataSource, onAfterLogout = () => window.location.reload() }: AppProps) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [page, setPage] = useState<PageId>("cashier");
  const [notice, setNotice] = useState<string | null>(null);
  const [closePending, setClosePending] = useState(false);
  // Upaya penerimaan dimiliki App agar tidak hilang saat halaman dibongkar.
  const [receiptAttempt, setReceiptAttemptState] = useState<ReceiptAttempt | null>(null);
  const receiptAttemptRef = useRef<ReceiptAttempt | null>(null);
  // Recovery terpisah per pemilik agar pergantian user tidak membuang upaya user lain.
  const recoveredReceiptRef = useRef(new Map<number, ReceiptAttempt>());
  const setReceiptAttempt = useCallback((next: ReceiptAttempt | null) => {
    receiptAttemptRef.current = next;
    setReceiptAttemptState(next);
  }, []);
  // Draft keranjang disimpan di App agar tidak hilang saat berpindah halaman.
  const [draft, setDraft] = useState(() => ({ id: newDraftId(), lines: [] as CartLine[] }));
  const setDraftLines: Dispatch<SetStateAction<CartLine[]>> = (update) => {
    setDraft((current) => ({
      ...current,
      lines: typeof update === "function" ? update(current.lines) : update,
    }));
  };
  function restoreDraft(expectedId: string, lines: CartLine[]) {
    setDraft((current) => current.id === expectedId && current.lines.length === 0
      ? { ...current, lines }
      : current);
  }
  function consumeDraft(expectedId: string, soldProductIds: number[] | null) {
    setDraft((current) => {
      if (current.id !== expectedId) return current;
      const sold = soldProductIds === null ? null : new Set(soldProductIds);
      return { id: newDraftId(), lines: sold ? current.lines.filter((line) => !sold.has(line.productId)) : [] };
    });
  }
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const sessionEpochRef = useRef(0);
  const shouldCheckBootstrap =
    dataSource.authMode !== "DEMO" && typeof dataSource.getBootstrapStatus === "function";
  const [needsSetup, setNeedsSetup] = useState(false);
  const [bootstrapState, setBootstrapState] = useState<"loading" | "ready" | "error">(shouldCheckBootstrap ? "loading" : "ready");
  const [bootstrapRetry, setBootstrapRetry] = useState(0);

  useEffect(() => {
    if (
      user !== null ||
      !shouldCheckBootstrap ||
      typeof dataSource.getBootstrapStatus !== "function"
    ) {
      return;
    }
    let active = true;
    setBootstrapState("loading");
    dataSource
      .getBootstrapStatus()
      .then((status) => {
        if (!active) return;
        setNeedsSetup(status.needsSetup);
        setBootstrapState("ready");
      })
      .catch(() => {
        if (!active) return;
        setBootstrapState("error");
      });
    return () => {
      active = false;
    };
  }, [dataSource, shouldCheckBootstrap, user, bootstrapRetry]);

  const handleLoggedIn = useCallback((nextUser: SessionUser) => {
    const nextEpoch = sessionEpochRef.current + 1;
    sessionEpochRef.current = nextEpoch;
    setSessionEpoch(nextEpoch);
    setDraft({ id: newDraftId(), lines: [] });
    // Pulihkan hanya untuk user yang sama; user lain tidak boleh melihat upayanya.
    const recovered = recoveredReceiptRef.current.get(nextUser.userId);
    setReceiptAttempt(recovered ?? null);
    recoveredReceiptRef.current.delete(nextUser.userId);
    setNotice(null);
    setUser(nextUser);
    const pending = nextUser.role === "CASHIER" && dataSource.authMode !== "DEMO" && hasPendingClose(nextUser.userId);
    setClosePending(pending);
    setPage(pending ? "shift" : defaultPage(nextUser.role));
  }, [dataSource]);

  const handleSessionExpired = useCallback(() => {
    if (sessionEpochRef.current !== sessionEpoch) {
      return;
    }
    const nextEpoch = sessionEpochRef.current + 1;
    sessionEpochRef.current = nextEpoch;
    setSessionEpoch(nextEpoch);
    setDraft({ id: newDraftId(), lines: [] });
    // Pertahankan kunci/payload PENDING maupun UNKNOWN untuk pemiliknya,
    // tetapi jangan tampilkan di UI saat sesi tidak terautentikasi.
    const current = receiptAttemptRef.current;
    if (current && isUnresolvedReceipt(current) && user) {
      recoveredReceiptRef.current.set(user.userId, { ...current, status: "UNKNOWN" });
    }
    setReceiptAttempt(null);
    setUser(null);
    setPage("cashier");
    setNotice("Sesi berakhir atau tidak lagi valid. Silakan masuk kembali.");
    // Bersihkan token di memori klien; kegagalan revoke server ditangani TTL backend.
    void dataSource.logout();
  }, [dataSource, sessionEpoch, setReceiptAttempt, user]);

  const submitReceipt = useCallback(
    async (payload: ReceiveGoodsInput) => {
      const current = receiptAttemptRef.current;
      if (current && current.status === "PENDING") return;
      const epoch = sessionEpochRef.current;
      const attempt: ReceiptAttempt = {
        receiptKey: payload.receiptKey,
        payload,
        status: "PENDING",
        result: null,
        error: null,
      };
      setReceiptAttempt(attempt);
      try {
        const result = await dataSource.receiveGoods(payload);
        if (epoch !== sessionEpochRef.current) return;
        setReceiptAttempt({ ...attempt, status: "COMMITTED", result, error: null });
      } catch (error) {
        if (epoch !== sessionEpochRef.current) return;
        if (error instanceof ApiError && error.isSessionExpired) {
          // Hasil 401 bisa saja terjadi setelah commit; simpan sebagai UNKNOWN
          // sebelum sesi dibersihkan agar same-user recovery menyimpan kuncinya.
          setReceiptAttempt({ ...attempt, status: "UNKNOWN", result: null, error: error.message });
          handleSessionExpired();
          return;
        }
        // DEMO_UNSUPPORTED adalah tolakan tegas: tidak ada penerimaan yang
        // disimpan, jadi draft boleh dikoreksi/dibatalkan (tidak dikunci).
        // Semua kegagalan lain tetap UNKNOWN dengan kunci/payload asli.
        const confirmedRejection =
          error instanceof ApiError && error.code === "DEMO_UNSUPPORTED";
        setReceiptAttempt({
          ...attempt,
          status: confirmedRejection ? "REJECTED" : "UNKNOWN",
          result: null,
          error: error instanceof ApiError ? error.message : "Penerimaan gagal disimpan.",
        });
      }
    },
    [dataSource, handleSessionExpired, setReceiptAttempt],
  );

  const retryReceipt = useCallback(() => {
    const current = receiptAttemptRef.current;
    // Retry memakai payload snapshot yang sama, bukan draft yang sudah diubah.
    if (current) void submitReceipt(current.payload);
  }, [submitReceipt]);

  const clearReceiptAttempt = useCallback(() => setReceiptAttempt(null), [setReceiptAttempt]);

  async function handleLogout() {
    if (isUnresolvedReceipt(receiptAttempt)) {
      setNotice("Penerimaan belum selesai atau hasilnya belum pasti. Periksa ulang dengan receiptKey yang sama sebelum keluar.");
      return;
    }
    const logoutEpoch = sessionEpochRef.current + 1;
    sessionEpochRef.current = logoutEpoch;
    setSessionEpoch(logoutEpoch);
    // Sembunyikan halaman terlindungi dan bersihkan state klien seketika
    // tanpa menunggu respons backend.
    setDraft({ id: newDraftId(), lines: [] });
    setReceiptAttempt(null);
    setUser(null);
    setPage("cashier");
    setNotice(null);
    try {
      await dataSource.logout();
    } finally {
      // Reload akan membuang recovery milik user lain yang masih berada di memori.
      if (sessionEpochRef.current === logoutEpoch && recoveredReceiptRef.current.size === 0) {
        onAfterLogout();
      }
    }
  }

  if (!user) {
    if (shouldCheckBootstrap && bootstrapState !== "ready") {
      return bootstrapState === "loading" ? <p>Memeriksa status setup…</p> : <div role="alert">Status setup tidak dapat diperiksa. <button type="button" onClick={() => setBootstrapRetry((n) => n + 1)}>Coba lagi</button></div>;
    }
    if (needsSetup) {
      return (
        <SetupAdminPage
          dataSource={dataSource}
          onAlreadyExists={() => {
            setNeedsSetup(false);
            setNotice("Akun admin sudah ada. Silakan masuk.");
          }}
          onCompleted={(createdUsername) => {
            setNeedsSetup(false);
            setNotice(`Akun admin pertama "${createdUsername}" dibuat. Silakan masuk.`);
          }}
        />
      );
    }
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
          onBack={() => navigateTo(defaultPage(currentUser.role))}
        />
      </AppShell>
    );
  }

  const activePage = page;

  function navigateTo(next: PageId): void {
    if (isUnresolvedReceipt(receiptAttempt) && next !== "receiving") {
      setNotice(
        "Penerimaan belum selesai atau hasilnya belum pasti. Periksa ulang dengan receiptKey yang sama sebelum pindah halaman.",
      );
      return;
    }
    setNotice(null);
    setPage(next);
  }

  function renderPage() {
    if (activePage === "dashboard") {
      return <DashboardPage dataSource={dataSource} currentUser={currentUser} onSessionExpired={handleSessionExpired} />;
    }
    if (activePage === "cashier") {
      return (
        <CashierPage
          dataSource={dataSource}
          lines={draft.lines}
          draftId={draft.id}
          onDraftConsumed={consumeDraft}
          onDraftRestore={restoreDraft}
          onLinesChange={setDraftLines}
          sessionEpoch={sessionEpochRef.current}
          cashierId={currentUser.userId}
          onSessionExpired={handleSessionExpired}
        />
      );
    }
    if (activePage === "shift") {
      return <ShiftDemoPage dataSource={dataSource} currentUser={currentUser} onSessionExpired={handleSessionExpired} onPendingChange={(pending) => { if (sessionEpochRef.current === sessionEpoch) setClosePending(pending); }} />;
    }
    if (activePage === "products") {
      return (
        <ProductsPage
          dataSource={dataSource}
          currentUser={currentUser}
          onSessionExpired={handleSessionExpired}
          view="manage"
        />
      );
    }
    if (activePage === "product-list") {
      return (
        <ProductsPage
          dataSource={dataSource}
          currentUser={currentUser}
          onSessionExpired={handleSessionExpired}
          view="list"
        />
      );
    }
    if (activePage === "accounts") {
      return (
        <AccountsPage
          dataSource={dataSource}
          currentUser={currentUser}
          onSessionExpired={handleSessionExpired}
        />
      );
    }
    if (activePage === "reports") {
      return (
        <ReportsPage
          dataSource={dataSource}
          currentUser={currentUser}
          onSessionExpired={handleSessionExpired}
        />
      );
    }
    if (activePage === "history") {
      return <ReceiptPage dataSource={dataSource} onSessionExpired={handleSessionExpired} />;
    }
    if (activePage === "receiving") {
      return (
        <ReceivingPage
          dataSource={dataSource}
          currentUser={currentUser}
          onSessionExpired={handleSessionExpired}
          attempt={receiptAttempt}
          onSubmitAttempt={(payload) => void submitReceipt(payload)}
          onRetryAttempt={retryReceipt}
          onClearAttempt={clearReceiptAttempt}
        />
      );
    }
    if (activePage === "stock-adjustment") return <StockAdjustmentPage dataSource={dataSource} currentUser={currentUser} onSessionExpired={handleSessionExpired} />;
    return <BackupPage dataSource={dataSource} onSessionExpired={handleSessionExpired} />;
  }

  return (
    <AppShell
      user={currentUser}
      authMode={dataSource.authMode}
      navItems={NAV_BY_ROLE[currentUser.role]}
      activePage={activePage}
      onNavigate={(next) => { if (!closePending || next === "shift") navigateTo(next); }}
      onLogout={handleLogout}
    >
      {notice && <StatusMessage tone="warning" text={notice} />}
      {renderPage()}
    </AppShell>
  );
}
