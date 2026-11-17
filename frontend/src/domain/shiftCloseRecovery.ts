export interface PendingShiftClose { shiftId: number; closeKey: string; declaredCashRp: number }
export function closePrefix(userId: number): string { return `pos.shift.close.${userId}.`; }
export function pendingClose(userId: number): { key: string; value: PendingShiftClose } | null {
  const prefix = closePrefix(userId);
  const key = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    .find((item): item is string => item !== null && item.startsWith(prefix));
  if (!key) return null;
  const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
  if (!value || typeof value !== "object") throw new Error("Rekaman tidak valid");
  const v = value as Record<string, unknown>;
  if (typeof v.shiftId !== "number" || !Number.isSafeInteger(v.shiftId) || v.shiftId <= 0 ||
      typeof v.closeKey !== "string" || !v.closeKey || key !== `${prefix}${v.closeKey}` ||
      typeof v.declaredCashRp !== "number" || !Number.isSafeInteger(v.declaredCashRp) || v.declaredCashRp < 0 || v.declaredCashRp > 1_000_000_000)
    throw new Error("Rekaman tidak valid");
  return { key, value: { shiftId: v.shiftId, closeKey: v.closeKey, declaredCashRp: v.declaredCashRp } };
}
export function hasPendingClose(userId: number): boolean {
  try { return pendingClose(userId) !== null; } catch { return true; }
}
