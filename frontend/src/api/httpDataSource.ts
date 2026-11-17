/**
 * Klien API lokal untuk autentikasi/akun (TASK-011) dan katalog master
 * (TASK-010/TASK-012) pada backend loopback.
 *
 * Aturan keamanan:
 * - Token sesi HANYA disimpan di memori modul ini (bukan localStorage/sessionStorage).
 *   Reload halaman = login ulang; ini disengaja sampai penyimpanan token Electron disahkan.
 * - Tidak ada `console.log`/debug yang memuat kata sandi atau token.
 * - UI tidak pernah menganggap login sukses tanpa respons API; setelah `POST /auth/login`
 *   klien memverifikasi sesi lewat `GET /auth/me`.
 * - Otorisasi tetap di backend; 403/401 dipetakan ke ApiError agar UI menanganinya.
 */
import { ApiError, type ApiErrorCode } from "./errors";
import type {
  AccountSummary,
  CatalogProduct,
  CatalogQuery,
  CategorySummary,
  CheckoutQuote,
  CheckoutQuoteItem,
  CheckoutStatusResult,
  CommitCheckoutInput,
  CommitCheckoutResult,
  CreateAccountInput,
  CreateProductInput,
  LoginResult,
  PosDataSource,
  PrepareCheckoutInput,
  PrepareCheckoutResult,
  ProductSummary,
  Role,
  SessionUser,
  ShiftSummary,
  SupplierSummary,
  UpdateProductInput,
} from "./types";

