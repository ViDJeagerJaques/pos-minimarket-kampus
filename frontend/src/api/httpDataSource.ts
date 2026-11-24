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
  BootstrapAdminInput,
  BootstrapStatus,
  CatalogProduct,
  CatalogQuery,
  CategorySummary,
  CheckoutPaymentMethod,
  DailyReport,
  DailyReportFilter,
  DailySaleRow,
  CheckoutQuote,
  CheckoutQuoteItem,
  CheckoutStatusResult,
  CommitCheckoutInput,
  CommitCheckoutResult,
  CreateAccountInput,
  CreateProductInput,
  LoginResult,
  PaymentReport,
  PosDataSource,
  PrepareCheckoutInput,
  PrepareCheckoutResult,
  PendingQrisVerification,
  PrintResult,
  ProductSummary,
  ProductStockReport,
  Receipt,
  ReceiptResult,
  ReceiptResultItem,
  ReceiptView,
  ReceiveGoodsInput,
  Role,
  SessionUser,
  VerifiedQrisVerification,
  ShiftSummary,
  ShiftClosePreview,
  ShiftClosing,
  StockMovementEntry,
  StockReport,
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
  "PRINTER_UNAVAILABLE",
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
      return "Akses ditolak oleh backend (403). Tindakan ini tidak diizinkan untuk akun Anda.";
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
    case "PRINTER_UNAVAILABLE":
      return typeof serverMessage === "string" && serverMessage.length > 0
        ? serverMessage
        : "Struk belum dapat dicetak. Transaksi tetap tersimpan; cetak ulang dari transaksi yang sama.";
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

function asCheckoutMethod(value: unknown): CheckoutPaymentMethod {
  if (value !== "CASH" && value !== "QRIS_MANUAL") {
    throw invalidResponse("Metode pembayaran dari backend tidak dikenal.");
  }
  return value;
}

function toPendingQrisVerification(value: unknown): PendingQrisVerification | undefined {
  if (!isRecord(value) || value.status !== "pending") return undefined;
  return { status: "pending" };
}

