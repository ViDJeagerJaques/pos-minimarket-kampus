export type InventoryErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INSUFFICIENT_STOCK";

export class InventoryError extends Error {
  readonly code: InventoryErrorCode;
  readonly httpStatus: number;
  readonly field: string | null;

  constructor(code: InventoryErrorCode, httpStatus: number, message: string, field: string | null = null) {
    super(message);
    this.name = "InventoryError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.field = field;
  }
}

export class ValidationError extends InventoryError {
  constructor(message: string, field: string | null = null) {
    super("VALIDATION_ERROR", 422, message, field);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends InventoryError {
  constructor(message = "Produk tidak ditemukan.") {
    super("NOT_FOUND", 404, message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends InventoryError {
  constructor(message: string, field: string | null = null) {
    super("CONFLICT", 409, message, field);
    this.name = "ConflictError";
  }
}

/**
 * DEC-018 (PROPOSED): checkout menolak stok negatif. Error ini dipakai oleh
 * penjaga ledger; checkout nyata adalah TASK-016.
 */
export class InsufficientStockError extends InventoryError {
  constructor(message = "Stok tidak cukup.") {
    super("INSUFFICIENT_STOCK", 409, message, "quantity");
    this.name = "InsufficientStockError";
  }
}
