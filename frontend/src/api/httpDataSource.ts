/**
 * Klien API auth/akun lokal (TASK-011) untuk backend TASK-009.
 *
 * Aturan keamanan:
 * - Token sesi HANYA disimpan di memori modul ini (bukan localStorage/sessionStorage).
 *   Reload halaman = login ulang; ini disengaja sampai penyimpanan token Electron disahkan.
 * - Tidak ada `console.log`/debug yang memuat kata sandi atau token.
 * - UI tidak pernah menganggap login sukses tanpa respons API; setelah `POST /auth/login`
 *   klien memverifikasi sesi lewat `GET /auth/me`.
 * - Katalog produk masih didelegasikan ke mock DEMO (TASK-012 belum ada).
 */
import { ApiError, type ApiErrorCode } from "./errors";
import type {
  AccountSummary,
  CreateAccountInput,
  LoginResult,
  PosDataSource,
  ProductSummary,
  Role,
  SessionUser,
} from "./types";

const KNOWN_CODES = new Set<ApiErrorCode>([
  "NETWORK_ERROR",
  "INVALID_RESPONSE",
  "AUTH_REQUIRED",
  "INVALID_CREDENTIALS",
  "LOGIN_RATE_LIMITED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "VALIDATION_ERROR",
  "INTERNAL_ERROR",
  "DEMO_UNSUPPORTED",
]);

type ApiEnvelope = {
  data?: unknown;
  error?: {
    code?: unknown;
    message?: unknown;
    retryable?: unknown;
  };
};

