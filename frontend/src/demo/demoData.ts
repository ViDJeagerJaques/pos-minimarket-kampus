/**
 * DATA DEMO SINTETIS — TASK-007.
 * Semua nama, barcode, harga dan stok di file ini FIKTIF dan hanya untuk
 * pengembangan UI. Jangan dipakai sebagai data awal, harga resmi, atau SOP.
 * Tidak ada kata sandi di sini (AGENTS.md §13); login DEMO tidak memverifikasi sandi.
 */
import type { Role } from "../api/types";

export interface DemoAccount {
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
}

export interface DemoProduct {
  id: number;
  sku: string;
  name: string;
  priceRp: number;
  stock: number;
  active: boolean;
  /** Barcode disimpan sebagai teks agar nol di depan tetap ada (DATABASE.md §5). */
  barcodes: string[];
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { username: "kasir.demo", displayName: "Kasir DEMO A", role: "CASHIER", active: true },
  { username: "kasir.demo2", displayName: "Kasir DEMO B", role: "CASHIER", active: true },
  { username: "admin.demo", displayName: "Admin DEMO", role: "ADMIN", active: true },
  { username: "kasir.nonaktif", displayName: "Kasir DEMO Nonaktif", role: "CASHIER", active: false },
];

export const DEMO_PRODUCTS: readonly DemoProduct[] = [
  { id: 1, sku: "DEMO-001", name: "Roti Isi Cokelat (DEMO)", priceRp: 5000, stock: 12, active: true, barcodes: ["0000000000017"] },
  { id: 2, sku: "DEMO-002", name: "Air Mineral 600 ml (DEMO)", priceRp: 4000, stock: 30, active: true, barcodes: ["0000000000024"] },
  { id: 3, sku: "DEMO-003", name: "Mochi Kacang (DEMO)", priceRp: 5000, stock: 1, active: true, barcodes: ["0000000000031"] },
  { id: 4, sku: "DEMO-004", name: "Teh Kotak 200 ml (DEMO)", priceRp: 3500, stock: 0, active: true, barcodes: ["0000000000048"] },
  { id: 5, sku: "DEMO-005", name: "Pulpen Biru (DEMO)", priceRp: 2500, stock: 25, active: true, barcodes: ["0000000000055"] },
  { id: 6, sku: "DEMO-006", name: "Keripik Singkong (DEMO)", priceRp: 7000, stock: 8, active: true, barcodes: ["0000000000062"] },
  { id: 7, sku: "DEMO-007", name: "Buku Tulis 38 lbr (DEMO)", priceRp: 6000, stock: 15, active: true, barcodes: ["0000000000079"] },
  { id: 8, sku: "DEMO-008", name: "Permen Mint (DEMO, nonaktif)", priceRp: 1000, stock: 40, active: false, barcodes: ["0000000000086"] },
];

