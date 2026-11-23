import { useState, type FormEvent } from "react";
import { ApiError } from "../api/errors";
import type { PosDataSource, StockReport, StockMovementEntry } from "../api/types";
import { buildCsv, buildExcelHtml, triggerFileDownload } from "../domain/iposFeatures";
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

/**
 * Laporan stok (TASK-026). Saldo dan komponen berasal dari ledger backend,
 * bukan hitungan browser. Ambang "menipis" masih fixture/DEMO sampai SOP
 * pengelola disahkan.
 */
export function StockReportPanel({ dataSource, onSessionExpired }: StockReportPanelProps) {
  const [threshold, setThreshold] = useState("");
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
      setReport(await dataSource.getStockReport(parsed === undefined ? {} : { lowStockThreshold: parsed }));
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

  return (
    <section className="report-panel" aria-label="Laporan stok dan mutasi">
      <h2 className="section-title">Stok dan riwayat mutasi</h2>
      <p className="muted">
        Saldo dihitung backend dari ledger (stok awal + penerimaan − penjualan + koreksi). Ambang
        stok menipis belum disahkan; nilai di bawah hanya fixture pengembangan.
      </p>
      <form className="report-filter" onSubmit={(event) => void load(event)}>
        <label className="field-label" htmlFor="stock-threshold">Ambang stok menipis (opsional)</label>
        <input
          id="stock-threshold"
          className="input"
          type="text"
          inputMode="numeric"
          value={threshold}
          onChange={(event) => setThreshold(event.target.value)}
          placeholder="Kosongkan untuk tidak menandai menipis"
        />
        <Button type="submit" variant="primary" disabled={isLoading}>
          {isLoading ? "Memuat…" : "Muat stok"}
        </Button>
      </form>
      {error && <p className="field-error" role="alert">{error}</p>}
      {!error && report && (
        <>
          <p className="muted">
            Sumber data: backend lokal · ambang {report.lowStockThreshold} · dibuat{" "}
            {formatTime(report.generatedAtMs)}.
          </p>
          {report.products.length === 0 ? (
            <p className="muted">Belum ada produk pada laporan ini.</p>
          ) : (
            <div className="table-wrap">
              <table className="table" aria-label="Laporan stok per produk">
                <thead>
                  <tr>
                    <th scope="col">Produk</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="num">Awal</th>
                    <th scope="col" className="num">Terima</th>
                    <th scope="col" className="num">Jual</th>
                    <th scope="col" className="num">Koreksi</th>
                    <th scope="col" className="num">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {report.products.map((product) => (
                    <tr key={product.productId}>
                      <td>{product.sku} — {product.name}</td>
                      <td>
                        {product.zero ? (
                          <span className="badge badge--danger">Stok habis</span>
                        ) : product.low ? (
                          <span className="badge badge--warning">Menipis</span>
                        ) : (
                          <span className="badge badge--ok">Aman</span>
                        )}
                        {!product.matched && <span className="badge badge--warning">Saldo tidak cocok</span>}
                      </td>
                      <td className="num">{product.opening}</td>
                      <td className="num">{product.receipt}</td>
                      <td className="num">{product.sale}</td>
                      <td className="num">{product.adjustment}</td>
                      <td className="num"><strong>{product.onHand}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="dialog__actions">
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
              Ekspor CSV
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
                triggerFileDownload("laporan-stok.xls", buildExcelHtml("Laporan Stok", headers, rows), "application/vnd.ms-excel;charset=utf-8");
              }}
            >
              Ekspor Excel
            </Button>
          </div>
          {report.products.map((product) => (
            <details key={product.productId} className="stock-movements">
              <summary>Mutasi {product.sku} — {product.name}</summary>
              {product.movementsTruncated && (
                <p className="muted" role="note">Menampilkan 20 mutasi terbaru; rekonsiliasi tetap memakai seluruh mutasi.</p>
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
                        <th scope="col">Sumber</th>
                        <th scope="col" className="num">Delta</th>
                        <th scope="col">Petugas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {product.movements.map((movement) => (
                        <tr key={movement.id}>
                          <td>{formatTime(movement.createdAtMs)}</td>
                          <td>{KIND_LABEL[movement.kind]}</td>
                          <td>
                            {movement.sourceRef ?? "—"}
                            {movement.sourceQuantity !== null ? ` (${movement.sourceQuantity} unit)` : ""}
                            {movement.adjustmentReason ? ` · ${movement.adjustmentReason}` : ""}
                          </td>
                          <td className="num">{movement.delta}</td>
                          <td>#{movement.actorId}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </details>
          ))}
        </>
      )}
    </section>
  );
}