export type HttpDataSourceOptions = {
  /** Contoh: `/api/v1` (dev via proxy Vite) atau `http://127.0.0.1:8787/api/v1`. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Batas waktu tunggu per permintaan HTTP (ms); default 10.000 ms. */
  timeoutMs?: number;
  /** Sumber katalog sementara; tidak ikut terhubung ke API pada TASK-011. */
  catalog: Pick<
    PosDataSource,
    "findActiveProductByBarcode" | "searchActiveProducts" | "listProducts"
  >;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

function toApiErrorCode(value: unknown): ApiErrorCode {
  return typeof value === "string" && KNOWN_CODES.has(value as ApiErrorCode)
    ? (value as ApiErrorCode)
    : "INTERNAL_ERROR";
}

/** Pesan tetap aman: tidak menggemakan username, kata sandi, token, atau stack trace. */
function safeMessage(status: number, code: ApiErrorCode, serverMessage: unknown): string {
  switch (code) {
    case "LOGIN_RATE_LIMITED":
      return "Terlalu banyak percobaan login. Coba lagi nanti.";
    case "AUTH_REQUIRED":
      return "Sesi berakhir. Silakan masuk lagi.";
    case "FORBIDDEN":
      return "Akses ditolak oleh backend (403). Halaman ini hanya untuk ADMIN.";
    case "CONFLICT":
    case "VALIDATION_ERROR":
      return typeof serverMessage === "string" && serverMessage.length > 0
        ? serverMessage
        : "Data tidak valid atau bertentangan dengan data yang tersimpan.";
    case "NOT_FOUND":
      return "Data tidak ditemukan.";
    case "NETWORK_ERROR":
      return "Backend lokal tidak dapat dihubungi. Pastikan server lokal berjalan.";
    case "INVALID_RESPONSE":
      return "Respons backend tidak valid.";
    default:
      return status >= 500
        ? "Ada gangguan pada backend lokal. Coba lagi."
        : "Permintaan gagal. Coba lagi.";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRole(value: unknown): Role {
  if (value === "ADMIN" || value === "CASHIER") {
    return value;
  }
  throw new ApiError(200, "INVALID_RESPONSE", "Role pengguna dari backend tidak dikenal.");
}

function toSessionUser(value: unknown): SessionUser {
  if (!isRecord(value)) {
    throw new ApiError(200, "INVALID_RESPONSE", "Profil pengguna dari backend tidak valid.");
  }
  const id = value.id;
  const username = value.username;
  if (!Number.isSafeInteger(id) || Number(id) <= 0 || typeof username !== "string" || username.length === 0) {
    throw new ApiError(200, "INVALID_RESPONSE", "Profil pengguna dari backend tidak valid.");
  }
  return {
    userId: Number(id),
    username,
    displayName: username,
    role: toRole(value.role),
  };
}

function toAccountSummary(value: unknown): AccountSummary {
  if (!isRecord(value)) {
    throw new ApiError(200, "INVALID_RESPONSE", "Data akun dari backend tidak valid.");
  }
  const id = value.id;
  const username = value.username;
  if (!Number.isSafeInteger(id) || Number(id) <= 0 || typeof username !== "string" || username.length === 0) {
    throw new ApiError(200, "INVALID_RESPONSE", "Data akun dari backend tidak valid.");
  }
  return {
    id: Number(id),
    username,
    role: toRole(value.role),
    active: value.active === true,
  };
}

export function createHttpDataSource(options: HttpDataSourceOptions): PosDataSource {
  const baseUrl = (options.baseUrl ?? "/api/v1").replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl;
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  /** Token mentah hanya di memori. Jangan pindahkan ke localStorage (AUTHORIZATION §2). */
  let token: string | null = null;
  /** Monotonic counter untuk mengabaikan respons dari sesi/upaya login yang sudah usang. */
  let sessionSeq = 0;

  function getFetch(): typeof fetch {
    if (fetchImpl) {
      return fetchImpl;
    }
    if (typeof globalThis.fetch === "function") {
      return globalThis.fetch.bind(globalThis);
    }
    throw new ApiError(0, "NETWORK_ERROR", safeMessage(0, "NETWORK_ERROR", null), true);
  }

  function requireToken(): string {
    if (token === null) {
      throw new ApiError(401, "AUTH_REQUIRED", safeMessage(401, "AUTH_REQUIRED", null));
    }
    return token;
  }

  async function request(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
    authToken: string | null = token,
  ): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (authToken !== null) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    let response: Response;
    let text: string;
    try {
      try {
        response = await getFetch()(`${baseUrl}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal,
        });
      } catch {
        // Detail error jaringan / timeout (URL internal) tidak perlu ditampilkan ke kasir.
        throw new ApiError(0, "NETWORK_ERROR", safeMessage(0, "NETWORK_ERROR", null), true);
      }

      try {
        text = await response.text();
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          throw new ApiError(0, "NETWORK_ERROR", safeMessage(0, "NETWORK_ERROR", null), true);
        }
        throw new ApiError(response.status, "INVALID_RESPONSE", safeMessage(response.status, "INVALID_RESPONSE", null));
      }
    } finally {
      clearTimeout(timer);
    }

    let parsed: ApiEnvelope | null = null;
    if (text.length > 0) {
      try {
        const candidate: unknown = JSON.parse(text);
        parsed = isRecord(candidate) ? (candidate as ApiEnvelope) : null;
      } catch {
        parsed = null;
      }
      if (parsed === null) {
        throw new ApiError(
          response.status,
          "INVALID_RESPONSE",
          safeMessage(response.status, "INVALID_RESPONSE", null),
        );
      }
    }

    if (!response.ok) {
      const code = toApiErrorCode(parsed?.error?.code);
      throw new ApiError(
        response.status,
        code,
        safeMessage(response.status, code, parsed?.error?.message),
        parsed?.error?.retryable === true,
      );
    }

    return parsed?.data ?? null;
  }

  async function login(username: string, password: string): Promise<LoginResult> {
    // Jangan pernah memakai sesi lama saat login baru dimulai.
    sessionSeq += 1;
    const attemptSeq = sessionSeq;
    token = null;
    let data: unknown;
    try {
      data = await request("POST", "/auth/login", { username, password }, null);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 422)) {
        // 422 pada kredensial juga dibuat generik agar tidak menjadi oracle aturan akun.
        return { ok: false, code: "INVALID_CREDENTIALS" };
      }
      throw error;
    }

    if (attemptSeq !== sessionSeq) {
      throw new ApiError(401, "AUTH_REQUIRED", safeMessage(401, "AUTH_REQUIRED", null));
    }

    if (!isRecord(data) || typeof data.token !== "string" || data.token.length === 0) {
      throw new ApiError(200, "INVALID_RESPONSE", safeMessage(200, "INVALID_RESPONSE", null));
    }
    const nextToken = data.token;
    token = nextToken;
    try {
      // Verifikasi profil dari API; jangan mengaku sukses hanya dari state UI.
      const profile = await request("GET", "/auth/me", undefined, nextToken);
      if (attemptSeq !== sessionSeq) {
        throw new ApiError(401, "AUTH_REQUIRED", safeMessage(401, "AUTH_REQUIRED", null));
      }
      return { ok: true, user: toSessionUser(profile) };
    } catch (error) {
      // Token sempat dibuat tetapi /auth/me menolak: hanya bersihkan jika masih upaya yang sama.
      if (attemptSeq === sessionSeq) {
        token = null;
      }
      if (error instanceof ApiError && error.status === 401) {
        throw new ApiError(401, "AUTH_REQUIRED", "Sesi login tidak dapat diverifikasi. Coba lagi.");
      }
      throw error;
    }
  }

  async function logout(): Promise<void> {
    sessionSeq += 1;
    const current = token;
    token = null;
    if (current === null) {
      return;
    }
    try {
      await request("POST", "/auth/logout", undefined, current);
    } catch {
      // Sesi lokal tetap diakhiri meski backend tidak menjawab; token sudah dibuang.
      // Bila jaringan gagal, sesi server berakhir lewat TTL/revoke berikutnya.
      // Tidak ada detail token/kredensial yang dicatat.
    }
  }

  async function getProfile(): Promise<SessionUser> {
    const activeToken = requireToken();
    return toSessionUser(await request("GET", "/auth/me", undefined, activeToken));
  }

  async function listAccounts(): Promise<AccountSummary[]> {
    const activeToken = requireToken();
    const data = await request("GET", "/users", undefined, activeToken);
    if (!Array.isArray(data)) {
      throw new ApiError(200, "INVALID_RESPONSE", safeMessage(200, "INVALID_RESPONSE", null));
    }
    return data.map(toAccountSummary);
  }

  async function createAccount(input: CreateAccountInput): Promise<AccountSummary> {
    const activeToken = requireToken();
    const data = await request(
      "POST",
      "/users",
      { username: input.username, password: input.password, role: input.role },
      activeToken,
    );
    return toAccountSummary(data);
  }

  async function setAccountActive(userId: number, active: boolean): Promise<AccountSummary> {
    const activeToken = requireToken();
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new ApiError(422, "VALIDATION_ERROR", "ID akun tidak valid.");
    }
    const data = await request("PATCH", `/users/${userId}`, { active }, activeToken);
    return toAccountSummary(data);
  }

  return {
    authMode: "LOCAL_API",
    catalogMode: "DEMO",
    login,
    logout,
    getProfile,
    listAccounts,
    createAccount,
    setAccountActive,
    findActiveProductByBarcode: (barcode: string): Promise<ProductSummary | null> =>
      options.catalog.findActiveProductByBarcode(barcode),
    searchActiveProducts: (query: string): Promise<ProductSummary[]> =>
      options.catalog.searchActiveProducts(query),
    listProducts: (): Promise<ProductSummary[]> => options.catalog.listProducts(),
  };
}