const KNOWN_CODES = new Set<ApiErrorCode>([
  "NETWORK_ERROR",
  "INVALID_RESPONSE",
  "AUTH_REQUIRED",
  "SESSION_INVALID",
  "INVALID_CREDENTIALS",
  "LOGIN_RATE_LIMITED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "VALIDATION_ERROR",
  "DUPLICATE_SKU",
  "DUPLICATE_BARCODE",
  "DUPLICATE_CATEGORY",
  "PRODUCT_INACTIVE",
  "SHIFT_ALREADY_OPEN",
  "SHIFT_NOT_ACTIVE",
  "PRICE_CHANGED",
  "INSUFFICIENT_STOCK",
  "IDEMPOTENCY_CONFLICT",
  "PAYMENT_RECONCILIATION_REQUIRED",
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
    case "SESSION_INVALID":
      return "Sesi berakhir. Silakan masuk lagi.";
    case "FORBIDDEN":
      return "Akses ditolak oleh backend (403). Tindakan ini hanya untuk ADMIN.";
    case "CONFLICT":
    case "VALIDATION_ERROR":
    case "DUPLICATE_SKU":
    case "DUPLICATE_BARCODE":
    case "DUPLICATE_CATEGORY":
    case "PRODUCT_INACTIVE":
    case "SHIFT_ALREADY_OPEN":
    case "SHIFT_NOT_ACTIVE":
    case "PRICE_CHANGED":
    case "INSUFFICIENT_STOCK":
    case "IDEMPOTENCY_CONFLICT":
    case "PAYMENT_RECONCILIATION_REQUIRED":
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

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function invalidResponse(message: string): ApiError {
  return new ApiError(200, "INVALID_RESPONSE", message);
}

function toRole(value: unknown): Role {
  if (value === "ADMIN" || value === "CASHIER") {
    return value;
  }
  throw invalidResponse("Role pengguna dari backend tidak dikenal.");
}

function toSessionUser(value: unknown): SessionUser {
  if (!isRecord(value)) {
    throw invalidResponse("Profil pengguna dari backend tidak valid.");
  }
  const id = value.id;
  const username = value.username;
  if (!isPositiveInt(id) || typeof username !== "string" || username.length === 0) {
    throw invalidResponse("Profil pengguna dari backend tidak valid.");
  }
  return {
    userId: id,
    username,
    displayName: username,
    role: toRole(value.role),
  };
}

function toAccountSummary(value: unknown): AccountSummary {
  if (!isRecord(value)) {
    throw invalidResponse("Data akun dari backend tidak valid.");
  }
  const id = value.id;
  const username = value.username;
  if (!isPositiveInt(id) || typeof username !== "string" || username.length === 0) {
    throw invalidResponse("Data akun dari backend tidak valid.");
  }
  return {
    id,
    username,
    role: toRole(value.role),
    active: value.active === true,
  };
}

function toCategory(value: unknown): CategorySummary {
  if (!isRecord(value)) {
    throw invalidResponse("Data kategori dari backend tidak valid.");
  }
  if (!isPositiveInt(value.id) || typeof value.name !== "string" || value.name.length === 0) {
    throw invalidResponse("Data kategori dari backend tidak valid.");
  }
  return { id: value.id, name: value.name };
}

function toSupplier(value: unknown): SupplierSummary {
  if (!isRecord(value)) {
    throw invalidResponse("Data supplier dari backend tidak valid.");
  }
  if (!isPositiveInt(value.id) || typeof value.name !== "string" || value.name.length === 0) {
    throw invalidResponse("Data supplier dari backend tidak valid.");
  }
  return { id: value.id, name: value.name };
}

function toCatalogProduct(value: unknown): CatalogProduct {
  if (!isRecord(value)) {
    throw invalidResponse("Data produk dari backend tidak valid.");
  }
  const barcodes = value.barcodes;
  const supplierIds = value.supplierIds;
  if (
    !isPositiveInt(value.id) ||
    !isPositiveInt(value.categoryId) ||
    typeof value.categoryName !== "string" ||
    typeof value.sku !== "string" ||
    value.sku.length === 0 ||
    typeof value.name !== "string" ||
    value.name.length === 0 ||
    !isNonNegativeInt(value.priceRp) ||
    typeof value.active !== "boolean" ||
    !isNonNegativeInt(value.stockOnHand) ||
    !Array.isArray(barcodes) ||
    !barcodes.every((item) => typeof item === "string") ||
    !Array.isArray(supplierIds) ||
    !supplierIds.every((item) => isPositiveInt(item))
  ) {
    throw invalidResponse("Data produk dari backend tidak valid.");
  }
  return {
    id: value.id,
    categoryId: value.categoryId,
    categoryName: value.categoryName,
    sku: value.sku,
    name: value.name,
    priceRp: value.priceRp,
    active: value.active,
    barcodes: barcodes as string[],
    supplierIds: supplierIds as number[],
    stockOnHand: value.stockOnHand,
  };
}

function toSummary(product: CatalogProduct): ProductSummary {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    priceRp: product.priceRp,
    stock: product.stockOnHand,
    active: product.active,
  };
}

function toShiftSummary(value: unknown): ShiftSummary {
  if (
    !isRecord(value) ||
    !isPositiveInt(value.id) ||
    !isPositiveInt(value.cashierId) ||
    !isNonNegativeInt(value.openedAtMs) ||
    (value.openingCashRp !== null &&
      value.openingCashRp !== undefined &&
      !isNonNegativeInt(value.openingCashRp))
  ) {
    throw invalidResponse("Data shift dari backend tidak valid.");
  }
  return {
    id: value.id,
    cashierId: value.cashierId,
    openedAtMs: value.openedAtMs,
    openingCashRp: value.openingCashRp === null || value.openingCashRp === undefined
      ? null
      : value.openingCashRp,
  };
}

function toCheckoutQuote(value: unknown): CheckoutQuote {
  if (!isRecord(value)) {
    throw invalidResponse("Quote checkout dari backend tidak valid.");
  }
  const rawItems = value.items;
  if (
    !isPositiveInt(value.shiftId) ||
    !isPositiveInt(value.cashierId) ||
    !Array.isArray(rawItems) ||
    rawItems.length === 0 ||
    !isNonNegativeInt(value.totalRp) ||
    !isRecord(value.payment) ||
    value.payment.method !== "CASH"
  ) {
    throw invalidResponse("Quote checkout dari backend tidak valid.");
  }
  const items: CheckoutQuoteItem[] = rawItems.map((raw) => {
    if (
      !isRecord(raw) ||
      !isPositiveInt(raw.productId) ||
      typeof raw.sku !== "string" ||
      typeof raw.name !== "string" ||
      !isPositiveInt(raw.quantity) ||
      !isNonNegativeInt(raw.unitPriceRp) ||
      !isNonNegativeInt(raw.lineTotalRp)
    ) {
      throw invalidResponse("Item quote checkout dari backend tidak valid.");
    }
    return {
      productId: raw.productId,
      sku: raw.sku,
      name: raw.name,
      quantity: raw.quantity,
      unitPriceRp: raw.unitPriceRp,
      lineTotalRp: raw.lineTotalRp,
    };
  });
  return {
    shiftId: value.shiftId,
    cashierId: value.cashierId,
    items,
    totalRp: value.totalRp,
    payment: { method: "CASH" },
  };
}

function assertAttemptFields(value: Record<string, unknown>): { attemptKey: string; requestHash: string } {
  if (
    typeof value.attemptKey !== "string" ||
    value.attemptKey.length === 0 ||
    typeof value.requestHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.requestHash)
  ) {
    throw invalidResponse("Identitas upaya checkout dari backend tidak valid.");
  }
  return { attemptKey: value.attemptKey, requestHash: value.requestHash };
}