function toVerifiedQrisVerification(value: unknown): VerifiedQrisVerification | undefined {
  if (
    !isRecord(value) ||
    value.status !== "verified" ||
    !isPositiveInt(value.verifiedBy) ||
    !isNonNegativeInt(value.verifiedAtMs)
  ) {
    return undefined;
  }
  return { status: "verified", verifiedBy: value.verifiedBy, verifiedAtMs: value.verifiedAtMs };
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

function toShiftClosePreview(value: unknown): ShiftClosePreview {
  if (!isRecord(value) || !isPositiveInt(value.shiftId) ||
      !(value.openingCashRp === null || isNonNegativeInt(value.openingCashRp)) ||
      !isNonNegativeInt(value.cashTotalRp) || !isNonNegativeInt(value.qrisTotalRp) ||
      !isNonNegativeInt(value.expectedCashRp) || !isNonNegativeInt(value.saleCount)) {
    throw invalidResponse("Pratinjau shift tidak valid.");
  }
  return { shiftId: value.shiftId, openingCashRp: value.openingCashRp, cashTotalRp: value.cashTotalRp,
    qrisTotalRp: value.qrisTotalRp, expectedCashRp: value.expectedCashRp, saleCount: value.saleCount };
}

function toShiftClosing(value: unknown): ShiftClosing {
  if (!isRecord(value) || !isRecord(value.totals) || !isPositiveInt(value.shiftId) ||
      !isPositiveInt(value.closedBy) || typeof value.closeKey !== "string" || !value.closeKey ||
      typeof value.requestHash !== "string" || !/^[0-9a-f]{64}$/.test(value.requestHash) ||
      !isNonNegativeInt(value.closedAtMs) || !isNonNegativeInt(value.expectedCashRp) ||
      !(value.openingCashRp === null || isNonNegativeInt(value.openingCashRp)) ||
      !(value.declaredCashRp === null || isNonNegativeInt(value.declaredCashRp)) ||
      !(value.varianceRp === null || (typeof value.varianceRp === "number" && Number.isSafeInteger(value.varianceRp))) ||
      !isNonNegativeInt(value.totals.cashRp) || !isNonNegativeInt(value.totals.qrisManualRp) ||
      !isNonNegativeInt(value.totals.totalSalesRp) || !isNonNegativeInt(value.totals.saleCount)) {
    throw invalidResponse("Hasil tutup shift tidak valid.");
  }
  if (value.varianceNote !== undefined && value.varianceNote !== null && typeof value.varianceNote !== "string") {
    throw invalidResponse("Hasil tutup shift tidak valid.");
  }
  return { shiftId: value.shiftId, closeKey: value.closeKey, requestHash: value.requestHash,
    closedAtMs: value.closedAtMs, closedBy: value.closedBy, openingCashRp: value.openingCashRp,
    expectedCashRp: value.expectedCashRp, declaredCashRp: value.declaredCashRp, varianceRp: value.varianceRp,
    ...(value.varianceNote !== undefined ? { varianceNote: value.varianceNote } : {}),
    totals: { cashRp: value.totals.cashRp, qrisManualRp: value.totals.qrisManualRp,
      totalSalesRp: value.totals.totalSalesRp, saleCount: value.totals.saleCount } };
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
    !isRecord(value.payment)
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
    payment: { method: asCheckoutMethod(value.payment.method) },
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
    !isNonNegativeInt(payment.amountRp) ||
    (payment.cashReceivedRp !== null && !isNonNegativeInt(payment.cashReceivedRp)) ||
    (payment.changeRp !== null && !isNonNegativeInt(payment.changeRp)) ||
    (payment.evidenceRef !== null && typeof payment.evidenceRef !== "string")
  ) {
    throw invalidResponse("Hasil commit checkout dari backend tidak valid.");
  }
  const method = asCheckoutMethod(payment.method);
  const verification = toVerifiedQrisVerification(value.qrisVerification);
  if (method === "QRIS_MANUAL" && verification === undefined) {
    // QRIS COMMITTED tanpa verifikasi sah bukan hasil yang bisa dipercaya.
    // Jangan ditampilkan sebagai sukses; attempt tetap bisa dicek lewat status.
    throw invalidResponse("Hasil commit QRIS tidak memuat verifikasi terverifikasi yang valid.");
  }
  return {
    saleId: value.saleId,
    saleNo: value.saleNo,
    ...ids,
    status: "COMMITTED",
    totalRp: value.totalRp,
    committedAtMs: value.committedAtMs,
    payment: {
      method,
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
      evidenceRef: payment.evidenceRef as string | null,
    },
    ...(method === "QRIS_MANUAL" && verification !== undefined
      ? { qrisVerification: verification }
      : {}),
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
      ...(value.qrisVerification !== undefined
        ? { qrisVerification: toPendingQrisVerification(value.qrisVerification) }
        : {}),
    };
  }
  if (value.status === "ABANDONED" && isNonNegativeInt(value.abandonedAtMs)) {
    return { ...ids, status: "ABANDONED", abandonedAtMs: value.abandonedAtMs };
  }
  throw invalidResponse("Status checkout dari backend tidak dikenal.");
}

