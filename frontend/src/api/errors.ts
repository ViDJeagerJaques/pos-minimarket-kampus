/**
 * Error transport/API yang aman ditampilkan ke UI.
 * Jangan pernah menyimpan kata sandi atau token di `message`, `cause`, atau log.
 */
export type ApiErrorCode =
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE"
  | "AUTH_REQUIRED"
  | "INVALID_CREDENTIALS"
  | "LOGIN_RATE_LIMITED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR"
  | "DEMO_UNSUPPORTED";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly retryable: boolean;

  constructor(status: number, code: ApiErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }

  /** 401 = sesi tidak valid/kedaluwarsa; UI wajib kembali ke login. */
  get isSessionExpired(): boolean {
    return this.status === 401;
  }
}
