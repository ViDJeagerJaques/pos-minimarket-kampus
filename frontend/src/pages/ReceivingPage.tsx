import { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "../api/errors";
import type {
  PosDataSource,
  ProductSummary,
  ReceiveGoodsInput,
  SessionUser,
  StockMovementEntry,
  SupplierSummary,
} from "../api/types";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { StatusMessage, type StatusTone } from "../components/StatusMessage";
import {
  isUnresolvedReceipt,
  newReceiptKey,
  type ReceiptAttempt,
} from "../domain/receivingAttempt";

interface ReceivingPageProps {
  dataSource: PosDataSource;
  currentUser: SessionUser;
  onSessionExpired: () => void;
  /** Upaya dimiliki App; halaman hanya menampilkan dan memicu aksi. */
  attempt: ReceiptAttempt | null;
  onSubmitAttempt: (payload: ReceiveGoodsInput) => void;
  onRetryAttempt: () => void;
  onClearAttempt: () => void;
}

type Status = { tone: StatusTone; text: string };
type DraftItem = { key: string; productId: number; sku: string; name: string; quantity: number };
type HistoryRow = StockMovementEntry & { productName: string; sku: string };

const MAX_QUANTITY = 1_000_000;
const SEARCH_LIMIT = 50;

function formatTime(ms: number): string {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? "waktu tidak diketahui" : date.toLocaleString("id-ID");
}

function parseQuantity(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_QUANTITY ? value : null;
}

/**
 * Penerimaan barang ADMIN (TASK-025/027). Draft berupa niat di browser;
 * tombol "Batal draft" untuk draft yang belum dikirim tidak memanggil API.
 * Setelah dikirim, receiptKey dan payload snapshot disimpan App: retry memakai
 * payload yang sama persis, sehingga tidak ada penerimaan ganda.
 */
export function ReceivingPage({
  dataSource,
  currentUser,
  onSessionExpired,
  attempt,
  onSubmitAttempt,
  onRetryAttempt,
  onClearAttempt,
}: ReceivingPageProps) {
  const [suppliers, setSuppliers] = useState<SupplierSummary[] | null>(null);
  const [baseError, setBaseError] = useState<string | null>(null);

  const [supplierId, setSupplierId] = useState("");
  const [supplierRef, setSupplierRef] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [productId, setProductId] = useState("");
  const [quantityInput, setQuantityInput] = useState("");
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [receiptKey, setReceiptKey] = useState(() => newReceiptKey());
  const [status, setStatus] = useState<Status | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const [searchResults, setSearchResults] = useState<ProductSummary[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [productRefreshKey, setProductRefreshKey] = useState(0);
  const searchSeqRef = useRef(0);

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyTruncated, setHistoryTruncated] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyKey, setHistoryKey] = useState(0);

  const supplierSelectId = useId();
  const supplierRefId = useId();
  const productSearchId = useId();
  const productSelectId = useId();
  const quantityId = useId();

  const attemptPending = isUnresolvedReceipt(attempt);

  useEffect(() => {
    let isActive = true;
    dataSource
      .listSuppliers()
      .then((list) => {
        if (!isActive) return;
        setSuppliers(list);
        setBaseError(null);
      })
      .catch((error: unknown) => {
        if (!isActive) return;
        if (error instanceof ApiError && error.isSessionExpired) {
          onSessionExpired();
          return;
        }
        setBaseError(error instanceof ApiError ? error.message : "Daftar supplier gagal dimuat.");
      });
    return () => {
      isActive = false;
    };
  }, [dataSource, onSessionExpired]);

  // Pencarian memakai searchActiveProducts (bukan listProducts yang terpotong).
  useEffect(() => {
    let isActive = true;
    const seq = ++searchSeqRef.current;
    const timer = setTimeout(() => {
      dataSource
        .searchActiveProducts(productQuery.trim())
        .then((results) => {
          if (!isActive || seq !== searchSeqRef.current) return;
          setSearchResults(results);
          setSearchError(null);
        })
        .catch((error: unknown) => {
          if (!isActive || seq !== searchSeqRef.current) return;
          if (error instanceof ApiError && error.isSessionExpired) {
            onSessionExpired();
            return;
          }
          setSearchError(error instanceof ApiError ? error.message : "Pencarian produk gagal.");
        });
    }, 200);
    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [dataSource, productQuery, onSessionExpired, productRefreshKey]);

  useEffect(() => {
    let isActive = true;
    setHistoryLoading(true);
    dataSource
      .getStockReport()
      .then((report) => {
        if (!isActive) return;
        const rows: HistoryRow[] = [];
        for (const product of report.products) {
          for (const movement of product.movements) {
            if (movement.kind === "RECEIPT") {
              rows.push({ ...movement, productName: product.name, sku: product.sku });
            }
          }
        }
        rows.sort((left, right) => right.createdAtMs - left.createdAtMs);
        setHistory(rows);
        setHistoryTruncated(report.products.some((product) => product.movementsTruncated));
        setHistoryError(null);
      })
      .catch((error: unknown) => {
        if (!isActive) return;
        if (error instanceof ApiError && error.isSessionExpired) {
          onSessionExpired();
          return;
        }
        setHistoryError(error instanceof ApiError ? error.message : "Riwayat penerimaan gagal dimuat.");
      })
      .finally(() => {
        if (isActive) setHistoryLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [dataSource, onSessionExpired, historyKey]);

  // Upaya COMMITTED: segarkan saldo produk dan riwayat, lalu siapkan draft baru.
  const committedKey = attempt?.status === "COMMITTED" ? attempt.result?.receiptKey : null;
  useEffect(() => {
    if (!committedKey) return;
    setProductRefreshKey((value) => value + 1);
    setHistoryKey((value) => value + 1);
    setSupplierId("");
    setSupplierRef("");
    setProductQuery("");
    setProductId("");
    setQuantityInput("");
    setDraftItems([]);
    setReceiptKey(newReceiptKey());
    setStatus({
      tone: attempt?.result?.duplicate ? "warning" : "success",
      text: attempt?.result?.duplicate
        ? `Penerimaan ${committedKey} sudah tercatat sebelumnya; hasil lama dikembalikan tanpa mutasi tambahan.`
        : `Penerimaan ${committedKey} tersimpan. Saldo produk telah dimuat ulang dari backend.`,
    });
    // Hanya bereaksi saat kunci hasil berubah, bukan setiap render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedKey]);

  function clearLocalDraft(): void {
    setSupplierId("");
    setSupplierRef("");
    setProductQuery("");
    setProductId("");
    setQuantityInput("");
    setDraftItems([]);
    setReceiptKey(newReceiptKey());
  }

  function addItem(): void {
    const parsed = parseQuantity(quantityInput);
    const id = Number(productId);
    if (!Number.isSafeInteger(id) || id <= 0 || parsed === null) {
      setStatus({ tone: "warning", text: "Pilih produk dan jumlah 1–1.000.000 yang valid." });
      return;
    }
    if (draftItems.some((item) => item.productId === id)) {
      setStatus({ tone: "warning", text: "Produk ini sudah ada di draft. Ubah jumlahnya atau hapus dulu." });
      return;
    }
    const selected = searchResults?.find((item) => item.id === id);
    setDraftItems((current) => [
      ...current,
      {
        key: `${id}-${current.length}`,
        productId: id,
        sku: selected?.sku ?? `#${id}`,
        name: selected?.name ?? "Produk",
        quantity: parsed,
      },
    ]);
    setProductId("");
    setQuantityInput("");
    setStatus(null);
  }

  function cancelDraft(): void {
    if (attemptPending) {
      setStatus({
        tone: "warning",
        text: `Upaya ${attempt?.receiptKey} masih diproses atau hasilnya belum pasti. Periksa ulang dengan receiptKey dan payload yang sama sebelum membatalkan.`,
      });
      return;
    }
    clearLocalDraft();
    if (attempt?.status === "COMMITTED" || attempt?.status === "REJECTED") onClearAttempt();
    setStatus({ tone: "info", text: "Draft dibatalkan. Tidak ada penerimaan atau perubahan stok." });
  }

  function confirmReceipt(): void {
    if (attemptPending) return;
    setShowConfirm(false);
    const payload: ReceiveGoodsInput = {
      receiptKey,
      supplierId: Number(supplierId),
      items: draftItems.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      supplierRef: supplierRef.trim().length > 0 ? supplierRef.trim() : null,
    };
    onSubmitAttempt(payload);
  }

  function startNewDraft(): void {
    onClearAttempt();
    clearLocalDraft();
    setStatus({ tone: "info", text: "Draft baru siap. Tidak ada transaksi yang dibuat." });
  }

  const isDemo = dataSource.authMode === "DEMO" || dataSource.catalogMode === "DEMO";
  const supplierName = suppliers?.find((item) => item.id === Number(supplierId))?.name ?? `#${supplierId}`;
  const canConfirm = supplierId !== "" && draftItems.length > 0 && !attemptPending;

  return (
    <section className="panel" aria-labelledby="receiving-title" aria-busy={attempt?.status === "PENDING"}>
      <h1 id="receiving-title" className="page-title">
        Penerimaan Barang <span className="chip chip--warning">ADMIN</span>
      </h1>
      <p className="muted">
        Masuk sebagai <strong>{currentUser.username}</strong>. Draft yang belum dikirim dapat
        dibatalkan tanpa API. Setelah dikirim, receiptKey dan isi penerimaan dipertahankan sampai
        hasilnya pasti; retry memakai payload yang sama persis.
      </p>
      {isDemo && (
        <StatusMessage
          tone="warning"
          text="Mode DEMO: penerimaan tidak disimpan dan tidak mengubah stok. Angka pada riwayat bersifat sintetis."
        />
      )}
      {baseError && <p className="field-error" role="alert">{baseError}</p>}
      {searchError && <p className="field-error" role="alert">{searchError}</p>}
      {status && <StatusMessage tone={status.tone} text={status.text} />}

      {attemptPending && (
        <div className="receipt-panel" aria-label="Upaya penerimaan berjalan">
          <h2 className="section-title">Upaya penerimaan belum selesai</h2>
          <p>
            <code>{attempt?.receiptKey}</code> · {attempt?.status === "PENDING"
              ? "Menyimpan ke backend…"
              : "Hasil belum pasti — periksa ulang sebelum melanjutkan."}
          </p>
          {attempt?.error && <p className="field-error" role="alert">{attempt.error}</p>}
          <p className="muted">
            Isi asli: {attempt?.payload.items.length} item, supplier #{attempt?.payload.supplierId}.
            Draft baru tidak dibuat sampai upaya ini selesai.
          </p>
          <Button variant="primary" disabled={attempt?.status === "PENDING"} onClick={onRetryAttempt}>
            Periksa ulang dengan kunci yang sama
          </Button>
        </div>
      )}

      {attempt?.status === "REJECTED" && (
        <div className="receipt-panel" aria-label="Penerimaan ditolak">
          <h2 className="section-title">Penerimaan ditolak — tidak ada penerimaan tersimpan</h2>
          {attempt.error && <p className="field-error" role="alert">{attempt.error}</p>}
          <p className="muted">
            Tolakan ini bersifat pasti; tidak ada stok yang berubah. Koreksi draft lalu kirim
            kembali, atau batalkan draft.
          </p>
          <Button variant="secondary" onClick={onClearAttempt}>
            Tutup dan koreksi draft
          </Button>
        </div>
      )}

      <div className="form-grid receiving-form">
        <div>
          <label htmlFor={supplierSelectId} className="field-label">Supplier</label>
          <select
            id={supplierSelectId}
            className="input"
            value={supplierId}
            disabled={attemptPending}
            onChange={(event) => setSupplierId(event.target.value)}
          >
            <option value="">Pilih supplier…</option>
            {(suppliers ?? []).map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={supplierRefId} className="field-label">Referensi surat jalan (opsional)</label>
          <input
            id={supplierRefId}
            className="input"
            type="text"
            maxLength={120}
            value={supplierRef}
            disabled={attemptPending}
            onChange={(event) => setSupplierRef(event.target.value)}
            placeholder="Mis. SJ-001"
          />
        </div>
        <div>
          <label htmlFor={productSearchId} className="field-label">Cari produk aktif</label>
          <input
            id={productSearchId}
            className="input"
            type="text"
            value={productQuery}
            disabled={attemptPending}
            onChange={(event) => {
              setProductQuery(event.target.value);
              setProductId("");
            }}
            placeholder="Nama atau SKU"
          />
        </div>
        <div>
          <label htmlFor={productSelectId} className="field-label">Produk</label>
          <select
            id={productSelectId}
            className="input"
            value={productId}
            disabled={attemptPending}
            onChange={(event) => setProductId(event.target.value)}
          >
            <option value="">Pilih produk…</option>
            {(searchResults ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.sku} — {item.name} (stok {item.stock})
              </option>
            ))}
          </select>
          {searchResults !== null && searchResults.length >= SEARCH_LIMIT && (
            <p className="muted" role="note">
              Hasil dibatasi {SEARCH_LIMIT} produk. Persempit pencarian bila produk yang dicari tidak muncul.
            </p>
          )}
        </div>
        <div>
          <label htmlFor={quantityId} className="field-label">Jumlah diterima</label>
          <input
            id={quantityId}
            className="input"
            type="text"
            inputMode="numeric"
            value={quantityInput}
            disabled={attemptPending}
            onChange={(event) => setQuantityInput(event.target.value)}
          />
        </div>
      </div>
      <div className="receiving-actions">
        <Button variant="secondary" disabled={attemptPending} onClick={addItem}>Tambah ke draft</Button>
        <Button variant="secondary" onClick={cancelDraft}>Batal draft</Button>
        <Button variant="primary" disabled={!canConfirm} onClick={() => setShowConfirm(true)}>
          Konfirmasi penerimaan
        </Button>
        {attempt?.status === "COMMITTED" && (
          <Button variant="secondary" onClick={startNewDraft}>Draft baru</Button>
        )}
      </div>
      <p className="muted">
        Identitas upaya draft: <code>{receiptKey}</code>. Kunci ini dipakai sebagai identitas saat
        konfirmasi dan dipertahankan bila hasil belum pasti.
      </p>

      <h2 className="section-title">Draft penerimaan (belum mengubah stok)</h2>
      {draftItems.length === 0 ? (
        <p className="muted">Belum ada item. Cari produk, lalu tambahkan ke draft.</p>
      ) : (
        <div className="table-wrap">
          <table className="table" aria-label="Draft penerimaan">
            <thead>
              <tr>
                <th scope="col">Produk</th>
                <th scope="col" className="num">Jumlah</th>
                <th scope="col">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {draftItems.map((item) => (
                <tr key={item.key}>
                  <td>{item.sku} — {item.name}</td>
                  <td className="num">{item.quantity}</td>
                  <td>
                    <Button
                      variant="secondary"
                      disabled={attemptPending}
                      onClick={() => setDraftItems((current) => current.filter((entry) => entry.key !== item.key))}
                    >
                      Hapus
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {attempt?.status === "COMMITTED" && attempt.result && (
        <div className="receipt-panel" aria-label="Hasil penerimaan tersimpan">
          <h2 className="section-title">Hasil penerimaan tersimpan</h2>
          <p>
            <code>{attempt.result.receiptKey}</code> · #{attempt.result.receiptId} · supplier #{attempt.result.supplierId} ·{" "}
            {attempt.result.totalQuantity} unit · {formatTime(attempt.result.committedAtMs)}
          </p>
          <p className="muted">Hash niat: <code>{attempt.result.requestHash}</code></p>
          {attempt.result.duplicate && (
            <p className="badge badge--warning" role="note">Retry identik — dokumen lama dikembalikan</p>
          )}
          <ul className="catalog-list">
            {attempt.result.items.map((item) => (
              <li key={item.receiptItemId}>
                {item.sku} — {item.name}: {item.quantity} unit (mutasi #{item.movementId})
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2 className="section-title">Riwayat penerimaan tersimpan</h2>
      <p className="muted">
        Diambil dari mutasi RECEIPT pada laporan stok. Backend belum memiliki endpoint daftar
        penerimaan terpisah, sehingga hanya mutasi yang benar-benar tersimpan yang ditampilkan.
      </p>
      <div className="report-toolbar">
        <Button variant="secondary" disabled={historyLoading} onClick={() => setHistoryKey((value) => value + 1)}>
          {historyLoading ? "Memuat…" : "Muat ulang"}
        </Button>
      </div>
      {historyError && <p className="field-error" role="alert">{historyError}</p>}
      {historyTruncated && (
        <p className="muted" role="note">
          Riwayat menampilkan sebagian mutasi terbaru; total saldo dihitung backend dari seluruh mutasi.
        </p>
      )}
      {!historyError && history.length === 0 && !historyLoading && !historyTruncated && (
        <p className="muted">Belum ada mutasi penerimaan yang tersimpan.</p>
      )}
      {!historyError && history.length > 0 && (
        <div className="table-wrap">
          <table className="table" aria-label="Riwayat penerimaan tersimpan">
            <thead>
              <tr>
                <th scope="col">Waktu</th>
                <th scope="col">Produk</th>
                <th scope="col">Receipt key</th>
                <th scope="col" className="num">Jumlah</th>
                <th scope="col">Petugas</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id}>
                  <td>{formatTime(row.createdAtMs)}</td>
                  <td>{row.sku} — {row.productName}</td>
                  <td><code>{row.sourceRef ?? "—"}</code></td>
                  <td className="num">{row.sourceQuantity ?? row.delta}</td>
                  <td>#{row.actorId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showConfirm && (
        <ConfirmDialog
          title="Simpan penerimaan?"
          message={`${draftItems.length} item dari ${supplierName} akan menambah stok. Draft dibatalkan setelah konfirmasi; receiptKey ${receiptKey} dipakai sebagai identitas upaya.`}
          confirmLabel="Ya, simpan penerimaan"
          cancelLabel="Kembali ke draft"
          onConfirm={confirmReceipt}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </section>
  );
}