function toReceipt(value: unknown): Receipt {
  if (
    !isRecord(value) ||
    !isPositiveInt(value.saleId) ||
    typeof value.saleNo !== "string" ||
    value.saleNo.length === 0 ||
    !isNonNegativeInt(value.committedAtMs) ||
    !isNonNegativeInt(value.totalRp) ||
    !Array.isArray(value.items) ||
    value.items.length === 0 ||
    !isRecord(value.payment)
  ) {
    throw invalidResponse("Struk dari backend tidak valid.");
  }
  const items = value.items.map((raw) => {
    if (
      !isRecord(raw) ||
      typeof raw.sku !== "string" ||
      typeof raw.name !== "string" ||
      !isPositiveInt(raw.quantity) ||
      !isNonNegativeInt(raw.unitPriceRp) ||
      !isNonNegativeInt(raw.lineTotalRp)
    ) {
      throw invalidResponse("Item struk dari backend tidak valid.");
    }
    return {
      sku: raw.sku,
      name: raw.name,
      quantity: raw.quantity,
      unitPriceRp: raw.unitPriceRp,
      lineTotalRp: raw.lineTotalRp,
    };
  });
  const payment = value.payment;
  if (
    !isNonNegativeInt(payment.amountRp) ||
    (payment.cashReceivedRp !== null && !isNonNegativeInt(payment.cashReceivedRp)) ||
    (payment.changeRp !== null && !isNonNegativeInt(payment.changeRp)) ||
    (payment.evidenceRef !== null && typeof payment.evidenceRef !== "string") ||
    (payment.verifiedAtMs !== null && !isNonNegativeInt(payment.verifiedAtMs))
  ) {
    throw invalidResponse("Pembayaran pada struk tidak valid.");
  }
  return {
    saleId: value.saleId,
    saleNo: value.saleNo,
    committedAtMs: value.committedAtMs,
    totalRp: value.totalRp,
    items,
    payment: {
      method: asCheckoutMethod(payment.method),
      amountRp: payment.amountRp,
      cashReceivedRp: payment.cashReceivedRp as number | null,
      changeRp: payment.changeRp as number | null,
      evidenceRef: payment.evidenceRef as string | null,
      verifiedAtMs: payment.verifiedAtMs as number | null,
    },
  };
}

function toReceiptView(value: unknown): ReceiptView {
  if (!isRecord(value) || typeof value.text !== "string" || value.demo !== true) {
    throw invalidResponse("Pratinjau struk dari backend tidak valid.");
  }
  return { receipt: toReceipt(value.receipt), text: value.text, demo: true };
}

function toPrintResult(value: unknown): PrintResult {
  if (
    !isRecord(value) ||
    !isPositiveInt(value.saleId) ||
    typeof value.saleNo !== "string" ||
    value.saleNo.length === 0 ||
    value.status !== "PRINTED" ||
    typeof value.channel !== "string" ||
    !isNonNegativeInt(value.printedAtMs) ||
    typeof value.text !== "string" ||
    value.demo !== true
  ) {
    throw invalidResponse("Hasil cetak dari backend tidak valid.");
  }
  return {
    saleId: value.saleId,
    saleNo: value.saleNo,
    status: "PRINTED",
    channel: value.channel,
    printedAtMs: value.printedAtMs,
    text: value.text,
    demo: true,
  };
}

function toReceiptResult(value: unknown): ReceiptResult {
  if (
    !isRecord(value) ||
    !isPositiveInt(value.receiptId) ||
    typeof value.receiptKey !== "string" ||
    value.receiptKey.length === 0 ||
    typeof value.requestHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.requestHash) ||
    !isPositiveInt(value.supplierId) ||
    (value.supplierRef !== null && typeof value.supplierRef !== "string") ||
    !isNonNegativeInt(value.committedAtMs) ||
    !isNonNegativeInt(value.totalQuantity) ||
    !Array.isArray(value.items) ||
    typeof value.duplicate !== "boolean"
  ) {
    throw invalidResponse("Hasil penerimaan dari backend tidak valid.");
  }
  const items: ReceiptResultItem[] = value.items.map((raw) => {
    if (
      !isRecord(raw) ||
      !isPositiveInt(raw.receiptItemId) ||
      !isPositiveInt(raw.productId) ||
      typeof raw.sku !== "string" ||
      typeof raw.name !== "string" ||
      !isPositiveInt(raw.quantity) ||
      !isPositiveInt(raw.movementId)
    ) {
      throw invalidResponse("Item penerimaan dari backend tidak valid.");
    }
    return {
      receiptItemId: raw.receiptItemId,
      productId: raw.productId,
      sku: raw.sku,
      name: raw.name,
      quantity: raw.quantity,
      movementId: raw.movementId,
    };
  });
  return {
    receiptId: value.receiptId,
    receiptKey: value.receiptKey,
    requestHash: value.requestHash,
    supplierId: value.supplierId,
    supplierRef: value.supplierRef as string | null,
    committedAtMs: value.committedAtMs,
    totalQuantity: value.totalQuantity,
    items,
    duplicate: value.duplicate,
  };
}

