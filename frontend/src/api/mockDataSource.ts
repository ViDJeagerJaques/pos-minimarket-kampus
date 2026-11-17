/**
 * MOCK DATA SOURCE — MODE DEMO (TASK-007).
 *
 * - Berjalan sepenuhnya di memori browser; tanpa jaringan, tanpa SQLite.
 * - TIDAK ada operasi checkout/penjualan/pembayaran/stok. Endpoint tersebut
 *   menunggu TASK-016 dan keputusan TASK-001 (K-05/K-06), jadi UI tidak boleh
 *   menampilkan pembayaran sukses.
 * - Login DEMO tidak memverifikasi kata sandi. Autentikasi asli (hash, sesi,
 *   role di backend) adalah TASK-009.
 *   TODO(security): ganti dengan POST /auth/login di backend lokal (127.0.0.1),
 *   sesi via cookie HttpOnly/SameSite + CSRF atau token di memori sesuai
 *   keputusan D-08 TASK-001. Jangan simpan token di localStorage.
 * - Penyembunyian menu di UI bukan otorisasi; backend wajib menolak (DEC-014).
 */
import {
  DEMO_ACCOUNTS,
  DEMO_CATEGORIES,
  DEMO_PRODUCTS,
  DEMO_SUPPLIERS,
  type DemoProduct,
} from "../demo/demoData";
import { ApiError } from "./errors";
import type {
  AccountSummary,
  CatalogProduct,
  CatalogQuery,
  CategorySummary,
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
  SessionUser,
  ShiftSummary,
  SupplierSummary,
  UpdateProductInput,
} from "./types";

const MAX_QUERY_LENGTH = 64;
const BARCODE_PATTERN = /^[0-9A-Za-z\-]{1,64}$/;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function categoryName(categoryId: number): string {
  return DEMO_CATEGORIES.find((item) => item.id === categoryId)?.name ?? "Tanpa kategori (DEMO)";
}

function toCatalogProduct(product: DemoProduct): CatalogProduct {
  return {
    id: product.id,
    categoryId: product.categoryId,
    categoryName: categoryName(product.categoryId),
    sku: product.sku,
    name: product.name,
    priceRp: product.priceRp,
    active: product.active,
    barcodes: [...product.barcodes],
    supplierIds: [...product.supplierIds],
    stockOnHand: product.stock,
  };
}

function toSummary(product: DemoProduct): ProductSummary {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    priceRp: product.priceRp,
    stock: product.stock,
    active: product.active,
  };
}

export function normalizeBarcode(raw: string): string | null {
  const trimmed = raw.trim();
  return BARCODE_PATTERN.test(trimmed) ? trimmed : null;
}

/** Catatan operasi yang dipanggil — dipakai tes untuk membuktikan tidak ada mutasi. */
export interface CallLogEntry {
  operation: string;
  isMutation: boolean;
}

