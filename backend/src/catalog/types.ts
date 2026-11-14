export type Role = "ADMIN" | "CASHIER";

/**
 * Identitas aktor diambil dari sesi backend (TASK-009), bukan dari body request.
 * `API_CONTRACT.md` §1 dan `AUTHORIZATION.md` §4.1 melarang mempercayai actor
 * atau role yang dikirim klien.
 */
export type Actor = {
  userId: number;
  role: Role;
};

export type CategoryDto = {
  id: number;
  name: string;
};

export type SupplierDto = {
  id: number;
  name: string;
};

export type ProductDto = {
  id: number;
  categoryId: number;
  categoryName: string;
  sku: string;
  name: string;
  priceRp: number;
  active: boolean;
  barcodes: string[];
  supplierIds: number[];
  stockOnHand: number;
};

export type CreateCategoryInput = {
  name: string;
};

export type CreateSupplierInput = {
  name: string;
};

export type CreateProductInput = {
  categoryId: number;
  sku: string;
  name: string;
  priceRp: number;
  barcodes?: string[];
  supplierIds?: number[];
};

export type UpdateProductInput = {
  name?: string;
  categoryId?: number;
  priceRp?: number;
  active?: boolean;
};

export type LookupOptions = {
  query?: string;
  barcode?: string;
  /** Hanya ADMIN. CASHIER yang meminta ini ditolak 403. */
  includeInactive?: boolean;
  limit?: number;
};