function decodeDailyItems(value: unknown): Receipt["items"] {
  if (!Array.isArray(value)) throw invalidResponse("Rincian barang laporan tidak valid.");
  return value.map(item => {
    if (!isRecord(item) || typeof item.sku !== "string" || typeof item.name !== "string" || !isPositiveInt(item.quantity) || !isNonNegativeInt(item.unitPriceRp) || !isNonNegativeInt(item.lineTotalRp)) throw invalidResponse("Rincian barang laporan tidak valid.");
    return { sku: item.sku, name: item.name, quantity: item.quantity, unitPriceRp: item.unitPriceRp, lineTotalRp: item.lineTotalRp };
  });
}

function toDailyReport(value: unknown): DailyReport {
  if (
    !isRecord(value) ||
    !isNonNegativeInt(value.startMs) ||
    !isNonNegativeInt(value.endMs) ||
    (value.shiftId !== null && !isPositiveInt(value.shiftId)) ||
    !isRecord(value.cash) || !isNonNegativeInt(value.cash.totalRp) || !isNonNegativeInt(value.cash.count) ||
    !isRecord(value.qrisManual) || !isNonNegativeInt(value.qrisManual.totalRp) ||
    !isNonNegativeInt(value.qrisManual.count) || !isNonNegativeInt(value.qrisManual.verifiedCount) ||
    !isNonNegativeInt(value.totalRp) ||
    !isNonNegativeInt(value.saleCount) ||
    !Array.isArray(value.sales) ||
    typeof value.salesTruncated !== "boolean" ||
    !isNonNegativeInt(value.generatedAtMs)
  ) {
    throw invalidResponse("Laporan harian dari backend tidak valid.");
  }
  const sales: DailySaleRow[] = value.sales.map((raw) => {
    if (
      !isRecord(raw) ||
      !isPositiveInt(raw.saleId) ||
      typeof raw.saleNo !== "string" ||
      !isNonNegativeInt(raw.committedAtMs) ||
      !isPositiveInt(raw.shiftId) ||
      (raw.cashierUsername !== null && typeof raw.cashierUsername !== "string") ||
      (raw.method !== "CASH" && raw.method !== "QRIS_MANUAL") ||
      !isNonNegativeInt(raw.amountRp)
    ) {
      throw invalidResponse("Baris penjualan pada laporan tidak valid.");
    }
    return {
      saleId: raw.saleId,
      saleNo: raw.saleNo,
      committedAtMs: raw.committedAtMs,
      shiftId: raw.shiftId,
      cashierUsername: raw.cashierUsername as string | null,
      method: raw.method,
      amountRp: raw.amountRp,
      ...(raw.items === undefined ? {} : { items: decodeDailyItems(raw.items) }),
    };
  });
  return {
    startMs: value.startMs,
    endMs: value.endMs,
    shiftId: value.shiftId as number | null,
    cash: { totalRp: value.cash.totalRp, count: value.cash.count },
    qrisManual: {
      totalRp: value.qrisManual.totalRp,
      count: value.qrisManual.count,
      verifiedCount: value.qrisManual.verifiedCount,
    },
    totalRp: value.totalRp,
    saleCount: value.saleCount,
    sales,
    salesTruncated: value.salesTruncated,
    generatedAtMs: value.generatedAtMs,
  };
}

