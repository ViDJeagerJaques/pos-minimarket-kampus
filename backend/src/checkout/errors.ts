/**
 * Error domain checkout (TASK-016).
 * Mengikuti kode error standar di ERROR_HANDLING.md dan API_CONTRACT.md §5.
 */
export type CheckoutErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "PRICE_CHANGED"
  | "INSUFFICIENT_STOCK"
  | "SHIFT_NOT_ACTIVE"
  | "CONFLICT";

export class CheckoutError extends Error {
  readonly code: CheckoutErrorCode;
  readonly httpStatus: number;
  readonly field: string | null;

  constructor(
    code: CheckoutErrorCode,
    httpStatus: number,
    message: string,
    field: string | null = null,
  ) {
    super(message);
    this.name = "CheckoutError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.field = field;
  }
}

export class ValidationError extends CheckoutError {
  constructor(message: string, field: string | null = null) {
    super("VALIDATION_ERROR", 422, message, field);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends CheckoutError {
  constructor(message = "Data checkout tidak ditemukan.") {
    super("NOT_FOUND", 404, message);
    this.name = "NotFoundError";
  }
}

export class IdempotencyConflictError extends CheckoutError {
  constructor(message = "attemptKey sudah dipakai untuk niat checkout yang berbeda.") {
    super("IDEMPOTENCY_CONFLICT", 409, message, "attemptKey");
    this.name = "IdempotencyConflictError";
  }
}

export class PriceChangedError extends CheckoutError {
  constructor(message = "Harga produk berubah. Silakan buat quote checkout baru.") {
    super("PRICE_CHANGED", 409, message);
    this.name = "PriceChangedError";
  }
}

export class InsufficientStockError extends CheckoutError {
  constructor(message = "Stok tidak cukup.") {
    super("INSUFFICIENT_STOCK", 409, message);
    this.name = "InsufficientStockError";
  }
}

export class ShiftNotActiveError extends CheckoutError {
  constructor(message = "Shift tidak aktif atau bukan milik kasir ini.") {
    super("SHIFT_NOT_ACTIVE", 409, message, "shiftId");
    this.name = "ShiftNotActiveError";
  }
}

export class AttemptAbandonedError extends CheckoutError {
  constructor(message = "Upaya checkout sudah dibatalkan (ABANDONED).") {
    super("CONFLICT", 409, message, "attemptKey");
    this.name = "AttemptAbandonedError";
  }
}

