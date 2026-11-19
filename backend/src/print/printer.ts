import { formatReceiptText } from "./receipt.ts";
import type { PrinterAdapter } from "./types.ts";

/**
 * Adapter VIRTUAL: tidak menyentuh perangkat keras maupun jaringan.
 * Dipakai sebagai jalur fallback/pratinjau DEMO sampai printer tujuan diuji.
 */
export function createVirtualPrinterAdapter(
  deps: { now?: () => number } = {},
): PrinterAdapter {
  const now = deps.now ?? (() => Date.now());
  return {
    channel: "VIRTUAL",
    print(receipt) {
      return { ok: true, printedAtMs: now(), text: formatReceiptText(receipt) };
    },
  };
}

/**
 * Adapter GAGAL (simulasi printer mati). Dipakai pada tes dan sebagai kontrak
 * kegagalan untuk adapter ESC/POS nyata: transaksi tetap COMMITTED, UI
 * menampilkan PRINTER_UNAVAILABLE, kasir mencetak ulang dari sale tersimpan.
 */
export function createFailingPrinterAdapter(
  reason = "Printer tidak dapat dihubungi.",
): PrinterAdapter {
  return {
    channel: "VIRTUAL_OFFLINE",
    print() {
      return { ok: false, reason };
    },
  };
}