function toStockReport(value: unknown): StockReport {
  if (
    !isRecord(value) ||
    !isNonNegativeInt(value.generatedAtMs) ||
    !isNonNegativeInt(value.lowStockThreshold) ||
    !Array.isArray(value.products)
  ) {
    throw invalidResponse("Laporan stok dari backend tidak valid.");
  }
  const products: ProductStockReport[] = value.products.map((raw) => {
    if (
      !isRecord(raw) ||
      !isPositiveInt(raw.productId) ||
      typeof raw.sku !== "string" ||
      typeof raw.name !== "string" ||
      !isNonNegativeInt(raw.onHand) ||
      !isNonNegativeInt(raw.opening) ||
      !isNonNegativeInt(raw.receipt) ||
      !isNonNegativeInt(raw.sale) ||
      // Adjustment adalah delta ledger: boleh negatif, tetapi harus safe integer.
      typeof raw.adjustment !== "number" || !Number.isSafeInteger(raw.adjustment) ||
      typeof raw.matched !== "boolean" ||
      typeof raw.low !== "boolean" ||
      typeof raw.zero !== "boolean" ||
      !Array.isArray(raw.movements) ||
      typeof raw.movementsTruncated !== "boolean"
    ) {
      throw invalidResponse("Produk pada laporan stok tidak valid.");
    }
    const movements: StockMovementEntry[] = raw.movements.map((entry) => {
      if (
        !isRecord(entry) ||
        !isPositiveInt(entry.id) ||
        (entry.kind !== "OPENING" && entry.kind !== "SALE" && entry.kind !== "RECEIPT" && entry.kind !== "ADJUSTMENT") ||
        typeof entry.delta !== "number" || !Number.isSafeInteger(entry.delta) ||
        !isNonNegativeInt(entry.createdAtMs) ||
        !isPositiveInt(entry.actorId) ||
        (entry.sourceType !== null && typeof entry.sourceType !== "string") ||
        (entry.sourceId !== null && !isPositiveInt(entry.sourceId)) ||
        (entry.sourceRef !== null && typeof entry.sourceRef !== "string") ||
        (entry.sourceQuantity !== null && !isPositiveInt(entry.sourceQuantity)) ||
        (entry.adjustmentReason !== null && typeof entry.adjustmentReason !== "string")
      ) {
        throw invalidResponse("Mutasi pada laporan stok tidak valid.");
      }
      return {
        id: entry.id,
        kind: entry.kind,
        delta: entry.delta,
        createdAtMs: entry.createdAtMs,
        actorId: entry.actorId,
        sourceType: entry.sourceType as string | null,
        sourceId: entry.sourceId as number | null,
        sourceRef: entry.sourceRef as string | null,
        sourceQuantity: entry.sourceQuantity as number | null,
        adjustmentReason: entry.adjustmentReason as string | null,
      };
    });
    return {
      productId: raw.productId,
      sku: raw.sku,
      name: raw.name,
      onHand: raw.onHand,
      opening: raw.opening,
      receipt: raw.receipt,
      sale: raw.sale,
      adjustment: raw.adjustment,
      matched: raw.matched,
      low: raw.low,
      zero: raw.zero,
      movements,
      movementsTruncated: raw.movementsTruncated,
    };
  });
  return {
    generatedAtMs: value.generatedAtMs,
    lowStockThreshold: value.lowStockThreshold,
    products,
  };
}

