import { useState, type FormEvent } from "react";
import { ApiError } from "../api/errors";
import type { PosDataSource, ProductStockReport, StockMovementEntry, StockReport } from "../api/types";
import { buildExcelWorkbook } from "../domain/excel";
import { buildCsv, triggerFileDownload } from "../domain/iposFeatures";
import {
  IconAlertTriangle,
  IconDownload,
  IconFileSpreadsheet,
  IconHistory,
  IconPackage,
  IconRefresh,
  IconRotateCcw,
  IconSearch,
  IconX,
  IconXCircle,
} from "./AdminIcons";
import { Button } from "./Button";

interface StockReportPanelProps {
  dataSource: PosDataSource;
  onSessionExpired: () => void;
}

function formatTime(ms: number): string {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? "waktu tidak diketahui" : date.toLocaleString("id-ID");
}

const KIND_LABEL: Record<StockMovementEntry["kind"], string> = {
  OPENING: "Stok awal",
  RECEIPT: "Penerimaan",
  SALE: "Penjualan",
  ADJUSTMENT: "Koreksi",
};

function computeRunningBalances(product: ProductStockReport): Map<number, number> | null {
  if (product.movementsTruncated) return null;
  const chronological = [...product.movements].sort((a, b) =>
    a.createdAtMs !== b.createdAtMs ? a.createdAtMs - b.createdAtMs : a.id - b.id,
  );
  const map = new Map<number, number>();
  let running = 0;
  for (const m of chronological) {
    running += m.delta;
    map.set(m.id, running);
  }
  return map;
}

/**
 * Laporan stok (TASK-026). Saldo dan komponen berasal dari ledger backend,
 * bukan hitungan browser. Menyediakan filter produk/status serta panel samping
 * detail mutasi per produk.
 */
