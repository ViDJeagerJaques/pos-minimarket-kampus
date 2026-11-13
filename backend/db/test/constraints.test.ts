import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { checkIntegrity } from "../src/db.ts";
import {
  createTempDatabase,
  FIXED_NOW,
  fixtureIds,
  insertBaseFixture,
  migrateFresh,
} from "./helpers.ts";

function expectSqlFailure(
  db: DatabaseSync,
  sql: string,
  pattern: RegExp,
  ...params: Array<string | number | Uint8Array | null>
): void {
  assert.throws(
    () => db.prepare(sql).run(...params),
    (error: unknown) => pattern.test(error instanceof Error ? error.message : String(error)),
    `SQL seharusnya gagal (${pattern}): ${sql}`,
  );
}

test("DDL menolak FK, barcode, sesi, shift, pembayaran, dan ledger yang tidak valid", () => {
  const database = createTempDatabase();
  const db = database.open();
  try {
    migrateFresh(database);
    insertBaseFixture(db);
    const ids = fixtureIds();

    // FK: kategori tidak ada.
    expectSqlFailure(
      db,
      `INSERT INTO products (id, category_id, sku, name, price_rp)
       VALUES (99, 404, 'FX-404', 'Produk Kategori Hilang', 1000)`,
      /FOREIGN KEY/,
    );

    // Barcode invalid (kosong / hanya spasi).
    expectSqlFailure(
      db,
      "INSERT INTO product_barcodes (barcode, product_id) VALUES ('', 1)",
      /CHECK constraint failed/,
    );
    expectSqlFailure(
      db,
      "INSERT INTO product_barcodes (barcode, product_id) VALUES ('   ', 1)",
      /CHECK constraint failed/,
    );

    // Barcode sebagai teks: nol di depan dipertahankan, duplikat ditolak.
    db.prepare("INSERT INTO product_barcodes (barcode, product_id) VALUES (?, 1)").run(
      "0000000000017",
    );
    const barcode = db
      .prepare("SELECT barcode FROM product_barcodes WHERE product_id = 1")
      .get() as { barcode: string };
    assert.equal(barcode.barcode, "0000000000017");
    expectSqlFailure(
      db,
      "INSERT INTO product_barcodes (barcode, product_id) VALUES ('0000000000017', 1)",
      /UNIQUE constraint failed|PRIMARY KEY/,
    );

    // Sesi: digest wajib 32 byte.
    expectSqlFailure(
      db,
      "INSERT INTO sessions (token_digest, user_id, expires_at_ms) VALUES (?, ?, ?)",
      /CHECK constraint failed/,
      new Uint8Array(31),
      ids.cashierId,
      FIXED_NOW,
    );
    db.prepare(
      "INSERT INTO sessions (token_digest, user_id, expires_at_ms) VALUES (?, ?, ?)",
    ).run(new Uint8Array(32), ids.cashierId, FIXED_NOW);

    // Hanya satu shift aktif per database (indeks unik parsial).
    db.prepare(
      "INSERT INTO shifts (id, cashier_id, opened_at_ms, opening_cash_rp) VALUES (10, ?, ?, 0)",
    ).run(ids.cashierId, FIXED_NOW);
    expectSqlFailure(
      db,
      "INSERT INTO shifts (id, cashier_id, opened_at_ms) VALUES (11, ?, ?)",
      /UNIQUE constraint failed/,
      ids.otherCashierId,
      FIXED_NOW,
    );

    // Penutupan shift oleh bukan pemilik ditolak FK komposit.
    expectSqlFailure(
      db,
      `INSERT INTO shift_closings (shift_id, close_key, request_hash, closed_by)
       VALUES (10, 'close-1', zeroblob(32), ?)`,
      /FOREIGN KEY/,
      ids.adminId,
    );
    db.prepare(
      `INSERT INTO shift_closings (shift_id, close_key, request_hash, closed_by)
       VALUES (10, 'close-1', zeroblob(32), ?)`,
    ).run(ids.cashierId);

    // Pembayaran: CASH tanpa verifikator, QRIS_MANUAL wajib verifikator,
    // dan kode metode di luar allowlist ditolak.
    db.prepare(
      `INSERT INTO checkout_attempts (attempt_key, shift_id, cashier_id, request_hash, prepared_at_ms)
       VALUES ('attempt-bayar', 10, ?, zeroblob(32), ?)`,
    ).run(ids.cashierId, FIXED_NOW);
    db.prepare(
      `INSERT INTO sales (id, sale_no, attempt_key, committed_at_ms, total_rp)
       VALUES (30, 'SALE-FX-0030', 'attempt-bayar', ?, 5000)`,
    ).run(FIXED_NOW);
    expectSqlFailure(
      db,
      `INSERT INTO payments (sale_id, method_code, amount_rp, verified_by, verified_at_ms)
       VALUES (30, 'CASH', 5000, ?, ?)`,
      /CHECK constraint failed/,
      ids.adminId,
      FIXED_NOW,
    );
    expectSqlFailure(
      db,
      "INSERT INTO payments (sale_id, method_code, amount_rp) VALUES (30, 'QRIS_MANUAL', 5000)",
      /CHECK constraint failed/,
    );
    expectSqlFailure(
      db,
      "INSERT INTO payments (sale_id, method_code, amount_rp) VALUES (30, 'QRIS', 5000)",
      /CHECK constraint failed/,
    );
    db.prepare(
      "INSERT INTO payments (sale_id, method_code, amount_rp) VALUES (30, 'CASH', 5000)",
    ).run();

    // Item penjualan: total baris harus sama dengan kuantitas x harga.
    expectSqlFailure(
      db,
      `INSERT INTO sale_items (
         sale_id, product_id, sku_snapshot, name_snapshot, quantity, unit_price_rp, line_total_rp
       ) VALUES (30, 1, 'FX-001', 'Fixture Produk', 2, 2500, 4000)`,
      /CHECK constraint failed/,
    );

    // Produk kedua untuk menguji FK komposit sumber mutasi.
    db.prepare(
      "INSERT INTO products (id, category_id, sku, name, price_rp) VALUES (2, 1, 'FX-002', 'Fixture Dua', 1000)",
    ).run();
    const saleItem = db
      .prepare(
        `INSERT INTO sale_items (
           sale_id, product_id, sku_snapshot, name_snapshot, quantity, unit_price_rp, line_total_rp
         ) VALUES (30, 1, 'FX-001', 'Fixture Produk', 2, 2500, 5000)`,
      )
      .run();
    const saleItemId = Number(saleItem.lastInsertRowid);

    // SALE tanpa sale_item_id ditolak CHECK.
    expectSqlFailure(
      db,
      `INSERT INTO inventory_movements (product_id, kind, delta, actor_id, created_at_ms)
       VALUES (1, 'SALE', -1, ?, ?)`,
      /CHECK constraint failed/,
      ids.cashierId,
      FIXED_NOW,
    );
    // Mutasi SALE yang menunjuk item penjualan produk lain ditolak FK komposit.
    expectSqlFailure(
      db,
      `INSERT INTO inventory_movements (
         product_id, kind, delta, sale_item_id, actor_id, created_at_ms
       ) VALUES (2, 'SALE', -1, ?, ?, ?)`,
      /FOREIGN KEY/,
      saleItemId,
      ids.cashierId,
      FIXED_NOW,
    );
    // ADJUSTMENT tanpa alasan ditolak; dengan alasan diterima.
    expectSqlFailure(
      db,
      `INSERT INTO inventory_movements (
         product_id, kind, delta, adjustment_reason, actor_id, created_at_ms
       ) VALUES (1, 'ADJUSTMENT', -1, '   ', ?, ?)`,
      /CHECK constraint failed/,
      ids.adminId,
      FIXED_NOW,
    );
    db.prepare(
      `INSERT INTO inventory_movements (
         product_id, kind, delta, adjustment_reason, actor_id, created_at_ms
       ) VALUES (1, 'ADJUSTMENT', -1, 'Koreksi fixture', ?, ?)`,
    ).run(ids.adminId, FIXED_NOW);
    // OPENING ganda untuk produk yang sama ditolak indeks unik parsial.
    db.prepare(
      `INSERT INTO inventory_movements (
         product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms
       ) VALUES (2, 'OPENING', 5, 'FIXTURE-OPENING', ?, ?)`,
    ).run(ids.adminId, FIXED_NOW);
    expectSqlFailure(
      db,
      `INSERT INTO inventory_movements (
         product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms
       ) VALUES (2, 'OPENING', 5, 'FIXTURE-OPENING-2', ?, ?)`,
      /UNIQUE constraint failed/,
      ids.adminId,
      FIXED_NOW,
    );
    // Audit tanpa pelaku ditolak FK.
    expectSqlFailure(
      db,
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, created_at_ms)
       VALUES (404, 'PRICE_CHANGE', 'products', '1', ?)`,
      /FOREIGN KEY/,
      FIXED_NOW,
    );

    const integrity = checkIntegrity(db);
    assert.equal(integrity.integrity, "ok");
    assert.equal(integrity.foreignKeyViolations, 0);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("view stock_balances menghitung ledger dan memberi nol untuk produk tanpa mutasi", () => {
  const database = createTempDatabase();
  const db = database.open();
  try {
    migrateFresh(database);
    insertBaseFixture(db);
    const ids = fixtureIds();
    db.prepare(
      "INSERT INTO products (id, category_id, sku, name, price_rp) VALUES (2, 1, 'FX-002', 'Fixture Dua', 1000)",
    ).run();
    db.prepare(
      `INSERT INTO inventory_movements (
         product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms
       ) VALUES (1, 'OPENING', 10, 'FIXTURE-OPENING', ?, ?)`,
    ).run(ids.adminId, FIXED_NOW);
    db.prepare(
      `INSERT INTO inventory_movements (
         product_id, kind, delta, adjustment_reason, actor_id, created_at_ms
       ) VALUES (1, 'ADJUSTMENT', -3, 'Koreksi fixture', ?, ?)`,
    ).run(ids.adminId, FIXED_NOW);

    const balances = db
      .prepare("SELECT product_id, on_hand FROM stock_balances ORDER BY product_id")
      .all() as Array<{ product_id: number; on_hand: number }>;
    assert.deepEqual(
      balances.map((row) => ({ product_id: row.product_id, on_hand: row.on_hand })),
      [
        { product_id: 1, on_hand: 7 },
        { product_id: 2, on_hand: 0 },
      ],
    );
  } finally {
    db.close();
    database.cleanup();
  }
});