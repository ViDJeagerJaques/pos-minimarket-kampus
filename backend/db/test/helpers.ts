import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/db.ts";
import { runMigrations } from "../src/migrate.ts";

export type TempDatabase = {
  dir: string;
  dbPath: string;
  open: () => DatabaseSync;
  cleanup: () => void;
};

/**
 * Database uji selalu berada di direktori temp OS, di luar source tree.
 * Setiap tes memakai direktori sendiri agar tidak saling mengganggu.
 */
export function createTempDatabase(prefix = "pos-db-test-"): TempDatabase {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  const dbPath = path.join(dir, "pos-dev.sqlite");
  return {
    dir,
    dbPath,
    open: () => openDatabase(dbPath),
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

export function migrateFresh(database: TempDatabase, options: { backup?: "auto" | "off" } = {}) {
  return runMigrations({
    dbPath: database.dbPath,
    backup: options.backup ?? "off",
  });
}

export const FIXED_NOW = 1_762_992_000_000;

export function fixtureIds() {
  return { adminId: 1, cashierId: 2, otherCashierId: 3 };
}

export function insertBaseFixture(db: DatabaseSync): void {
  const ids = fixtureIds();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, active, created_at_ms)
     VALUES (?, ?, 'scrypt$fixture-not-a-real-hash', ?, 1, ?)`,
  ).run(ids.adminId, "admin.fixture", "ADMIN", FIXED_NOW);
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, active, created_at_ms)
     VALUES (?, ?, 'scrypt$fixture-not-a-real-hash', ?, 1, ?)`,
  ).run(ids.cashierId, "kasir.fixture", "CASHIER", FIXED_NOW);
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, active, created_at_ms)
     VALUES (?, ?, 'scrypt$fixture-not-a-real-hash', ?, 1, ?)`,
  ).run(ids.otherCashierId, "kasir.lain", "CASHIER", FIXED_NOW);
  db.prepare("INSERT INTO categories (id, name) VALUES (1, 'Fixture Kategori')").run();
  db.prepare("INSERT INTO products (id, category_id, sku, name, price_rp, active) VALUES (1, 1, 'FX-001', 'Fixture Produk', 2500, 1)").run();
}

export type SaleFixture = {
  saleId: number;
  saleItemId: number;
  productId: number;
};

export function insertSaleFixture(db: DatabaseSync): SaleFixture {
  const ids = fixtureIds();
  db.prepare(
    `INSERT INTO shifts (id, cashier_id, opened_at_ms, opening_cash_rp)
     VALUES (10, ?, ?, 50000)`,
  ).run(ids.cashierId, FIXED_NOW);
  db.prepare(
    `INSERT INTO checkout_attempts (attempt_key, shift_id, cashier_id, request_hash, prepared_at_ms)
     VALUES ('attempt-fixture-1', 10, ?, zeroblob(32), ?)`,
  ).run(ids.cashierId, FIXED_NOW);
  db.prepare(
    `INSERT INTO sales (id, sale_no, attempt_key, committed_at_ms, total_rp)
     VALUES (20, 'SALE-FX-0001', 'attempt-fixture-1', ?, 5000)`,
  ).run(FIXED_NOW);
  const itemResult = db
    .prepare(
      `INSERT INTO sale_items (
         sale_id, product_id, sku_snapshot, name_snapshot, quantity, unit_price_rp, line_total_rp
       ) VALUES (20, 1, 'FX-001', 'Fixture Produk', 2, 2500, 5000)`,
    )
    .run();
  return {
    saleId: 20,
    saleItemId: Number(itemResult.lastInsertRowid),
    productId: 1,
  };
}