function toPaymentReport(value: unknown): PaymentReport {
  if (
    !isRecord(value) ||
    !isRecord(value.cash) ||
    !isNonNegativeInt(value.cash.totalRp) ||
    !isNonNegativeInt(value.cash.count) ||
    !isRecord(value.qrisManual) ||
    !isNonNegativeInt(value.qrisManual.totalRp) ||
    !isNonNegativeInt(value.qrisManual.count) ||
    !isNonNegativeInt(value.qrisManual.verifiedCount) ||
    !isNonNegativeInt(value.totalRp) ||
    !Array.isArray(value.qrisSales)
  ) {
    throw invalidResponse("Laporan pembayaran dari backend tidak valid.");
  }
  const qrisSales = value.qrisSales.map((raw) => {
    if (
      !isRecord(raw) ||
      !isPositiveInt(raw.saleId) ||
      typeof raw.saleNo !== "string" ||
      !isNonNegativeInt(raw.committedAtMs) ||
      !isNonNegativeInt(raw.totalRp) ||
      (raw.cashierUsername !== null && typeof raw.cashierUsername !== "string") ||
      !isPositiveInt(raw.verifiedBy) ||
      !isNonNegativeInt(raw.verifiedAtMs) ||
      (raw.evidenceRef !== null && typeof raw.evidenceRef !== "string") ||
      raw.status !== "verified"
    ) {
      throw invalidResponse("Baris QRIS pada laporan tidak valid.");
    }
    return {
      saleId: raw.saleId,
      saleNo: raw.saleNo,
      committedAtMs: raw.committedAtMs,
      totalRp: raw.totalRp,
      cashierUsername: raw.cashierUsername as string | null,
      verifiedBy: raw.verifiedBy,
      verifiedAtMs: raw.verifiedAtMs,
      evidenceRef: raw.evidenceRef as string | null,
      status: "verified" as const,
    };
  });
  return {
    cash: { totalRp: value.cash.totalRp, count: value.cash.count },
    qrisManual: {
      totalRp: value.qrisManual.totalRp,
      count: value.qrisManual.count,
      verifiedCount: value.qrisManual.verifiedCount,
    },
    totalRp: value.totalRp,
    qrisSales,
  };
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

  async function getBootstrapStatus(): Promise<BootstrapStatus> {
    const data = await request("GET", "/auth/bootstrap-status");
    if (!isRecord(data) || typeof data.needsSetup !== "boolean") {
      throw invalidResponse("Status setup awal dari backend tidak valid.");
    }
    return { needsSetup: data.needsSetup };
  }

  async function bootstrapAdmin(input: BootstrapAdminInput): Promise<AccountSummary> {
    const data = await request("POST", "/auth/bootstrap-admin", {
      username: input.username,
      password: input.password,
    });
    return toAccountSummary(data);
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
    if (query.offset !== undefined) {
      params.set("offset", String(query.offset));
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

  async function getShiftClosePreview(shiftId: number): Promise<ShiftClosePreview> {
    if (!isPositiveInt(shiftId)) throw new ApiError(422, "VALIDATION_ERROR", "Shift tidak valid.");
    return toShiftClosePreview(await request("GET", `/shifts/${shiftId}/close/preview`, undefined, requireToken()));
  }
  async function getShiftClosing(shiftId: number): Promise<ShiftClosing> {
    if (!isPositiveInt(shiftId)) throw new ApiError(422, "VALIDATION_ERROR", "Shift tidak valid.");
    return toShiftClosing(await request("GET", `/shifts/${shiftId}/close`, undefined, requireToken()));
  }
  async function closeShift(shiftId: number, input: { closeKey: string; declaredCashRp: number; varianceNote?: string | null }): Promise<ShiftClosing> {
    if (!isPositiveInt(shiftId) || !input.closeKey || !isNonNegativeInt(input.declaredCashRp) || input.declaredCashRp > 1_000_000_000)
      throw new ApiError(422, "VALIDATION_ERROR", "Data penutupan tidak valid.");
    return toShiftClosing(await request("POST", `/shifts/${shiftId}/close`, input, requireToken()));
  }

  async function prepareCheckout(input: PrepareCheckoutInput): Promise<PrepareCheckoutResult> {
    const activeToken = requireToken();
    if (
      typeof input.attemptKey !== "string" ||
      input.attemptKey.trim().length === 0 ||
      !isPositiveInt(input.shiftId) ||
      (input.paymentMethod !== "CASH" && input.paymentMethod !== "QRIS_MANUAL") ||
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
    const confirmation = input.paymentConfirmation;
    const isValid =
      typeof input.attemptKey === "string" &&
      input.attemptKey.trim().length > 0 &&
      typeof input.requestHash === "string" &&
      /^[0-9a-f]{64}$/.test(input.requestHash) &&
      (confirmation?.method === "CASH"
        ? isNonNegativeInt(confirmation.cashReceivedRp)
        : confirmation?.method === "QRIS_MANUAL" &&
          confirmation.merchantConfirmed === true &&
          isNonNegativeInt(confirmation.confirmedAmountRp) &&
          (confirmation.evidenceRef === null || typeof confirmation.evidenceRef === "string"));
    if (!isValid) {
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

  async function getRecentSales(
    options?: { startMs?: number; endMs?: number; limit?: number; offset?: number },
  ): ReturnType<PosDataSource["getRecentSales"]> {
    const params = new URLSearchParams();
    if (options?.startMs !== undefined) params.set("startMs", String(options.startMs));
    if (options?.endMs !== undefined) params.set("endMs", String(options.endMs));
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    if (options?.offset !== undefined) params.set("offset", String(options.offset));
    const qs = params.toString();
    const rows = await request("GET", qs ? `/sales/recent?${qs}` : "/sales/recent", undefined, requireToken());
    if (!Array.isArray(rows)) throw new ApiError(500, "INVALID_RESPONSE", "Daftar transaksi tidak valid.");
    return rows.map(raw => {
      if (!isRecord(raw) || !isPositiveInt(raw.saleId) || typeof raw.saleNo !== "string" || !isNonNegativeInt(raw.committedAtMs) || !isNonNegativeInt(raw.totalRp) || (raw.method !== "CASH" && raw.method !== "QRIS_MANUAL")) throw new ApiError(500, "INVALID_RESPONSE", "Transaksi tidak valid.");
      return { saleId: raw.saleId, saleNo: raw.saleNo, committedAtMs: raw.committedAtMs, totalRp: raw.totalRp, method: raw.method };
    });
  }

  async function adjustStock(input: import("./types").AdjustmentInput): Promise<import("./types").AdjustmentResult> {
    const value = await request("POST", "/inventory/adjustments", input, requireToken());
    if (!isRecord(value) || !isPositiveInt(value.productId) || !isNonNegativeInt(value.previousOnHand) || !isNonNegativeInt(value.onHand) || !Number.isSafeInteger(value.delta) || typeof value.duplicate !== "boolean") throw new ApiError(500, "INVALID_RESPONSE", "Hasil koreksi tidak valid.");
    return { productId: value.productId, previousOnHand: value.previousOnHand, onHand: value.onHand, delta: value.delta as number, duplicate: value.duplicate };
  }
  function backupEntry(value: unknown): import("./types").BackupEntry {
    if (!isRecord(value) || typeof value.name !== "string" || typeof value.valid !== "boolean" || !(value.createdAtMs === null || isNonNegativeInt(value.createdAtMs))) throw new ApiError(500, "INVALID_RESPONSE", "Data cadangan tidak valid.");
    return { name: value.name, valid: value.valid, createdAtMs: value.createdAtMs };
  }
  async function listBackups() { const value = await request("GET", "/backups", undefined, requireToken()); if (!Array.isArray(value)) throw new ApiError(500, "INVALID_RESPONSE", "Daftar cadangan tidak valid."); return value.map(backupEntry); }
  async function createBackup() { return backupEntry(await request("POST", "/backups", {}, requireToken())); }
  async function restoreBackupTest(name: string) { const value = await request("POST", "/backups/restore-test", { name }, requireToken()); if (!isRecord(value) || typeof value.destinationPath !== "string") throw new ApiError(500, "INVALID_RESPONSE", "Hasil pemulihan tidak valid."); return { destinationPath: value.destinationPath }; }

  async function getSaleReceipt(saleId: number): Promise<ReceiptView> {
    if (!isPositiveInt(saleId)) {
      throw new ApiError(422, "VALIDATION_ERROR", "ID transaksi tidak valid.");
    }
    return toReceiptView(
      await request("GET", `/sales/${saleId}/receipt`, undefined, requireToken()),
    );
  }

  async function printSaleReceipt(saleId: number): Promise<PrintResult> {
    if (!isPositiveInt(saleId)) {
      throw new ApiError(422, "VALIDATION_ERROR", "ID transaksi tidak valid.");
    }
    return toPrintResult(
      await request("POST", `/sales/${saleId}/print`, {}, requireToken()),
    );
  }

  async function receiveGoods(input: ReceiveGoodsInput): Promise<ReceiptResult> {
    const receiptKey = typeof input?.receiptKey === "string" ? input.receiptKey.trim() : "";
    const valid =
      receiptKey.length > 0 &&
      receiptKey.length <= 128 &&
      isPositiveInt(input?.supplierId) &&
      Array.isArray(input?.items) &&
      input.items.length > 0 &&
      input.items.every(
        (item) => isRecord(item) && isPositiveInt(item.productId) && isPositiveInt(item.quantity),
      ) &&
      (input.supplierRef === undefined ||
        input.supplierRef === null ||
        typeof input.supplierRef === "string");
    if (!valid) {
      throw new ApiError(422, "VALIDATION_ERROR", "Data penerimaan tidak valid dari UI.");
    }
    return toReceiptResult(
      await request("POST", "/goods-receipts", input, requireToken()),
    );
  }

  async function getDailyReport(filter: DailyReportFilter): Promise<DailyReport> {
    if (
      !isNonNegativeInt(filter?.startMs) ||
      !isNonNegativeInt(filter?.endMs) ||
      filter.startMs >= filter.endMs ||
      (filter.shiftId !== undefined && filter.shiftId !== null && !isPositiveInt(filter.shiftId))
    ) {
      throw new ApiError(422, "VALIDATION_ERROR", "Filter tanggal/shift tidak valid.");
    }
    const params = new URLSearchParams();
    params.set("start", String(filter.startMs));
    params.set("end", String(filter.endMs));
    if (filter.shiftId !== undefined && filter.shiftId !== null) {
      params.set("shiftId", String(filter.shiftId));
    }
    return toDailyReport(
      await request("GET", `/reports/daily?${params.toString()}`, undefined, requireToken()),
    );
  }

  async function getStockReport(filter: { lowStockThreshold?: number } = {}): Promise<StockReport> {
    if (
      filter.lowStockThreshold !== undefined &&
      !isNonNegativeInt(filter.lowStockThreshold)
    ) {
      throw new ApiError(422, "VALIDATION_ERROR", "Ambang stok menipis tidak valid.");
    }
    const suffix =
      filter.lowStockThreshold === undefined ? "" : `?lowStockThreshold=${filter.lowStockThreshold}`;
    return toStockReport(
      await request("GET", `/reports/stock${suffix}`, undefined, requireToken()),
    );
  }

  async function getPaymentReport(): Promise<PaymentReport> {
    return toPaymentReport(await request("GET", "/reports/payments", undefined, requireToken()));
  }

  return {
    authMode: "LOCAL_API",
    catalogMode: "LOCAL_API",
    getBootstrapStatus,
    bootstrapAdmin,
    login,
    logout,
    getProfile,
    async changePassword(input) {
      const data = await request("POST", "/auth/password", input, requireToken());
      if (!isRecord(data) || data.changed !== true) throw invalidResponse("Perubahan sandi tidak dapat dikonfirmasi.");
    },
    async resetAccountPassword(userId, input) {
      const data = await request("POST", `/users/${encodeURIComponent(String(userId))}/password`, input, requireToken());
      if (!isRecord(data) || data.changed !== true) throw invalidResponse("Reset sandi akun tidak dapat dikonfirmasi.");
    },
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
    getShiftClosePreview,
    getShiftClosing,
    closeShift,
    prepareCheckout,
    commitCheckout,
    getCheckoutStatus,
    getRecentSales,
    adjustStock, listBackups, createBackup, restoreBackupTest,
    getSaleReceipt,
    printSaleReceipt,
    getPaymentReport,
    receiveGoods,
    getDailyReport,
    getStockReport,
  };
}
