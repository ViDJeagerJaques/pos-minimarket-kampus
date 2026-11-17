import { useId, useState } from "react";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MoneyText } from "../components/MoneyText";

// Fixture TASK-002 §7: nilai sintetis, bukan data shift dan bukan SOP pengelola.
const OPENING_RP = 100_000;
const CASH_RP = 500_000;
const QRIS_RP = 300_000;
const EXPECTED_RP = OPENING_RP + CASH_RP;

/** Pratinjau terisolasi: tidak membaca, membuka, atau menutup shift nyata. */
export function ShiftDemoPage() {
  const [cashInput, setCashInput] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [finished, setFinished] = useState(false);
  const cashId = useId();
  const value = /^\d+$/.test(cashInput) ? Number(cashInput) : null;
  const valid = value !== null && Number.isSafeInteger(value) && value <= 1_000_000_000;

  return (
    <section className="panel" aria-labelledby="shift-demo-title">
      <h1 id="shift-demo-title">Simulasi pratinjau tutup shift</h1>
      <p role="note"><strong>DEMO — data sintetis.</strong> Ini hanya simulasi tampilan; tidak membaca atau menutup shift sebenarnya. SOP setoran belum disahkan.</p>
      <p>Penutupan shift sebenarnya belum tersedia: pratinjau dan pemeriksaan hasil tersimpan masih menunggu integrasi backend.</p>
      <table className="table" aria-label="Ringkasan simulasi">
        <tbody>
          <tr><th scope="row">Modal awal simulasi</th><td><MoneyText amountRp={OPENING_RP} /></td></tr>
          <tr><th scope="row">Penjualan CASH simulasi</th><td><MoneyText amountRp={CASH_RP} /></td></tr>
          <tr><th scope="row">Penjualan QRIS simulasi</th><td><MoneyText amountRp={QRIS_RP} /></td></tr>
          <tr><th scope="row">Perkiraan uang tunai simulasi</th><td><MoneyText amountRp={EXPECTED_RP} /></td></tr>
        </tbody>
      </table>
      <p className="muted">Rumus fixture: modal + CASH. QRIS tidak masuk ke uang tunai.</p>
      <label className="field-label" htmlFor={cashId}>Uang dihitung untuk simulasi (Rp)</label>
      <input id={cashId} className="input" inputMode="numeric" value={cashInput} onChange={(event) => { setCashInput(event.target.value); setFinished(false); }} />
      {cashInput !== "" && !valid && <p className="field-error" role="alert">Masukkan bilangan rupiah bulat dari 0 sampai 1.000.000.000.</p>}
      {valid && <p>Selisih simulasi: <MoneyText amountRp={value - EXPECTED_RP} /></p>}
      <Button variant="primary" disabled={!valid} onClick={() => setConfirming(true)}>Lanjutkan simulasi</Button>
      {finished && <p role="status">Simulasi selesai. Tidak ada shift sebenarnya yang ditutup atau data yang disimpan.</p>}
      {confirming && <ConfirmDialog title="Konfirmasi simulasi" message="Ini tidak menutup shift sebenarnya dan tidak menyimpan data." confirmLabel="Selesaikan simulasi" onCancel={() => setConfirming(false)} onConfirm={() => { setConfirming(false); setFinished(true); }} />}
    </section>
  );
}
