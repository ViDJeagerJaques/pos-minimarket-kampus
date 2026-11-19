import { useCallback, useEffect, useId, useState } from "react";
import { ApiError } from "../api/errors";
import type {
  PosDataSource,
  ProductSummary,
  ReceiptResult,
  SessionUser,
  StockMovementEntry,
  SupplierSummary,
} from "../api/types";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { StatusMessage, type StatusTone } from "../components/StatusMessage";

interface ReceivingPageProps {
  dataSource: PosDataSource;
  currentUser: SessionUser;
  onSessionExpired: () => void;
}

type Status = { tone: StatusTone; text: string };
type DraftItem = { key: string; productId: number; quantity: number };
type HistoryRow = StockMovementEntry & { productName: string; sku: string };

const MAX_QUANTITY = 1_000_000;

function newReceiptKey(): string {
  const random =
    typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `rcv_${random}`;
}

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
 * Penerimaan barang ADMIN (TASK-025/027). Draft berupa niat di browser:
 * tombol "Batal draft" hanya membuang state dan TIDAK memanggil API, sehingga
 * tidak ada saldo yang berubah. Stok bertambah hanya setelah backend
 * mengembalikan ReceiptResult (satu transaksi + mutasi ledger + audit).
 */
export function ReceivingPage({ dataSource, currentUser, onSessionExpired }: ReceivingPageProps) {
  const [suppliers, setSuppliers] = useState<SupplierSummary[] | null>(null);
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [baseError, setBaseError] = useState<string | null>(null);

  const [supplierId, setSupplierId] = useState("");
  const [supplierRef, setSupplierRef] = useState("");
  const [productId, setProductId] = useState("");
  const [quantityInput, setQuantityInput] = useState("");
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [receiptKey, setReceiptKey] = useState(() => newReceiptKey());
  const [status, setStatus] = useState<Status | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [lastResult, setLastResult] = useState<ReceiptResult | null>(null);

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyKey, setHistoryKey] = useState(0);

  const supplierSelectId = useId();
  const supplierRefId = useId();
  const productSelectId = useId();
  const quantityId = useId();

  const handleActionError = useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof ApiError && error.isSessionExpired) {
        onSessionExpired();
        return;
      }
      setStatus({ tone: "danger", text: error instanceof ApiError ? error.message : fallback });
    },
    [onSessionExpired],
  );

  useEffect(() => {
    let isActive = true;
    Promise.all([dataSource.listSuppliers(), dataSource.listProducts()])
      .then(([supplierList, productList]) => {
        if (!isActive) return;
        setSuppliers(supplierList);
        setProducts(productList);
        setBaseError(null);
      })
      .catch((error: unknown) => {
        if (!isActive) return;
        if (error instanceof ApiError && error.isSessionExpired) {
          onSessionExpired();
          return;
        }
        setBaseError(error instanceof ApiError ? error.message : "Data master gagal dimuat.");
      });
    return () => {
      isActive = false;
    };
  }, [dataSource, onSessionExpired]);

  useEffect(() => {
    let isActive = true;
    setHistoryLoading(true);
    dataSource
      .getStockReport()
      .then((report) => {
        if (!isActive) return;
        const names = new Map(report.products.map((item) => [item.productId, item]));
        const rows: HistoryRow[] = [];
        for (const product of report.products) {
          for (const movement of product.movements) {
            if (movement.kind === "RECEIPT") {
              rows.push({ ...movement, productName: product.name, sku: names.get(product.productId)?.sku ?? product.sku });
            }
          }
        }
        rows.sort((left, right) => right.createdAtMs - left.createdAtMs);
        setHistory(rows);
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
    setDraftItems((current) => [
      ...current,
      { key: `${id}-${current.length}`, productId: id, quantity: parsed },
    ]);
    setProductId("");
    setQuantityInput("");
    setStatus(null);
  }

  function cancelDraft(): void {
    // Draf hanya state UI. Tidak ada pemanggilan API dan tidak ada mutasi stok.
    setSupplierId("");
    setSupplierRef("");
    setProductId("");
    setQuantityInput("");
    setDraftItems([]);
    setShowConfirm(false);
    setReceiptKey(newReceiptKey());
    setStatus({ tone: "info", text: "Draft dibatalkan. Tidak ada penerimaan atau perubahan stok." });
  }

  async function commitReceipt(): Promise<void> {
    if (isSubmitting) return;
    setShowConfirm(false);
    setIsSubmitting(true);
    try {
      const result = await dataSource.receiveGoods({
        receiptKey,
        supplierId: Number(supplierId),
        items: draftItems.map((item) => ({ productId: item.productId, quantity: item.quantity })),
        supplierRef: supplierRef.trim().length > 0 ? supplierRef.trim() : null,
      });
      setLastResult(result);
      // receiptKey lama sengaja dipertahankan pada error; setelah sukses dibuat yang baru.
      setSupplierId("");
      setSupplierRef("");
      setProductId("");
      setQuantityInput("");
      setDraftItems([]);
      setReceiptKey(newReceiptKey());
      setStatus({
        tone: result.duplicate ? "warning" : "success",
        text: result.duplicate
          ? `Penerimaan ${result.receiptKey} sudah tercatat sebelumnya; hasil lama dikembalikan tanpa mutasi tambahan.`
          : `Penerimaan ${result.receiptKey} tersimpan. Stok bertambah satu kali.`,
      });
      setHistoryKey((value) => value + 1);
    } catch (error) {
      handleActionError(error, "Penerimaan gagal disimpan. Draft dan receiptKey dipertahankan.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const isDemo = dataSource.authMode === "DEMO" || dataSource.catalogMode === "DEMO";
  const supplierName = suppliers?.find((item) => item.id === Number(supplierId))?.name ?? `#${supplierId}`;
  const canConfirm = supplierId !== "" && draftItems.length > 0 && !isSubmitting;

  return (
    <section className="panel" aria-labelledby="receiving-title" aria-busy={isSubmitting}>
      <h1 id="receiving-title" className="page-title">
        Penerimaan Barang <span className="chip chip--warning">ADMIN</span>
      </h1>
      <p className="muted">
        Masuk sebagai <strong>{currentUser.username}</strong>. Draft hanya ada di browser; tombol
        batal tidak memanggil backend dan tidak mengubah stok. Saldo bertambah hanya setelah
        konfirmasi tersimpan.
      </p>
      {isDemo && (
        <StatusMessage
          tone="warning"
          text="Mode DEMO: penerimaan tidak disimpan dan tidak mengubah stok. Angka pada riwayat bersifat sintetis."
        />
      )}
      {baseError && <p className="field-error" role="alert">{baseError}</p>}
      {status && <StatusMessage tone={status.tone} text={status.text} />}

      <div className="form-grid receiving-form">
        <div>
          <label htmlFor={supplierSelectId} className="field-label">Supplier</label>
          <select
            id={supplierSelectId}
            className="input"
            value={supplierId}
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
            onChange={(event) => setSupplierRef(event.target.value)}
            placeholder="Mis. SJ-001"
          />
        </div>
        <div>
          <label htmlFor={productSelectId} className="field-label">Produk</label>
          <select
            id={productSelectId}
            className="input"
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
          >
            <option value="">Pilih produk…</option>
            {(products ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.sku} — {item.name} (stok {item.stock})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={quantityId} className="field-label">Jumlah diterima</label>
          <input
            id={quantityId}
            className="input"
            type="text"
            inputMode="numeric"
            value={quantityInput}
            onChange={(event) => setQuantityInput(event.target.value)}
          />
        </div>
      </div>
      <div className="receiving-actions">
        <Button variant="secondary" disabled={isSubmitting} onClick={addItem}>Tambah ke draft</Button>
        <Button variant="secondary" disabled={isSubmitting} onClick={cancelDraft}>Batal draft</Button>
        <Button variant="primary" disabled={!canConfirm} onClick={() => setShowConfirm(true)}>
          Konfirmasi penerimaan
        </Button>
      </div>
      <p className="muted">
        Identitas upaya: <code>{receiptKey}</code>. Kunci yang sama dipakai ulang bila pengiriman
        gagal, agar penerimaan tidak tercatat dua kali.
      </p>

      <h2 className="section-title">Draft penerimaan (belum mengubah stok)</h2>
      {draftItems.length === 0 ? (
        <p className="muted">Belum ada item. Pilih produk dan jumlah lalu tambahkan ke draft.</p>
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
              {draftItems.map((item) => {
                const product = products?.find((entry) => entry.id === item.productId);
                return (
                  <tr key={item.key}>
                    <td>{product ? `${product.sku} — ${product.name}` : `#${item.productId}`}</td>
                    <td className="num">{item.quantity}</td>
                    <td>
                      <Button
                        variant="secondary"
                        disabled={isSubmitting}
                        onClick={() => setDraftItems((current) => current.filter((entry) => entry.key !== item.key))}
                      >
                        Hapus
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {lastResult && (
        <div className="receipt-panel" aria-label="Hasil penerimaan tersimpan">
          <h2 className="section-title">Hasil penerimaan tersimpan</h2>
          <p>
            <code>{lastResult.receiptKey}</code> · #{lastResult.receiptId} · supplier #{lastResult.supplierId} ·{" "}
            {lastResult.totalQuantity} unit · {formatTime(lastResult.committedAtMs)}
          </p>
          <p className="muted">Hash niat: <code>{lastResult.requestHash}</code></p>
          {lastResult.duplicate && (
            <p className="badge badge--warning" role="note">Retry identik — dokumen lama dikembalikan</p>
          )}
          <ul className="catalog-list">
            {lastResult.items.map((item) => (
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
      {!historyError && history.length === 0 && !historyLoading && (
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
          onConfirm={() => void commitReceipt()}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </section>
  );
}
