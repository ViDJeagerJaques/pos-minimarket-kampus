/**
 * Error domain katalog. Setiap error membawa `code` dan `httpStatus` agar lapisan
 * HTTP (TASK-009) dapat memetakannya ke `API_CONTRACT.md` §5 tanpa menebak:
 * 401 sesi, 403 role, 404 tidak ada, 409 konflik/idempotensi, 422 input.
 */
export type CatalogErrorCode =
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "SESSION_INVALID"
  | "NOT_FOUND"
  | "DUPLICATE_SKU"
  | "DUPLICATE_BARCODE"
  | "DUPLICATE_CATEGORY"
  | "PRODUCT_INACTIVE";

export class CatalogError extends Error {
  readonly code: CatalogErrorCode;
  readonly httpStatus: number;
  readonly field: string | null;

  constructor(
    code: CatalogErrorCode,
    httpStatus: number,
    message: string,
    field: string | null = null,
  ) {
    super(message);
    this.name = "CatalogError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.field = field;
  }
}

/** Input tidak valid (422). */
export class ValidationError extends CatalogError {
  constructor(message: string, field: string | null = null) {
    super("VALIDATION_ERROR", 422, message, field);
    this.name = "ValidationError";
  }
}

/** Role tidak berwenang (403). */
export class ForbiddenError extends CatalogError {
  constructor(message = "Peran ini tidak diizinkan melakukan operasi katalog.") {
    super("FORBIDDEN", 403, message);
    this.name = "ForbiddenError";
  }
}

/** Actor tidak berasal dari sesi yang valid (401). */
export class SessionInvalidError extends CatalogError {
  constructor(message = "Sesi tidak valid; identitas aktor tidak dapat diverifikasi.") {
    super("SESSION_INVALID", 401, message);
    this.name = "SessionInvalidError";
  }
}

/** Objek tidak ditemukan atau tidak terlihat oleh role (404). */
export class NotFoundError extends CatalogError {
  constructor(message: string) {
    super("NOT_FOUND", 404, message);
    this.name = "NotFoundError";
  }
}

/** Bentrok keunikan data (409). */
export class ConflictError extends CatalogError {
  constructor(code: CatalogErrorCode, message: string, field: string | null = null) {
    super(code, 409, message, field);
    this.name = "ConflictError";
  }
}