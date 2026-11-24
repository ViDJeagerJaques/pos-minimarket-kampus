import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/errors";
import type { PaymentReport, PosDataSource, SessionUser } from "../api/types";
import { buildExcelWorkbook } from "../domain/excel";
import { buildCsv, triggerFileDownload } from "../domain/iposFeatures";
import { Button } from "../components/Button";
import { DailyReportPanel } from "../components/DailyReportPanel";
import { MoneyText } from "../components/MoneyText";
import { StockReportPanel } from "../components/StockReportPanel";
import { StatusMessage } from "../components/StatusMessage";

interface ReportsPageProps {
  dataSource: PosDataSource;
  currentUser: SessionUser;
  onSessionExpired: () => void;
}

function formatTime(ms: number): string {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? "waktu tidak diketahui" : date.toLocaleString("id-ID");
}

/**
 * Laporan pembayaran TASK-037. QRIS manual sengaja dipisah dari kas tunai:
 * QRIS tidak masuk laci dan tidak boleh dianggap uang fisik. Hanya transaksi
 * yang benar-benar COMMITTED yang muncul; upaya pending/gagal tidak dihitung.
 */
export function ReportsPage({ dataSource, currentUser, onSessionExpired }: ReportsPageProps) {
  const [report, setReport] = useState<PaymentReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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

  const isDemo = dataSource.authMode === "DEMO" || dataSource.catalogMode === "DEMO";

  return (
    <section className="panel" aria-labelledby="reports-title" aria-busy={isLoading}>
      <h1 id="reports-title" className="page-title">
        Laporan Pembayaran <span className="chip chip--warning">ADMIN · QRIS terpisah</span>
      </h1>
      <p className="muted">
        Masuk sebagai <strong>{currentUser.username}</strong>.
        {isDemo
          ? "Mode DEMO menampilkan angka sintetis untuk pratinjau UI, bukan bukti transaksi."
          : "Angka berasal dari transaksi yang benar-benar tersimpan di backend lokal. Upaya pending/gagal tidak dihitung sebagai penjualan."}
      </p>
      {isDemo && (
        <StatusMessage
          tone="warning"
          text="Mode DEMO: angka laporan sintetis untuk pratinjau UI, bukan bukti transaksi nyata."
        />
      )}

      <div className="report-toolbar">
        <Button variant="secondary" onClick={() => setReloadKey((value) => value + 1)} disabled={isLoading}>
          {isLoading ? "Memuat…" : "Muat ulang"}
        </Button>
      </div>

      {loadError && (
        <div className="account-load-error">
          <p className="field-error" role="alert">{loadError}</p>
          <Button variant="secondary" disabled={isLoading} onClick={() => setReloadKey((value) => value + 1)}>
            Coba lagi
          </Button>
        </div>
      )}

      {!loadError && report && (
        <>
          <div className="report-cards">
            <div className="report-card">
              <h2 className="section-title">Kas tunai</h2>
              <p className="money money--total"><MoneyText amountRp={report.cash.totalRp} /></p>
              <p className="muted">{report.cash.count} transaksi · penjualan CASH tercatat</p>
            </div>
            <div className="report-card">
              <h2 className="section-title">QRIS manual</h2>
              <p className="money money--total"><MoneyText amountRp={report.qrisManual.totalRp} /></p>
              <p className="muted">
                {report.qrisManual.count} transaksi · {report.qrisManual.verifiedCount} terverifikasi ·{" "}
                {report.qrisSales.length} ditampilkan
              </p>
              <p className="muted">Tidak ditambahkan ke kas fisik.</p>
            </div>
          </div>

          <h2 className="section-title">Rincian QRIS terverifikasi</h2>
          {report.qrisSales.length < report.qrisManual.verifiedCount && (
            <p className="muted" role="note">
              Daftar hanya sebagian: menampilkan {report.qrisSales.length} dari{" "}
              {report.qrisManual.verifiedCount} transaksi QRIS terverifikasi. Total di atas tetap
              mencakup seluruh transaksi tersimpan.
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
                    <th scope="col" className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {report.qrisSales.map((sale) => (
                    <tr key={sale.saleId}>
                      <td><code>{sale.saleNo}</code></td>
                      <td>{formatTime(sale.verifiedAtMs)}</td>
                      <td>{sale.cashierUsername ?? `#${sale.verifiedBy}`}</td>
                      <td>{sale.evidenceRef ?? <span className="muted">—</span>}</td>
                      <td><span className="badge badge--ok">Terverifikasi</span></td>
                      <td className="num"><MoneyText amountRp={sale.totalRp} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted">
            Total seluruh pembayaran: <MoneyText amountRp={report.totalRp} />. Kas dan QRIS
            direkonsiliasi terpisah sesuai SOP yang belum disahkan.
          </p>
          <div className="dialog__actions">
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
              Ekspor CSV
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
              Ekspor Excel
            </Button>
          </div>
        </>
      )}

      <DailyReportPanel dataSource={dataSource} onSessionExpired={onSessionExpired} />
      <StockReportPanel dataSource={dataSource} onSessionExpired={onSessionExpired} />
    </section>
  );
}
