/**
 * Tipe sisi UI yang meniru bentuk respons baseline di
 * docs/architecture/API_CONTRACT.md v0.1.1 §3 (GET /auth/me, GET /products)
 * dan DTO nyata TASK-009 (`backend/src/auth/service.ts`).
 * File ini TIDAK mengubah kontrak backend. Bila kontrak berubah lewat review,
 * sesuaikan di sini dan pindahkan DTO ke `shared/` (CODING_STANDARDS §2).
 */
export type Role = "ADMIN" | "CASHIER";

/** `DEMO` = mock di memori; `LOCAL_API` = backend loopback nyata. */
export type AuthMode = "DEMO" | "LOCAL_API";

/** Katalog masih mock sampai TASK-010/TASK-012 tersedia. */
export type CatalogMode = "DEMO";

export interface SessionUser {
  userId: number;
  username: string;
  displayName: string;
  role: Role;
}

/** API_CONTRACT §3: `GET /products` → id, sku, name, price, stock, active. */
export interface ProductSummary {
  id: number;
  sku: string;
  name: string;
  priceRp: number;
  stock: number;
  active: boolean;
}

/** `GET /users` TASK-009. Tidak pernah memuat hash/kata sandi. */
export interface AccountSummary {
  id: number;
  username: string;
  role: Role;
  active: boolean;
}

/** `POST /users` TASK-009; kata sandi hanya dikirim ke backend, tidak disimpan UI. */
export interface CreateAccountInput {
  username: string;
  password: string;
  role: Role;
}

export type LoginResult =
  | { ok: true; user: SessionUser }
  /** Pesan generik: tidak membocorkan apakah akun ada atau nonaktif (AC-01.02). */
  | { ok: false; code: "INVALID_CREDENTIALS" };

/**
 * Antarmuka data yang dipakai layar.
 * `authMode`/`catalogMode` dipakai UI untuk memberi label DEMO yang jujur:
 * autentikasi lokal nyata tetap bukan izin transaksi uang sungguhan.
 */
export interface PosDataSource {
  readonly authMode: AuthMode;
  readonly catalogMode: CatalogMode;
  login(username: string, password: string): Promise<LoginResult>;
  logout(): Promise<void>;
  /** `GET /auth/me`; profil/role diambil ulang dari backend, bukan dari UI. */
  getProfile(): Promise<SessionUser>;
  listAccounts(): Promise<AccountSummary[]>;
  createAccount(input: CreateAccountInput): Promise<AccountSummary>;
  setAccountActive(userId: number, active: boolean): Promise<AccountSummary>;
  findActiveProductByBarcode(barcode: string): Promise<ProductSummary | null>;
  searchActiveProducts(query: string): Promise<ProductSummary[]>;
  listProducts(): Promise<ProductSummary[]>;
}
