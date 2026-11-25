import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/errors";
import type { PaymentReport, PosDataSource, SessionUser, SheetsSyncStatus } from "../api/types";
import {
  IconEye,
  IconEyeOff,
  IconBarChart,
  IconCloud,
  IconDownload,
  IconFileSpreadsheet,
  IconHardDrive,
  IconPackage,
  IconRefresh,
} from "../components/AdminIcons";
import { Button } from "../components/Button";
import {
  DailyReportPanel,
  exclusiveEndMs,
  parseDay,
  toDateInputValue,
} from "../components/DailyReportPanel";
import { MoneyText } from "../components/MoneyText";
import { StatusMessage, type StatusTone } from "../components/StatusMessage";
import { StockReportPanel } from "../components/StockReportPanel";
import { buildExcelWorkbook } from "../domain/excel";
import { buildCsv, triggerFileDownload } from "../domain/iposFeatures";

interface ReportsPageProps {
  dataSource: PosDataSource;
  currentUser: SessionUser;
  onSessionExpired: () => void;
  initialTab?: ReportTab;
}

export type ReportTab = "payments" | "sales" | "stock" | "sync";
type Status = { tone: StatusTone; text: string };
type ManualDataset = "daily" | "payments" | "stock";

function formatTime(ms: number): string {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? "waktu tidak diketahui" : date.toLocaleString("id-ID");
}

/**
 * Halaman Laporan ADMIN dengan 4 tab internal:
 * 1. Pembayaran (Tunai vs QRIS terverifikasi terpisah)
 * 2. Penjualan (per tanggal / shift)
 * 3. Persediaan & Mutasi (ledger stok + panel detail)
 * 4. Ekspor & Sinkronisasi (Excel Lokal, Google Sheets, Ekspor Manual)
 */
