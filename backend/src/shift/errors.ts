/**
 * Error domain shift. `SHIFT_ALREADY_OPEN` mengikuti ERROR_HANDLING.md §2.
 * Validasi input dan penolakan role memakai error domain auth yang sudah ada.
 */
export type ShiftErrorCode = "SHIFT_ALREADY_OPEN";

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
