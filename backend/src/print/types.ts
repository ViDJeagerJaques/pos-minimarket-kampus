import type { CheckoutPaymentMethod } from "../../../shared/checkoutHash.ts";

/**
 * DTO struk TASK-021 (POS-04.03 / AC-04.03).
 * Seluruh nilai berasal dari sale yang SUDAH COMMITTED; tidak ada field yang
 * diambil dari products.price_rp saat ini maupun dari checkout draft.
 */

export type ReceiptItem = {
  sku: string;
  name: string;
  quantity: number;
  unitPriceRp: number;
  lineTotalRp: number;
  discountPct?: number;
  discountRp?: number;
};

export type ReceiptPayment = {
  method: CheckoutPaymentMethod;
  amountRp: number;
  cashReceivedRp: number | null;
  changeRp: number | null;
  evidenceRef: string | null;
  verifiedAtMs: number | null;
};

export type Receipt = {
  saleId: number;
  saleNo: string;
  committedAtMs: number;
  totalRp: number;
  shiftId?: number;
  cashierUsername?: string;
  items: ReceiptItem[];
  payment: ReceiptPayment;
};

/** Data struk + teks pratinjau virtual untuk DEMO. */
export type ReceiptView = {
  receipt: Receipt;
  text: string;
  /** Selalu true: belum ada printer fisik/drivers yang diuji (VAL-04). */
  demo: true;
};

export type PrintResult = {
  saleId: number;
  saleNo: string;
  status: "PRINTED";
  channel: string;
  printedAtMs: number;
  text: string;
  demo: true;
};

/** Hasil upaya adapter. Kegagalan TIDAK mengubah sale/payment/stock. */
export type PrintAttempt =
  | { ok: true; printedAtMs: number; text: string }
  | { ok: false; reason: string };

/**
 * Adapter output dipisahkan dari transaksi SQLite. Implementasi ESC/POS nyata
 * baru boleh ditambahkan setelah driver/port/printer tujuan diuji (TASK-005,
 * VAL-04). Adapter virtual dipakai untuk pratinjau DEMO tanpa printer.
 */
export type PrinterAdapter = {
  readonly channel: string;
  print(receipt: Receipt): PrintAttempt;
};