export function ReportsPage({
  dataSource,
  currentUser: _currentUser,
  onSessionExpired,
  initialTab = "payments",
}: ReportsPageProps) {
  const [activeTab, setActiveTab] = useState<ReportTab>(initialTab);
  const [excel, setExcel] = useState<{ file: string | null; lastSync: number | null } | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);
  const [excelMessage, setExcelMessage] = useState("");
  useEffect(() => { let active = true; dataSource.getExcelSync?.().then(result => { if (active) setExcel(result); }).catch(error => { if (active && error instanceof ApiError && error.isSessionExpired) onSessionExpired(); }); return () => { active = false; }; }, [dataSource, onSessionExpired]);
  async function excelAction(action: "choose" | "sync" | "open") {
    if (excelBusy) return; setExcelBusy(true); setExcelMessage("");
    try {
      if (action === "choose") { const file = await window.POS_SPIKE?.chooseExcelFile(); if (file && dataSource.configureExcelSync) { setExcel(await dataSource.configureExcelSync(file)); setExcelMessage("Lokasi tersimpan."); } }
      if (action === "sync" && dataSource.runExcelSync) { setExcel(await dataSource.runExcelSync()); setExcelMessage("Sinkronisasi berhasil."); }
      if (action === "open" && !(await dataSource.openExcelSync?.())) setExcelMessage("File tidak dapat dibuka. Pastikan file tersedia dan aplikasi Excel terpasang.");
    } catch (error) { if (error instanceof ApiError && error.isSessionExpired) onSessionExpired(); else setExcelMessage(error instanceof ApiError ? error.message : "Operasi Excel gagal. Periksa lokasi dan apakah file sedang dibuka."); }
    finally { setExcelBusy(false); }
  }
  const [report, setReport] = useState<PaymentReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // State Google Sheets (dipindahkan dari ProductsPage sesuai UI_UX_ADMIN.md §4.6 A)
  const [sheetsSyncStatus, setSheetsSyncStatus] = useState<SheetsSyncStatus | null>(null);
  const [sheetsSyncLoading, setSheetsSyncLoading] = useState(false);
  const [sheetsSyncStatusError, setSheetsSyncStatusError] = useState<string | null>(null);
  const [sheetsSyncReloadKey, setSheetsSyncReloadKey] = useState(0);
  const [syncingSheets, setSyncingSheets] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [futureSalesOnly, setFutureSalesOnly] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);
  const [configMessage, setConfigMessage] = useState("");
  const [configState, setConfigState] = useState<{ configured: boolean; restartRequired: boolean; legacy?: boolean } | null>(null);
  useEffect(() => {
    if (!dataSource.getSheetsConfig) return;
    let active = true;
    dataSource.getSheetsConfig().then(value => { if (active) setConfigState(value); }).catch(error => {
      if (active && error instanceof ApiError && error.isSessionExpired) onSessionExpired();
    });
    return () => { active = false; };
  }, [dataSource, onSessionExpired, sheetsSyncReloadKey]);
  async function openConfig() {
    setConfigOpen(true); setConfigMessage(""); setWebhookUrl(""); setWebhookSecret(""); setShowSecret(false); setFutureSalesOnly(false);
    try { if (dataSource.getSheetsConfig) setConfigState(await dataSource.getSheetsConfig()); }
    catch (error) { if (error instanceof ApiError && error.isSessionExpired) onSessionExpired(); else setConfigMessage("Status konfigurasi tidak dapat dimuat."); }
  }
  async function configure(action: "ping" | "save") {
    if (configBusy || !webhookUrl.trim() || webhookSecret.length === 0) return;
    setConfigBusy(true); setConfigMessage("");
    try {
      if (action === "ping" && dataSource.pingSheetsConfig) {
        const result = await dataSource.pingSheetsConfig({ webhookUrl, secret: webhookSecret });
        setConfigMessage(result.connected ? "Terhubung: receiver merespons ping." : "Gagal terhubung. Periksa URL, secret, dan jaringan.");
      } else if (action === "save" && dataSource.saveSheetsConfig) {
        await dataSource.saveSheetsConfig({ webhookUrl, secret: webhookSecret, futureSalesOnly });
        setWebhookSecret(""); setConfigState({ configured: true, restartRequired: true }); setConfigMessage("Konfigurasi tersimpan. Restart aplikasi secara manual saat aman untuk mengaktifkannya.");
      }
    } catch (error) { if (error instanceof ApiError && error.isSessionExpired) onSessionExpired(); else setConfigMessage(error instanceof ApiError ? error.message : "Operasi konfigurasi gagal."); }
    finally { setConfigBusy(false); }
  }
  const [sheetsSyncFeedback, setSheetsSyncFeedback] = useState<Status | null>(null);

  // State Ekspor Manual terpusat
  const today = toDateInputValue(new Date());
  const [manualDataset, setManualDataset] = useState<ManualDataset>("daily");
  const [manualStart, setManualStart] = useState(today);
  const [manualEnd, setManualEnd] = useState(today);
  const [manualShiftId, setManualShiftId] = useState("");
  const [manualThreshold, setManualThreshold] = useState("5");
  const [manualExporting, setManualExporting] = useState(false);
  const [manualFeedback, setManualFeedback] = useState<Status | null>(null);

  const handleError = useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof ApiError && error.isSessionExpired) {
        onSessionExpired();
        return;
      }
      setLoadError(error instanceof ApiError ? error.message : fallback);
    },
    [onSessionExpired],
  );

  useEffect(() => {
    let isActive = true;
    setIsLoading(true);
    dataSource
      .getPaymentReport()
      .then((data) => {
        if (!isActive) return;
        setReport(data);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (isActive) handleError(error, "Laporan pembayaran gagal dimuat.");
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [dataSource, handleError, reloadKey]);

  useEffect(() => {
    if (!dataSource.getSheetsSyncStatus) {
      setSheetsSyncStatus(null);
      setSheetsSyncStatusError(null);
      setSheetsSyncLoading(false);
      return;
    }
    let active = true;
    setSheetsSyncLoading(true);
    setSheetsSyncStatusError(null);
    dataSource
      .getSheetsSyncStatus()
      .then((result) => {
        if (!active) return;
        setSheetsSyncStatus(result);
        setSheetsSyncStatusError(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.isSessionExpired) {
          onSessionExpired();
          return;
        }
        setSheetsSyncStatus(null);
        setSheetsSyncStatusError(
          error instanceof ApiError
            ? error.message
            : "Status sinkronisasi spreadsheet gagal dimuat.",
        );
      })
      .finally(() => {
        if (active) setSheetsSyncLoading(false);
      });
    return () => {
      active = false;
    };
  }, [dataSource, onSessionExpired, sheetsSyncReloadKey]);

  async function handleSyncSheets(): Promise<void> {
    if (syncingSheets || !dataSource.syncSheetsNow || !sheetsSyncStatus?.enabled) return;
    setSyncingSheets(true);
    setSheetsSyncFeedback(null);
    try {
      const result = await dataSource.syncSheetsNow();
      setSheetsSyncStatus({ enabled: result.enabled, pendingCount: result.pendingCount });
      if (!result.enabled) {
        setSheetsSyncFeedback({
          tone: "warning",
          text: "Sinkronisasi spreadsheet belum dikonfigurasi pada server lokal.",
        });
      } else if (result.pendingCount === 0) {
        setSheetsSyncFeedback({
          tone: "success",
          text:
            result.sentCount > 0
              ? `Sinkronisasi spreadsheet berhasil: ${result.sentCount} penjualan terkirim.`
              : "Sinkronisasi spreadsheet berhasil: tidak ada penjualan tertunda.",
        });
      } else {
        const reasons: Record<NonNullable<typeof result.failure>, string> = {
          NETWORK: "Jaringan tidak tersedia atau permintaan habis waktu.",
          UNSAFE_REDIRECT: "Pengalihan receiver tidak aman.",
          HTTP_ERROR: "Layanan receiver mengembalikan kesalahan HTTP.",
          INVALID_RESPONSE: "Respons receiver tidak dapat dibaca.",
          SALE_CONFLICT: "Nomor struk sudah ada dengan data yang berbeda; periksa receiver dan laporan.",
          NAMESPACE_MISMATCH: "Identitas database tidak sesuai dengan receiver.",
          REJECTED: "Receiver menolak transaksi; periksa konfigurasi dan data.",
        };
        setSheetsSyncFeedback({
          tone: "warning",
          text:
            result.sentCount > 0
              ? `Sinkronisasi sebagian berhasil: ${result.sentCount} terkirim, ${result.pendingCount} masih tertunda.`
              : `Sinkronisasi spreadsheet gagal: ${result.pendingCount} penjualan masih tertunda.`,
        });
        if (result.failure) setSheetsSyncFeedback(previous => previous ? { ...previous, text: `${previous.text} ${reasons[result.failure!]}` } : previous);
      }
    } catch (error: unknown) {
      if (error instanceof ApiError && error.isSessionExpired) {
        onSessionExpired();
        return;
      }
      setSheetsSyncFeedback({
        tone: "danger",
        text: error instanceof ApiError ? error.message : "Sinkronisasi spreadsheet gagal. Coba lagi.",
      });
    } finally {
      setSyncingSheets(false);
    }
  }

  async function runManualExport(format: "csv" | "xlsx"): Promise<void> {
    if (manualExporting) return;
    setManualFeedback(null);

    if (manualDataset === "daily") {
      const startMs = parseDay(manualStart);
      const endMs = exclusiveEndMs(manualEnd);
      if (startMs === null || endMs === null || startMs >= endMs) {
        setManualFeedback({
          tone: "danger",
          text: "Pilih tanggal mulai dan akhir yang valid (tanggal akhir tidak sebelum tanggal mulai).",
        });
        return;
      }
      const parsedShift = manualShiftId.trim() === "" ? null : Number(manualShiftId.trim());
      if (parsedShift !== null && (!Number.isSafeInteger(parsedShift) || parsedShift <= 0)) {
        setManualFeedback({
          tone: "danger",
          text: "ID shift harus berupa bilangan bulat positif atau dikosongkan.",
        });
        return;
      }

      setManualExporting(true);
      try {
        const daily = await dataSource.getDailyReport({
          startMs,
          endMs,
          ...(parsedShift === null ? {} : { shiftId: parsedShift }),
        });
        const headers = ["No. Penjualan", "Waktu", "Shift", "Kasir", "Metode", "Total (Rp)"];
        const rows = daily.sales.map((s) => [
          s.saleNo,
          formatTime(s.committedAtMs),
          `#${s.shiftId}`,
          s.cashierUsername ?? "Kasir tidak diketahui",
          s.method === "CASH" ? "Tunai" : "QRIS manual",
          s.amountRp,
        ]);
        const suffix = `${manualStart}_sd_${manualEnd}`;
        if (format === "csv") {
          triggerFileDownload(`laporan-penjualan-${suffix}.csv`, buildCsv(headers, rows), "text/csv;charset=utf-8");
        } else {
          triggerFileDownload(
            `laporan-penjualan-${suffix}.xlsx`,
            buildExcelWorkbook(`Laporan Penjualan ${manualStart} s.d. ${manualEnd}`, headers, rows),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          );
        }
        setManualFeedback({
          tone: daily.salesTruncated ? "warning" : "success",
          text: daily.salesTruncated
            ? `File laporan penjualan diunduh (${daily.sales.length} dari ${daily.saleCount} transaksi; rincian dibatasi 100 baris oleh backend).`
            : `File laporan penjualan (${daily.sales.length} transaksi) berhasil disiapkan untuk diunduh.`,
        });
      } catch (error) {
        if (error instanceof ApiError && error.isSessionExpired) {
          onSessionExpired();
          return;
        }
        setManualFeedback({
          tone: "danger",
          text: error instanceof ApiError ? error.message : "Gagal mengekspor laporan penjualan.",
        });
      } finally {
        setManualExporting(false);
      }
      return;
    }

    if (manualDataset === "payments") {
      setManualExporting(true);
      try {
        const payments = await dataSource.getPaymentReport();
        const headers = ["No. Penjualan", "Waktu", "Kasir Verifikasi", "Referensi Bukti", "Total (Rp)"];
        const rows = payments.qrisSales.map((s) => [
          s.saleNo,
          formatTime(s.verifiedAtMs),
          s.cashierUsername ?? `#${s.verifiedBy}`,
          s.evidenceRef ?? "",
          s.totalRp,
        ]);
        if (format === "csv") {
          triggerFileDownload("laporan-qris.csv", buildCsv(headers, rows), "text/csv;charset=utf-8");
        } else {
          triggerFileDownload(
            "laporan-qris.xlsx",
            buildExcelWorkbook("Laporan Pembayaran QRIS", headers, rows),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          );
        }
        setManualFeedback({
          tone: "success",
          text: `File rincian pembayaran QRIS (${payments.qrisSales.length} baris) berhasil disiapkan untuk diunduh.`,
        });
      } catch (error) {
        if (error instanceof ApiError && error.isSessionExpired) {
          onSessionExpired();
          return;
        }
        setManualFeedback({
          tone: "danger",
          text: error instanceof ApiError ? error.message : "Gagal mengekspor laporan pembayaran.",
        });
      } finally {
        setManualExporting(false);
      }
      return;
    }

    const rawThreshold = manualThreshold.trim();
    if (rawThreshold !== "" && (!/^\d+$/.test(rawThreshold) || !Number.isSafeInteger(Number(rawThreshold)))) {
      setManualFeedback({
        tone: "danger",
        text: "Ambang stok harus berupa bilangan bulat non-negatif atau dikosongkan.",
      });
      return;
    }

    setManualExporting(true);
    try {
      const stock = await dataSource.getStockReport(
        rawThreshold === "" ? {} : { lowStockThreshold: Number(rawThreshold) },
      );
      const headers = ["SKU", "Nama", "Stok Awal", "Penerimaan", "Penjualan", "Koreksi", "Saldo"];
      const rows = stock.products.map((p) => [
        p.sku,
        p.name,
        p.opening,
        p.receipt,
        p.sale,
        p.adjustment,
        p.onHand,
      ]);
      if (format === "csv") {
        triggerFileDownload("laporan-stok.csv", buildCsv(headers, rows), "text/csv;charset=utf-8");
      } else {
        triggerFileDownload(
          "laporan-stok.xlsx",
          buildExcelWorkbook("Laporan Stok", headers, rows),
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
      }
      setManualFeedback({
        tone: "success",
        text: `File snapshot persediaan (${stock.products.length} produk) berhasil disiapkan untuk diunduh.`,
      });
    } catch (error) {
      if (error instanceof ApiError && error.isSessionExpired) {
        onSessionExpired();
        return;
      }
      setManualFeedback({
        tone: "danger",
        text: error instanceof ApiError ? error.message : "Gagal mengekspor laporan stok.",
      });
    } finally {
      setManualExporting(false);
    }
  }

  const isDemo = dataSource.authMode === "DEMO" || dataSource.catalogMode === "DEMO";
  const hasPaymentTotal = report !== null && report.totalRp > 0;
  const cashPercent = hasPaymentTotal ? Math.round((report.cash.totalRp / report.totalRp) * 100) : 0;
  const qrisPercent = hasPaymentTotal ? Math.max(0, 100 - cashPercent) : 0;

  return (
    <section className="admin-page" aria-labelledby="reports-title" aria-busy={isLoading}>
      <header className="admin-header">
        <div className="admin-header__titles">
          <h1 id="reports-title" className="admin-header__title">
            Laporan
          </h1>
          <p className="admin-header__subtitle">
            {isDemo
              ? "Mode DEMO menampilkan angka sintetis untuk pratinjau UI, bukan bukti transaksi."
              : "Pusat rekap pembayaran, penjualan per shift, audit persediaan, serta ekspor dan sinkronisasi laporan."}
          </p>
        </div>
      </header>

      {isDemo && (
        <StatusMessage
          tone="warning"
          text="Mode DEMO: angka laporan sintetis untuk pratinjau UI, bukan bukti transaksi nyata."
        />
      )}

      {/* Empat Tab Internal Laporan */}
      <div className="admin-tabs" role="tablist" aria-label="Kategori Laporan">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "payments"}
          className={activeTab === "payments" ? "admin-tab admin-tab--active" : "admin-tab"}
          onClick={() => setActiveTab("payments")}
        >
          <IconBarChart size={18} />
          <span>Pembayaran</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "sales"}
          className={activeTab === "sales" ? "admin-tab admin-tab--active" : "admin-tab"}
          onClick={() => setActiveTab("sales")}
        >
          <IconFileSpreadsheet size={18} />
          <span>Penjualan</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "stock"}
          className={activeTab === "stock" ? "admin-tab admin-tab--active" : "admin-tab"}
          onClick={() => setActiveTab("stock")}
        >
          <IconPackage size={18} />
          <span>Persediaan &amp; Mutasi</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "sync"}
          className={activeTab === "sync" ? "admin-tab admin-tab--active" : "admin-tab"}
          onClick={() => setActiveTab("sync")}
        >
          <IconCloud size={18} />
          <span>Ekspor &amp; Sinkronisasi</span>
        </button>
      </div>

      {/* TAB 1: PEMBAYARAN */}
      {activeTab === "payments" && (
        <div className="admin-card">
          <div className="admin-card__header">
            <div>
              <h2 className="admin-card__title">Laporan Pembayaran</h2>
              <p className="admin-card__desc">
                QRIS (verifikasi kasir) dipisahkan dari kas tunai karena tidak menambah uang fisik di laci.
              </p>
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <Button variant="secondary" onClick={() => setReloadKey((value) => value + 1)} disabled={isLoading}>
                <IconRefresh size={16} />
                <span>{isLoading ? "Memuat…" : "Muat ulang"}</span>
              </Button>
              {!loadError && report && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const headers = ["No. Penjualan", "Waktu", "Kasir Verifikasi", "Referensi Bukti", "Total (Rp)"];
                      const rows = report.qrisSales.map((s) => [
                        s.saleNo,
                        formatTime(s.verifiedAtMs),
                        s.cashierUsername ?? `#${s.verifiedBy}`,
                        s.evidenceRef ?? "",
                        s.totalRp,
                      ]);
                      triggerFileDownload("laporan-qris.csv", buildCsv(headers, rows), "text/csv;charset=utf-8");
                    }}
                  >
                    <IconDownload size={16} />
                    <span>Ekspor CSV</span>
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const headers = ["No. Penjualan", "Waktu", "Kasir Verifikasi", "Referensi Bukti", "Total (Rp)"];
                      const rows = report.qrisSales.map((s) => [
                        s.saleNo,
                        formatTime(s.verifiedAtMs),
                        s.cashierUsername ?? `#${s.verifiedBy}`,
                        s.evidenceRef ?? "",
                        s.totalRp,
                      ]);
                      triggerFileDownload(
                        "laporan-qris.xlsx",
                        buildExcelWorkbook("Laporan Pembayaran QRIS", headers, rows),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                      );
                    }}
                  >
                    <IconFileSpreadsheet size={16} />
                    <span>Ekspor Excel</span>
                  </Button>
                </>
              )}
            </div>
          </div>

          {loadError && (
            <div className="account-load-error">
              <p className="field-error" role="alert">
                {loadError}
              </p>
              <Button variant="secondary" disabled={isLoading} onClick={() => setReloadKey((value) => value + 1)}>
                Coba lagi
              </Button>
            </div>
          )}

          {!loadError && report && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="admin-kpi-grid admin-kpi-grid--3">
                <div className="admin-kpi-card admin-kpi-card--primary">
                  <h3 className="admin-kpi-card__label">Total seluruh pembayaran</h3>
                  <div className="admin-kpi-card__value">
                    <MoneyText amountRp={report.totalRp} />
                  </div>
                  <p className="admin-kpi-card__meta">
                    {report.cash.count + report.qrisManual.count} transaksi tersimpan
                  </p>
                </div>

                <div className="admin-kpi-card">
                  <h3 className="admin-kpi-card__label">Kas tunai</h3>
                  <div className="admin-kpi-card__value">
                    <MoneyText amountRp={report.cash.totalRp} />
                  </div>
                  <p className="admin-kpi-card__meta">{report.cash.count} transaksi · penjualan CASH tercatat</p>
                </div>

                <div className="admin-kpi-card">
                  <h3 className="admin-kpi-card__label">QRIS manual</h3>
                  <div className="admin-kpi-card__value">
                    <MoneyText amountRp={report.qrisManual.totalRp} />
                  </div>
                  <p className="admin-kpi-card__meta">
                    {report.qrisManual.count} transaksi · {report.qrisManual.verifiedCount} terverifikasi · tidak masuk kas fisik
                  </p>
                </div>
              </div>

              {/* Stacked Bar Distribusi Nominal */}
              <div style={{ padding: "12px 16px", background: "var(--color-bg)", borderRadius: "var(--radius-md)", border: "1px solid var(--color-border)" }}>
                <span className="field-label">Distribusi Nominal Pembayaran</span>
                <div className="stacked-bar" aria-hidden="true">
                  {hasPaymentTotal && (
                    <>
                      <div className="stacked-bar__segment--cash" style={{ width: `${cashPercent}%` }} />
                      <div className="stacked-bar__segment--qris" style={{ width: `${qrisPercent}%` }} />
                    </>
                  )}
                </div>
                <div className="stacked-bar-legend">
                  <span>
                    <span className="payment-dot payment-dot--cash" aria-hidden="true" />
                    Tunai: <MoneyText amountRp={report.cash.totalRp} />
                    {hasPaymentTotal ? ` (${cashPercent}%)` : ""}
                  </span>
                  <span>
                    <span className="payment-dot payment-dot--qris" aria-hidden="true" />
                    QRIS (verifikasi kasir): <MoneyText amountRp={report.qrisManual.totalRp} />
                    {hasPaymentTotal ? ` (${qrisPercent}%)` : ""}
                  </span>
                </div>
              </div>

              <div>
                <h3 className="section-title">Rincian QRIS terverifikasi</h3>
                {report.qrisSales.length < report.qrisManual.verifiedCount && (
                  <p className="muted" role="note">
                    Daftar menampilkan {report.qrisSales.length} dari {report.qrisManual.verifiedCount} transaksi QRIS terverifikasi. Total di atas tetap mencakup seluruh transaksi tersimpan.
                  </p>
                )}
                {report.qrisSales.length === 0 ? (
                  <p className="muted">Belum ada transaksi QRIS terverifikasi.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="table" aria-label="Rincian QRIS terverifikasi">
                      <thead>
                        <tr>
                          <th scope="col">No. penjualan</th>
                          <th scope="col">Waktu</th>
                          <th scope="col">Kasir verifikasi</th>
                          <th scope="col">Referensi bukti</th>
                          <th scope="col">Status</th>
                          <th scope="col" className="num">
                            Nominal
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.qrisSales.map((sale) => (
                          <tr key={sale.saleId}>
                            <td>
                              <code>{sale.saleNo}</code>
                            </td>
                            <td>{formatTime(sale.verifiedAtMs)}</td>
                            <td>{sale.cashierUsername ?? `#${sale.verifiedBy}`}</td>
                            <td>{sale.evidenceRef ?? <span className="muted">—</span>}</td>
                            <td>
                              <span className="badge badge--ok">QRIS (verifikasi kasir)</span>
                            </td>
                            <td className="num">
                              <MoneyText amountRp={sale.totalRp} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: PENJUALAN */}
      {activeTab === "sales" && (
        <DailyReportPanel dataSource={dataSource} onSessionExpired={onSessionExpired} />
      )}

      {/* TAB 3: PERSEDIAAN & MUTASI */}
      {activeTab === "stock" && (
        <StockReportPanel dataSource={dataSource} onSessionExpired={onSessionExpired} />
      )}

      {/* TAB 4: EKSPOR & SINKRONISASI */}
      {activeTab === "sync" && (
        <div className="sync-stack">
          {/* Kartu 1: Microsoft Excel Lokal */}
          <article className="sync-card" aria-label="Microsoft Excel Lokal">
            <div className="admin-card__header" style={{ marginBottom: 0 }}>
              <div>
                <h2 className="admin-card__title">
                  <IconHardDrive size={20} />
                  <span>Microsoft Excel — Lokal / Offline</span>
                </h2>
                <p className="admin-card__desc">
                  Perbarui satu workbook (.xlsx) lokal yang sama tanpa membuat file baru setiap hari.
                </p>
              </div>
              <span className="badge">{excelBusy ? "Memproses…" : excel?.file ? "Dikonfigurasi" : "Belum dikonfigurasi"}</span>
            </div>

            <div className="sync-card__meta-grid">
              <div>
                <span className="sync-card__kv-label">File tujuan</span>
                <span className="sync-card__kv-value">{excel?.file ?? "Belum memilih file"}</span>
              </div>
              <div>
                <span className="sync-card__kv-label">Sinkronisasi terakhir</span>
                <span className="sync-card__kv-value">
                  {excel?.lastSync ? formatTime(excel.lastSync) : "Belum pernah"}
                </span>
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <span className="muted" style={{ fontSize: "12px" }}>
                Workbook khusus laporan POS. Perubahan manual dapat tertimpa saat sinkronisasi.
              </span>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <Button type="button" variant="secondary" disabled={excelBusy || !window.POS_SPIKE?.chooseExcelFile || !dataSource.configureExcelSync} onClick={() => void excelAction("choose")}>
                  Pilih file
                </Button>
                <Button type="button" variant="secondary" disabled={excelBusy || !excel?.file} onClick={() => void excelAction("sync")}>
                  Sinkronkan
                </Button>
                <Button type="button" variant="secondary" disabled={excelBusy || !excel?.lastSync} onClick={() => void excelAction("open")}>Buka File Excel</Button>
              </div>
            </div>
            {excelMessage && <p role="status">{excelMessage}</p>}
          </article>

          {/* Kartu 2: Google Sheets — Online (Integrasi Existing Dipindahkan dari Barang/Stok) */}
          <article className="sync-card" aria-label="Google Sheets Online">
            <div className="admin-card__header" style={{ marginBottom: 0 }}>
              <div>
                <h2 className="admin-card__title">
                  <IconCloud size={20} />
                  <span>Google Sheets — Online</span>
                </h2>
                <p className="admin-card__desc">
                  Kirim antrean penjualan tersimpan ke Google Sheets melalui layanan sinkronisasi server lokal.
                </p>
              </div>
              {sheetsSyncLoading ? (
                <span className="badge">Memuat status…</span>
              ) : sheetsSyncStatusError !== null ? (
                <span className="badge badge--danger">Gagal membaca status</span>
              ) : syncingSheets ? (
                <span className="badge badge--info">Mengirim…</span>
              ) : configState?.restartRequired ? (
                <span className="badge badge--warning">Tersimpan, restart diperlukan</span>
              ) : sheetsSyncStatus?.enabled ? (
                <span className="badge badge--ok">Siap di server lokal</span>
              ) : (
                <span className="badge">Belum dikonfigurasi</span>
              )}
            </div>

            {sheetsSyncFeedback && (
              <StatusMessage tone={sheetsSyncFeedback.tone} text={sheetsSyncFeedback.text} />
            )}

            {sheetsSyncStatusError !== null && (
              <div className="account-load-error">
                <span className="field-error" role="alert">
                  {sheetsSyncStatusError}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setSheetsSyncReloadKey((value) => value + 1)}
                >
                  Coba lagi
                </Button>
              </div>
            )}

            <div className="sync-card__meta-grid">
              <div>
                <span className="sync-card__kv-label">Status integrasi</span>
                <span className="sync-card__kv-value">
                  {sheetsSyncLoading
                    ? "Memeriksa konfigurasi…"
                    : sheetsSyncStatusError !== null
                      ? "Status tidak dapat dimuat"
                      : configState?.restartRequired
                        ? "Konfigurasi tersimpan, restart diperlukan."
                      : sheetsSyncStatus?.enabled
                        ? "Konfigurasi webhook aktif (bukan bukti koneksi internet)"
                        : "Sinkronisasi spreadsheet belum dikonfigurasi."}
                </span>
              </div>
              <div>
                <span className="sync-card__kv-label">Transaksi tertunda</span>
                <span className="sync-card__kv-value">
                  {sheetsSyncStatus !== null ? `${sheetsSyncStatus.pendingCount} penjualan dalam antrean` : "—"}
                </span>
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <span className="muted" style={{ fontSize: "12px" }}>
                SQLite lokal tetap menjadi sumber kebenaran; kegagalan internet tidak menghambat kasir.
              </span>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={sheetsSyncLoading || syncingSheets}
                  onClick={() => setSheetsSyncReloadKey((value) => value + 1)}
                >
                  <IconRefresh size={16} />
                  <span>Perbarui status</span>
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!dataSource.getSheetsConfig || syncingSheets}
                  onClick={() => void openConfig()}
                >
                  Konfigurasi
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={
                    syncingSheets ||
                    sheetsSyncLoading ||
                    sheetsSyncStatusError !== null ||
                    !sheetsSyncStatus?.enabled
                  }
                  onClick={() => void handleSyncSheets()}
                >
                  <IconCloud size={18} />
                  <span>{syncingSheets ? "Menyinkronkan…" : "Sinkronkan Spreadsheet"}</span>
                </Button>
              </div>
            </div>
          </article>

          {/* Kartu 3: Ekspor Manual */}
          <article className="sync-card" aria-label="Ekspor Manual">
            <div className="admin-card__header" style={{ marginBottom: 0 }}>
              <div>
                <h2 className="admin-card__title">
                  <IconFileSpreadsheet size={20} />
                  <span>Ekspor Manual</span>
                </h2>
                <p className="admin-card__desc">
                  Unduh salinan laporan baru (.csv atau .xlsx) berdasarkan data tersimpan pada database lokal.
                </p>
              </div>
            </div>

            {manualFeedback && <StatusMessage tone={manualFeedback.tone} text={manualFeedback.text} />}

            <div className="form-grid">
              <div>
                <label htmlFor="manual-export-dataset" className="field-label">
                  Jenis laporan
                </label>
                <select
                  id="manual-export-dataset"
                  className="input"
                  value={manualDataset}
                  disabled={manualExporting}
                  onChange={(e) => {
                    setManualDataset(e.target.value as ManualDataset);
                    setManualFeedback(null);
                  }}
                >
                  <option value="daily">Penjualan per Periode</option>
                  <option value="payments">Pembayaran QRIS Terverifikasi</option>
                  <option value="stock">Persediaan &amp; Saldo Stok</option>
                </select>
              </div>

              {manualDataset === "daily" && (
                <>
                  <div>
                    <label htmlFor="manual-export-start" className="field-label">
                      Tanggal mulai
                    </label>
                    <input
                      id="manual-export-start"
                      type="date"
                      className="input"
                      value={manualStart}
                      disabled={manualExporting}
                      onChange={(e) => setManualStart(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="manual-export-end" className="field-label">
                      Tanggal akhir
                    </label>
                    <input
                      id="manual-export-end"
                      type="date"
                      className="input"
                      value={manualEnd}
                      disabled={manualExporting}
                      onChange={(e) => setManualEnd(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="manual-export-shift" className="field-label">
                      ID shift (opsional)
                    </label>
                    <input
                      id="manual-export-shift"
                      type="text"
                      inputMode="numeric"
                      className="input"
                      placeholder="Semua shift"
                      value={manualShiftId}
                      disabled={manualExporting}
                      onChange={(e) => setManualShiftId(e.target.value)}
                    />
                  </div>
                </>
              )}

              {manualDataset === "stock" && (
                <div>
                  <label htmlFor="manual-export-threshold" className="field-label">
                    Ambang stok menipis (opsional)
                  </label>
                  <input
                    id="manual-export-threshold"
                    type="text"
                    inputMode="numeric"
                    className="input"
                    value={manualThreshold}
                    disabled={manualExporting}
                    onChange={(e) => setManualThreshold(e.target.value)}
                  />
                </div>
              )}
            </div>

            {manualDataset === "payments" && (
              <p className="field-hint" style={{ margin: 0 }}>
                Mengekspor daftar transaksi QRIS terverifikasi sesuai cakupan endpoint laporan pembayaran saat ini.
              </p>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", flexWrap: "wrap" }}>
              <Button
                type="button"
                variant="secondary"
                disabled={manualExporting}
                onClick={() => void runManualExport("csv")}
              >
                <IconDownload size={16} />
                <span>{manualExporting ? "Menyiapkan…" : "Unduh CSV"}</span>
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={manualExporting}
                onClick={() => void runManualExport("xlsx")}
              >
                <IconFileSpreadsheet size={18} />
                <span>{manualExporting ? "Menyiapkan…" : "Unduh Excel (.xlsx)"}</span>
              </Button>
            </div>
          </article>
        </div>
      )}
      {configOpen && <div className="dialog-backdrop"><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="sheets-config-title">
        <h2 id="sheets-config-title">Konfigurasi Google Sheets</h2>
        <p>Pastikan tujuan spreadsheet sudah benar. Dalam sandbox, gunakan data sintetis hanya dengan persetujuan. Hanya penjualan baru sejak konfigurasi disimpan yang akan dikirim setelah restart; histori dan antrean lama tidak dipindahkan.</p>
        {configState?.legacy && <p role="alert">Konfigurasi lama ditemukan; perubahan memerlukan rekonsiliasi manual agar antrean existing aman.</p>}
        {configState?.configured && <p>{configState.restartRequired ? "Konfigurasi tersimpan, restart diperlukan." : "Konfigurasi aktif; koneksi belum tentu teruji."}</p>}
        <label className="field-label" htmlFor="sheets-url">URL web app Apps Script</label><input id="sheets-url" className="input" value={webhookUrl} onChange={event => { setWebhookUrl(event.target.value); setConfigMessage(""); }} disabled={configBusy} autoComplete="off" />
        <label className="field-label" htmlFor="sheets-secret">Secret</label><div className="input-with-icon"><input id="sheets-secret" className="input input--pr" type={showSecret ? "text" : "password"} value={webhookSecret} onChange={event => { setWebhookSecret(event.target.value); setConfigMessage(""); }} disabled={configBusy} autoComplete="new-password" /><button type="button" aria-label={showSecret ? "Sembunyikan secret" : "Tampilkan secret"} onClick={() => setShowSecret(!showSecret)}>{showSecret ? <IconEyeOff /> : <IconEye />}</button></div>
        <label><input type="checkbox" checked={futureSalesOnly} onChange={event => setFutureSalesOnly(event.target.checked)} /> Saya menyetujui pengiriman hanya transaksi baru.</label>
        {configMessage && <p role="status">{configMessage}</p>}
        <div className="dialog__actions"><Button disabled={configBusy} onClick={() => { setWebhookSecret(""); setConfigOpen(false); }}>Batal</Button><Button disabled={configBusy || webhookSecret.length === 0 || !webhookUrl.trim()} onClick={() => void configure("ping")}>Uji Koneksi</Button><Button variant="primary" disabled={configBusy || webhookSecret.length === 0 || !webhookUrl.trim() || (!configState?.configured && !futureSalesOnly)} onClick={() => void configure("save")}>Simpan Konfigurasi</Button></div>
      </div></div>}
    </section>
  );
}
