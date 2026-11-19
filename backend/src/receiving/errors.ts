/**
 * Error domain penerimaan barang. Kode mengikuti ERROR_HANDLING.md §2.
 * Role/validasi admin memakai error domain auth yang sudah ada.
 */
export type ReceivingErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "IDEMPOTENCY_CONFLICT";

export class ReceivingError extends Error {
  readonly code: ReceivingErrorCode;
  readonly httpStatus: number;
  readonly field: string | null;

  constructor(code: ReceivingErrorCode, httpStatus: number, message: string, field: string | null = null) {
    super(message);
    this.name = "ReceivingError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.field = field;
  }
}

export class ValidationError extends ReceivingError {
  constructor(message: string, field: string | null = null) {
    super("VALIDATION_ERROR", 422, message, field);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends ReceivingError {
  constructor(message = "Data tidak ditemukan.") {
    super("NOT_FOUND", 404, message);
    this.name = "NotFoundError";
  }
}

export class ReceiptConflictError extends ReceivingError {
  constructor(message = "receiptKey sudah dipakai.", field: string | null = "receiptKey") {
    super("CONFLICT", 409, message, field);
    this.name = "ReceiptConflictError";
  }
}

export class IdempotencyConflictError extends ReceivingError {
  constructor(message = "receiptKey sudah dipakai untuk isi penerimaan yang berbeda.") {
    super("IDEMPOTENCY_CONFLICT", 409, message, "receiptKey");
    this.name = "IdempotencyConflictError";
  }
}
