import { useState, type FormEvent } from "react";
import { ApiError } from "../api/errors";
import type { DailyReport, PosDataSource } from "../api/types";
import { buildExcelWorkbook } from "../domain/excel";
import { buildCsv, triggerFileDownload } from "../domain/iposFeatures";
import {
  IconBarChart,
  IconCheckCircle,
  IconDownload,
  IconFileSpreadsheet,
  IconRefresh,
  IconRotateCcw,
} from "./AdminIcons";
import { Button } from "./Button";
import { MoneyText } from "./MoneyText";

interface DailyReportPanelProps {
  dataSource: PosDataSource;
  onSessionExpired: () => void;
}

export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseCalendarDate(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(year!, month! - 1, day!);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month! - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function parseDay(raw: string): number | null {
  return parseCalendarDate(raw)?.getTime() ?? null;
}

/**
 * Awal hari berikutnya menurut kalender lokal. Memakai setDate, bukan +24 jam,
 * agar benar pada hari dengan transisi DST 23 jam maupun 25 jam.
 */
export function exclusiveEndMs(raw: string): number | null {
  const date = parseCalendarDate(raw);
  if (!date) return null;
  date.setDate(date.getDate() + 1);
  return date.getTime();
}

function formatTime(ms: number): string {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? "waktu tidak diketahui" : date.toLocaleString("id-ID");
}

/**
 * Laporan penjualan harian/per shift (TASK-026). UI hanya mengirim filter
 * [start,end) epoch ms dan menampilkan angka yang dikembalikan backend; tidak
 * menjumlahkan ulang total utama di browser.
 */
export function DailyReportPanel({ dataSource, onSessionExpired }: DailyReportPanelProps) {
  const today = toDateInputValue(new Date());
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [shiftId, setShiftId] = useState("");
  const [report, setReport] = useState<DailyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function load(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const startMs = parseDay(startDate);
    const endMs = exclusiveEndMs(endDate);
    if (startMs === null || endMs === null) {
      setError("Tanggal mulai dan akhir wajib diisi dengan benar.");
      return;
    }
    if (startMs >= endMs) {
      setError("Tanggal akhir harus tidak sebelum tanggal mulai.");
      return;
    }
    const parsedShift = shiftId.trim() === "" ? null : Number(shiftId.trim());
    if (parsedShift !== null && (!Number.isSafeInteger(parsedShift) || parsedShift <= 0)) {
      setError("ID shift harus bilangan bulat positif atau dikosongkan.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      setReport(
        await dataSource.getDailyReport({
          startMs,
          endMs,
          ...(parsedShift === null ? {} : { shiftId: parsedShift }),
        }),
      );
    } catch (failure) {
      if (failure instanceof ApiError && failure.isSessionExpired) {
        onSessionExpired();
      } else {
        setError(failure instanceof ApiError ? failure.message : "Laporan harian gagal dimuat.");
      }
    } finally {
      setIsLoading(false);
    }
  }

  function resetFilters(): void {
    setStartDate(today);
    setEndDate(today);
    setShiftId("");
    setError(null);
  }

  const shifts = new Map<number, { count: number; cash: number; qris: number }>();
  if (report && !report.salesTruncated) {
    for (const sale of report.sales) {
      const row = shifts.get(sale.shiftId) ?? { count: 0, cash: 0, qris: 0 };
      row.count += 1;
      if (sale.method === "CASH") row.cash += sale.amountRp;
      else row.qris += sale.amountRp;
      shifts.set(sale.shiftId, row);
    }
  }

  return (
    <section className="admin-card" aria-label="Laporan penjualan harian dan shift">
      <div className="admin-card__header">
        <div>
          <h2 className="admin-card__title">Penjualan per Tanggal / Shift</h2>
          <p className="admin-card__desc">
            Filter dikirim sebagai rentang waktu lokal [mulai, akhir). Hanya penjualan berstatus COMMITTED yang dihitung.
          </p>
        </div>
      </div>

      <form className="admin-toolbar" style={{ background: "var(--color-bg)", marginBottom: "16px" }} onSubmit={(event) => void load(event)}>
        <div className="admin-toolbar__controls">
          <div className="admin-toolbar__field">
            <label className="field-label" htmlFor="daily-start">
              Tanggal mulai
            </label>
            <input
              id="daily-start"
              className="input"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>

          <div className="admin-toolbar__field">
            <label className="field-label" htmlFor="daily-end">
              Tanggal akhir
            </label>
            <input
              id="daily-end"
              className="input"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </div>

          <div className="admin-toolbar__field">
            <label className="field-label" htmlFor="daily-shift">
              ID shift (opsional)
            </label>
            <input
              id="daily-shift"
              className="input"
              type="text"
              inputMode="numeric"
              value={shiftId}
              onChange={(event) => setShiftId(event.target.value)}
              placeholder="Semua shift"
            />
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Button type="submit" variant="primary" disabled={isLoading}>
              <IconRefresh size={16} />
              <span>{isLoading ? "Memuat…" : "Muat laporan"}</span>
            </Button>
            <Button type="button" variant="secondary" disabled={isLoading} onClick={resetFilters}>
              <IconRotateCcw size={16} />
              <span>Reset</span>
            </Button>
          </div>
        </div>
      </form>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {!error && !report && !isLoading && (
        <div className="admin-empty">
          <span className="admin-empty__icon">
            <IconBarChart size={24} />
          </span>
          <p className="admin-empty__title">Pilih rentang tanggal lalu klik Muat laporan</p>
          <p className="admin-empty__desc">
            Data penjualan akan dimuat langsung dari database lokal sesuai periode dan shift yang dipilih.
          </p>
        </div>
      )}

      {!error && report && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <p className="muted" style={{ margin: 0, fontSize: "13px" }}>
              Periode dimuat: <strong>{formatTime(report.startMs)}</strong> s.d.{" "}
              <strong>{formatTime(report.endMs)}</strong> ·{" "}
              {report.shiftId === null ? "semua shift" : `shift #${report.shiftId}`} · dibuat{" "}
              {formatTime(report.generatedAtMs)}.
            </p>

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <Button
                variant="secondary"
                onClick={() => {
                  const headers = ["No. Penjualan", "Waktu", "Shift", "Kasir", "Metode", "Total (Rp)"];
                  const rows = report.sales.map((s) => [
                    s.saleNo,
                    formatTime(s.committedAtMs),
                    `#${s.shiftId}`,
                    s.cashierUsername ?? "Kasir tidak diketahui",
                    s.method === "CASH" ? "Tunai" : "QRIS manual",
                    s.amountRp,
                  ]);
                  triggerFileDownload(
                    "laporan-penjualan-harian.csv",
                    buildCsv(headers, rows),
                    "text/csv;charset=utf-8",
                  );
                }}
              >
                <IconDownload size={16} />
                <span>Ekspor CSV</span>
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const headers = ["No. Penjualan", "Waktu", "Shift", "Kasir", "Metode", "Total (Rp)"];
                  const rows = report.sales.map((s) => [
                    s.saleNo,
                    formatTime(s.committedAtMs),
                    `#${s.shiftId}`,
                    s.cashierUsername ?? "Kasir tidak diketahui",
                    s.method === "CASH" ? "Tunai" : "QRIS manual",
                    s.amountRp,
                  ]);
                  triggerFileDownload(
                    "laporan-penjualan-harian.xlsx",
                    buildExcelWorkbook("Laporan Penjualan Harian", headers, rows),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                  );
                }}
              >
                <IconFileSpreadsheet size={16} />
                <span>Ekspor Excel</span>
              </Button>
            </div>
          </div>

          <div className="admin-kpi-grid">
            <div className="admin-kpi-card admin-kpi-card--primary">
              <div className="admin-kpi-card__top">
                <h3 className="admin-kpi-card__label">Total penjualan</h3>
                <span className="admin-kpi-card__icon">
                  <IconBarChart size={18} />
                </span>
              </div>
              <div className="admin-kpi-card__value">
                <MoneyText amountRp={report.totalRp} />
              </div>
              <p className="admin-kpi-card__meta">{report.saleCount} transaksi tersimpan</p>
            </div>

            <div className="admin-kpi-card">
              <div className="admin-kpi-card__top">
                <h3 className="admin-kpi-card__label">Transaksi</h3>
                <span className="admin-kpi-card__icon">
                  <IconCheckCircle size={18} />
                </span>
              </div>
              <div className="admin-kpi-card__value">{report.saleCount}</div>
              <p className="admin-kpi-card__meta">Penjualan terkonfirmasi (bukan laba bersih)</p>
            </div>

            <div className="admin-kpi-card">
              <div className="admin-kpi-card__top">
                <h3 className="admin-kpi-card__label">Tunai</h3>
              </div>
              <div className="admin-kpi-card__value">
                <MoneyText amountRp={report.cash.totalRp} />
              </div>
              <p className="admin-kpi-card__meta">{report.cash.count} transaksi tunai</p>
            </div>

            <div className="admin-kpi-card">
              <div className="admin-kpi-card__top">
                <h3 className="admin-kpi-card__label">QRIS manual</h3>
              </div>
              <div className="admin-kpi-card__value">
                <MoneyText amountRp={report.qrisManual.totalRp} />
              </div>
              <p className="admin-kpi-card__meta">
                {report.qrisManual.count} transaksi · {report.qrisManual.verifiedCount} terverifikasi · tidak masuk kas fisik
              </p>
            </div>
          </div>

          {!report.salesTruncated && shifts.size > 0 && (
            <div>
              <h3 className="section-title">Ringkasan per Shift</h3>
              <div className="table-wrap">
                <table className="table" aria-label="Ringkasan shift pada laporan penjualan">
                  <thead>
                    <tr>
                      <th scope="col">Shift</th>
                      <th scope="col" className="num">
                        Transaksi
                      </th>
                      <th scope="col" className="num">
                        Tunai
                      </th>
                      <th scope="col" className="num">
                        QRIS
                      </th>
                      <th scope="col" className="num">
                        Omzet Shift
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...shifts]
                      .sort(([a], [b]) => a - b)
                      .map(([id, row]) => (
                        <tr key={id}>
                          <td className="cell-primary">#{id}</td>
                          <td className="num">{row.count}</td>
                          <td className="num">
                            <MoneyText amountRp={row.cash} />
                          </td>
                          <td className="num">
                            <MoneyText amountRp={row.qris} />
                          </td>
                          <td className="num">
                            <MoneyText amountRp={row.cash + row.qris} />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div>
            <h3 className="section-title">Rincian Penjualan</h3>
            {report.salesTruncated && (
              <p className="muted" role="note">
                Menampilkan sebagian transaksi (dibatasi 100 baris terbaru oleh backend). Total di atas tetap mencakup seluruh data tersimpan.
              </p>
            )}
            {report.sales.length === 0 ? (
              <p className="muted">Tidak ada penjualan tersimpan pada rentang ini.</p>
            ) : (
              <div className="table-wrap">
                <table className="table" aria-label="Rincian penjualan harian">
                  <thead>
                    <tr>
                      <th scope="col">No. penjualan</th>
                      <th scope="col">Waktu</th>
                      <th scope="col">Shift</th>
                      <th scope="col">Kasir</th>
                      <th scope="col">Metode</th>
                      <th scope="col" className="num">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.sales.map((sale) => (
                      <tr key={sale.saleId}>
                        <td>
                          <code>{sale.saleNo}</code>
                        </td>
                        <td>{formatTime(sale.committedAtMs)}</td>
                        <td>#{sale.shiftId}</td>
                        <td>{sale.cashierUsername ?? "Kasir tidak diketahui"}</td>
                        <td>
                          <span className={sale.method === "CASH" ? "badge badge--ok" : "badge badge--info"}>
                            {sale.method === "CASH" ? "Tunai" : "QRIS manual"}
                          </span>
                        </td>
                        <td className="num">
                          <MoneyText amountRp={sale.amountRp} />
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
    </section>
  );
}
