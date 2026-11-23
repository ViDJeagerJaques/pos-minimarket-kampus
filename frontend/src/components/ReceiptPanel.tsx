import { useEffect, useState } from "react";
import { ApiError } from "../api/errors";
import type { PosDataSource, PrintResult, ReceiptView } from "../api/types";
import { buildDemoTaxInvoiceText } from "../domain/iposFeatures";
import { Button } from "./Button";
import { MoneyText } from "./MoneyText";

interface ReceiptPanelProps {
  dataSource: PosDataSource;
  /** ID transaksi yang sudah COMMITTED; bukan attemptKey/checkout baru. */
  saleId: number;
  onSessionExpired?: () => void;
  /** Halaman riwayat memuat struk segera setelah saleId dipilih. */
  autoLoad?: boolean;
}

/**
 * Panel struk TASK-021. Semua data berasa dari backend (sale tersimpan).
 * Kegagalan cetak hanya mengubah status panel; tidak pernah membuat sale baru.
 * Teks struk dapat disalin/dicatat manual bila printer belum tersedia.
 */
export function ReceiptPanel({ dataSource, saleId, onSessionExpired, autoLoad = false }: ReceiptPanelProps) {
  const [view, setView] = useState<ReceiptView | null>(null);
  const [printResult, setPrintResult] = useState<PrintResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const [showTaxInvoice, setShowTaxInvoice] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const text = view?.text ?? printResult?.text ?? "";

  function handleFailure(failure: unknown, fallback: string): void {
    if (failure instanceof ApiError && failure.isSessionExpired) {
      onSessionExpired?.();
      setError("Sesi berakhir. Masuk lagi untuk mencetak ulang.");
      return;
    }
    setError(failure instanceof ApiError ? failure.message : fallback);
  }

  async function loadReceipt(): Promise<void> {
    if (isBusy) return;
    setIsBusy(true);
    setError(null);
    try {
      setView(await dataSource.getSaleReceipt(saleId));
    } catch (failure) {
      handleFailure(failure, "Struk tersimpan gagal dimuat.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handlePrint(): Promise<void> {
    if (isBusy) return;
    setIsBusy(true);
    setError(null);
    setCopyNote(null);
    try {
      const result = await dataSource.printSaleReceipt(saleId);
      setPrintResult(result);
      // Pastikan pratinjau tetap diambil dari sale tersimpan, bukan dari hasil klik.
      if (view === null) {
        try {
          setView(await dataSource.getSaleReceipt(saleId));
        } catch (previewFailure) {
          // Sesi habis harus mengembalikan aplikasi ke login walaupun cetak sukses.
          // Kegagalan pratinjau lain tetap diam agar teks hasil cetak dipakai.
          if (previewFailure instanceof ApiError && previewFailure.isSessionExpired) {
            handleFailure(previewFailure, "Struk tersimpan gagal dimuat.");
          }
        }
      }
    } catch (failure) {
      handleFailure(
        failure,
        "Cetak gagal. Transaksi tetap tersimpan; periksa printer lalu cetak ulang.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  function copyText(): void {
    if (text.length === 0) {
      setCopyNote("Muat struk terlebih dahulu sebelum menyalin.");
      return;
    }
    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard && typeof clipboard.writeText === "function") {
      void clipboard.writeText(text).then(
        () => setCopyNote("Teks struk disalin. Gunakan sebagai fallback manual bila printer belum tersedia."),
        () => setCopyNote("Salin teks pada kotak di bawah secara manual."),
      );
      return;
    }
    setCopyNote("Salin teks pada kotak di bawah secara manual.");
  }

  useEffect(() => {
    if (autoLoad) void loadReceipt();
    // Hanya pemetaan awal: loadReceipt dibuat ulang tiap render, bukan pemicu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad]);

  return (
    <section className="receipt-panel" aria-label="Struk transaksi tersimpan">
      <p className="muted">
        Struk virtual DEMO dari transaksi tersimpan. Printer fisik belum diuji; ini
        bukan bukti pembayaran.
      </p>
      {view && (
        <p className="receipt-panel__summary">
          <span className="badge badge--ok">Asli</span> · <strong>{view.receipt.saleNo}</strong> ·{" "}
          <MoneyText amountRp={view.receipt.totalRp} /> ·{" "}
          {view.receipt.payment.method === "CASH" ? "Tunai" : "QRIS manual"}
        </p>
      )}
      {text.length > 0 && (
        <pre className="receipt-panel__text" data-testid="receipt-text">
          {text}
        </pre>
      )}
      {printResult && (
        <p className="badge badge--ok" role="status">
          TERCETAK (virtual DEMO) · kanal {printResult.channel} · transaksi {printResult.saleNo}
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          Status: GAGAL — {error} Transaksi tetap tersimpan; periksa printer lalu cetak ulang.
          Tidak ada transaksi atau mutasi stok baru.
        </p>
      )}
      {copyNote && <p className="muted" role="status">{copyNote}</p>}
      <div className="dialog__actions">
        <Button variant="secondary" disabled={isBusy} onClick={() => void loadReceipt()}>
          {isBusy ? "Memproses…" : view ? "Muat ulang struk" : "Lihat struk"}
        </Button>
        <Button variant="primary" disabled={isBusy} onClick={() => void handlePrint()}>
          {printResult || error ? "Cetak ulang" : "Cetak struk"}
        </Button>
        <Button variant="secondary" disabled={isBusy || text.length === 0} onClick={copyText}>
          Salin teks (fallback manual)
        </Button>
        {view && (
          <Button variant="secondary" disabled={isBusy} onClick={() => setShowTaxInvoice((prev) => !prev)}>
            {showTaxInvoice ? "Tutup faktur pajak" : "Faktur Pajak (Simulasi DEMO)"}
          </Button>
        )}
      </div>
      {showTaxInvoice && view && (
        <pre className="receipt-panel__text" data-testid="tax-invoice-text">
          {buildDemoTaxInvoiceText({
            saleNo: view.receipt.saleNo,
            committedAtMs: view.receipt.committedAtMs,
            totalRp: view.receipt.totalRp,
          })}
        </pre>
      )}
    </section>
  );
}
