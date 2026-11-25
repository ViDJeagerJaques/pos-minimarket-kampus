import { useEffect, useState, type FormEvent } from "react";
import { ApiError } from "../api/errors";
import type { DailyReport, PosDataSource, SessionUser, StockReport } from "../api/types";
import type { PageId } from "../app/navigation";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBarChart,
  IconCheckCircle,
  IconDownload,
  IconFileSpreadsheet,
  IconPackage,
  IconRefresh,
  IconXCircle,
} from "../components/AdminIcons";
import { Button } from "../components/Button";
import { exclusiveEndMs, parseDay, toDateInputValue } from "../components/DailyReportPanel";
import { MoneyText } from "../components/MoneyText";
import { buildExcelWorkbook } from "../domain/excel";
import { buildCsv, triggerFileDownload } from "../domain/iposFeatures";

interface Props {
  dataSource: PosDataSource;
  currentUser: SessionUser;
  onSessionExpired: () => void;
  onNavigate?: (page: PageId) => void;
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

function buildExportRows(
  daily: DailyReport,
  period: DashboardPeriod,
  date: string,
  shifts: Map<number, { count: number; cash: number; qris: number }>,
): { headers: string[]; rows: Array<Array<string | number>> } {
  const headers = ["Bagian", "Keterangan", "Transaksi", "CASH (Rp)", "QRIS_MANUAL (Rp)", "Total (Rp)"];
  const rows: Array<Array<string | number>> = [
    ["Ringkasan", `Periode ${period} (${date})`, daily.saleCount, daily.cash.totalRp, daily.qrisManual.totalRp, daily.totalRp],
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
    for (const item of sale.items ?? []) {
      rows.push([
        sale.saleNo,
        new Date(sale.committedAtMs).toLocaleString("id-ID"),
        item.name,
        item.sku,
        item.quantity,
        item.unitPriceRp,
        item.lineTotalRp,
      ]);
    }
  }
  return { headers, rows };
}

/** Dashboard read-only; nominal dan status stok hanya dari laporan backend. */
export function DashboardPage({ dataSource, currentUser, onSessionExpired, onNavigate }: Props) {
  const [today, setToday] = useState(() => toDateInputValue(new Date()));
  const [date, setDate] = useState(() => toDateInputValue(new Date()));
  const [period, setPeriod] = useState<DashboardPeriod>("day");
  const [threshold, setThreshold] = useState("5");
  const [request, setRequest] = useState<{ date: string; period: DashboardPeriod; threshold: number; revision: number }>(() => ({
    date,
    period: "day",
    threshold: 5,
    revision: 0,
  }));
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const isAdmin = currentUser.role === "ADMIN";
  const isDemo = dataSource.authMode === "DEMO" || dataSource.catalogMode === "DEMO";

  useEffect(() => {
    let timerId: number | null = null;
    function syncToday() {
      setToday(toDateInputValue(new Date()));
    }
    function scheduleNextMidnight() {
      if (timerId !== null) window.clearTimeout(timerId);
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const delayMs = Math.max(1, nextMidnight.getTime() - now.getTime());
      timerId = window.setTimeout(() => {
        syncToday();
        scheduleNextMidnight();
      }, delayMs);
    }
    function handleFocus() {
      syncToday();
      scheduleNextMidnight();
    }
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        handleFocus();
      }
    }
    scheduleNextMidnight();
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      if (timerId !== null) window.clearTimeout(timerId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    setLoading(true);
    setSnapshot(null);
    setError(null);
    function handleReportFailure(failure: unknown): never {
      if (active && failure instanceof ApiError && failure.isSessionExpired) onSessionExpired();
      throw failure;
    }
    const range = getPeriodRangeMs(request.date, request.period)!;
    Promise.all([
      dataSource.getDailyReport(range).catch(handleReportFailure),
      dataSource.getStockReport({ lowStockThreshold: request.threshold }).catch(handleReportFailure),
    ])
      .then(([daily, stock]) => {
        if (active) setSnapshot({ daily, stock });
      })
      .catch((failure: unknown) => {
        if (!active) return;
        if (failure instanceof ApiError && failure.isSessionExpired) return;
        setError(failure instanceof ApiError ? failure.message : "Dashboard gagal dimuat. Coba lagi.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [dataSource, isAdmin, currentUser.userId, onSessionExpired, request]);

  if (!isAdmin) return <p role="alert">Dashboard hanya dapat diakses ADMIN.</p>;

  function refresh(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    if (
      getPeriodRangeMs(date, period) === null ||
      !/^\d+$/.test(threshold) ||
      !Number.isSafeInteger(Number(threshold))
    ) {
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

  const omzetTitle = (() => {
    if (request.period === "week") {
      const reqWeek = getPeriodRangeMs(request.date, "week");
      const curWeek = getPeriodRangeMs(today, "week");
      return reqWeek && curWeek && reqWeek.startMs === curWeek.startMs
        ? "Omzet minggu ini"
        : "Omzet minggu terpilih";
    }
    if (request.period === "month") {
      return request.date.slice(0, 7) === today.slice(0, 7) ? "Omzet bulan ini" : "Omzet bulan terpilih";
    }
    if (request.period === "year") {
      return request.date.slice(0, 4) === today.slice(0, 4) ? "Omzet tahun ini" : "Omzet tahun terpilih";
    }
    return request.date === today ? "Omzet hari ini" : "Omzet tanggal terpilih";
  })();

  const hasValidDenominator = daily !== undefined && daily.totalRp > 0;
  const cashPct = hasValidDenominator ? Math.round((daily.cash.totalRp / daily.totalRp) * 100) : null;
  const qrisPct = hasValidDenominator ? Math.max(0, 100 - (cashPct ?? 0)) : null;

  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const cashArc = hasValidDenominator ? (daily.cash.totalRp / daily.totalRp) * circumference : 0;
  const qrisArc = hasValidDenominator ? Math.max(0, circumference - cashArc) : 0;

  return (
    <section className="admin-page dashboard" aria-labelledby="dashboard-title" aria-busy={loading}>
      <header className="admin-header">
        <div className="admin-header__titles">
          <h1 id="dashboard-title" className="admin-header__title">
            Dashboard
          </h1>
          <p className="admin-header__subtitle">
            Ringkasan operasional penjualan dan persediaan ·{" "}
            {isDemo ? "DEMO — data sintetis, bukan transaksi nyata." : "Sumber: laporan backend lokal."}
          </p>
        </div>

        {!loading && daily && (
          <div className="admin-header__actions" role="group" aria-label="Ekspor laporan ringkasan">
            <Button
              variant="secondary"
              disabled={daily.saleCount === 0}
              onClick={() => {
                const { headers, rows } = buildExportRows(daily, request.period, request.date, shifts);
                triggerFileDownload(
                  `laporan-penjualan-${request.date}.csv`,
                  buildCsv(headers, rows),
                  "text/csv;charset=utf-8",
                );
              }}
            >
              <IconDownload size={18} />
              <span>Ekspor CSV</span>
            </Button>
            <Button
              variant="secondary"
              disabled={daily.saleCount === 0}
              onClick={() => {
                const { headers, rows } = buildExportRows(daily, request.period, request.date, shifts);
                triggerFileDownload(
                  `laporan-penjualan-${request.date}.xlsx`,
                  buildExcelWorkbook(`Laporan Penjualan ${request.date}`, headers, rows),
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                );
              }}
            >
              <IconFileSpreadsheet size={18} />
              <span>Ekspor Excel</span>
            </Button>
          </div>
        )}
      </header>

      <form className="admin-toolbar" noValidate onSubmit={refresh}>
        <div className="admin-toolbar__controls">
          <div className="admin-toolbar__field">
            <label className="field-label" htmlFor="dashboard-period">
              Periode
            </label>
            <select
              id="dashboard-period"
              className="input"
              value={period}
              disabled={loading}
              onChange={(e) => {
                const nextPeriod = e.target.value as DashboardPeriod;
                setPeriod(nextPeriod);
                if (
                  getPeriodRangeMs(date, nextPeriod) === null ||
                  !/^\d+$/.test(threshold) ||
                  !Number.isSafeInteger(Number(threshold))
                ) {
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

          <div className="admin-toolbar__field">
            <label className="field-label" htmlFor="dashboard-date">
              Tanggal penjualan
            </label>
            <input
              id="dashboard-date"
              className="input"
              type="date"
              max={today}
              value={date}
              disabled={loading}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="admin-toolbar__field">
            <label className="field-label" htmlFor="dashboard-threshold">
              Ambang stok menipis
            </label>
            <input
              id="dashboard-threshold"
              className="input"
              inputMode="numeric"
              value={threshold}
              disabled={loading}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </div>

          <Button type="submit" variant="primary" disabled={loading}>
            <IconRefresh size={18} />
            <span>{loading ? "Memuat dashboard…" : "Perbarui dashboard"}</span>
          </Button>
        </div>

        {!loading && daily && stock && (
          <div className="admin-toolbar__meta">
            <span>Penjualan diperbarui: {new Date(daily.generatedAtMs).toLocaleTimeString("id-ID")}</span>
            <span>Stok diperbarui: {new Date(stock.generatedAtMs).toLocaleTimeString("id-ID")}</span>
          </div>
        )}
      </form>

      <p className="muted" style={{ margin: 0, fontSize: "12px" }}>
        Zona waktu perangkat: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Batas hari dan ambang awal 5 unit
        adalah asumsi awal sebelum SOP pengelola disahkan; stok menampilkan saldo terkini, bukan stok historis tanggal penjualan.
      </p>

      {validation && (
        <p role="alert" className="field-error">
          {validation}
        </p>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {loading && (
        <div className="admin-card">
          <p role="status" className="muted" style={{ margin: 0 }}>
            Mengambil laporan penjualan dan stok…
          </p>
        </div>
      )}

      {!loading && daily && stock && (
        <>
          <p className="muted" style={{ margin: 0, fontSize: "13px" }}>
            Rentang penjualan dimuat: <strong>{new Date(daily.startMs).toLocaleString("id-ID")}</strong> s.d.{" "}
            <strong>{new Date(daily.endMs).toLocaleString("id-ID")}</strong> (batas akhir eksklusif).
          </p>

          {/* Baris 1: Empat KPI Utama dalam satu baris pada desktop */}
          <div className="admin-kpi-grid">
            <article className="admin-kpi-card admin-kpi-card--primary dashboard__primary" aria-label="Omzet">
              <div className="admin-kpi-card__top">
                <h2 className="admin-kpi-card__label">{omzetTitle}</h2>
                <span className="admin-kpi-card__icon">
                  <IconBarChart size={18} />
                </span>
              </div>
              <div className="admin-kpi-card__value">
                <MoneyText amountRp={daily.totalRp} className="money--total" />
              </div>
              <p className="admin-kpi-card__meta">Penjualan tersimpan (omzet kotor), bukan laba bersih.</p>
            </article>

            <article className="admin-kpi-card" aria-label="Jumlah transaksi">
              <div className="admin-kpi-card__top">
                <h2 className="admin-kpi-card__label">Jumlah transaksi</h2>
                <span className="admin-kpi-card__icon">
                  <IconCheckCircle size={18} />
                </span>
              </div>
              <div className="admin-kpi-card__value">{daily.saleCount}</div>
              <p className="admin-kpi-card__meta">Draft dan transaksi gagal tidak dihitung.</p>
            </article>

            <article className="admin-kpi-card admin-kpi-card--warning dashboard__accent" aria-label="Jumlah stok menipis">
              <div className="admin-kpi-card__top">
                <h2 className="admin-kpi-card__label">Stok menipis</h2>
                <span className="admin-kpi-card__icon">
                  <IconAlertTriangle size={18} />
                </span>
              </div>
              <div className="admin-kpi-card__value">{low.length}</div>
              <p className="admin-kpi-card__meta">
                Produk dengan saldo positif s.d. {stock.lowStockThreshold} unit.
              </p>
            </article>

            <article className="admin-kpi-card admin-kpi-card--danger" aria-label="Jumlah stok habis">
              <div className="admin-kpi-card__top">
                <h2 className="admin-kpi-card__label">Stok habis</h2>
                <span className="admin-kpi-card__icon">
                  <IconXCircle size={18} />
                </span>
              </div>
              <div className="admin-kpi-card__value">{zero.length}</div>
              <p className="admin-kpi-card__meta">Produk dengan saldo 0 unit pada ledger.</p>
            </article>
          </div>

          {/* Baris 2: Metode Pembayaran (Donut + Nominal) & Penjualan per Shift */}
          <div className="admin-split-grid">
            <div className="admin-card">
              <div className="admin-card__header">
                <div>
                  <h2 className="admin-card__title">Metode Pembayaran</h2>
                  <p className="admin-card__desc">Distribusi penjualan Tunai dan QRIS terverifikasi kasir.</p>
                </div>
              </div>

              {daily.saleCount === 0 && (
                <p className="muted" style={{ marginTop: 0 }}>
                  Belum ada transaksi tersimpan pada periode ini.
                </p>
              )}

              <div className="payment-donut-layout">
                <div className="payment-donut" aria-hidden="true">
                  <svg width="124" height="124" viewBox="0 0 120 120">
                    <circle
                      cx="60"
                      cy="60"
                      r={radius}
                      fill="none"
                      stroke="var(--color-border)"
                      strokeWidth="16"
                    />
                    {hasValidDenominator && (
                      <>
                        <circle
                          cx="60"
                          cy="60"
                          r={radius}
                          fill="none"
                          stroke="var(--color-primary)"
                          strokeWidth="16"
                          strokeDasharray={`${cashArc} ${circumference}`}
                          transform="rotate(-90 60 60)"
                        />
                        {qrisArc > 0 && (
                          <circle
                            cx="60"
                            cy="60"
                            r={radius}
                            fill="none"
                            stroke="var(--color-info)"
                            strokeWidth="16"
                            strokeDasharray={`${qrisArc} ${circumference}`}
                            strokeDashoffset={-cashArc}
                            transform="rotate(-90 60 60)"
                          />
                        )}
                      </>
                    )}
                    <text
                      x="60"
                      y="57"
                      textAnchor="middle"
                      fontSize="11"
                      fill="var(--color-text-muted)"
                      fontWeight="600"
                    >
                      Transaksi
                    </text>
                    <text
                      x="60"
                      y="74"
                      textAnchor="middle"
                      fontSize="16"
                      fill="var(--color-text)"
                      fontWeight="700"
                    >
                      {daily.saleCount}
                    </text>
                  </svg>
                </div>

                <div className="payment-breakdown-list">
                  <article className="payment-breakdown-item" aria-label="Penjualan CASH">
                    <div className="payment-breakdown-item__head">
                      <strong>
                        <span className="payment-dot payment-dot--cash" aria-hidden="true" />
                        Tunai (CASH)
                      </strong>
                      {cashPct !== null && <span className="badge badge--ok">{cashPct}%</span>}
                    </div>
                    <div style={{ fontSize: "20px", fontWeight: 700 }}>
                      <MoneyText amountRp={daily.cash.totalRp} />
                    </div>
                    <p className="admin-kpi-card__meta">
                      {daily.cash.count} transaksi · penjualan tunai, bukan saldo kas laci.
                    </p>
                  </article>

                  <article className="payment-breakdown-item" aria-label="Penjualan QRIS">
                    <div className="payment-breakdown-item__head">
                      <strong>
                        <span className="payment-dot payment-dot--qris" aria-hidden="true" />
                        QRIS (verifikasi kasir)
                      </strong>
                      {qrisPct !== null && <span className="badge badge--info">{qrisPct}%</span>}
                    </div>
                    <div style={{ fontSize: "20px", fontWeight: 700 }}>
                      <MoneyText amountRp={daily.qrisManual.totalRp} />
                    </div>
                    <p className="admin-kpi-card__meta">
                      {daily.qrisManual.count} transaksi · {daily.qrisManual.verifiedCount} terverifikasi kasir.
                      QRIS tidak menambah uang kas laci.
                    </p>
                  </article>
                </div>
              </div>
            </div>

            <div className="admin-card">
              <div className="admin-card__header">
                <div>
                  <h2 className="admin-card__title">Ringkasan Penjualan per Shift</h2>
                  <p className="admin-card__desc">
                    Shift dengan transaksi pada periode terpilih (bukan rekap kas penutupan).
                  </p>
                </div>
              </div>

              {daily.salesTruncated ? (
                <p role="note" className="muted">
                  Rincian backend dibatasi. Ringkasan shift tidak ditampilkan agar tidak memberi total parsial;
                  kartu omzet tetap memakai total lengkap backend. Gunakan menu Laporan dengan filter ID shift untuk
                  rekap shift tertentu.
                </p>
              ) : shifts.size === 0 ? (
                <div className="admin-empty">
                  <span className="admin-empty__icon">
                    <IconBarChart size={24} />
                  </span>
                  <p className="admin-empty__title">Belum ada aktivitas shift</p>
                  <p className="admin-empty__desc">Tidak ada transaksi pada shift manapun untuk rentang waktu ini.</p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="table" aria-label="Penjualan per shift">
                    <thead>
                      <tr>
                        <th scope="col">Shift</th>
                        <th scope="col" className="num">Transaksi</th>
                        <th scope="col" className="num">Tunai</th>
                        <th scope="col" className="num">QRIS</th>
                        <th scope="col" className="num">Omzet</th>
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
              )}
            </div>
          </div>

          {/* Baris 3: Produk Perlu Perhatian */}
          <div className="admin-card">
            <div className="admin-card__header">
              <div>
                <h2 className="admin-card__title">Produk Perlu Perhatian</h2>
                <p className="admin-card__desc">
                  Daftar barang dengan saldo habis atau menipis pada ambang {stock.lowStockThreshold} unit.
                </p>
              </div>
              {onNavigate && (
                <Button variant="secondary" onClick={() => onNavigate("products")}>
                  <IconPackage size={18} />
                  <span>Buka Barang/Stok</span>
                  <IconArrowRight size={16} />
                </Button>
              )}
            </div>

            {stock.products.some((p) => !p.matched) && (
              <p className="field-error" role="alert" style={{ marginBottom: "12px" }}>
                Ada saldo yang belum cocok dengan ledger. Periksa laporan stok sebelum tindakan operasional.
              </p>
            )}

            {stock.products.length === 0 ? (
              <div className="admin-empty">
                <span className="admin-empty__icon">
                  <IconPackage size={24} />
                </span>
                <p className="admin-empty__title">Belum ada produk pada laporan stok</p>
                <p className="admin-empty__desc">Tambahkan master barang melalui menu Daftar Barang.</p>
              </div>
            ) : low.length + zero.length === 0 ? (
              <div className="admin-empty">
                <span className="admin-empty__icon">
                  <IconCheckCircle size={24} />
                </span>
                <p className="admin-empty__title">Seluruh stok berada di atas ambang perhatian</p>
                <p className="admin-empty__desc">
                  Tidak ada produk habis atau menipis pada ambang {stock.lowStockThreshold} unit.
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table" aria-label="Stok habis dan menipis">
                  <thead>
                    <tr>
                      <th scope="col">Nama Produk</th>
                      <th scope="col">SKU</th>
                      <th scope="col" className="num">Saldo</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...zero, ...low].map((p) => (
                      <tr key={p.productId}>
                        <td className="cell-primary">{p.name}</td>
                        <td>
                          <code>{p.sku}</code>
                        </td>
                        <td className="num">
                          <strong>{p.onHand}</strong>
                        </td>
                        <td>
                          <span className={`badge ${p.zero ? "badge--danger" : "badge--warning"}`}>
                            {p.zero ? <IconXCircle size={14} /> : <IconAlertTriangle size={14} />}
                            <span style={{ marginLeft: "4px" }}>{p.zero ? "Stok habis" : "Menipis"}</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
