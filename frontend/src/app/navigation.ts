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

export interface NavItem {
  id: PageId;
  label: string;
}

export const NAV_BY_ROLE: Record<Role, readonly NavItem[]> = {
  CASHIER: [
    { id: "cashier", label: "Kasir" },
    { id: "history", label: "Riwayat/Struk" },
    { id: "shift", label: "Shift" },
    { id: "password", label: "Ganti Sandi" },
  ],
  ADMIN: [
    { id: "dashboard", label: "Dashboard" },
    { id: "products", label: "Barang/Stok" },
    { id: "product-list", label: "Daftar Barang" },
    { id: "receiving", label: "Penerimaan" },
    { id: "stock-adjustment", label: "Koreksi Stok" },
    { id: "reports", label: "Laporan" },
    { id: "accounts", label: "Akun" },
    { id: "backup", label: "Backup" },
  ],
};

export function defaultPage(role: Role): PageId {
  return role === "CASHIER" ? "cashier" : "dashboard";
}

export function isPageAllowed(role: Role, page: PageId): boolean {
  return NAV_BY_ROLE[role].some((item) => item.id === page);
}

