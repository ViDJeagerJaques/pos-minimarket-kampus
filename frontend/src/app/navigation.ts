import type { Role } from "../api/types";

/**
 * Menu per role sesuai DESIGN_SYSTEM §5.1. Menyembunyikan menu hanya membantu
 * navigasi; backend tetap wajib menolak akses langsung (DEC-014, AUTHORIZATION §1).
 */
export type PageId =
  | "cashier"
  | "history"
  | "shift"
  | "dashboard"
  | "products"
  | "product-list"
  | "receiving"
  | "stock-adjustment"
  | "reports"
  | "accounts"
  | "password"
  | "backup";

export type NavGroup = "Utama" | "Barang & Persediaan" | "Pelaporan" | "Sistem";

export interface NavItem {
  id: PageId;
  label: string;
  group?: NavGroup;
}

export const NAV_BY_ROLE: Record<Role, readonly NavItem[]> = {
  CASHIER: [
    { id: "cashier", label: "Kasir" },
    { id: "history", label: "Riwayat/Struk" },
    { id: "shift", label: "Shift" },
    { id: "password", label: "Ganti Sandi" },
  ],
  ADMIN: [
    { id: "dashboard", label: "Dashboard", group: "Utama" },
    { id: "products", label: "Barang/Stok", group: "Barang & Persediaan" },
    { id: "product-list", label: "Daftar Barang", group: "Barang & Persediaan" },
    { id: "receiving", label: "Penerimaan", group: "Barang & Persediaan" },
    { id: "stock-adjustment", label: "Koreksi Stok", group: "Barang & Persediaan" },
    { id: "reports", label: "Laporan", group: "Pelaporan" },
    { id: "accounts", label: "Akun", group: "Sistem" },
    { id: "backup", label: "Cadangan Data", group: "Sistem" },
  ],
};

export function defaultPage(role: Role): PageId {
  return role === "CASHIER" ? "cashier" : "dashboard";
}

export function isPageAllowed(role: Role, page: PageId): boolean {
  return NAV_BY_ROLE[role].some((item) => item.id === page);
}

