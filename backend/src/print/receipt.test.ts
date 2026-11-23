import assert from "node:assert/strict";
import { test } from "node:test";
import { formatReceiptText } from "./receipt.ts";
import type { Receipt } from "./types.ts";

const RECEIPT: Receipt = {
  saleId: 20,
  saleNo: "S-000020",
  committedAtMs: 1_700_000_000_000,
  totalRp: 5000,
  items: [
    { sku: "FX-001", name: "Fixture Produk", quantity: 2, unitPriceRp: 2500, lineTotalRp: 5000 },
  ],
  payment: {
    method: "CASH",
    amountRp: 5000,
    cashReceivedRp: 10_000,
    changeRp: 5000,
    evidenceRef: null,
    verifiedAtMs: null,
  },
};

test("TASK-021: struk virtual memuat nomor jual dan harga historis serta label DEMO", () => {
  const text = formatReceiptText(RECEIPT);
  assert.match(text, /STRUK DEMO/);
  assert.match(text, /BARIS: 1 · QTY: 2/);
  assert.match(text, /No\. Penjualan : S-000020/);
  assert.match(text, /Fixture Produk \(FX-001\)/);
  assert.match(text, /2 x Rp2500 = Rp5000/);
  assert.match(text, /TOTAL : Rp5000/);
  assert.match(text, /Uang diterima: Rp10000/);
  assert.match(text, /Kembalian    : Rp5000/);
  assert.match(text, /bukan bukti pembayaran/);
});

test("TASK-021: format struk deterministik (reprint identik) dan QRIS tidak masuk kas fisik", () => {
  assert.equal(formatReceiptText(RECEIPT), formatReceiptText(RECEIPT));
  const qris: Receipt = {
    ...RECEIPT,
    payment: {
      method: "QRIS_MANUAL",
      amountRp: 5000,
      cashReceivedRp: null,
      changeRp: 0,
      evidenceRef: "ref-123",
      verifiedAtMs: 1_700_000_000_000,
    },
  };
  const text = formatReceiptText(qris);
  assert.match(text, /QRIS MANUAL/);
  assert.match(text, /Referensi    : ref-123/);
  assert.match(text, /tidak masuk kas fisik/);
  assert.doesNotMatch(text, /Uang diterima/);
});
