/** Error domain cetak (TASK-021). Kode mengikuti ERROR_HANDLING.md. */
export type PrintErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PRINTER_UNAVAILABLE";

export class PrintError extends Error {
  readonly code: PrintErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(
    code: PrintErrorCode,
    httpStatus: number,
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = "PrintError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

export class PrinterUnavailableError extends PrintError {
  constructor(message = "Struk belum dapat dicetak. Transaksi tetap tersimpan; cetak ulang dari riwayat.") {
    super("PRINTER_UNAVAILABLE", 503, message, true);
    this.name = "PrinterUnavailableError";
  }
}

export class PrintValidationError extends PrintError {
  constructor(message: string) {
    super("VALIDATION_ERROR", 422, message);
    this.name = "PrintValidationError";
  }
}

export class SaleNotFoundError extends PrintError {
  constructor(message = "Transaksi tersimpan tidak ditemukan.") {
    super("NOT_FOUND", 404, message);
    this.name = "SaleNotFoundError";
  }
}
