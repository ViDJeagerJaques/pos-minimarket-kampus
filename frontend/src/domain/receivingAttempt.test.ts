import { describe, expect, it } from "vitest";
import type { ReceiveGoodsInput } from "../api/types";
import { isUnresolvedReceipt, type ReceiptAttempt } from "./receivingAttempt";

const payload: ReceiveGoodsInput = {
  receiptKey: "rcv_x",
  supplierId: 1,
  items: [{ productId: 1, quantity: 1 }],
  supplierRef: null,
};

function attempt(status: ReceiptAttempt["status"]): ReceiptAttempt {
  return { receiptKey: payload.receiptKey, payload, status, result: null, error: null };
}

describe("TASK-027 domain receivingAttempt", () => {
  it("PENDING dan UNKNOWN dikunci; COMMITTED dan REJECTED tidak", () => {
    expect(isUnresolvedReceipt(attempt("PENDING"))).toBe(true);
    expect(isUnresolvedReceipt(attempt("UNKNOWN"))).toBe(true);
    expect(isUnresolvedReceipt(attempt("COMMITTED"))).toBe(false);
    expect(isUnresolvedReceipt(attempt("REJECTED"))).toBe(false);
    expect(isUnresolvedReceipt(null)).toBe(false);
  });
});
