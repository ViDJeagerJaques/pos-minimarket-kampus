import { useEffect, useState, type FormEvent } from "react";
import type { PosDataSource } from "../api/types";
import { ApiError } from "../api/errors";
import { Button } from "../components/Button";
import { ReceiptPanel } from "../components/ReceiptPanel";

interface ReceiptPageProps {
  dataSource: PosDataSource;
  onSessionExpired: () => void;
}

const PAGE_SIZE = 20;
const FETCH_LIMIT = 100;

function parseSaleId(raw: string): number | null {
  const normalized = raw.trim().replace(/^S-/i, "");
  if (!/^\d+$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function getTodayRangeMs(): { startMs: number; endMs: number } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return { startMs: start, endMs: start + 24 * 60 * 60 * 1000 };
}

export function ReceiptPage({ dataSource, onSessionExpired }: ReceiptPageProps) {
  const [input, setInput] = useState("");
  const [saleId, setSaleId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [recent, setRecent] = useState<Awaited<ReturnType<PosDataSource["getRecentSales"]>>>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [slideDir, setSlideDir] = useState<"next" | "prev">("next");

  useEffect(() => {
    let active = true;
    const { startMs, endMs } = getTodayRangeMs();
    setLoading(true);
    setRecent([]);
    setListError(null);
    setPage(0);

    async function loadToday() {
      const collected: Awaited<ReturnType<PosDataSource["getRecentSales"]>> = [];
      let offset = 0;
      while (true) {
        const rows = await dataSource.getRecentSales({
          startMs,
          endMs,
          limit: FETCH_LIMIT,
          offset,
        });
        if (!active) return;
        const todayRows = rows.filter(
          (row) => row.committedAtMs >= startMs && row.committedAtMs < endMs,
        );
        collected.push(...todayRows);
        if (rows.length < FETCH_LIMIT) break;
        offset += FETCH_LIMIT;
      }
      if (active) {
        setRecent(collected);
      }
    }

    loadToday()
      .catch((error) => {
        if (!active) return;
        if (error instanceof ApiError && error.isSessionExpired) onSessionExpired();
        else setListError("Daftar transaksi gagal dimuat. Gunakan pencarian struk atau buka kembali halaman ini.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [dataSource, onSessionExpired]);

  useEffect(() => {
    if (saleId === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSaleId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saleId]);

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

  const totalPages = Math.max(1, Math.ceil(recent.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = recent.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <section className="panel receipt-history" aria-label="Riwayat dan cetak ulang struk">
      <h2 className="section-title">Riwayat/Struk</h2>
      <p className="muted">
        Masukkan nomor struk atau ID transaksi tersimpan. Struk diambil dari sale yang sudah COMMITTED
        beserta nomor dan harga historisnya; mencetak ulang tidak membuat transaksi baru.
      </p>
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

      <h3>Transaksi hari ini</h3>
      {loading && <p role="status">Memuat transaksi...</p>}
      {listError && <p role="alert">{listError}</p>}
      {!loading && !listError && recent.length === 0 && <p>Belum ada transaksi hari ini.</p>}
      {recent.length > 0 && (
        <>
          <div
            key={safePage}
            className={`table-wrap ${slideDir === "next" ? "receipt-history__slider--next" : "receipt-history__slider--prev"}`}
          >
            <table>
              <thead>
                <tr>
                  <th>Nomor penjualan</th>
                  <th>Waktu</th>
                  <th>Total</th>
                  <th>Metode bayar</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((sale) => (
                  <tr key={sale.saleId} onClick={() => setSaleId(sale.saleId)}>
                    <td>
                      <button type="button" onClick={() => setSaleId(sale.saleId)}>
                        {sale.saleNo}
                      </button>
                    </td>
                    <td>{new Date(sale.committedAtMs).toLocaleString("id-ID")}</td>
                    <td>
                      {new Intl.NumberFormat("id-ID", {
                        style: "currency",
                        currency: "IDR",
                        maximumFractionDigits: 0,
                      }).format(sale.totalRp)}
                    </td>
                    <td>{sale.method === "CASH" ? "Tunai" : "QRIS manual"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {recent.length > PAGE_SIZE && (
            <div className="receipt-history__pagination">
              <Button
                variant="secondary"
                disabled={safePage === 0}
                onClick={() => {
                  setSlideDir("prev");
                  setPage((current) => Math.max(0, current - 1));
                }}
              >
                Sebelumnya
              </Button>
              <span className="muted">
                Halaman {safePage + 1} dari {totalPages}
              </span>
              <Button
                variant="secondary"
                disabled={safePage >= totalPages - 1}
                onClick={() => {
                  setSlideDir("next");
                  setPage((current) => Math.min(totalPages - 1, current + 1));
                }}
              >
                Berikutnya
              </Button>
            </div>
          )}
        </>
      )}

      {saleId !== null && (
        <div className="dialog-backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="receipt-modal-title">
            <div className="dialog__header">
              <h2 id="receipt-modal-title" className="dialog__title">Struk transaksi</h2>
              <Button
                variant="secondary"
                className="dialog__close"
                aria-label="Tutup struk"
                onClick={() => setSaleId(null)}
              >
                X
              </Button>
            </div>
            <ReceiptPanel
              key={saleId}
              dataSource={dataSource}
              saleId={saleId}
              onSessionExpired={onSessionExpired}
              autoLoad
            />
          </div>
        </div>
      )}
    </section>
  );
}
