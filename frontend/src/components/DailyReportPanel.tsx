import { useState, type FormEvent } from "react";
import { ApiError } from "../api/errors";
import type { DailyReport, PosDataSource } from "../api/types";
import { Button } from "./Button";
import { MoneyText } from "./MoneyText";

interface DailyReportPanelProps {
  dataSource: PosDataSource;
  onSessionExpired: () => void;
}

function toDateInputValue(date: Date): string {
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

function parseDay(raw: string): number | null {
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
 * menjumlahkan ulang data di browser.
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
    // `end` eksklusif mengikuti kalender lokal (aman untuk hari DST 23/25 jam).
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

  return (
    <section className="report-panel" aria-label="Laporan penjualan harian dan shift">
      <h2 className="section-title">Penjualan per tanggal / shift</h2>
      <p className="muted">
        Filter dikirim sebagai epoch ms rentang [start, end). Zona operasional dan batas hari
        belum disahkan pengelola; tanggal di bawah memakai waktu lokal PC ini.
      </p>
      <form className="form-grid report-filter" onSubmit={(event) => void load(event)}>
        <div>
          <label className="field-label" htmlFor="daily-start">Tanggal mulai</label>
          <input id="daily-start" className="input" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="daily-end">Tanggal akhir</label>
          <input id="daily-end" className="input" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="daily-shift">ID shift (opsional)</label>
          <input id="daily-shift" className="input" type="text" inputMode="numeric" value={shiftId} onChange={(event) => setShiftId(event.target.value)} placeholder="Semua shift" />
        </div>
        <div className="receiving-actions">
          <Button type="submit" variant="primary" disabled={isLoading}>
            {isLoading ? "Memuat…" : "Muat laporan"}
          </Button>
        </div>
      </form>
      {error && <p className="field-error" role="alert">{error}</p>}
      {!error && report && (
        <>
          <p className="muted">
            Sumber data: backend lokal · rentang{" "}
            <code>{new Date(report.startMs).toISOString()}</code> s.d.{" "}
            <code>{new Date(report.endMs).toISOString()}</code> ·{" "}
            {report.shiftId === null ? "semua shift" : `shift #${report.shiftId}`} · dibuat{" "}
            {formatTime(report.generatedAtMs)}.
          </p>
          <div className="report-cards">
            <div className="report-card">
              <h3 className="section-title">Total penjualan</h3>
              <p className="money money--total"><MoneyText amountRp={report.totalRp} /></p>
              <p className="muted">{report.saleCount} transaksi tersimpan</p>
            </div>
            <div className="report-card">
              <h3 className="section-title">Tunai</h3>
              <p className="money money--total"><MoneyText amountRp={report.cash.totalRp} /></p>
              <p className="muted">{report.cash.count} transaksi</p>
            </div>
            <div className="report-card">
              <h3 className="section-title">QRIS manual</h3>
              <p className="money money--total"><MoneyText amountRp={report.qrisManual.totalRp} /></p>
              <p className="muted">{report.qrisManual.count} transaksi · {report.qrisManual.verifiedCount} terverifikasi · tidak masuk kas fisik</p>
            </div>
          </div>
          <h3 className="section-title">Rincian penjualan</h3>
          {report.salesTruncated && (
            <p className="muted" role="note">
              Menampilkan sebagian transaksi. Total di atas tetap mencakup seluruh data tersimpan.
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
                    <th scope="col" className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {report.sales.map((sale) => (
                    <tr key={sale.saleId}>
                      <td><code>{sale.saleNo}</code></td>
                      <td>{formatTime(sale.committedAtMs)}</td>
                      <td>#{sale.shiftId}</td>
                      <td>{sale.cashierUsername ?? "Kasir tidak diketahui"}</td>
                      <td>{sale.method === "CASH" ? "Tunai" : "QRIS manual"}</td>
                      <td className="num"><MoneyText amountRp={sale.amountRp} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
