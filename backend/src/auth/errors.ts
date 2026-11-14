/**
 * Error domain autentikasi/otorisasi. `httpStatus` memetakan ke
 * ERROR_HANDLING.md §2; `code` dipakai UI. Pesan login gagal selalu generik
 * agar tidak membocorkan keberadaan akun (AC-01.02).
 */
export type AuthErrorCode =
  | "VALIDATION_ERROR"
  | "AUTH_REQUIRED"
  | "INVALID_CREDENTIALS"
  | "LOGIN_RATE_LIMITED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT";

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly httpStatus: number;
  readonly field: string | null;
  readonly retryable: boolean;
  /** Detik untuk header `Retry-After` pada 429. */
  readonly retryAfterSeconds: number | null;

  constructor(
    code: AuthErrorCode,
    httpStatus: number,
    message: string,
    field: string | null = null,
    retryable = false,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.field = field;
    this.retryable = retryable;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ValidationError extends AuthError {
  constructor(message: string, field: string | null = null) {
    super("VALIDATION_ERROR", 422, message, field);
    this.name = "ValidationError";
  }
}

export class AuthRequiredError extends AuthError {
  constructor(message = "Sesi tidak valid atau sudah berakhir.") {
    super("AUTH_REQUIRED", 401, message);
    this.name = "AuthRequiredError";
  }
}

export class InvalidCredentialsError extends AuthError {
  constructor(
    message = "Nama pengguna atau kata sandi salah, atau akun tidak dapat dipakai.",
  ) {
    super("INVALID_CREDENTIALS", 401, message);
    this.name = "InvalidCredentialsError";
  }
}

export class ForbiddenError extends AuthError {
  constructor(message = "Akses hanya untuk petugas berwenang.") {
    super("FORBIDDEN", 403, message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AuthError {
  constructor(message = "Data tidak ditemukan.") {
    super("NOT_FOUND", 404, message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AuthError {
  constructor(message: string, field: string | null = null) {
    super("CONFLICT", 409, message, field);
    this.name = "ConflictError";
  }
}
