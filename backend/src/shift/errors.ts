/**
 * Error domain shift. `SHIFT_ALREADY_OPEN` mengikuti ERROR_HANDLING.md §2.
 * Validasi input dan penolakan role memakai error domain auth yang sudah ada.
 */
export type ShiftErrorCode =
  | "SHIFT_ALREADY_OPEN"
  | "SHIFT_NOT_FOUND"
  | "SHIFT_CLOSED"
  | "IDEMPOTENCY_CONFLICT";

export class ShiftError extends Error {
  readonly code: ShiftErrorCode;
  readonly httpStatus: number;

  constructor(code: ShiftErrorCode, httpStatus: number, message: string) {
    super(message);
    this.name = "ShiftError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export class ShiftAlreadyOpenError extends ShiftError {
  constructor(message = "Sudah ada shift aktif. Tutup shift sebelum membuka shift baru.") {
    super("SHIFT_ALREADY_OPEN", 409, message);
    this.name = "ShiftAlreadyOpenError";
  }
}

export class ShiftNotFoundError extends ShiftError {
  constructor(message = "Shift tidak ditemukan.") {
    super("SHIFT_NOT_FOUND", 404, message);
    this.name = "ShiftNotFoundError";
  }
}

export class ShiftClosedError extends ShiftError {
  constructor(message = "Shift sudah ditutup dengan closeKey lain.") {
    super("SHIFT_CLOSED", 409, message);
    this.name = "ShiftClosedError";
  }
}

export class CloseIdempotencyConflictError extends ShiftError {
  constructor(message = "closeKey sudah dipakai untuk payload penutupan yang berbeda.") {
    super("IDEMPOTENCY_CONFLICT", 409, message);
    this.name = "CloseIdempotencyConflictError";
  }
}
