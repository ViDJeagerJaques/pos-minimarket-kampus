import type { CheckoutPaymentMethod } from "../../../shared/checkoutHash.ts";

export type CheckoutStatus = "PREPARED" | "COMMITTED" | "ABANDONED";

export type CheckoutQuoteItem = {
  productId: number;
  sku: string;
  name: string;
  quantity: number;
  unitPriceRp: number;
  lineTotalRp: number;
};

export type CheckoutQuote = {
  shiftId: number;
  cashierId: number;
  items: CheckoutQuoteItem[];
  totalRp: number;
  payment: {
    method: CheckoutPaymentMethod;
  };
};

export type PrepareCheckoutInput = {
  attemptKey?: unknown;
  shiftId?: unknown;
  items?: unknown;
  payment?: unknown;
};

export type PrepareCheckoutResult = {
  attemptKey: string;
  requestHash: string;
  status: "PREPARED";
  quote: CheckoutQuote;
};

export type CommitCheckoutInput = {
  attemptKey?: unknown;
  requestHash?: unknown;
  paymentConfirmation?: unknown;
};

export type QrisVerification =
  | { status: "pending" }
  | { status: "verified"; verifiedBy: number; verifiedAtMs: number };

export type CommittedPaymentSummary = {
  method: CheckoutPaymentMethod;
  amountRp: number;
  cashReceivedRp: number | null;
  changeRp: number | null;
  verifiedBy: number | null;
  verifiedAtMs: number | null;
  /** Referensi bukti opsional dari kasir; bukan data rekening/kredensial bank. */
  evidenceRef: string | null;
};

export type CommitCheckoutResult = {
  saleId: number;
  saleNo: string;
  attemptKey: string;
  requestHash: string;
  status: "COMMITTED";
  totalRp: number;
  committedAtMs: number;
  payment: CommittedPaymentSummary;
  /** Hanya diisi untuk QRIS_MANUAL: status verifikasi dari sesi/jam backend. */
  qrisVerification?: QrisVerification;
};

export type CheckoutStatusResult =
  | {
      attemptKey: string;
      requestHash: string;
      status: "PREPARED";
      quote: CheckoutQuote | null;
      qrisVerification?: QrisVerification;
    }
  | {
      attemptKey: string;
      requestHash: string;
      status: "ABANDONED";
      abandonedAtMs: number;
    }
  | CommitCheckoutResult;

