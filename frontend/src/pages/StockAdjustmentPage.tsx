import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/errors";
import type { AdjustmentInput, PosDataSource, ProductStockReport, SessionUser } from "../api/types";

type Props = { dataSource: PosDataSource; currentUser: SessionUser; onSessionExpired: () => void };
export function StockAdjustmentPage({ dataSource, currentUser, onSessionExpired }: Props) {
  const storageKey = `pos:adjustment:${currentUser.userId}`;
  const [products, setProducts] = useState<ProductStockReport[]>([]);
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
      if (typeof item.adjustmentKey !== "string" || !item.adjustmentKey || !Number.isSafeInteger(item.productId) || !Number.isSafeInteger(item.expectedOnHand) || !Number.isSafeInteger(item.targetOnHand) || typeof item.reason !== "string" || !item.reason.trim()) return { pending: null, blocked: true };
      return { pending: item as AdjustmentInput, blocked: false };
    } catch { return { pending: null, blocked: true }; }
  });
  const [pending, setPending] = useState<AdjustmentInput | null>(recovery.pending);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const product = products.find(item => item.productId === Number(selected));
  async function load() { const report = await dataSource.getStockReport(); setProducts(report.products); }
  useEffect(() => { let active = true; dataSource.getStockReport().then(report => { if (active) setProducts(report.products); }).catch(error => { if (!active) return; if (error instanceof ApiError && error.isSessionExpired) onSessionExpired(); else setMessage("Gagal memuat stok."); }); return () => { active = false; }; }, [dataSource, onSessionExpired]);
  function clearAttempt(attempt: AdjustmentInput) {
    const raw = localStorage.getItem(storageKey);
    if (raw && (JSON.parse(raw) as { adjustmentKey?: unknown }).adjustmentKey === attempt.adjustmentKey) {
      localStorage.removeItem(storageKey);
    }
    setPending(current => current?.adjustmentKey === attempt.adjustmentKey ? null : current);
  }
  async function submit(attempt: AdjustmentInput) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage("");
    try {
      const result = await dataSource.adjustStock(attempt);
      clearAttempt(attempt);
      setMessage(`Koreksi tersimpan. Stok ${result.previousOnHand} menjadi ${result.onHand}.`);
      try { await load(); } catch { setMessage(`Koreksi tersimpan. Stok ${result.previousOnHand} menjadi ${result.onHand}; muat ulang halaman untuk memperbarui daftar.`); }
    } catch (error) {
      if (error instanceof ApiError && error.isSessionExpired) onSessionExpired();
      else if (error instanceof ApiError && (error.code === "DEMO_UNSUPPORTED" || (error.status >= 400 && error.status < 500))) {
        clearAttempt(attempt); setMessage(error.message);
        if (error.status === 409 && error.code === "CONFLICT") {
          try { await load(); } catch { setMessage(`${error.message} Gagal memuat stok terbaru; buka ulang halaman sebelum mencoba lagi.`); setProducts([]); }
        }
      }
      else setMessage("Hasil belum pasti. Ulangi permintaan yang sama sebelum membuat koreksi baru.");
    } finally { lock.current = false; setBusy(false); }
  }
  function start() {
    if (lock.current || pending || recovery.blocked || !product || !/^\d+$/.test(target) || !Number.isSafeInteger(Number(target)) || !reason.trim()) return;
    const attempt = { adjustmentKey: `adjust_${crypto.randomUUID()}`, productId: product.productId, expectedOnHand: product.onHand, targetOnHand: Number(target), reason: reason.trim() };
    try { localStorage.setItem(storageKey, JSON.stringify(attempt)); setPending(attempt); void submit(attempt); }
    catch { setMessage("Catatan koreksi tidak dapat disimpan. Permintaan tidak dikirim."); }
  }
  return <section className="panel adjustment-form"><h1>Koreksi Stok</h1>{dataSource.authMode === "DEMO" && <p>DEMO — koreksi tidak tersimpan.</p>}<p>Masukkan target stok absolut dan alasan koreksi.</p>
    <div className="adjustment-form__field">
      <label htmlFor="adjust-product">Produk</label>
      <div className="adjustment-form__product-row">
        <select id="adjust-product" value={selected} disabled={busy || !!pending} onChange={e => setSelected(e.target.value)}><option value="">Pilih produk</option>{products.map(item => <option value={item.productId} key={item.productId}>{item.sku} — {item.name}</option>)}</select>
        {product && <p className="adjustment-form__stock-badge">Stok sekarang: {product.onHand}</p>}
      </div>
    </div>
    <div className="adjustment-form__field">
      <label htmlFor="adjust-target">Target stok</label>
      <input id="adjust-target" className="input" inputMode="numeric" value={target} disabled={busy || !!pending} onChange={e => setTarget(e.target.value)} />
    </div>
    <div className="adjustment-form__field">
      <label htmlFor="adjust-reason">Alasan</label>
      <input id="adjust-reason" className="input" value={reason} disabled={busy || !!pending} onChange={e => setReason(e.target.value)} />
    </div>
    <button type="button" disabled={busy || !!pending || recovery.blocked || !product || !/^\d+$/.test(target) || !reason.trim()} onClick={start}>Simpan koreksi</button>
    {recovery.blocked && <p role="alert">Catatan koreksi tidak dapat dibaca. Jangan membuat koreksi baru sebelum rekonsiliasi.</p>}
    {pending && <div><p>Upaya {pending.adjustmentKey} belum dipastikan. Produk #{pending.productId}, stok {pending.expectedOnHand} menjadi {pending.targetOnHand}.</p><button type="button" disabled={busy} onClick={() => void submit(pending)}>Ulangi permintaan yang sama</button></div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
