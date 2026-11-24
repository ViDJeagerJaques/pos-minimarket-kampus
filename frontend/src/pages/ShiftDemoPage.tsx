import { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "../api/errors";
import type { PaymentReport, PosDataSource, SessionUser, ShiftClosePreview, ShiftClosing, ShiftSummary } from "../api/types";
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
  const [paymentReport, setPaymentReport] = useState<PaymentReport | null>(null);
  const [paymentError, setPaymentError] = useState("");
  const [shift, setShift] = useState<ShiftSummary | null>(null);
  const [preview, setPreview] = useState<ShiftClosePreview | null>(null);
  const [pending, setPending] = useState<PendingShiftClose | null>(null);
  const [closing, setClosing] = useState<ShiftClosing | null>(null);
  const [cash, setCash] = useState("");
  const [varianceNote, setVarianceNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(true);
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const cashId = useId();
  const noteId = useId();
  const owner = currentUser.role === "CASHIER" && dataSource.authMode !== "DEMO";
  const value = /^\d+$/.test(cash) ? Number(cash) : null;
  const valid = value !== null && Number.isSafeInteger(value) && value <= 1_000_000_000;
  const estimatedVariance = valid && preview ? value - preview.expectedCashRp : null;
  const needsNote = estimatedVariance !== null && estimatedVariance !== 0;
  const trimmedNote = varianceNote.trim();
  const noteValid = !needsNote || (trimmedNote.length > 0 && trimmedNote.length <= 500);
  const canClose = valid && noteValid;

  function varianceClass(variance: number): string {
    if (variance < 0) return "variance--negative";
    if (variance > 0) return "variance--positive";
    return "";
  }
  function formatSignedRp(amount: number): string {
    const abs = Math.abs(amount).toLocaleString("id-ID");
    if (amount < 0) return `-Rp${abs}`;
    if (amount > 0) return `+Rp${abs}`;
    return "Rp0";
  }

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
  async function check(attempt: PendingShiftClose, rejectedMessage?: string) {
    setChecked(false);
    try { accept(await dataSource.getShiftClosing(attempt.shiftId), attempt); }
    catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        if (rejectedMessage) {
          try {
            localStorage.removeItem(`${closePrefix(currentUser.userId)}${attempt.closeKey}`);
            const remaining = pendingClose(currentUser.userId);
            setPending(remaining?.value ?? null);
            onPendingChange(remaining !== null);
            if (!remaining) {
              try {
                const activeShift = await dataSource.getCurrentShift();
                if (activeShift && activeShift.cashierId === currentUser.userId && activeShift.id === attempt.shiftId) {
                  const fresh = await dataSource.getShiftClosePreview(activeShift.id);
                  if (fresh.shiftId === activeShift.id) {
                    setShift(activeShift);
                    setPreview(fresh);
                  }
                }
              } catch (previewError) {
                if (previewError instanceof ApiError && previewError.isSessionExpired) {
                  onSessionExpired();
                  return;
                }
              }
            }
            setMessage(rejectedMessage);
          } catch {
            setChecked(true);
            setMessage("Penutupan ditolak, tetapi catatan lokal tidak dapat dibersihkan. Cek kembali sebelum melanjutkan.");
          }
          return;
        }
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

  useEffect(() => {
    if (currentUser.role !== "CASHIER") return;
    let active = true;
    dataSource.getPaymentReport().then(report => { if (active) setPaymentReport(report); }).catch(error => {
      if (!active) return;
      if (error instanceof ApiError && error.isSessionExpired) onSessionExpired();
      else setPaymentError("Rincian QRIS tidak dapat dimuat.");
    });
    return () => { active = false; };
  }, [dataSource, currentUser.userId, currentUser.role, onSessionExpired]);

  async function reloadPreview() {
    if (!shift || pending || closing || lock.current) return;
    lock.current = true; setBusy(true); setMessage("");
    try {
      const result = await dataSource.getShiftClosePreview(shift.id);
      if (result.shiftId !== shift.id) throw new Error("Shift tidak cocok");
      setPreview(result);
    } catch (error) {
      if (error instanceof ApiError && error.isSessionExpired) onSessionExpired();
      else setMessage("Pratinjau gagal dimuat ulang. Angka sebelumnya masih ditampilkan.");
    } finally { lock.current = false; setBusy(false); }
  }
  async function checkStatus() {
    if (!pending || lock.current) return;
    lock.current = true; setBusy(true);
    try { await check(pending); } finally { lock.current = false; setBusy(false); }
  }
  async function submit(attempt: PendingShiftClose) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setChecked(false);
    try {
      const payload = {
        closeKey: attempt.closeKey,
        declaredCashRp: attempt.declaredCashRp,
        ...(attempt.varianceNote ? { varianceNote: attempt.varianceNote } : {}),
      };
      accept(await dataSource.closeShift(attempt.shiftId, payload), attempt);
    }
    catch (error) {
      if (error instanceof ApiError && error.isSessionExpired) onSessionExpired();
      else if (error instanceof ApiError && error.status === 422 && error.code === "VALIDATION_ERROR") {
        await check(attempt, error.message);
      } else await check(attempt);
    } finally { lock.current = false; setBusy(false); }
  }
  function start() {
    if (!shift || !canClose || value === null || lock.current) return;
    setConfirming(false);
    try {
      const existing = pendingClose(currentUser.userId);
      if (existing) { setPending(existing.value); setChecked(false); onPendingChange(true); setMessage("Ada penutupan yang belum diperiksa. Cek statusnya."); return; }
      const attempt: PendingShiftClose = {
        shiftId: shift.id,
        closeKey: `close_${crypto.randomUUID()}`,
        declaredCashRp: value,
        ...(needsNote ? { varianceNote: trimmedNote } : {}),
      };
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
      <Button disabled={busy || confirming} onClick={() => void reloadPreview()}>Muat ulang pratinjau</Button>
      <table className="table" aria-label="Ringkasan shift"><tbody>
        <tr><th scope="row">Modal awal</th><td>{preview.openingCashRp === null ? "Tidak dicatat (fixture: 0)" : <MoneyText amountRp={preview.openingCashRp} />}</td></tr>
        <tr><th scope="row">Penjualan CASH</th><td><MoneyText amountRp={preview.cashTotalRp} /></td></tr>
        <tr><th scope="row">Penjualan QRIS</th><td><MoneyText amountRp={preview.qrisTotalRp} /></td></tr>
        <tr><th scope="row">Total penghasilan (CASH + QRIS)</th><td><MoneyText amountRp={preview.cashTotalRp + preview.qrisTotalRp} /></td></tr>
        <tr><th scope="row">Uang tunai harapan</th><td><MoneyText amountRp={preview.expectedCashRp} /></td></tr>
      </tbody></table>
      <p>Pratinjau dapat berubah jika penjualan tersimpan sebelum shift ditutup. QRIS tidak masuk kas tunai.</p>
      <div className="shift-close-box">
        <div className="shift-close-row">
          <div className="shift-close-field">
            <label className="field-label" htmlFor={cashId}>Uang dihitung (Rp)</label>
            <input id={cashId} className="input" inputMode="numeric" value={cash.replace(/\B(?=(\d{3})+(?!\d))/g, ".")} onChange={(e) => setCash(e.target.value.replace(/\./g, ""))} />
          </div>
          <Button variant="primary" className="shift-close-submit" disabled={!canClose || busy} onClick={() => setConfirming(true)}>Tutup shift</Button>
        </div>
        {cash !== "" && !valid && <p role="alert">Masukkan bilangan rupiah bulat dari 0 sampai 1.000.000.000.</p>}
        {estimatedVariance !== null && (
          <p>
            Perkiraan selisih:{" "}
            <span className={varianceClass(estimatedVariance)}>
              {estimatedVariance > 0 ? "+" : ""}
              <MoneyText amountRp={estimatedVariance} />
            </span>
          </p>
        )}
        {needsNote && (
          <div className="shift-close-note">
            <label className="field-label" htmlFor={noteId}>Catatan/Alasan Selisih</label>
            <input
              id={noteId}
              className="input"
              type="text"
              maxLength={500}
              placeholder="Jelaskan alasan selisih kas"
              value={varianceNote}
              onChange={(e) => setVarianceNote(e.target.value)}
              required
            />
            {trimmedNote.length === 0 && (
              <p className="muted">Wajib diisi sebelum menutup shift karena selisih bukan Rp0.</p>
            )}
          </div>
        )}
        {estimatedVariance !== null && preview.qrisTotalRp > 0 && estimatedVariance !== 0 && Math.abs(estimatedVariance) === preview.qrisTotalRp && (
          <p className="muted" role="note">
            Petunjuk rekonsiliasi: selisih kas sama persis dengan total QRIS (<MoneyText amountRp={preview.qrisTotalRp} />). Periksa apakah ada transaksi QRIS yang salah dicatat sebagai Tunai atau sebaliknya.
          </p>
        )}
      </div>
    </>}
    {pending && <div><p>Upaya penutupan shift #{pending.shiftId}: <code>{pending.closeKey}</code>. Jangan membuat penutupan baru.</p>
      <Button disabled={busy} onClick={() => void checkStatus()}>Cek status penutupan</Button>{" "}
      {checked && <Button disabled={busy} onClick={() => void submit(pending)}>Ulangi permintaan yang sama</Button>}
    </div>}
    {closing && <div><h2>Penutupan tersimpan</h2><p>Shift #{closing.shiftId} · CASH <MoneyText amountRp={closing.totals.cashRp} /> · QRIS <MoneyText amountRp={closing.totals.qrisManualRp} /></p>
      <p>Total penghasilan (CASH + QRIS): <MoneyText amountRp={closing.totals.cashRp + closing.totals.qrisManualRp} /></p>
      <p>
        Uang harapan <MoneyText amountRp={closing.expectedCashRp} /> · selisih{" "}
        {closing.varianceRp === null ? (
          "tidak dicatat"
        ) : (
          <span className={varianceClass(closing.varianceRp)}>
            {closing.varianceRp > 0 ? "+" : ""}
            <MoneyText amountRp={closing.varianceRp} />
          </span>
        )}
      </p>
      {closing.varianceNote && <p>Catatan selisih: <strong>{closing.varianceNote}</strong></p>}
      {closing.totals.qrisManualRp > 0 && closing.varianceRp !== null && closing.varianceRp !== 0 && Math.abs(closing.varianceRp) === closing.totals.qrisManualRp && (
        <p className="muted" role="note">
          Petunjuk rekonsiliasi: selisih kas sama persis dengan total QRIS (<MoneyText amountRp={closing.totals.qrisManualRp} />). Periksa kemungkinan salah klasifikasi Tunai/QRIS.
        </p>
      )}</div>}
    {currentUser.role === "CASHIER" && <section aria-label="Rincian QRIS terverifikasi">
      <h2>Rincian QRIS terverifikasi</h2>
      {dataSource.authMode === "DEMO" && <p>DEMO — data sintetis.</p>}
      {paymentError && <p role="alert">{paymentError}</p>}
      {paymentReport && <><p>Total QRIS: <MoneyText amountRp={paymentReport.qrisManual.totalRp} /> · {paymentReport.qrisManual.verifiedCount} terverifikasi</p>
        {paymentReport.qrisSales.length < paymentReport.qrisManual.verifiedCount && <p>Menampilkan {paymentReport.qrisSales.length} dari {paymentReport.qrisManual.verifiedCount} transaksi terverifikasi.</p>}
        {paymentReport.qrisSales.length === 0 ? <p>Belum ada transaksi QRIS terverifikasi.</p> : <div className="table-wrap"><table className="table" aria-label="Rincian QRIS terverifikasi"><thead><tr><th>No. penjualan</th><th>Waktu</th><th>Kasir verifikasi</th><th>Referensi bukti</th><th>Status</th><th>Total</th></tr></thead><tbody>
        {paymentReport.qrisSales.map(sale => <tr key={sale.saleId}><td>{sale.saleNo}</td><td>{new Date(sale.verifiedAtMs).toLocaleString("id-ID")}</td><td>{sale.cashierUsername ?? `#${sale.verifiedBy}`}</td><td>{sale.evidenceRef ?? "—"}</td><td>Terverifikasi</td><td><MoneyText amountRp={sale.totalRp} /></td></tr>)}
        </tbody></table></div>}</>}
    </section>}
    {confirming && shift && value !== null && estimatedVariance !== null && (
      <ConfirmDialog
        title="Konfirmasi tutup shift"
        message={`Yakin tutup shift #${shift.id} dengan uang dihitung Rp${value.toLocaleString("id-ID")} dan selisih ${formatSignedRp(estimatedVariance)}? Hasil akhir mengikuti transaksi tersimpan.`}
        confirmLabel="Ya, tutup shift"
        onCancel={() => setConfirming(false)}
        onConfirm={start}
      />
    )}
  </section>;
}
