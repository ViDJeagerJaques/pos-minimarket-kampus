import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/errors";
import type { AdjustmentInput, PosDataSource, ProductStockReport, SessionUser } from "../api/types";
import {
  IconArrowRight,
  IconCheckCircle,
  IconRefresh,
  IconRotateCcw,
  IconSearch,
  IconSliders,
} from "../components/AdminIcons";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Button } from "../components/Button";
import { StatusMessage } from "../components/StatusMessage";

type Props = { dataSource: PosDataSource; currentUser: SessionUser; onSessionExpired: () => void };

export function StockAdjustmentPage({ dataSource, currentUser, onSessionExpired }: Props) {
  const storageKey = `pos:adjustment:${currentUser.userId}`;
  const [products, setProducts] = useState<ProductStockReport[]>([]);
  const [filterText, setFilterText] = useState("");
  const [selected, setSelected] = useState("");
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [recovery] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return { pending: null, blocked: false };
      const value: unknown = JSON.parse(raw);
      if (typeof value !== "object" || value === null) return { pending: null, blocked: true };
      const item = value as Partial<AdjustmentInput>;
      if (
        typeof item.adjustmentKey !== "string" ||
        !item.adjustmentKey ||
        !Number.isSafeInteger(item.productId) ||
        !Number.isSafeInteger(item.expectedOnHand) ||
        !Number.isSafeInteger(item.targetOnHand) ||
        typeof item.reason !== "string" ||
        !item.reason.trim()
      ) {
        return { pending: null, blocked: true };
      }
      return { pending: item as AdjustmentInput, blocked: false };
    } catch {
      return { pending: null, blocked: true };
    }
  });
  const [pending, setPending] = useState<AdjustmentInput | null>(recovery.pending);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const lock = useRef(false);

  const product = products.find((item) => item.productId === Number(selected));
  const filteredProducts = products.filter((item) => {
    const q = filterText.trim().toLowerCase();
    if (!q) return true;
    if (item.productId === Number(selected)) return true;
    return item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q);
  });

  async function load() {
    const report = await dataSource.getStockReport();
    setProducts(report.products);
  }

  useEffect(() => {
    let active = true;
    dataSource
      .getStockReport()
      .then((report) => {
        if (active) setProducts(report.products);
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof ApiError && error.isSessionExpired) onSessionExpired();
        else setMessage("Gagal memuat stok.");
      });
    return () => {
      active = false;
    };
  }, [dataSource, onSessionExpired]);

  function clearAttempt(attempt: AdjustmentInput) {
    const raw = localStorage.getItem(storageKey);
    if (raw && (JSON.parse(raw) as { adjustmentKey?: unknown }).adjustmentKey === attempt.adjustmentKey) {
      localStorage.removeItem(storageKey);
    }
    setPending((current) => (current?.adjustmentKey === attempt.adjustmentKey ? null : current));
  }

  async function submit(attempt: AdjustmentInput) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await dataSource.adjustStock(attempt);
      clearAttempt(attempt);
      setMessage(`Koreksi tersimpan. Stok ${result.previousOnHand} menjadi ${result.onHand}.`);
      try {
        await load();
      } catch {
        setMessage(
          `Koreksi tersimpan. Stok ${result.previousOnHand} menjadi ${result.onHand}; muat ulang halaman untuk memperbarui daftar.`,
        );
      }
    } catch (error) {
      if (error instanceof ApiError && error.isSessionExpired) onSessionExpired();
      else if (
        error instanceof ApiError &&
        (error.code === "DEMO_UNSUPPORTED" || (error.status >= 400 && error.status < 500))
      ) {
        clearAttempt(attempt);
        setMessage(error.message);
        if (error.status === 409 && error.code === "CONFLICT") {
          try {
            await load();
          } catch {
            setMessage(`${error.message} Gagal memuat stok terbaru; buka ulang halaman sebelum mencoba lagi.`);
            setProducts([]);
          }
        }
      } else {
        setMessage("Hasil belum pasti. Ulangi permintaan yang sama sebelum membuat koreksi baru.");
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const parsedTarget =
    /^\d+$/.test(target.trim()) && Number.isSafeInteger(Number(target.trim()))
      ? Number(target.trim())
      : null;
  const delta = product && parsedTarget !== null ? parsedTarget - product.onHand : null;
  const isNoOp = delta === 0;

  function resetForm() {
    if (busy || pending) return;
    setSelected("");
    setTarget("");
    setReason("");
    setFilterText("");
    setMessage("");
  }

  function start() {
    if (
      lock.current ||
      pending ||
      recovery.blocked ||
      !product ||
      parsedTarget === null ||
      isNoOp ||
      !reason.trim()
    ) {
      return;
    }
    const attempt: AdjustmentInput = {
      adjustmentKey: `adjust_${crypto.randomUUID()}`,
      productId: product.productId,
      expectedOnHand: product.onHand,
      targetOnHand: parsedTarget,
      reason: reason.trim(),
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(attempt));
      setPending(attempt);
      void submit(attempt);
    } catch {
      setMessage("Catatan koreksi tidak dapat disimpan. Permintaan tidak dikirim.");
    }
  }

  return (
    <section className="admin-page" aria-labelledby="adjustment-title" aria-busy={busy}>
      <header className="admin-header">
        <div className="admin-header__titles">
          <h1 id="adjustment-title" className="admin-header__title">
            Koreksi Stok
          </h1>
          <p className="admin-header__subtitle">
            Sesuaikan saldo sistem dengan hasil hitung fisik (stok opname). Seluruh perubahan dicatat ke audit mutasi.
          </p>
        </div>
      </header>

      {dataSource.authMode === "DEMO" && (
        <StatusMessage
          tone="warning"
          text="DEMO — koreksi tidak tersimpan ke database operasional."
        />
      )}

      {recovery.blocked && (
        <p role="alert" className="field-error">
          Catatan koreksi tidak dapat dibaca. Jangan membuat koreksi baru sebelum rekonsiliasi.
        </p>
      )}

      {pending && (
        <div className="admin-card" style={{ borderLeft: "4px solid var(--color-warning)" }}>
          <h2 className="admin-card__title">Upaya Koreksi Belum Dipastikan</h2>
          <p style={{ margin: "6px 0 12px" }}>
            Upaya <code>{pending.adjustmentKey}</code> belum dipastikan. Produk #{pending.productId}, stok{" "}
            <strong>{pending.expectedOnHand}</strong> menjadi <strong>{pending.targetOnHand}</strong>.
          </p>
          <Button type="button" variant="primary" disabled={busy} onClick={() => void submit(pending)}>
            <IconRefresh size={18} />
            <span>Ulangi permintaan yang sama</span>
          </Button>
        </div>
      )}

      {message && (
        <p className="status status--info" role="status">
          {message}
        </p>
      )}

      <div className="admin-split-60-40">
        {/* Kolom Kiri (60%): Form Input Koreksi */}
        <div className="admin-card">
          <div className="admin-card__header">
            <div>
              <h2 className="admin-card__title">Input Hitung Fisik</h2>
              <p className="admin-card__desc">
                Masukkan jumlah akhir stok aktual (bukan selisih) beserta alasan wajib.
              </p>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {products.length > 8 && (
              <div>
                <label htmlFor="adjust-search" className="field-label">
                  Filter daftar barang
                </label>
                <div className="input-with-icon">
                  <span className="input-with-icon__prefix">
                    <IconSearch size={16} />
                  </span>
                  <input
                    id="adjust-search"
                    type="search"
                    className="input input--pl"
                    placeholder="Ketik SKU atau nama barang…"
                    value={filterText}
                    disabled={busy || !!pending}
                    onChange={(e) => setFilterText(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="adjustment-form__field">
              <label htmlFor="adjust-product" className="field-label">
                Produk
              </label>
              <div className="adjustment-form__product-row">
                <select
                  id="adjust-product"
                  className="input"
                  value={selected}
                  disabled={busy || !!pending}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">Pilih produk…</option>
                  {filteredProducts.map((item) => (
                    <option value={item.productId} key={item.productId}>
                      {item.sku} — {item.name}
                    </option>
                  ))}
                </select>
                {product && <p className="adjustment-form__stock-badge">Stok sekarang: {product.onHand}</p>}
              </div>
            </div>

            {product && (
              <div className="sync-card__meta-grid" style={{ padding: "10px 12px" }}>
                <div>
                  <span className="sync-card__kv-label">SKU</span>
                  <span className="sync-card__kv-value">
                    <code>{product.sku}</code>
                  </span>
                </div>
                <div>
                  <span className="sync-card__kv-label">Saldo Sistem</span>
                  <span className="sync-card__kv-value">{product.onHand} unit</span>
                </div>
                <div>
                  <span className="sync-card__kv-label">Masuk / Terjual</span>
                  <span className="sync-card__kv-value">
                    +{product.receipt} / -{product.sale}
                  </span>
                </div>
              </div>
            )}

            <div className="adjustment-form__field">
              <label htmlFor="adjust-target" className="field-label">
                Target stok
              </label>
              <input
                id="adjust-target"
                className="input"
                inputMode="numeric"
                placeholder="Contoh: 8 (jumlah fisik akhir, 0 valid)"
                value={target}
                disabled={busy || !!pending}
                onChange={(e) => setTarget(e.target.value)}
              />
              <span className="field-hint">
                Stok aktual fisik di rak/gudang. Selisih mutasi dihitung otomatis terhadap saldo sistem.
              </span>
            </div>

            <div className="adjustment-form__field">
              <label htmlFor="adjust-reason" className="field-label">
                Alasan
              </label>
              <input
                id="adjust-reason"
                className="input"
                maxLength={200}
                placeholder="Contoh: Hasil stok opname mingguan / kemasan rusak"
                value={reason}
                disabled={busy || !!pending}
                onChange={(e) => setReason(e.target.value)}
              />
              <span className="field-hint">Wajib diisi (1–200 karakter) untuk pencatatan pelaku dan audit.</span>
            </div>
          </div>
        </div>

        {/* Kolom Kanan (40%): Ringkasan & Konfirmasi Perubahan */}
        <div className="adjustment-preview" aria-label="Pratinjau perubahan stok">
          <div className="admin-card__header" style={{ marginBottom: 0 }}>
            <h2 className="admin-card__title">
              <IconSliders size={18} />
              <span>Pratinjau Koreksi</span>
            </h2>
          </div>

          <div className="adjustment-preview__flow">
            <div>
              <span className="sync-card__kv-label">Stok Sebelumnya</span>
              <div className="adjustment-preview__num">{product ? product.onHand : "—"}</div>
            </div>
            <IconArrowRight size={20} />
            <div>
              <span className="sync-card__kv-label">Stok Aktual</span>
              <div className="adjustment-preview__num">{parsedTarget !== null ? parsedTarget : "—"}</div>
            </div>
          </div>

          <div
            className={[
              "adjustment-delta",
              delta !== null && delta > 0 ? "adjustment-delta--positive" : "",
              delta !== null && delta < 0 ? "adjustment-delta--negative" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span>Selisih Mutasi</span>
            <span>
              {delta === null
                ? "—"
                : delta > 0
                  ? `+${delta} unit`
                  : delta < 0
                    ? `${delta} unit`
                    : "0 (Tidak berubah)"}
            </span>
          </div>

          <div style={{ fontSize: "13px", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
            {!product ? (
              <p style={{ margin: 0 }}>Pilih barang di sebelah kiri untuk melihat perhitungan selisih stok.</p>
            ) : parsedTarget === null ? (
              <p style={{ margin: 0 }}>
                Masukkan angka bulat non-negatif pada <strong>Target stok</strong> untuk menghitung selisih dari saldo{" "}
                <strong>{product.onHand}</strong> unit.
              </p>
            ) : isNoOp ? (
              <p style={{ margin: 0 }}>
                Stok aktual sama dengan saldo sistem ({product.onHand} unit). Simpan koreksi dinonaktifkan karena tidak ada perubahan.
              </p>
            ) : (
              <p style={{ margin: 0 }}>
                <strong>{product.name}</strong> (<code>{product.sku}</code>) akan disesuaikan dari{" "}
                <strong>{product.onHand}</strong> menjadi <strong>{parsedTarget}</strong> unit (
                {delta !== null && delta > 0 ? `bertambah +${delta}` : `berkurang ${delta}`} unit).
                {reason.trim() ? ` Alasan: "${reason.trim()}".` : " Isi alasan sebelum menyimpan."}
              </p>
            )}
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "flex-end",
              gap: "8px",
              paddingTop: "12px",
              borderTop: "1px solid var(--color-border)",
            }}
          >
            <Button type="button" variant="secondary" disabled={busy || !!pending} onClick={resetForm}>
              <IconRotateCcw size={16} />
              <span>Reset</span>
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={
                busy ||
                !!pending ||
                recovery.blocked ||
                !product ||
                parsedTarget === null ||
                isNoOp ||
                !reason.trim()
              }
              onClick={() => setConfirming(true)}
            >
              <IconCheckCircle size={18} />
              <span>Simpan koreksi</span>
            </Button>
          </div>
        </div>
      </div>
      {confirming && product && parsedTarget !== null && delta !== null && <ConfirmDialog title="Konfirmasi koreksi stok" message={`Barang: ${product.name}. Stok saat ini: ${product.onHand}. Stok setelah koreksi: ${parsedTarget}. Selisih: ${delta > 0 ? "+" : ""}${delta}. Alasan: ${reason.trim()}.`} confirmLabel="Ya, simpan koreksi" cancelLabel="Batal" onCancel={() => setConfirming(false)} onConfirm={() => { setConfirming(false); start(); }} />}
    </section>
  );
}
