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
import {
  IconCheckCircle,
  IconHistory,
  IconPackage,
  IconPackageCheck,
  IconPlus,
  IconRefresh,
  IconRotateCcw,
  IconSearch,
  IconTrash,
} from "../components/AdminIcons";
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
type ReceivingTab = "new" | "history";
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
 * Penerimaan barang ADMIN (TASK-025/027). Draft berupa niat di klien;
 * tombol "Batal draft" untuk draft yang belum dikirim tidak memanggil API.
 * Setelah dikirim, receiptKey dan payload snapshot disimpan App: retry memakai
 * payload yang sama persis, sehingga tidak ada penerimaan ganda.
 */
export function ReceivingPage({
  dataSource,
  currentUser: _currentUser,
  onSessionExpired,
  attempt,
  onSubmitAttempt,
  onRetryAttempt,
  onClearAttempt,
}: ReceivingPageProps) {
  const [activeTab, setActiveTab] = useState<ReceivingTab>("new");
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

  function updateDraftItemQuantity(key: string, nextQty: number): void {
    if (attemptPending) return;
    if (!Number.isSafeInteger(nextQty) || nextQty < 1 || nextQty > MAX_QUANTITY) return;
    setDraftItems((current) =>
      current.map((entry) => (entry.key === key ? { ...entry, quantity: nextQty } : entry)),
    );
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
  const totalDraftUnits = draftItems.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <section className="admin-page" aria-labelledby="receiving-title" aria-busy={attempt?.status === "PENDING"}>
      <header className="admin-header">
        <div className="admin-header__titles">
          <h1 id="receiving-title" className="admin-header__title">
            Penerimaan Barang
          </h1>
          <p className="admin-header__subtitle">
            Catat barang masuk dari supplier ke persediaan lokal. Stok hanya bertambah setelah penerimaan dikonfirmasi.
          </p>
        </div>
      </header>

      {isDemo && (
        <StatusMessage
          tone="warning"
          text="Mode DEMO: penerimaan tidak disimpan dan tidak mengubah stok. Angka pada riwayat bersifat sintetis."
        />
      )}
      {baseError && (
        <p className="field-error" role="alert">
          {baseError}
        </p>
      )}
      {searchError && (
        <p className="field-error" role="alert">
          {searchError}
        </p>
      )}
      {status && <StatusMessage tone={status.tone} text={status.text} />}

      {/* Tab Internal Penerimaan */}
      <div className="admin-tabs" role="tablist" aria-label="Submenu Penerimaan">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "new"}
          className={activeTab === "new" ? "admin-tab admin-tab--active" : "admin-tab"}
          onClick={() => setActiveTab("new")}
        >
          <IconPackageCheck size={18} />
          <span>Penerimaan Baru</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "history"}
          className={activeTab === "history" ? "admin-tab admin-tab--active" : "admin-tab"}
          onClick={() => setActiveTab("history")}
        >
          <IconHistory size={18} />
          <span>Riwayat Penerimaan ({history.length})</span>
        </button>
      </div>

      {attemptPending && (
        <div className="admin-card" aria-label="Upaya penerimaan berjalan" style={{ borderLeft: "4px solid var(--color-warning)" }}>
          <h2 className="admin-card__title">Upaya penerimaan belum selesai</h2>
          <p style={{ margin: "8px 0" }}>
            <code>{attempt?.receiptKey}</code> ·{" "}
            {attempt?.status === "PENDING"
              ? "Menyimpan ke backend…"
              : "Hasil belum pasti — periksa ulang sebelum melanjutkan."}
          </p>
          {attempt?.error && (
            <p className="field-error" role="alert">
              {attempt.error}
            </p>
          )}
          <p className="muted" style={{ margin: "4px 0 12px" }}>
            Isi asli: {attempt?.payload.items.length} item, supplier #{attempt?.payload.supplierId}. Draft baru tidak dibuat sampai upaya ini selesai.
          </p>
          <Button variant="primary" disabled={attempt?.status === "PENDING"} onClick={onRetryAttempt}>
            <IconRefresh size={18} />
            <span>Periksa ulang dengan kunci yang sama</span>
          </Button>
        </div>
      )}

      {attempt?.status === "REJECTED" && (
        <div className="admin-card" aria-label="Penerimaan ditolak" style={{ borderLeft: "4px solid var(--color-danger)" }}>
          <h2 className="admin-card__title">Penerimaan ditolak — tidak ada penerimaan tersimpan</h2>
          {attempt.error && (
            <p className="field-error" role="alert">
              {attempt.error}
            </p>
          )}
          <p className="muted" style={{ margin: "6px 0 12px" }}>
            Tolakan ini bersifat pasti; tidak ada stok yang berubah. Koreksi draft lalu kirim kembali, atau batalkan draft.
          </p>
          <Button variant="secondary" onClick={onClearAttempt}>
            Tutup dan koreksi draft
          </Button>
        </div>
      )}

      {attempt?.status === "COMMITTED" && attempt.result && (
        <div className="admin-card" aria-label="Hasil penerimaan tersimpan" style={{ borderLeft: "4px solid var(--color-success)" }}>
          <div className="admin-card__header">
            <h2 className="admin-card__title">Hasil penerimaan tersimpan</h2>
            <Button variant="secondary" onClick={startNewDraft}>
              Draft baru
            </Button>
          </div>
          <p style={{ margin: "4px 0" }}>
            <code>{attempt.result.receiptKey}</code> · #{attempt.result.receiptId} · supplier #{attempt.result.supplierId} ·{" "}
            <strong>{attempt.result.totalQuantity} unit</strong> · {formatTime(attempt.result.committedAtMs)}
          </p>
          <p className="muted" style={{ margin: "4px 0", fontSize: "12px" }}>
            Hash niat: <code>{attempt.result.requestHash}</code>
          </p>
          {attempt.result.duplicate && (
            <p className="badge badge--warning" role="note">
              Retry identik — dokumen lama dikembalikan
            </p>
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

      {activeTab === "new" && (
        <div className="admin-split-40-60">
          {/* Kolom Kiri (40%): Input Supplier & Barang */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div className="admin-card">
              <div className="admin-card__header">
                <div>
                  <h2 className="admin-card__title">1. Informasi Pemasok</h2>
                  <p className="admin-card__desc">Pilih pemasok sumber barang masuk.</p>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <label htmlFor={supplierSelectId} className="field-label">
                    Supplier
                  </label>
                  <select
                    id={supplierSelectId}
                    className="input"
                    value={supplierId}
                    disabled={attemptPending}
                    onChange={(event) => setSupplierId(event.target.value)}
                  >
                    <option value="">Pilih supplier…</option>
                    {(suppliers ?? []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor={supplierRefId} className="field-label">
                    Referensi surat jalan (opsional)
                  </label>
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
              </div>
            </div>

            <div className="admin-card">
              <div className="admin-card__header">
                <div>
                  <h2 className="admin-card__title">2. Tambah Barang ke Draft</h2>
                  <p className="admin-card__desc">Cari produk aktif, isi jumlah unit diterima, lalu tambahkan.</p>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <label htmlFor={productSearchId} className="field-label">
                    Cari produk aktif
                  </label>
                  <div className="input-with-icon">
                    <span className="input-with-icon__prefix">
                      <IconSearch size={16} />
                    </span>
                    <input
                      id={productSearchId}
                      className="input input--pl"
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
                </div>

                <div>
                  <label htmlFor={productSelectId} className="field-label">
                    Produk
                  </label>
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
                    <p className="field-hint" role="note">
                      Hasil dibatasi {SEARCH_LIMIT} produk. Persempit pencarian bila produk yang dicari tidak muncul.
                    </p>
                  )}
                </div>

                <div className="search__row" style={{ alignItems: "flex-end" }}>
                  <div style={{ flex: 1 }}>
                    <label htmlFor={quantityId} className="field-label">
                      Jumlah diterima
                    </label>
                    <input
                      id={quantityId}
                      className="input"
                      type="text"
                      inputMode="numeric"
                      placeholder="Unit bulat positif"
                      value={quantityInput}
                      disabled={attemptPending}
                      onChange={(event) => setQuantityInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addItem();
                        }
                      }}
                    />
                  </div>
                  <Button variant="secondary" disabled={attemptPending} onClick={addItem}>
                    <IconPlus size={18} />
                    <span>Tambah ke draft</span>
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Kolom Kanan (60%): Draft Penerimaan */}
          <div className="admin-card">
            <div className="admin-card__header">
              <div>
                <h2 className="admin-card__title">Draft Penerimaan</h2>
                <p className="admin-card__desc">Periksa daftar barang dan kuantitas sebelum menyimpan ke stok.</p>
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <span className="badge">{draftItems.length} jenis barang</span>
                <span className="badge badge--ok">{totalDraftUnits} total unit</span>
              </div>
            </div>

            {draftItems.length === 0 ? (
              <div className="admin-empty">
                <span className="admin-empty__icon">
                  <IconPackage size={26} />
                </span>
                <p className="admin-empty__title">Draft penerimaan masih kosong</p>
                <p className="admin-empty__desc">
                  Pilih supplier di sebelah kiri, cari barang aktif, masukkan jumlah unit, lalu klik Tambah ke draft.
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table" aria-label="Draft penerimaan">
                  <thead>
                    <tr>
                      <th scope="col">Produk</th>
                      <th scope="col" className="num">
                        Jumlah
                      </th>
                      <th scope="col">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draftItems.map((item) => (
                      <tr key={item.key}>
                        <td>
                          <div className="cell-primary">{item.name}</div>
                          <div className="cell-sub">
                            <code>{item.sku}</code>
                          </div>
                        </td>
                        <td className="num">
                          <div className="qty" style={{ justifyContent: "flex-end" }}>
                            <Button
                              type="button"
                              variant="secondary"
                              className="btn--icon"
                              style={{ minHeight: "30px", minWidth: "30px", padding: "0 6px" }}
                              aria-label={`Kurangi jumlah ${item.sku}`}
                              disabled={attemptPending || item.quantity <= 1}
                              onClick={() => updateDraftItemQuantity(item.key, item.quantity - 1)}
                            >
                              -
                            </Button>
                            <span className="qty__value">{item.quantity}</span>
                            <Button
                              type="button"
                              variant="secondary"
                              className="btn--icon"
                              style={{ minHeight: "30px", minWidth: "30px", padding: "0 6px" }}
                              aria-label={`Tambah jumlah ${item.sku}`}
                              disabled={attemptPending || item.quantity >= MAX_QUANTITY}
                              onClick={() => updateDraftItemQuantity(item.key, item.quantity + 1)}
                            >
                              +
                            </Button>
                          </div>
                        </td>
                        <td>
                          <Button
                            variant="secondary"
                            className="btn--outline-danger"
                            style={{ minHeight: "32px", padding: "4px 10px", fontSize: "13px" }}
                            disabled={attemptPending}
                            onClick={() =>
                              setDraftItems((current) => current.filter((entry) => entry.key !== item.key))
                            }
                          >
                            <IconTrash size={14} />
                            <span>Hapus</span>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div
              style={{
                marginTop: "16px",
                paddingTop: "12px",
                borderTop: "1px solid var(--color-border)",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
              }}
            >
              <span className="muted" style={{ fontSize: "12px" }}>
                Kunci upaya: <code>{receiptKey}</code>
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                <Button variant="secondary" onClick={cancelDraft}>
                  <IconRotateCcw size={16} />
                  <span>Batal draft</span>
                </Button>
                <Button variant="primary" disabled={!canConfirm} onClick={() => setShowConfirm(true)}>
                  <IconCheckCircle size={18} />
                  <span>Konfirmasi penerimaan</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "history" && (
        <div className="admin-card">
          <div className="admin-card__header">
            <div>
              <h2 className="admin-card__title">Riwayat Penerimaan Tersimpan</h2>
              <p className="admin-card__desc">
                Diambil dari mutasi RECEIPT per barang pada laporan stok. Hanya penerimaan yang telah commit yang ditampilkan.
              </p>
            </div>
            <Button variant="secondary" disabled={historyLoading} onClick={() => setHistoryKey((value) => value + 1)}>
              <IconRefresh size={16} />
              <span>{historyLoading ? "Memuat…" : "Muat ulang"}</span>
            </Button>
          </div>

          {historyError && (
            <p className="field-error" role="alert">
              {historyError}
            </p>
          )}
          {historyTruncated && (
            <p className="muted" role="note">
              Riwayat menampilkan sebagian mutasi terbaru; total saldo dihitung backend dari seluruh mutasi.
            </p>
          )}
          {!historyError && history.length === 0 && !historyLoading && !historyTruncated && (
            <div className="admin-empty">
              <span className="admin-empty__icon">
                <IconHistory size={24} />
              </span>
              <p className="admin-empty__title">Belum ada mutasi penerimaan yang tersimpan.</p>
              <p className="admin-empty__desc">Penerimaan baru yang telah dikonfirmasi akan tercatat di sini.</p>
            </div>
          )}
          {!historyError && history.length > 0 && (
            <div className="table-wrap">
              <table className="table" aria-label="Riwayat penerimaan tersimpan">
                <thead>
                  <tr>
                    <th scope="col">Waktu</th>
                    <th scope="col">Produk</th>
                    <th scope="col">Referensi / Receipt Key</th>
                    <th scope="col" className="num">
                      Kuantitas
                    </th>
                    <th scope="col">Petugas</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.id}>
                      <td>{formatTime(row.createdAtMs)}</td>
                      <td>
                        <div className="cell-primary">{row.productName}</div>
                        <div className="cell-sub">
                          <code>{row.sku}</code>
                        </div>
                      </td>
                      <td>
                        <code>{row.sourceRef ?? "—"}</code>
                      </td>
                      <td className="num">
                        <strong>+{row.sourceQuantity ?? row.delta}</strong>
                      </td>
                      <td>Petugas #{row.actorId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showConfirm && (
        <ConfirmDialog
          title="Simpan penerimaan?"
          message={`Supplier: ${supplierName} · ${draftItems.length} jenis barang · Total ${totalDraftUnits} unit akan ditambahkan ke stok. Identitas upaya: ${receiptKey}.`}
          confirmLabel="Ya, simpan penerimaan"
          cancelLabel="Kembali ke draft"
          onConfirm={confirmReceipt}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </section>
  );
}
