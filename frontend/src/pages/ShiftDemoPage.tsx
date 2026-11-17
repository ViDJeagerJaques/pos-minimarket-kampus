import { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "../api/errors";
import type { PosDataSource, SessionUser, ShiftClosePreview, ShiftClosing, ShiftSummary } from "../api/types";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MoneyText } from "../components/MoneyText";
import { closePrefix, pendingClose, type PendingShiftClose } from "../domain/shiftCloseRecovery";

interface Props {
  dataSource: PosDataSource;
  currentUser: SessionUser;
  onSessionExpired: () => void;
  onPendingChange: (pending: boolean) => void;
}

export function ShiftDemoPage({ dataSource, currentUser, onSessionExpired, onPendingChange }: Props) {
  const [shift, setShift] = useState<ShiftSummary | null>(null);
  const [preview, setPreview] = useState<ShiftClosePreview | null>(null);
  const [pending, setPending] = useState<PendingShiftClose | null>(null);
  const [closing, setClosing] = useState<ShiftClosing | null>(null);
  const [cash, setCash] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(true);
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const cashId = useId();
  const owner = currentUser.role === "CASHIER" && dataSource.authMode !== "DEMO";
  const value = /^\d+$/.test(cash) ? Number(cash) : null;
  const valid = value !== null && Number.isSafeInteger(value) && value <= 1_000_000_000;

  function errorMessage(error: unknown) {
    if (error instanceof ApiError && error.isSessionExpired) { onSessionExpired(); return; }
    setMessage("Status penutupan belum dapat dipastikan. Cek kembali sebelum melanjutkan.");
  }
  function accept(result: ShiftClosing, attempt: PendingShiftClose) {
    if (result.shiftId !== attempt.shiftId || result.closeKey !== attempt.closeKey || result.closedBy !== currentUser.userId) {
      setMessage("Hasil penutupan berbeda dari upaya ini. Minta rekonsiliasi; jangan buat penutupan baru.");
      return;
    }
    try {
      localStorage.removeItem(`${closePrefix(currentUser.userId)}${attempt.closeKey}`);
      const remaining = pendingClose(currentUser.userId);
      setClosing(result);
      setPending(remaining?.value ?? null);
      onPendingChange(remaining !== null);
      setMessage(remaining ? "Masih ada upaya penutupan lain yang perlu diperiksa." : "Penutupan tersimpan. Shift berikutnya dapat dibuka di halaman Kasir.");
    } catch {
      setMessage("Hasil tersimpan, tetapi catatan pemulihan tidak dapat dibersihkan. Cek kembali sebelum melanjutkan.");
    }
  }
  async function check(attempt: PendingShiftClose) {
    setChecked(false);
    try { accept(await dataSource.getShiftClosing(attempt.shiftId), attempt); }
    catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setChecked(true);
        setMessage("Hasil belum ditemukan; penutupan mungkin masih berjalan. Cek lagi atau ulangi permintaan yang sama.");
      } else errorMessage(error);
    }
  }
  useEffect(() => {
    if (!owner) { setBusy(false); return; }
    let active = true;
    async function load() {
      try {
        let saved;
        try { saved = pendingClose(currentUser.userId); }
        catch (error) { if (active) onPendingChange(true); throw error; }
        if (saved) {
          if (active) { setPending(saved.value); onPendingChange(true); }
          if (active) await check(saved.value);
        } else {
          const activeShift = await dataSource.getCurrentShift();
          if (!active) return;
          if (activeShift && activeShift.cashierId === currentUser.userId) {
            const data = await dataSource.getShiftClosePreview(activeShift.id);
            if (!active) return;
            if (data.shiftId !== activeShift.id) throw new Error("Shift tidak cocok");
            setShift(activeShift); setPreview(data);
          } else { setMessage("Tidak ada shift aktif milik Anda. Buka shift melalui halaman Kasir."); }
        }
      } catch (error) { if (active) errorMessage(error); }
      finally { if (active) setBusy(false); }
    }
    void load();
    return () => { active = false; };
    // Status dan callbacks dipertahankan untuk satu mount halaman/sesi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, currentUser.userId, owner]);

  async function checkStatus() {
    if (!pending || lock.current) return;
    lock.current = true; setBusy(true);
    try { await check(pending); } finally { lock.current = false; setBusy(false); }
  }
  async function submit(attempt: PendingShiftClose) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setChecked(false);
    try { accept(await dataSource.closeShift(attempt.shiftId, { closeKey: attempt.closeKey, declaredCashRp: attempt.declaredCashRp }), attempt); }
    catch (error) {
      if (error instanceof ApiError && error.isSessionExpired) onSessionExpired();
      else await check(attempt);
    } finally { lock.current = false; setBusy(false); }
  }
  function start() {
    if (!shift || !valid || value === null || lock.current) return;
    setConfirming(false);
    try {
      const existing = pendingClose(currentUser.userId);
      if (existing) { setPending(existing.value); setChecked(false); onPendingChange(true); setMessage("Ada penutupan yang belum diperiksa. Cek statusnya."); return; }
      const attempt = { shiftId: shift.id, closeKey: `close_${crypto.randomUUID()}`, declaredCashRp: value };
      localStorage.setItem(`${closePrefix(currentUser.userId)}${attempt.closeKey}`, JSON.stringify(attempt));
      setPending(attempt); onPendingChange(true); void submit(attempt);
    } catch { onPendingChange(true); setMessage("Catatan upaya tidak dapat disimpan atau dibaca. Penutupan tidak dikirim; periksa penyimpanan lokal."); }
  }
  return <section className="panel" aria-labelledby="shift-title">
    <h1 id="shift-title">Penutupan shift</h1>
    <p role="note"><strong>DEMO:</strong> Rumus setoran masih fixture uji; SOP pengelola belum disahkan.</p>
    {!owner && <p>Penutupan hanya tersedia bagi kasir pemilik melalui backend lokal. Mode DEMO tidak menyimpan shift.</p>}
    {busy && <p role="status">Memeriksa shift…</p>}
    {message && <p role="status">{message}</p>}
    {preview && !pending && !closing && <>
      <h2>Pratinjau shift #{shift?.id}</h2>
      <table className="table" aria-label="Ringkasan shift"><tbody>
        <tr><th scope="row">Modal awal</th><td>{preview.openingCashRp === null ? "Tidak dicatat (fixture: 0)" : <MoneyText amountRp={preview.openingCashRp} />}</td></tr>
        <tr><th scope="row">Penjualan CASH</th><td><MoneyText amountRp={preview.cashTotalRp} /></td></tr>
        <tr><th scope="row">Penjualan QRIS</th><td><MoneyText amountRp={preview.qrisTotalRp} /></td></tr>
        <tr><th scope="row">Uang tunai harapan</th><td><MoneyText amountRp={preview.expectedCashRp} /></td></tr>
      </tbody></table>
      <p>Pratinjau dapat berubah jika penjualan tersimpan sebelum shift ditutup. QRIS tidak masuk kas tunai.</p>
      <label className="field-label" htmlFor={cashId}>Uang dihitung (Rp)</label>
      <input id={cashId} className="input" inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value)} />
      {cash !== "" && !valid && <p role="alert">Masukkan bilangan rupiah bulat dari 0 sampai 1.000.000.000.</p>}
      {valid && <p>Perkiraan selisih: <MoneyText amountRp={value - preview.expectedCashRp} /></p>}
      <Button variant="primary" disabled={!valid || busy} onClick={() => setConfirming(true)}>Tutup shift</Button>
    </>}
    {pending && <div><p>Upaya penutupan shift #{pending.shiftId}: <code>{pending.closeKey}</code>. Jangan membuat penutupan baru.</p>
      <Button disabled={busy} onClick={() => void checkStatus()}>Cek status penutupan</Button>{" "}
      {checked && <Button disabled={busy} onClick={() => void submit(pending)}>Ulangi permintaan yang sama</Button>}
    </div>}
    {closing && <div><h2>Penutupan tersimpan</h2><p>Shift #{closing.shiftId} · CASH <MoneyText amountRp={closing.totals.cashRp} /> · QRIS <MoneyText amountRp={closing.totals.qrisManualRp} /></p>
      <p>Uang harapan <MoneyText amountRp={closing.expectedCashRp} /> · selisih {closing.varianceRp === null ? "tidak dicatat" : <MoneyText amountRp={closing.varianceRp} />}</p></div>}
    {confirming && <ConfirmDialog title="Konfirmasi tutup shift" message="Tutup shift milik Anda dengan uang yang dihitung? Hasil akhir mengikuti transaksi tersimpan." confirmLabel="Ya, tutup shift" onCancel={() => setConfirming(false)} onConfirm={start} />}
  </section>;
}
