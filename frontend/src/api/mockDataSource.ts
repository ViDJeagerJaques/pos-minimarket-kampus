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
import { DEMO_ACCOUNTS, DEMO_PRODUCTS, type DemoProduct } from "../demo/demoData";
import { ApiError } from "./errors";
import type {
  AccountSummary,
  CreateAccountInput,
  LoginResult,
  PosDataSource,
  ProductSummary,
  SessionUser,
} from "./types";

const MAX_QUERY_LENGTH = 64;
const BARCODE_PATTERN = /^[0-9A-Za-z\-]{1,64}$/;

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
  };
}

