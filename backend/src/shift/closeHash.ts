import { createHash } from "node:crypto";

/**
 * Kanonisasi niat penutupan shift (format DEMO, bukan kontrak final).
 * Urutan kunci tetap dan `null` eksplisit sehingga retry dengan payload sama
 * menghasilkan digest yang sama. Rekap CASH/QRIS dihitung backend dari sale
 * COMMITTED, bukan dipercaya dari klien, sehingga tidak masuk hash niat.
 */
export const SHIFT_CLOSE_HASH_VERSION = "shift-close-v1" as const;

export type ShiftCloseIntent = {
  shiftId: number;
  cashierId: number;
  closeKey: string;
  declaredCashRp: number | null;
  varianceNote?: string | null;
};

export function computeShiftCloseHash(intent: ShiftCloseIntent): {
  hex: string;
  bytes: Buffer;
} {
  const payload: Record<string, unknown> = {
    version: SHIFT_CLOSE_HASH_VERSION,
    shiftId: intent.shiftId,
    cashierId: intent.cashierId,
    closeKey: intent.closeKey,
    declaredCashRp: intent.declaredCashRp,
  };
  if (intent.varianceNote !== undefined && intent.varianceNote !== null) {
    payload.varianceNote = intent.varianceNote;
  }
  const canonical = JSON.stringify(payload);
  const bytes = createHash("sha256").update(canonical, "utf8").digest();
  return { hex: bytes.toString("hex"), bytes };
}
