import { useEffect, useState, type FormEvent } from "react";
import { ApiError } from "../api/errors";
import type { DailyReport, PosDataSource, SessionUser, StockReport } from "../api/types";
import { Button } from "../components/Button";
import { exclusiveEndMs, parseDay, toDateInputValue } from "../components/DailyReportPanel";
import { MoneyText } from "../components/MoneyText";
import { buildCsv, triggerFileDownload } from "../domain/iposFeatures";

import { buildExcelWorkbook } from "../domain/excel";

interface Props {
  dataSource: PosDataSource;
  currentUser: SessionUser;
  onSessionExpired: () => void;
}
type DashboardPeriod = "day" | "week" | "month" | "year";
type Snapshot = { daily: DailyReport; stock: StockReport };

function getPeriodRangeMs(dateStr: string, period: DashboardPeriod): { startMs: number; endMs: number } | null {
  const dayStart = parseDay(dateStr);
  const dayEnd = exclusiveEndMs(dateStr);
  if (dayStart === null || dayEnd === null) return null;
  if (period === "day") return { startMs: dayStart, endMs: dayEnd };
  const [year, month, day] = dateStr.split("-").map(Number);
  if (period === "week") {
    const selected = new Date(year!, month! - 1, day!);
    const daysSinceMonday = (selected.getDay() + 6) % 7;
    return {
      startMs: new Date(year!, month! - 1, day! - daysSinceMonday).getTime(),
      endMs: new Date(year!, month! - 1, day! - daysSinceMonday + 7).getTime(),
    };
  }
  if (period === "month") {
    return {
      startMs: new Date(year!, month! - 1, 1).getTime(),
      endMs: new Date(year!, month!, 1).getTime(),
    };
  }
  return {
    startMs: new Date(year!, 0, 1).getTime(),
    endMs: new Date(year! + 1, 0, 1).getTime(),
  };
}

