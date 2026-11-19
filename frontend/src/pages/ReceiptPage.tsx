import { useState, type FormEvent } from "react";
import type { PosDataSource } from "../api/types";
import { Button } from "../components/Button";
import { ReceiptPanel } from "../components/ReceiptPanel";

interface ReceiptPageProps {
  dataSource: PosDataSource;
  onSessionExpired: () => void;
}

function parseSaleId(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
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

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsed = parseSaleId(input);
    if (parsed === null) {
      setSaleId(null);
      setMessage("Masukkan ID transaksi berupa bilangan bulat positif.");
      return;
    }
    setMessage(null);
    setSaleId(parsed);
  }

  return (
    <section className="panel receipt-history" aria-label="Riwayat dan cetak ulang struk">
      <h2 className="section-title">Riwayat/Struk</h2>
      <p className="muted">
        Masukkan ID transaksi tersimpan. Struk diambil dari sale yang sudah COMMITTED
        beserta nomor dan harga historisnya; mencetak ulang tidak membuat transaksi baru.
      </p>
      <form onSubmit={handleSubmit} className="receipt-history__form">
        <label htmlFor="receipt-sale-id" className="field-label">
          ID transaksi tersimpan
        </label>
        <input
          id="receipt-sale-id"
          className="input"
          type="text"
          inputMode="numeric"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Mis. 102"
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
