import type { Receipt } from "./types.ts";

/** Format rupiah deterministik (tanpa locale) agar teks struk identik saat reprint. */
function rupiah(value: number | null): string {
  return value === null ? "—" : `Rp${value}`;
}

function transactionTime(committedAtMs: number): string {
  const date = new Date(committedAtMs);
  return Number.isNaN(date.getTime()) ? "waktu tidak diketahui" : date.toISOString();
}

/**
 * Struk virtual (TEKS) untuk DEMO. Nomor penjualan dan seluruh harga berasal
 * dari snapshot penjualan tersimpan, sehingga reprint dari saleId lama
 * menghasilkan nomor dan isi yang sama walaupun harga katalog sudah berubah.
 */
export function formatReceiptText(receipt: Receipt): string {
  const rule = "----------------------------------------";
  const lines: string[] = [
    "=== STRUK DEMO ===",
    "Minimarket Kampus (DATA SINTETIS)",
    `No. Penjualan : ${receipt.saleNo}`,
    `Waktu         : ${transactionTime(receipt.committedAtMs)}`,
    rule,
  ];

  for (const item of receipt.items) {
    lines.push(`${item.name} (${item.sku})`);
    lines.push(
      `  ${item.quantity} x ${rupiah(item.unitPriceRp)} = ${rupiah(item.lineTotalRp)}`,
    );
  }

  lines.push(rule);
  lines.push(`TOTAL : ${rupiah(receipt.totalRp)}`);
  if (receipt.payment.method === "CASH") {
    lines.push(`METODE: TUNAI`);
    lines.push(`Uang diterima: ${rupiah(receipt.payment.cashReceivedRp)}`);
    lines.push(`Kembalian    : ${rupiah(receipt.payment.changeRp)}`);
  } else {
    lines.push(`METODE: QRIS MANUAL (terverifikasi kasir)`);
    if (receipt.payment.evidenceRef !== null) {
      lines.push(`Referensi    : ${receipt.payment.evidenceRef}`);
    }
    lines.push(`QRIS tidak masuk kas fisik.`);
  }
  lines.push(rule);
  lines.push("* Pratinjau virtual DEMO, bukan bukti pembayaran.");
  return `${lines.join("\n")}\n`;
}