/** Dashboard read-only; nominal dan status stok hanya dari laporan backend. */
export function DashboardPage({ dataSource, currentUser, onSessionExpired }: Props) {
  const [date, setDate] = useState(() => toDateInputValue(new Date()));
  const [period, setPeriod] = useState<DashboardPeriod>("day");
  const [threshold, setThreshold] = useState("5");
  const [request, setRequest] = useState<{ date: string; period: DashboardPeriod; threshold: number; revision: number }>(() => ({ date, period: "day", threshold: 5, revision: 0 }));
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const isAdmin = currentUser.role === "ADMIN";
  const isDemo = dataSource.authMode === "DEMO" || dataSource.catalogMode === "DEMO";

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    setLoading(true);
    setSnapshot(null);
    setError(null);
    // Setiap laporan harus memproses 401, meskipun laporan lain sudah gagal.
    function handleReportFailure(failure: unknown): never {
      if (active && failure instanceof ApiError && failure.isSessionExpired) onSessionExpired();
      throw failure;
    }
    const range = getPeriodRangeMs(request.date, request.period)!;
    Promise.all([
      dataSource.getDailyReport(range).catch(handleReportFailure),
      dataSource.getStockReport({ lowStockThreshold: request.threshold }).catch(handleReportFailure),
    ]).then(([daily, stock]) => {
      if (active) setSnapshot({ daily, stock });
    }).catch((failure: unknown) => {
      if (!active) return;
      if (failure instanceof ApiError && failure.isSessionExpired) return;
      setError(failure instanceof ApiError ? failure.message : "Dashboard gagal dimuat. Coba lagi.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [dataSource, isAdmin, currentUser.userId, onSessionExpired, request]);

  if (!isAdmin) return <p role="alert">Dashboard hanya dapat diakses ADMIN.</p>;

  function refresh(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    if (getPeriodRangeMs(date, period) === null ||
        !/^\d+$/.test(threshold) || !Number.isSafeInteger(Number(threshold))) {
      setValidation("Isi tanggal valid dan ambang stok berupa bilangan bulat non-negatif.");
      return;
    }
    if (date > toDateInputValue(new Date())) {
      setValidation("Tanggal tidak boleh lebih dari hari ini.");
      return;
    }
    setValidation(null);
    setRequest({ date, period, threshold: Number(threshold), revision: request.revision + 1 });
  }
  const today = toDateInputValue(new Date());
  const daily = snapshot?.daily;
  const stock = snapshot?.stock;
  const low = stock?.products.filter((p) => p.low && !p.zero) ?? [];
  const zero = stock?.products.filter((p) => p.zero) ?? [];
  // Jangan pernah menjumlahkan rincian yang dipotong sebagai total semua shift.
  const shifts = new Map<number, { count: number; cash: number; qris: number }>();
  if (daily && !daily.salesTruncated) {
    for (const sale of daily.sales) {
      const row = shifts.get(sale.shiftId) ?? { count: 0, cash: 0, qris: 0 };
      row.count += 1;
      if (sale.method === "CASH") row.cash += sale.amountRp;
      else row.qris += sale.amountRp;
      shifts.set(sale.shiftId, row);
    }
  }

  return <section className="panel dashboard" aria-labelledby="dashboard-title" aria-busy={loading}>
    <h1 id="dashboard-title" className="page-title">Dashboard</h1>
    <p className="muted">Ringkasan ADMIN · {isDemo ? "DEMO — data sintetis, bukan transaksi nyata." : "Sumber: laporan backend lokal."}</p>
    <form className="report-filter dashboard__filters" noValidate onSubmit={refresh}>
      <div><label className="field-label" htmlFor="dashboard-period">Periode</label>
        <select
          id="dashboard-period"
          className="input"
          value={period}
          disabled={loading}
          onChange={(e) => {
            const nextPeriod = e.target.value as DashboardPeriod;
            setPeriod(nextPeriod);
            if (getPeriodRangeMs(date, nextPeriod) === null || !/^\d+$/.test(threshold) || !Number.isSafeInteger(Number(threshold))) {
              return;
            }
            if (date > toDateInputValue(new Date())) {
              setValidation("Tanggal tidak boleh lebih dari hari ini.");
              return;
            }
            setValidation(null);
            setRequest({ date, period: nextPeriod, threshold: Number(threshold), revision: request.revision + 1 });
          }}
        >
          <option value="day">Hari</option>
          <option value="week">Minggu</option>
          <option value="month">Bulan</option>
          <option value="year">Tahun</option>
        </select>
      </div>
      <div><label className="field-label" htmlFor="dashboard-date">Tanggal penjualan</label>
        <input id="dashboard-date" className="input" type="date" max={today} value={date} disabled={loading} onChange={(e) => setDate(e.target.value)} /></div>
      <div><label className="field-label" htmlFor="dashboard-threshold">Ambang stok menipis (DEMO)</label>
        <input id="dashboard-threshold" className="input" inputMode="numeric" value={threshold} disabled={loading} onChange={(e) => setThreshold(e.target.value)} /></div>
      <Button type="submit" variant="primary" disabled={loading}>{loading ? "Memuat dashboard…" : "Perbarui dashboard"}</Button>
    </form>
    <p className="muted">Tanggal memakai zona PC: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Batas hari dan ambang awal 5 unit adalah asumsi DEMO, belum SOP pengelola. Stok adalah saldo saat laporan dimuat, bukan stok historis tanggal penjualan.</p>
    {validation && <p role="alert" className="field-error">{validation}</p>}
    {error && <p role="alert" className="field-error">{error}</p>}
    {loading && <p role="status">Mengambil laporan penjualan dan stok…</p>}
    {!loading && daily && stock && <>
      <p className="muted">Rentang penjualan: {new Date(daily.startMs).toLocaleString("id-ID")} sampai {new Date(daily.endMs).toLocaleString("id-ID")} (akhir tidak termasuk).
        Penjualan diperbarui {new Date(daily.generatedAtMs).toLocaleString("id-ID")}; stok diperbarui {new Date(stock.generatedAtMs).toLocaleString("id-ID")}. Kedua laporan dimuat terpisah.</p>
      <div className="report-cards dashboard__cards">
        <article className="report-card dashboard__primary" aria-label="Omzet"><h2 className="section-title">{(() => {
          if (request.period === "week") {
            const reqWeek = getPeriodRangeMs(request.date, "week");
            const curWeek = getPeriodRangeMs(today, "week");
            return reqWeek && curWeek && reqWeek.startMs === curWeek.startMs ? "Omzet minggu ini" : "Omzet minggu terpilih";
          }
          if (request.period === "month") return request.date.slice(0, 7) === today.slice(0, 7) ? "Omzet bulan ini" : "Omzet bulan terpilih";
          if (request.period === "year") return request.date.slice(0, 4) === today.slice(0, 4) ? "Omzet tahun ini" : "Omzet tahun terpilih";
          return request.date === today ? "Omzet hari ini" : "Omzet tanggal terpilih";
        })()}</h2><MoneyText amountRp={daily.totalRp} className="money--total" /><p>Penjualan tersimpan, bukan laba.</p></article>
        <article className="report-card" aria-label="Jumlah transaksi"><h2 className="section-title">Transaksi</h2><strong className="money--total">{daily.saleCount}</strong><p>Draft dan transaksi gagal tidak dihitung.</p></article>
        <article className="report-card" aria-label="Penjualan CASH"><h2 className="section-title">CASH</h2><MoneyText amountRp={daily.cash.totalRp} className="money--total" /><p>{daily.cash.count} transaksi · penjualan tunai, bukan saldo laci.</p></article>
        <article className="report-card dashboard__accent" aria-label="Penjualan QRIS"><h2 className="section-title">QRIS_MANUAL</h2><MoneyText amountRp={daily.qrisManual.totalRp} className="money--total" /><p>{daily.qrisManual.count} transaksi · {daily.qrisManual.verifiedCount} terverifikasi kasir. QRIS tidak menambah uang kas laci.</p></article>
        <article className="report-card dashboard__accent" aria-label="Jumlah stok menipis"><h2 className="section-title">Stok menipis</h2><strong className="money--total">{low.length}</strong><p>Produk dengan saldo positif sampai {stock.lowStockThreshold} unit.</p></article>
        <article className="report-card" aria-label="Jumlah stok habis"><h2 className="section-title">Stok habis</h2><strong className="money--total">{zero.length}</strong><p>Produk dengan saldo nol.</p></article>
      </div>
      <div className="dialog__actions">
        <Button
          variant="secondary"
          disabled={daily.saleCount === 0}
          onClick={() => {
            const headers = ["Bagian", "Keterangan", "Transaksi", "CASH (Rp)", "QRIS_MANUAL (Rp)", "Total (Rp)"];
            const rows: Array<Array<string | number>> = [
              ["Ringkasan", `Periode ${request.period} (${request.date})`, daily.saleCount, daily.cash.totalRp, daily.qrisManual.totalRp, daily.totalRp],
              ["CASH", `${daily.cash.count} transaksi`, daily.cash.count, daily.cash.totalRp, 0, daily.cash.totalRp],
              ["QRIS_MANUAL", `${daily.qrisManual.count} transaksi (${daily.qrisManual.verifiedCount} terverifikasi)`, daily.qrisManual.count, 0, daily.qrisManual.totalRp, daily.qrisManual.totalRp],
            ];
            if (daily.salesTruncated) {
              rows.push(["Catatan", "Rincian dibatasi backend, rekap per shift tidak lengkap.", "", "", "", ""]);
            } else {
              for (const [id, row] of [...shifts].sort(([a], [b]) => a - b)) {
                rows.push(["Shift", `#${id}`, row.count, row.cash, row.qris, row.cash + row.qris]);
              }
            }
            rows.push([], ["Rincian barang"], ["No. penjualan", "Waktu", "Barang", "SKU", "Jumlah", "Harga", "Total"]);
            for (const sale of daily.sales) {
              if (sale.items === undefined) rows.push([sale.saleNo, "Rincian barang tidak tersedia dari backend ini."]);
              for (const item of sale.items ?? []) rows.push([sale.saleNo, new Date(sale.committedAtMs).toLocaleString("id-ID"), item.name, item.sku, item.quantity, item.unitPriceRp, item.lineTotalRp]);
            }
            triggerFileDownload(`laporan-penjualan-${request.date}.csv`, buildCsv(headers, rows), "text/csv;charset=utf-8");
          }}
        >
          Ekspor CSV
        </Button>
        <Button
          variant="secondary"
          disabled={daily.saleCount === 0}
          onClick={() => {
            const headers = ["Bagian", "Keterangan", "Transaksi", "CASH (Rp)", "QRIS_MANUAL (Rp)", "Total (Rp)"];
            const rows: Array<Array<string | number>> = [
              ["Ringkasan", `Periode ${request.period} (${request.date})`, daily.saleCount, daily.cash.totalRp, daily.qrisManual.totalRp, daily.totalRp],
              ["CASH", `${daily.cash.count} transaksi`, daily.cash.count, daily.cash.totalRp, 0, daily.cash.totalRp],
              ["QRIS_MANUAL", `${daily.qrisManual.count} transaksi (${daily.qrisManual.verifiedCount} terverifikasi)`, daily.qrisManual.count, 0, daily.qrisManual.totalRp, daily.qrisManual.totalRp],
            ];
            if (daily.salesTruncated) {
              rows.push(["Catatan", "Rincian dibatasi backend, rekap per shift tidak lengkap.", "", "", "", ""]);
            } else {
              for (const [id, row] of [...shifts].sort(([a], [b]) => a - b)) {
                rows.push(["Shift", `#${id}`, row.count, row.cash, row.qris, row.cash + row.qris]);
              }
            }
            rows.push([], ["Rincian barang"], ["No. penjualan", "Waktu", "Barang", "SKU", "Jumlah", "Harga", "Total"]);
            for (const sale of daily.sales) {
              if (sale.items === undefined) rows.push([sale.saleNo, "Rincian barang tidak tersedia dari backend ini."]);
              for (const item of sale.items ?? []) rows.push([sale.saleNo, new Date(sale.committedAtMs).toLocaleString("id-ID"), item.name, item.sku, item.quantity, item.unitPriceRp, item.lineTotalRp]);
            }
            triggerFileDownload(
              `laporan-penjualan-${request.date}.xlsx`,
              buildExcelWorkbook(`Laporan Penjualan ${request.date}`, headers, rows),
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            );
          }}
        >
          Ekspor Excel
        </Button>
      </div>
      {daily.saleCount === 0 && <p>Belum ada transaksi tersimpan pada periode ini.</p>}
      <h2 className="section-title">Ringkasan penjualan per shift</h2>
      <p className="muted">Hanya shift dengan penjualan pada rentang terpilih; bukan status aktif/tutup atau rekap kas penutupan.</p>
      {daily.salesTruncated ? <p role="note">Rincian backend dibatasi. Ringkasan shift tidak ditampilkan agar tidak memberi total parsial; kartu omzet tetap memakai total lengkap backend. Gunakan Laporan dengan filter ID shift untuk rekap shift tertentu.</p> : shifts.size > 0 && <div className="table-wrap"><table className="table" aria-label="Penjualan per shift">
        <thead><tr><th scope="col">Shift</th><th scope="col">Transaksi</th><th scope="col">CASH</th><th scope="col">QRIS_MANUAL</th><th scope="col">Omzet</th></tr></thead>
        <tbody>{[...shifts].sort(([a], [b]) => a - b).map(([id, row]) => <tr key={id}><td>#{id}</td><td>{row.count}</td><td><MoneyText amountRp={row.cash} /></td><td><MoneyText amountRp={row.qris} /></td><td><MoneyText amountRp={row.cash + row.qris} /></td></tr>)}</tbody>
      </table></div>}
      <h2 className="section-title">Produk perlu perhatian</h2>
      {stock.products.some((p) => !p.matched) && <p className="field-error" role="alert">Ada saldo yang belum cocok dengan ledger. Periksa laporan stok sebelum tindakan operasional.</p>}
      {stock.products.length === 0 ? <p>Belum ada produk pada laporan stok.</p> : low.length + zero.length === 0 ? <p>Tidak ada produk habis atau menipis pada ambang ini.</p> : <div className="table-wrap"><table className="table" aria-label="Stok habis dan menipis">
        <thead><tr><th scope="col">Produk</th><th scope="col">Saldo</th><th scope="col">Status</th></tr></thead>
        <tbody>{[...zero, ...low].map((p) => <tr key={p.productId}><td>{p.sku} — {p.name}</td><td>{p.onHand}</td><td><span className={`badge ${p.zero ? "badge--danger" : "badge--warning"}`}>{p.zero ? "Stok habis" : "Menipis"}</span></td></tr>)}</tbody>
      </table></div>}
    </>}
  </section>;
}
