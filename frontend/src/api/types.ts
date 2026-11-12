/**
 * Tipe sisi UI yang meniru bentuk respons baseline di
 * docs/architecture/API_CONTRACT.md v0.1.1 §3 (GET /auth/me, GET /products).
 * File ini TIDAK mengubah kontrak backend. Bila kontrak berubah lewat review,
 * sesuaikan di sini dan pindahkan DTO ke `shared/` (CODING_STANDARDS §2).
 */
export type Role = "ADMIN" | "CASHIER";

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

export type LoginResult =
  | { ok: true; user: SessionUser }
  /** Pesan generik: tidak membocorkan apakah akun ada atau nonaktif (AC-01.02). */
  | { ok: false; code: "INVALID_CREDENTIALS" };

/** Antarmuka data yang dipakai layar. Implementasi saat ini hanya mock DEMO. */
export interface PosDataSource {
  readonly mode: "DEMO";
  login(username: string, password: string): Promise<LoginResult>;
  logout(): Promise<void>;
  findActiveProductByBarcode(barcode: string): Promise<ProductSummary | null>;
  searchActiveProducts(query: string): Promise<ProductSummary[]>;
  listProducts(): Promise<ProductSummary[]>;
}

