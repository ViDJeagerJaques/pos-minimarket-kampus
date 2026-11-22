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
    "Belanja praktis untuk kebutuhan kampus",
    "Alamat dan telepon: belum dikonfigurasi (DEMO)",
    "ASLI — PRATINJAU VIRTUAL",
    `No. Penjualan : ${receipt.saleNo}`,
    `Waktu         : ${transactionTime(receipt.committedAtMs)}`,
    ...(receipt.shiftId !== undefined ? [`Shift         : #${receipt.shiftId}`] : []),
    ...(receipt.cashierUsername ? [`Kasir         : ${receipt.cashierUsername}`] : []),
    rule,
  ];

  for (const item of receipt.items) {
    lines.push(`${item.name} (${item.sku})`);
    lines.push(
      `  ${item.quantity} x ${rupiah(item.unitPriceRp)} = ${rupiah(item.lineTotalRp)}`,
    );
    if (item.discountRp && item.discountRp > 0) {
      lines.push(`  Pot (${item.discountPct ?? 0}%): -${rupiah(item.discountRp)}`);
    }
  }

  lines.push(rule);
  lines.push(`BARIS: ${receipt.items.length} · QTY: ${receipt.items.reduce((sum, item) => sum + item.quantity, 0)}`);
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
  lines.push("Terima kasih — Belanja praktis untuk kebutuhan kampus");
  lines.push("Kebijakan retur: belum ditetapkan pengelola.");
  return `${lines.join("\n")}\n`;
}
