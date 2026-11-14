import { AuthError } from "../auth/errors.ts";

/**
 * Rate-limit login in-memory (AUDIT_LOG.md §4: event keamanan; API_CONTRACT
 * menyebut throttle kegagalan). Tidak memakai internet dan tidak menyimpan
 * kredensial. Datae restart proses menghitung ulang dari nol — dicatat sebagai
 * batasan DEMO.
 *
 * Key memakai username ternormalisasi dan alamat IP yang diamati, sehingga
 * percobaan berulang pada satu nama tetap dibatasi dan semua nama dari satu
 *客户端 juga dibatasi. Pesan 429 generik, tidak mengungkap keberadaan
 * username.
 */
export const DEFAULT_LOGIN_MAX_ATTEMPTS = 5;
export const DEFAULT_LOGIN_IP_MAX_ATTEMPTS = 20;
export const DEFAULT_LOGIN_WINDOW_MS = 60_000;
const MIN_LOGIN_MAX_ATTEMPTS = 1;
const MAX_LOGIN_MAX_ATTEMPTS = 100;
const MIN_LOGIN_WINDOW_MS = 1_000;
const MAX_LOGIN_WINDOW_MS = 60 * 60 * 1000;

function clampInt(
  value: number,
  min: number,
  max: number,
  field: string,
): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${field} harus bilangan bulat.`);
  }
  if (value < min || value > max) {
    throw new Error(`${field} harus antara ${min} dan ${max}.`);
  }
  return value;
}

export type LoginRateLimiterOptions = {
  maxAttempts?: number;
  windowMs?: number;
  now?: () => number;
};

export type LoginRateLimiter = {
  /** Memeriksa apakah percobaan masih diizinkan; melempar 429 bila batas tercapai. */
  assertAllowed(key: string): void;
  /** Mencatat kegagalan login tanpa melempar error. */
  recordFailure(key: string): void;
  /** Mencatat percobaan dan melempar 429 bila batas terlampaui. */
  consume(key: string): void;
  /** Menghapus hitungan setelah login berhasil. */
  reset(key: string): void;
};

export class LoginRateLimitError extends AuthError {
  constructor(retryAfterMs: number) {
    super(
      "LOGIN_RATE_LIMITED",
      429,
      "Terlalu banyak percobaan login. Coba lagi nanti.",
      null,
      true,
      Math.max(1, Math.ceil(retryAfterMs / 1000)),
    );
    this.name = "LoginRateLimitError";
  }
}

export function createLoginRateLimiter(
  options: LoginRateLimiterOptions = {},
): LoginRateLimiter {
  const maxAttempts = clampInt(
    options.maxAttempts ?? DEFAULT_LOGIN_MAX_ATTEMPTS,
    MIN_LOGIN_MAX_ATTEMPTS,
    MAX_LOGIN_MAX_ATTEMPTS,
    "maxAttempts",
  );
  const windowMs = clampInt(
    options.windowMs ?? DEFAULT_LOGIN_WINDOW_MS,
    MIN_LOGIN_WINDOW_MS,
    MAX_LOGIN_WINDOW_MS,
    "windowMs",
  );
  const now = options.now ?? (() => Date.now());
  const buckets = new Map<string, number[]>();

  function prune(key: string, at: number): number[] {
    const kept = (buckets.get(key) ?? []).filter((timestamp) => timestamp > at - windowMs);
    if (kept.length === 0) {
      buckets.delete(key);
    } else {
      buckets.set(key, kept);
    }
    return kept;
  }

  function checkLimit(attempts: number[], at: number): void {
    if (attempts.length >= maxAttempts) {
      const retryAfterMs = Math.max(1, windowMs - (at - (attempts[0] ?? at)));
      throw new LoginRateLimitError(retryAfterMs);
    }
  }

  return {
    assertAllowed(key: string): void {
      const at = now();
      const attempts = prune(key, at);
      checkLimit(attempts, at);
    },
    recordFailure(key: string): void {
      const at = now();
      const attempts = prune(key, at);
      attempts.push(at);
      buckets.set(key, attempts);
    },
    consume(key: string): void {
      const at = now();
      const attempts = prune(key, at);
      checkLimit(attempts, at);
      attempts.push(at);
      buckets.set(key, attempts);
    },
    reset(key: string): void {
      buckets.delete(key);
    },
  };
}