export function StockReportPanel({ dataSource, onSessionExpired }: StockReportPanelProps) {
  const [threshold, setThreshold] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "safe" | "low" | "zero">("all");
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [report, setReport] = useState<StockReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function load(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const raw = threshold.trim();
    let parsed: number | undefined;
    if (raw !== "") {
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
        setError("Ambang stok menipis harus bilangan bulat non-negatif atau dikosongkan.");
        return;
      }
      parsed = Number(raw);
    }
    setIsLoading(true);
    setError(null);
    try {
      const nextReport = await dataSource.getStockReport(
        parsed === undefined ? {} : { lowStockThreshold: parsed },
      );
      setReport(nextReport);
    } catch (failure) {
      if (failure instanceof ApiError && failure.isSessionExpired) {
        onSessionExpired();
      } else {
        setError(failure instanceof ApiError ? failure.message : "Laporan stok gagal dimuat.");
      }
    } finally {
      setIsLoading(false);
    }
  }

  const filteredProducts =
    report?.products.filter((p) => {
      if (statusFilter === "zero" && !p.zero) return false;
      if (statusFilter === "low" && (!p.low || p.zero)) return false;
      if (statusFilter === "safe" && (p.zero || p.low || report.lowStockThreshold === 0)) return false;
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
    }) ?? [];

  const selectedProduct =
    report?.products.find((p) => p.productId === selectedProductId) ?? null;
  const runningBalances = selectedProduct ? computeRunningBalances(selectedProduct) : null;

  const lowCount = report?.products.filter((p) => p.low && !p.zero).length ?? 0;
  const zeroCount = report?.products.filter((p) => p.zero).length ?? 0;

  return (
    <section className="admin-card" aria-label="Laporan stok dan mutasi">
      <div className="admin-card__header">
        <div>
          <h2 className="admin-card__title">Persediaan &amp; Riwayat Mutasi</h2>
          <p className="admin-card__desc">
            Saldo dihitung backend dari ledger (stok awal + penerimaan − penjualan + koreksi).
          </p>
        </div>
      </div>

      <form
        className="admin-toolbar"
        style={{ background: "var(--color-bg)", marginBottom: "16px" }}
        onSubmit={(event) => void load(event)}
      >
        <div className="admin-toolbar__controls">
          <div className="admin-toolbar__field admin-toolbar__field--grow">
            <label className="field-label" htmlFor="stock-report-search">
              Cari produk / SKU
            </label>
            <div className="input-with-icon">
              <span className="input-with-icon__prefix">
                <IconSearch size={16} />
              </span>
              <input
                id="stock-report-search"
                className="input input--pl"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter nama barang atau SKU…"
              />
            </div>
          </div>

          <div className="admin-toolbar__field">
            <label className="field-label" htmlFor="stock-report-status">
              Status stok
            </label>
            <select
              id="stock-report-status"
              className="input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | "safe" | "low" | "zero")}
            >
              <option value="all">Semua status</option>
              <option value="safe">Aman (ambang aktif)</option>
              <option value="low">Menipis</option>
              <option value="zero">Stok habis</option>
            </select>
          </div>

          <div className="admin-toolbar__field">
            <label className="field-label" htmlFor="stock-threshold">
              Ambang stok menipis (opsional)
            </label>
            <input
              id="stock-threshold"
              className="input"
              type="text"
              inputMode="numeric"
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
              placeholder="Mis. 5"
            />
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Button type="submit" variant="primary" disabled={isLoading}>
              <IconRefresh size={16} />
              <span>{isLoading ? "Memuat…" : "Muat stok"}</span>
            </Button>
            {(searchQuery !== "" || statusFilter !== "all" || threshold !== "") && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("all");
                  setThreshold("");
                  setError(null);
                }}
              >
                <IconRotateCcw size={16} />
                <span>Reset</span>
              </Button>
            )}
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
            <IconPackage size={24} />
          </span>
          <p className="admin-empty__title">Klik Muat stok untuk menampilkan rekap persediaan</p>
          <p className="admin-empty__desc">
            Isi ambang stok menipis bila ingin menandai produk berisiko habis, atau kosongkan untuk memuat saldo tanpa ambang.
          </p>
        </div>
      )}

      {!error && report && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <p className="muted" style={{ margin: 0, fontSize: "13px" }}>
              Sumber data: backend lokal ·{" "}
              {report.lowStockThreshold === 0
                ? "ambang menipis belum diatur (0)"
                : `ambang menipis ≤ ${report.lowStockThreshold} unit`}{" "}
              · dibuat {formatTime(report.generatedAtMs)}.
            </p>

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <Button
                variant="secondary"
                onClick={() => {
                  const headers = ["SKU", "Nama", "Stok Awal", "Penerimaan", "Penjualan", "Koreksi", "Saldo"];
                  const rows = report.products.map((p) => [
                    p.sku,
                    p.name,
                    p.opening,
                    p.receipt,
                    p.sale,
                    p.adjustment,
                    p.onHand,
                  ]);
                  triggerFileDownload("laporan-stok.csv", buildCsv(headers, rows), "text/csv;charset=utf-8");
                }}
              >
                <IconDownload size={16} />
                <span>Ekspor CSV</span>
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const headers = ["SKU", "Nama", "Stok Awal", "Penerimaan", "Penjualan", "Koreksi", "Saldo"];
                  const rows = report.products.map((p) => [
                    p.sku,
                    p.name,
                    p.opening,
                    p.receipt,
                    p.sale,
                    p.adjustment,
                    p.onHand,
                  ]);
                  triggerFileDownload(
                    "laporan-stok.xlsx",
                    buildExcelWorkbook("Laporan Stok", headers, rows),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                  );
                }}
              >
                <IconFileSpreadsheet size={16} />
                <span>Ekspor Excel</span>
              </Button>
            </div>
          </div>

          <div className="admin-kpi-grid admin-kpi-grid--3">
            <div className="admin-kpi-card">
              <div className="admin-kpi-card__top">
                <span className="admin-kpi-card__label">Total produk</span>
                <span className="admin-kpi-card__icon">
                  <IconPackage size={18} />
                </span>
              </div>
              <div className="admin-kpi-card__value">{report.products.length}</div>
              <p className="admin-kpi-card__meta">Terdaftar pada ledger persediaan</p>
            </div>

            <div className="admin-kpi-card admin-kpi-card--warning">
              <div className="admin-kpi-card__top">
                <span className="admin-kpi-card__label">Stok menipis</span>
                <span className="admin-kpi-card__icon">
                  <IconAlertTriangle size={18} />
                </span>
              </div>
              <div className="admin-kpi-card__value">{lowCount}</div>
              <p className="admin-kpi-card__meta">
                {report.lowStockThreshold === 0
                  ? "Isi ambang > 0 untuk menghitung stok menipis"
                  : `Saldo 1 s.d. ${report.lowStockThreshold} unit`}
              </p>
            </div>

            <div className="admin-kpi-card admin-kpi-card--danger">
              <div className="admin-kpi-card__top">
                <span className="admin-kpi-card__label">Stok habis</span>
                <span className="admin-kpi-card__icon">
                  <IconXCircle size={18} />
                </span>
              </div>
              <div className="admin-kpi-card__value">{zeroCount}</div>
              <p className="admin-kpi-card__meta">Produk dengan saldo akhir 0 unit</p>
            </div>
          </div>

          <div className={selectedProduct ? "stock-detail-layout" : undefined}>
            <div>
              {filteredProducts.length === 0 ? (
                <p className="muted">Belum ada produk yang cocok pada laporan ini.</p>
              ) : (
                <div className="table-wrap">
                  <table className="table" aria-label="Laporan stok per produk">
                    <thead>
                      <tr>
                        <th scope="col">Produk</th>
                        <th scope="col">Status</th>
                        <th scope="col" className="num">
                          Awal
                        </th>
                        <th scope="col" className="num">
                          Masuk
                        </th>
                        <th scope="col" className="num">
                          Jual
                        </th>
                        <th scope="col" className="num">
                          Koreksi
                        </th>
                        <th scope="col" className="num">
                          Saldo
                        </th>
                        <th scope="col">Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProducts.map((product) => (
                        <tr key={product.productId}>
                          <td>
                            <div className="cell-primary">{product.name}</div>
                            <div className="cell-sub">
                              <code>{product.sku}</code>
                            </div>
                          </td>
                          <td>
                            {product.zero ? (
                              <span className="badge badge--danger">Stok habis</span>
                            ) : product.low ? (
                              <span className="badge badge--warning">Menipis</span>
                            ) : report.lowStockThreshold === 0 ? (
                              <span className="badge">Ambang belum diatur</span>
                            ) : (
                              <span className="badge badge--ok">Aman</span>
                            )}
                            {!product.matched && (
                              <span className="badge badge--warning" style={{ marginLeft: "4px" }}>
                                Saldo tidak cocok
                              </span>
                            )}
                          </td>
                          <td className="num">{product.opening}</td>
                          <td className="num">{product.receipt}</td>
                          <td className="num">{product.sale}</td>
                          <td className="num">
                            {product.adjustment > 0 ? `+${product.adjustment}` : product.adjustment}
                          </td>
                          <td className="num">
                            <strong>{product.onHand}</strong>
                          </td>
                          <td>
                            <Button
                              type="button"
                              variant={selectedProductId === product.productId ? "primary" : "secondary"}
                              style={{ minHeight: "32px", padding: "4px 10px", fontSize: "12px" }}
                              onClick={() =>
                                setSelectedProductId((prev) =>
                                  prev === product.productId ? null : product.productId,
                                )
                              }
                            >
                              <IconHistory size={14} />
                              <span>Detail</span>
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {selectedProduct && (
              <aside className="stock-drawer" aria-label={`Detail mutasi ${selectedProduct.sku}`}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                  <div>
                    <h3 className="admin-card__title" style={{ fontSize: "16px" }}>
                      {selectedProduct.name}
                    </h3>
                    <span className="muted" style={{ fontSize: "12px" }}>
                      SKU: <code>{selectedProduct.sku}</code>
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="btn--icon"
                    style={{ minHeight: "32px", minWidth: "32px" }}
                    aria-label="Tutup panel detail mutasi"
                    onClick={() => setSelectedProductId(null)}
                  >
                    <IconX size={16} />
                  </Button>
                </div>

                <div className="sync-card__meta-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)", padding: "10px" }}>
                  <div>
                    <span className="sync-card__kv-label">Stok Awal</span>
                    <span className="sync-card__kv-value">{selectedProduct.opening} unit</span>
                  </div>
                  <div>
                    <span className="sync-card__kv-label">Saldo Akhir</span>
                    <span className="sync-card__kv-value">{selectedProduct.onHand} unit</span>
                  </div>
                  <div>
                    <span className="sync-card__kv-label">Masuk / Jual</span>
                    <span className="sync-card__kv-value">
                      +{selectedProduct.receipt} / -{selectedProduct.sale}
                    </span>
                  </div>
                  <div>
                    <span className="sync-card__kv-label">Koreksi Bersih</span>
                    <span className="sync-card__kv-value">
                      {selectedProduct.adjustment > 0
                        ? `+${selectedProduct.adjustment}`
                        : selectedProduct.adjustment}{" "}
                      unit
                    </span>
                  </div>
                </div>

                {selectedProduct.movementsTruncated && (
                  <p className="field-hint" role="note" style={{ margin: 0 }}>
                    Menampilkan 20 mutasi terbaru. Saldo berjalan per baris disembunyikan karena histori dipotong; saldo akhir dihitung backend dari seluruh mutasi.
                  </p>
                )}

                {selectedProduct.movements.length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>
                    Belum ada mutasi tercatat untuk produk ini.
                  </p>
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th scope="col">Waktu &amp; Jenis</th>
                          <th scope="col" className="num">
                            Delta
                          </th>
                          {runningBalances && (
                            <th scope="col" className="num">
                              Saldo
                            </th>
                          )}
                          <th scope="col">Referensi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedProduct.movements.map((m) => (
                          <tr key={m.id}>
                            <td>
                              <div className="cell-primary">{KIND_LABEL[m.kind]}</div>
                              <div className="cell-sub">
                                {formatTime(m.createdAtMs)} · #{m.actorId}
                              </div>
                            </td>
                            <td className="num">
                              <strong>{m.delta > 0 ? `+${m.delta}` : m.delta}</strong>
                            </td>
                            {runningBalances && <td className="num">{runningBalances.get(m.id) ?? "—"}</td>}
                            <td style={{ fontSize: "12px" }}>
                              <code>{m.sourceRef ?? "—"}</code>
                              {m.adjustmentReason ? <div className="cell-sub">{m.adjustmentReason}</div> : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </aside>
            )}
          </div>

          <div>
            <h3 className="section-title">Rincian Audit Mutasi per Produk</h3>
            {report.products.map((product) => (
              <details key={product.productId} className="stock-movements">
                <summary>
                  Mutasi {product.sku} — {product.name} (Saldo: {product.onHand})
                </summary>
                {product.movementsTruncated && (
                  <p className="muted" role="note">
                    Menampilkan 20 mutasi terbaru; rekonsiliasi tetap memakai seluruh mutasi.
                  </p>
                )}
                {product.movements.length === 0 ? (
                  <p className="muted">Belum ada mutasi untuk produk ini.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="table" aria-label={`Mutasi ${product.sku}`}>
                      <thead>
                        <tr>
                          <th scope="col">Waktu</th>
                          <th scope="col">Jenis</th>
                          <th scope="col">Sumber / Referensi</th>
                          <th scope="col" className="num">
                            Delta
                          </th>
                          <th scope="col">Petugas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {product.movements.map((movement) => (
                          <tr key={movement.id}>
                            <td>{formatTime(movement.createdAtMs)}</td>
                            <td>{KIND_LABEL[movement.kind]}</td>
                            <td>
                              <code>{movement.sourceRef ?? "—"}</code>
                              {movement.sourceQuantity !== null ? ` (${movement.sourceQuantity} unit)` : ""}
                              {movement.adjustmentReason ? ` · ${movement.adjustmentReason}` : ""}
                            </td>
                            <td className="num">
                              {movement.delta > 0 ? `+${movement.delta}` : movement.delta}
                            </td>
                            <td>#{movement.actorId}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </details>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
