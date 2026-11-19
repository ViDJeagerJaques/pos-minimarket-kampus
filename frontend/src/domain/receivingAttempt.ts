import type { ReceiveGoodsInput, ReceiptResult } from "../api/types";

/**
 * Upaya penerimaan dimiliki sesi (App), bukan halaman: berpindah halaman atau
 * unmount tidak boleh membuang receiptKey/payload saat hasil belum pasti.
 */
export type ReceiptAttemptStatus = "PENDING" | "UNKNOWN" | "COMMITTED";

export type ReceiptAttempt = {
  /** Identitas upaya yang tidak berubah sampai upaya selesai. */
  receiptKey: string;
  /** Snapshot payload yang dikirim; dipakai ulang apa adanya saat retry. */
  payload: ReceiveGoodsInput;
  status: ReceiptAttemptStatus;
  result: ReceiptResult | null;
  error: string | null;
};

export function newReceiptKey(): string {
  const random =
    typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `rcv_${random}`;
}

export function isUnresolvedReceipt(attempt: ReceiptAttempt | null): boolean {
  return attempt !== null && attempt.status !== "COMMITTED";
}