function toPrepareResult(value: unknown): PrepareCheckoutResult {
  if (!isRecord(value) || value.status !== "PREPARED") {
    throw invalidResponse("Hasil prepare checkout dari backend tidak valid.");
  }
  const ids = assertAttemptFields(value);
  return { ...ids, status: "PREPARED", quote: toCheckoutQuote(value.quote) };
}

function toCommitResult(value: unknown): CommitCheckoutResult {
  if (!isRecord(value) || value.status !== "COMMITTED") {
    throw invalidResponse("Hasil commit checkout dari backend tidak valid.");
  }
  const ids = assertAttemptFields(value);
  const payment = value.payment;
  if (
    !isPositiveInt(value.saleId) ||
    typeof value.saleNo !== "string" ||
    value.saleNo.length === 0 ||
    !isNonNegativeInt(value.totalRp) ||
    !isNonNegativeInt(value.committedAtMs) ||
    !isRecord(payment) ||
    payment.method !== "CASH" ||
    !isNonNegativeInt(payment.amountRp) ||
    (payment.cashReceivedRp !== null && !isNonNegativeInt(payment.cashReceivedRp)) ||
    (payment.changeRp !== null && !isNonNegativeInt(payment.changeRp))
  ) {
    throw invalidResponse("Hasil commit checkout dari backend tidak valid.");
  }
  return {
    saleId: value.saleId,
    saleNo: value.saleNo,
    ...ids,
    status: "COMMITTED",
    totalRp: value.totalRp,
    committedAtMs: value.committedAtMs,
    payment: {
      method: "CASH",
      amountRp: payment.amountRp,
      cashReceivedRp: payment.cashReceivedRp as number | null,
      changeRp: payment.changeRp as number | null,
      verifiedBy:
        typeof payment.verifiedBy === "number" && Number.isSafeInteger(payment.verifiedBy)
          ? payment.verifiedBy
          : null,
      verifiedAtMs:
        typeof payment.verifiedAtMs === "number" && Number.isSafeInteger(payment.verifiedAtMs)
          ? payment.verifiedAtMs
          : null,
    },
  };
}

function toCheckoutStatus(value: unknown): CheckoutStatusResult {
  if (!isRecord(value)) {
    throw invalidResponse("Status checkout dari backend tidak valid.");
  }
  if (value.status === "COMMITTED") {
    return toCommitResult(value);
  }
  const ids = assertAttemptFields(value);
  if (value.status === "PREPARED") {
    return {
      ...ids,
      status: "PREPARED",
      quote: value.quote === null || value.quote === undefined ? null : toCheckoutQuote(value.quote),
    };
  }
  if (value.status === "ABANDONED" && isNonNegativeInt(value.abandonedAtMs)) {
    return { ...ids, status: "ABANDONED", abandonedAtMs: value.abandonedAtMs };
  }
  throw invalidResponse("Status checkout dari backend tidak dikenal.");
}