export function createMockDataSource(options: { latencyMs?: number } = {}): PosDataSource & {
  readonly callLog: readonly CallLogEntry[];
} {
  const latencyMs = options.latencyMs ?? 0;
  const callLog: CallLogEntry[] = [];
  let currentUser: SessionUser | null = null;

  const delay = () =>
    latencyMs > 0 ? new Promise<void>((resolve) => setTimeout(resolve, latencyMs)) : Promise.resolve();

  return {
    authMode: "DEMO",
    catalogMode: "DEMO",
    callLog,

    async login(username: string, password: string): Promise<LoginResult> {
      callLog.push({ operation: "login", isMutation: false });
      await delay();
      const normalized = username.trim().toLowerCase();
      const account = DEMO_ACCOUNTS.find((item) => item.username === normalized);
      // DEMO: sandi hanya wajib terisi, tidak diverifikasi. Jangan tiru di backend.
      if (!account || !account.active || password.length === 0) {
        return { ok: false, code: "INVALID_CREDENTIALS" };
      }
      const user: SessionUser = {
        userId: DEMO_ACCOUNTS.indexOf(account) + 1,
        username: account.username,
        displayName: account.displayName,
        role: account.role,
      };
      currentUser = user;
      return { ok: true, user };
    },

    async logout(): Promise<void> {
      callLog.push({ operation: "logout", isMutation: false });
      currentUser = null;
      await delay();
    },

    async getProfile(): Promise<SessionUser> {
      callLog.push({ operation: "getProfile", isMutation: false });
      await delay();
      if (currentUser === null) {
        throw new ApiError(401, "AUTH_REQUIRED", "Sesi DEMO tidak tersedia.");
      }
      return currentUser;
    },

    async listAccounts(): Promise<AccountSummary[]> {
      callLog.push({ operation: "listAccounts", isMutation: false });
      await delay();
      return DEMO_ACCOUNTS.map((account, index) => ({
        id: index + 1,
        username: account.username,
        role: account.role,
        active: account.active,
      }));
    },

    async createAccount(_input: CreateAccountInput): Promise<AccountSummary> {
      callLog.push({ operation: "createAccount", isMutation: false });
      await delay();
      // Mode DEMO tidak menyimpan akun. Jangan menampilkan sukses palsu.
      throw new ApiError(
        0,
        "DEMO_UNSUPPORTED",
        "Mode DEMO tidak menyimpan akun. Jalankan backend lokal untuk mengelola akun.",
      );
    },

    async setAccountActive(_userId: number, _active: boolean): Promise<AccountSummary> {
      callLog.push({ operation: "setAccountActive", isMutation: false });
      await delay();
      throw new ApiError(
        0,
        "DEMO_UNSUPPORTED",
        "Mode DEMO tidak mengubah status akun. Jalankan backend lokal untuk mengelola akun.",
      );
    },

    async listCategories(): Promise<CategorySummary[]> {
      callLog.push({ operation: "listCategories", isMutation: false });
      await delay();
      return DEMO_CATEGORIES.map((item) => ({ ...item }));
    },

    async createCategory(_name: string): Promise<CategorySummary> {
      callLog.push({ operation: "createCategory", isMutation: true });
      await delay();
      throw new ApiError(
        0,
        "DEMO_UNSUPPORTED",
        "Mode DEMO tidak menyimpan kategori. Jalankan backend lokal untuk mengelola katalog.",
      );
    },

    async listSuppliers(): Promise<SupplierSummary[]> {
      callLog.push({ operation: "listSuppliers", isMutation: false });
      await delay();
      return DEMO_SUPPLIERS.map((item) => ({ ...item }));
    },

    async createSupplier(_name: string): Promise<SupplierSummary> {
      callLog.push({ operation: "createSupplier", isMutation: true });
      await delay();
      throw new ApiError(
        0,
        "DEMO_UNSUPPORTED",
        "Mode DEMO tidak menyimpan supplier. Jalankan backend lokal untuk mengelola katalog.",
      );
    },

    async listCatalogProducts(options: CatalogQuery = {}): Promise<CatalogProduct[]> {
      callLog.push({ operation: "listCatalogProducts", isMutation: false });
      await delay();
      const needle = (options.query ?? "").trim().toLowerCase().slice(0, MAX_QUERY_LENGTH);
      const barcode = (options.barcode ?? "").trim();
      const limitRaw = options.limit ?? DEFAULT_LIMIT;
      const limit = Number.isSafeInteger(limitRaw)
        ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT)
        : DEFAULT_LIMIT;
      const rows = DEMO_PRODUCTS.filter((item) => {
        if (options.includeInactive !== true && !item.active) return false;
        if (barcode.length > 0 && !item.barcodes.includes(barcode)) return false;
        if (needle.length > 0) {
          return (
            item.name.toLowerCase().includes(needle) ||
            item.sku.toLowerCase().includes(needle) ||
            item.barcodes.some((code) => code.toLowerCase().includes(needle))
          );
        }
        return true;
      });
      return rows.slice(0, limit).map(toCatalogProduct);
    },

    async createProduct(_input: CreateProductInput): Promise<CatalogProduct> {
      callLog.push({ operation: "createProduct", isMutation: true });
      await delay();
      throw new ApiError(
        0,
        "DEMO_UNSUPPORTED",
        "Mode DEMO tidak menyimpan produk. Jalankan backend lokal untuk mengelola katalog.",
      );
    },

    async updateProduct(_productId: number, _input: UpdateProductInput): Promise<CatalogProduct> {
      callLog.push({ operation: "updateProduct", isMutation: true });
      await delay();
      throw new ApiError(
        0,
        "DEMO_UNSUPPORTED",
        "Mode DEMO tidak mengubah produk. Jalankan backend lokal untuk mengelola katalog.",
      );
    },

    async addBarcode(_productId: number, _barcode: string): Promise<CatalogProduct> {
      callLog.push({ operation: "addBarcode", isMutation: true });
      await delay();
      throw new ApiError(
        0,
        "DEMO_UNSUPPORTED",
        "Mode DEMO tidak menambah barcode. Jalankan backend lokal untuk mengelola katalog.",
      );
    },

    async removeBarcode(_productId: number, _barcode: string): Promise<CatalogProduct> {
      callLog.push({ operation: "removeBarcode", isMutation: true });
      await delay();
      throw new ApiError(
        0,
        "DEMO_UNSUPPORTED",
        "Mode DEMO tidak menghapus barcode. Jalankan backend lokal untuk mengelola katalog.",
      );
    },

    async findActiveProductByBarcode(barcode: string): Promise<ProductSummary | null> {
      callLog.push({ operation: "findActiveProductByBarcode", isMutation: false });
      await delay();
      const normalized = normalizeBarcode(barcode);
      if (!normalized) {
        return null;
      }
      const product = DEMO_PRODUCTS.find((item) => item.active && item.barcodes.includes(normalized));
      return product ? toSummary(product) : null;
    },

    async searchActiveProducts(query: string): Promise<ProductSummary[]> {
      callLog.push({ operation: "searchActiveProducts", isMutation: false });
      await delay();
      const needle = query.trim().toLowerCase().slice(0, MAX_QUERY_LENGTH);
      if (needle.length === 0) {
        return [];
      }
      return DEMO_PRODUCTS.filter(
        (item) =>
          item.active &&
          (item.name.toLowerCase().includes(needle) ||
            item.sku.toLowerCase().includes(needle) ||
            item.barcodes.some((code) => code.includes(needle))),
      ).map(toSummary);
    },

    async listProducts(): Promise<ProductSummary[]> {
      callLog.push({ operation: "listProducts", isMutation: false });
      await delay();
      return DEMO_PRODUCTS.map(toSummary);
    },

    async getCurrentShift(): Promise<ShiftSummary | null> {
      callLog.push({ operation: "getCurrentShift", isMutation: false });
      await delay();
      throw new ApiError(
        0,
        "DEMO_UNSUPPORTED",
        "Mode DEMO tidak memiliki shift tersimpan. Jalankan backend lokal untuk membuka shift.",
      );
    },

    async openShift(_input?: { openingCashRp?: number }): Promise<ShiftSummary> {
      callLog.push({ operation: "openShift", isMutation: true });
      await delay();
      throw new ApiError(
        0,
        "DEMO_UNSUPPORTED",
        "Mode DEMO tidak menyimpan shift. Jalankan backend lokal untuk membuka shift.",
      );
    },

    async prepareCheckout(_input: PrepareCheckoutInput): Promise<PrepareCheckoutResult> {
      callLog.push({ operation: "prepareCheckout", isMutation: true });
      await delay();
      throw new ApiError(
        0,
        "DEMO_UNSUPPORTED",
        "Mode DEMO tidak membuat quote checkout. Jalankan backend lokal untuk checkout.",
      );
    },

    async commitCheckout(_input: CommitCheckoutInput): Promise<CommitCheckoutResult> {
      callLog.push({ operation: "commitCheckout", isMutation: true });
      await delay();
      throw new ApiError(
        0,
        "DEMO_UNSUPPORTED",
        "Mode DEMO tidak menyimpan penjualan. Jalankan backend lokal untuk checkout.",
      );
    },

    async getCheckoutStatus(_attemptKey: string): Promise<CheckoutStatusResult> {
      callLog.push({ operation: "getCheckoutStatus", isMutation: false });
      await delay();
      throw new ApiError(
        0,
        "DEMO_UNSUPPORTED",
        "Mode DEMO tidak menyimpan status upaya. Jalankan backend lokal untuk checkout.",
      );
    },
  };
}

