import { useEffect, useState, type FormEvent } from "react";
import type { PosDataSource } from "../api/types";
import { ApiError } from "../api/errors";
import { Button } from "../components/Button";
import { ReceiptPanel } from "../components/ReceiptPanel";

interface ReceiptPageProps {
  dataSource: PosDataSource;
  onSessionExpired: () => void;
}

function parseSaleId(raw: string): number | null {
  const normalized = raw.trim().replace(/^S-/i, "");
  if (!/^\d+$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Halaman Riwayat/Struk: mengambil struk berdasarkan ID sale yang sudah
 * tersimpan. Cetak ulang memakai endpoint yang sama dengan saleId lama;
 * tidak ada checkout/pembayaran/stok baru (POS-04.03).
 */
export function ReceiptPage({ dataSource, onSessionExpired }: ReceiptPageProps) {
  const [input, setInput] = useState("");
  const [saleId, setSaleId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [recent, setRecent] = useState<Awaited<ReturnType<PosDataSource["getRecentSales"]>>>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setRecent([]);
    setListError(null);
    dataSource.getRecentSales().then(rows => { if (active) setRecent(rows); }).catch(error => {
      if (!active) return;
      if (error instanceof ApiError && error.isSessionExpired) onSessionExpired();
      else setListError("Daftar transaksi gagal dimuat. Gunakan pencarian struk atau buka kembali halaman ini.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [dataSource, onSessionExpired]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsed = parseSaleId(input);
    if (parsed === null) {
      setSaleId(null);
      setMessage("Masukkan nomor struk seperti S-000208 atau ID transaksi berupa bilangan bulat positif.");
      return;
    }
    setMessage(null);
    setSaleId(parsed);
  }

  return (
    <section className="panel receipt-history" aria-label="Riwayat dan cetak ulang struk">
      <h2 className="section-title">Riwayat/Struk</h2>
      <p className="muted">
        Masukkan nomor struk atau ID transaksi tersimpan. Struk diambil dari sale yang sudah COMMITTED
        beserta nomor dan harga historisnya; mencetak ulang tidak membuat transaksi baru.
      </p>
      <h3>20 transaksi terbaru</h3>
      {loading && <p role="status">Memuat transaksi…</p>}
      {listError && <p role="alert">{listError}</p>}
      {!loading && !listError && recent.length === 0 && <p>Belum ada transaksi.</p>}
      {recent.length > 0 && <table>
        <thead><tr><th>Nomor penjualan</th><th>Waktu</th><th>Total</th><th>Metode bayar</th></tr></thead>
        <tbody>{recent.map(sale => <tr key={sale.saleId} onClick={() => setSaleId(sale.saleId)}>
          <td><button type="button" onClick={() => setSaleId(sale.saleId)}>{sale.saleNo}</button></td>
          <td>{new Date(sale.committedAtMs).toLocaleString("id-ID")}</td>
          <td>{new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(sale.totalRp)}</td>
          <td>{sale.method === "CASH" ? "Tunai" : "QRIS manual"}</td>
        </tr>)}</tbody>
      </table>}
      <form onSubmit={handleSubmit} className="receipt-history__form">
        <label htmlFor="receipt-sale-id" className="field-label">
          Nomor struk atau ID transaksi tersimpan
        </label>
        <input
          id="receipt-sale-id"
          className="input"
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Mis. S-000208 atau 208"
        />
        <Button type="submit" variant="primary">Muat struk</Button>
      </form>
      {message && <p className="field-error" role="alert">{message}</p>}
      {saleId !== null && (
        <ReceiptPanel
          key={saleId}
          dataSource={dataSource}
          saleId={saleId}
          onSessionExpired={onSessionExpired}
          autoLoad
        />
      )}
    </section>
  );
}