export function createHttpDataSource(options: HttpDataSourceOptions = {}): PosDataSource {
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
    method: "GET" | "POST" | "PATCH" | "DELETE",
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
      throw invalidResponse("Daftar akun dari backend tidak valid.");
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
    if (!isPositiveInt(userId)) {
      throw new ApiError(422, "VALIDATION_ERROR", "ID akun tidak valid.");
    }
    const data = await request("PATCH", `/users/${userId}`, { active }, activeToken);
    return toAccountSummary(data);
  }

  async function listCategories(): Promise<CategorySummary[]> {
    const activeToken = requireToken();
    const data = await request("GET", "/categories", undefined, activeToken);
    if (!Array.isArray(data)) {
      throw invalidResponse("Daftar kategori dari backend tidak valid.");
    }
    return data.map(toCategory);
  }

  async function createCategory(name: string): Promise<CategorySummary> {
    const activeToken = requireToken();
    return toCategory(await request("POST", "/categories", { name }, activeToken));
  }

  async function listSuppliers(): Promise<SupplierSummary[]> {
    const activeToken = requireToken();
    const data = await request("GET", "/suppliers", undefined, activeToken);
    if (!Array.isArray(data)) {
      throw invalidResponse("Daftar supplier dari backend tidak valid.");
    }
    return data.map(toSupplier);
  }

  async function createSupplier(name: string): Promise<SupplierSummary> {
    const activeToken = requireToken();
    return toSupplier(await request("POST", "/suppliers", { name }, activeToken));
  }

  async function listCatalogProducts(query: CatalogQuery = {}): Promise<CatalogProduct[]> {
    const activeToken = requireToken();
    const params = new URLSearchParams();
    if (query.query !== undefined && query.query.trim().length > 0) {
      params.set("query", query.query.trim());
    }
    if (query.barcode !== undefined && query.barcode.trim().length > 0) {
      params.set("barcode", query.barcode.trim());
    }
    if (query.includeInactive === true) {
      params.set("includeInactive", "true");
    }
    if (query.limit !== undefined) {
      params.set("limit", String(query.limit));
    }
    const suffix = params.toString().length > 0 ? `?${params.toString()}` : "";
    const data = await request("GET", `/products${suffix}`, undefined, activeToken);
    if (!Array.isArray(data)) {
      throw invalidResponse("Daftar produk dari backend tidak valid.");
    }
    return data.map(toCatalogProduct);
  }

  async function createProduct(input: CreateProductInput): Promise<CatalogProduct> {
    const activeToken = requireToken();
    const data = await request(
      "POST",
      "/products",
      {
        categoryId: input.categoryId,
        sku: input.sku,
        name: input.name,
        priceRp: input.priceRp,
        barcodes: input.barcodes,
        supplierIds: input.supplierIds,
      },
      activeToken,
    );
    return toCatalogProduct(data);
  }

  async function updateProduct(
    productId: number,
    input: UpdateProductInput,
  ): Promise<CatalogProduct> {
    const activeToken = requireToken();
    if (!isPositiveInt(productId)) {
      throw new ApiError(422, "VALIDATION_ERROR", "ID produk tidak valid.");
    }
    const body: Record<string, unknown> = {};
    if (input.name !== undefined) body.name = input.name;
    if (input.categoryId !== undefined) body.categoryId = input.categoryId;
    if (input.priceRp !== undefined) body.priceRp = input.priceRp;
    if (input.active !== undefined) body.active = input.active;
    return toCatalogProduct(await request("PATCH", `/products/${productId}`, body, activeToken));
  }

  async function addBarcode(productId: number, barcode: string): Promise<CatalogProduct> {
    const activeToken = requireToken();
    if (!isPositiveInt(productId)) {
      throw new ApiError(422, "VALIDATION_ERROR", "ID produk tidak valid.");
    }
    return toCatalogProduct(
      await request("POST", `/products/${productId}/barcodes`, { barcode }, activeToken),
    );
  }

  async function removeBarcode(productId: number, barcode: string): Promise<CatalogProduct> {
    const activeToken = requireToken();
    if (!isPositiveInt(productId)) {
      throw new ApiError(422, "VALIDATION_ERROR", "ID produk tidak valid.");
    }
    return toCatalogProduct(
      await request(
        "DELETE",
        `/products/${productId}/barcodes/${encodeURIComponent(barcode)}`,
        undefined,
        activeToken,
      ),
    );
  }

  async function findActiveProductByBarcode(barcode: string): Promise<ProductSummary | null> {
    if (barcode.trim().length === 0) {
      return null;
    }
    const items = await listCatalogProducts({ barcode, limit: 1 });
    const first = items[0];
    return first ? toSummary(first) : null;
  }

  async function searchActiveProducts(query: string): Promise<ProductSummary[]> {
    return (await listCatalogProducts({ query, limit: 50 })).map(toSummary);
  }

  async function listProducts(): Promise<ProductSummary[]> {
    return (await listCatalogProducts({ limit: 100 })).map(toSummary);
  }

  async function getCurrentShift(): Promise<ShiftSummary | null> {
    const activeToken = requireToken();
    const data = await request("GET", "/shifts/current", undefined, activeToken);
    return data === null ? null : toShiftSummary(data);
  }

  async function openShift(input: { openingCashRp?: number } = {}): Promise<ShiftSummary> {
    const activeToken = requireToken();
    const body: Record<string, unknown> = {};
    if (input.openingCashRp !== undefined) {
      body.openingCashRp = input.openingCashRp;
    }
    return toShiftSummary(await request("POST", "/shifts/open", body, activeToken));
  }

  async function prepareCheckout(input: PrepareCheckoutInput): Promise<PrepareCheckoutResult> {
    const activeToken = requireToken();
    if (
      typeof input.attemptKey !== "string" ||
      input.attemptKey.trim().length === 0 ||
      !isPositiveInt(input.shiftId) ||
      input.paymentMethod !== "CASH" ||
      !Array.isArray(input.items) ||
      input.items.length === 0
    ) {
      throw new ApiError(422, "VALIDATION_ERROR", "Data prepare checkout tidak valid dari UI.");
    }
    return toPrepareResult(
      await request(
        "POST",
        "/checkouts/prepare",
        {
          attemptKey: input.attemptKey,
          shiftId: input.shiftId,
          items: input.items,
          payment: { method: input.paymentMethod },
        },
        activeToken,
      ),
    );
  }

  async function commitCheckout(input: CommitCheckoutInput): Promise<CommitCheckoutResult> {
    const activeToken = requireToken();
    if (
      typeof input.attemptKey !== "string" ||
      input.attemptKey.trim().length === 0 ||
      typeof input.requestHash !== "string" ||
      !/^[0-9a-f]{64}$/.test(input.requestHash) ||
      input.paymentConfirmation?.method !== "CASH" ||
      !isNonNegativeInt(input.paymentConfirmation?.cashReceivedRp)
    ) {
      throw new ApiError(422, "VALIDATION_ERROR", "Data commit checkout tidak valid dari UI.");
    }
    return toCommitResult(
      await request("POST", "/checkouts/commit", input, activeToken),
    );
  }

  async function getCheckoutStatus(attemptKey: string): Promise<CheckoutStatusResult> {
    const activeToken = requireToken();
    if (typeof attemptKey !== "string" || attemptKey.trim().length === 0) {
      throw new ApiError(422, "VALIDATION_ERROR", "attemptKey tidak valid.");
    }
    return toCheckoutStatus(
      await request("GET", `/checkouts/${encodeURIComponent(attemptKey)}`, undefined, activeToken),
    );
  }

  return {
    authMode: "LOCAL_API",
    catalogMode: "LOCAL_API",
    login,
    logout,
    getProfile,
    listAccounts,
    createAccount,
    setAccountActive,
    listCategories,
    createCategory,
    listSuppliers,
    createSupplier,
    listCatalogProducts,
    createProduct,
    updateProduct,
    addBarcode,
    removeBarcode,
    findActiveProductByBarcode,
    searchActiveProducts,
    listProducts,
    getCurrentShift,
    openShift,
    prepareCheckout,
    commitCheckout,
    getCheckoutStatus,
  };
}
