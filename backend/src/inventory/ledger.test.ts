import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  createTempDatabase,
  FIXED_NOW,
  fixtureIds,
  insertBaseFixture,
  migrateFresh,
} from "../../db/test/helpers.ts";
import { createCatalogService } from "../catalog/service.ts";
import {
  InsufficientStockError,
  NotFoundError,
  ValidationError,
} from "./errors.ts";
import {
  assertSufficientStock,
  getStockBalance,
  listStockBalances,
  listStockMovements,
  reconcileAll,
  reconcileProduct,
} from "./ledger.ts";

function setup() {
  const database = createTempDatabase("pos-inventory-test-");
  const db = database.open();
  migrateFresh(database);
  insertBaseFixture(db);
  db.prepare(
    "INSERT INTO products (id, category_id, sku, name, price_rp, active) VALUES (2, 1, 'FX-002', 'Produk Tanpa Mutasi', 1000, 1)",
  ).run();
  db.prepare("INSERT INTO suppliers (id, name) VALUES (1, 'Supplier Uji')").run();
  return { database, db };
}

function insertOpening(db: DatabaseSync, productId: number, delta: number, batchRef: string): void {
  db.prepare(
    `INSERT INTO inventory_movements (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
     VALUES (?, 'OPENING', ?, ?, 1, ?)`,
  ).run(productId, delta, batchRef, FIXED_NOW);
}

function insertSaleFixture(db: DatabaseSync, productId: number, quantity: number): number {
  const ids = fixtureIds();
  db.prepare(
    `INSERT INTO shifts (id, cashier_id, opened_at_ms, opening_cash_rp)
     VALUES (10, ?, ?, 50000)`,
  ).run(ids.cashierId, FIXED_NOW);
  db.prepare(
    `INSERT INTO checkout_attempts (attempt_key, shift_id, cashier_id, request_hash, prepared_at_ms)
     VALUES ('attempt-inv-1', 10, ?, zeroblob(32), ?)`,
  ).run(ids.cashierId, FIXED_NOW);
  db.prepare(
    `INSERT INTO sales (id, sale_no, attempt_key, committed_at_ms, total_rp)
     VALUES (20, 'SALE-INV-0001', 'attempt-inv-1', ?, ?)`,
  ).run(FIXED_NOW, quantity * 1000);
  const item = db
    .prepare(
      `INSERT INTO sale_items (sale_id, product_id, sku_snapshot, name_snapshot, quantity, unit_price_rp, line_total_rp)
       VALUES (20, ?, 'FX-001', 'Fixture Produk', ?, 1000, ?)`,
    )
    .run(productId, quantity, quantity * 1000);
  return Number(item.lastInsertRowid);
}

test("AC-08.02/AC-03.06: produk tanpa mutasi bersaldo 0; ledger adalah sumber saldo", () => {
  const { database, db } = setup();
  try {
    const empty = getStockBalance(db, 2);
    assert.ok(empty);
    assert.equal(empty.onHand, 0);
    assert.equal(empty.hasMovements, false);
    assert.equal(listStockBalances(db).length, 2);

    insertOpening(db, 1, 10, "LEDGER-OPEN-1");
    const product1 = getStockBalance(db, 1);
    assert.ok(product1);
    assert.equal(product1.onHand, 10);
    assert.equal(product1.hasMovements, true);
    assert.equal(getStockBalance(db, 9999), null);
    assert.throws(
      () => getStockBalance(db, 0),
      (error: unknown) => error instanceof ValidationError && error.field === "productId",
    );
  } finally {
    db.close();
    database.cleanup();
  }
});

test("AC-08.02: fixture +10 opening dan -3 sale menghasilkan 7 dengan riwayat sumber", () => {
  const { database, db } = setup();
  try {
    insertOpening(db, 1, 10, "LEDGER-OPEN-1");
    const saleItemId = insertSaleFixture(db, 1, 3);
    db.prepare(
      `INSERT INTO inventory_movements (product_id, kind, delta, sale_item_id, actor_id, created_at_ms)
       VALUES (1, 'SALE', -3, ?, 2, ?)`,
    ).run(saleItemId, FIXED_NOW + 1);

    const balance = getStockBalance(db, 1);
    assert.equal(balance?.onHand, 7);

    const history = listStockMovements(db, 1);
    assert.equal(history.length, 2);
    const opening = history.find((row) => row.kind === "OPENING");
    const sale = history.find((row) => row.kind === "SALE");
    assert.equal(opening?.sourceType, "OPENING");
    assert.equal(opening?.sourceRef, "LEDGER-OPEN-1");
    assert.equal(opening?.delta, 10);
    assert.equal(sale?.sourceType, "SALE_ITEM");
    assert.equal(sale?.sourceRef, "SALE-INV-0001");
    assert.equal(sale?.sourceQuantity, 3);
    assert.equal(sale?.delta, -3);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("AC-08.02: rekonsiliasi per SKU menjumlahkan opening + penerimaan - penjualan + penyesuaian", () => {
  const { database, db } = setup();
  try {
    insertOpening(db, 1, 10, "LEDGER-OPEN-1");
    const saleItemId = insertSaleFixture(db, 1, 3);
    db.prepare(
      `INSERT INTO inventory_movements (product_id, kind, delta, sale_item_id, actor_id, created_at_ms)
       VALUES (1, 'SALE', -3, ?, 2, ?)`,
    ).run(saleItemId, FIXED_NOW + 1);
    db.prepare(
      `INSERT INTO goods_receipts (id, receipt_key, request_hash, supplier_id, received_by, committed_at_ms)
       VALUES (1, 'RCV-INV-1', zeroblob(32), 1, 1, ?)`,
    ).run(FIXED_NOW + 2);
    const receiptItem = db
      .prepare(
        `INSERT INTO receipt_items (receipt_id, product_id, quantity) VALUES (1, 1, 4)`,
      )
      .run();
    db.prepare(
      `INSERT INTO inventory_movements (product_id, kind, delta, receipt_item_id, actor_id, created_at_ms)
       VALUES (1, 'RECEIPT', 4, ?, 1, ?)`,
    ).run(Number(receiptItem.lastInsertRowid), FIXED_NOW + 3);
    db.prepare(
      `INSERT INTO inventory_movements (product_id, kind, delta, adjustment_reason, actor_id, created_at_ms)
       VALUES (1, 'ADJUSTMENT', -1, 'susut uji', 1, ?)`,
    ).run(FIXED_NOW + 4);

    const report = reconcileProduct(db, 1);
    assert.equal(report.opening, 10);
    assert.equal(report.receipt, 4);
    assert.equal(report.sale, -3);
    assert.equal(report.adjustment, -1);
    assert.equal(report.computedOnHand, 10);
    assert.equal(report.ledgerOnHand, 10);
    assert.equal(report.matched, true);
    assert.deepEqual(report.issues, []);
    assert.equal(reconcileAll(db).length, 2);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("AC-03.06: penjaga stok menolak saldo negatif/kurang tanpa mengubah ledger atau audit", () => {
  const { database, db } = setup();
  try {
    insertOpening(db, 1, 1, "LEDGER-OPEN-1");
    const before = getStockBalance(db, 1)?.onHand;
    const movementsBefore = listStockMovements(db, 1).length;
    assert.throws(
      () => assertSufficientStock(db, 1, 2),
      (error: unknown) => error instanceof InsufficientStockError && error.httpStatus === 409,
    );
    assert.equal(getStockBalance(db, 1)?.onHand, before);
    assert.equal(listStockMovements(db, 1).length, movementsBefore);
    assertSufficientStock(db, 1, 1);
    assert.throws(
      () => assertSufficientStock(db, 9999, 1),
      (error: unknown) => error instanceof NotFoundError,
    );
    assert.throws(
      () => assertSufficientStock(db, 1, 0),
      (error: unknown) => error instanceof ValidationError,
    );
  } finally {
    db.close();
    database.cleanup();
  }
});

test("Sinkron katalog: stockOnHand catalog sama dengan ledger", () => {
  const { database, db } = setup();
  try {
    insertOpening(db, 1, 10, "LEDGER-OPEN-1");
    const service = createCatalogService(db, { now: () => FIXED_NOW });
    const actor = { userId: fixtureIds().adminId, role: "ADMIN" as const };
    const products = service.listProducts(actor, { query: "Fixture Produk" });
    assert.equal(products[0]?.stockOnHand, getStockBalance(db, 1)?.onHand);
    assert.equal(products[0]?.stockOnHand, 10);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("Constraint DB menolak mutasi ilegal dan OPENING ganda", () => {
  const { database, db } = setup();
  try {
    insertOpening(db, 1, 10, "LEDGER-OPEN-1");
    assert.throws(
      () => insertOpening(db, 1, 5, "LEDGER-OPEN-2"),
      /UNIQUE constraint failed/,
    );
    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO inventory_movements (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
           VALUES (2, 'OPENING', -5, 'BAD', 1, ?)`,
        ).run(FIXED_NOW),
      /CHECK constraint failed/,
    );
    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO inventory_movements (product_id, kind, delta, actor_id, created_at_ms)
           VALUES (2, 'SALE', -1, 1, ?)`,
        ).run(FIXED_NOW),
      /CHECK constraint failed/,
    );
    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO inventory_movements (product_id, kind, delta, actor_id, created_at_ms)
           VALUES (2, 'ADJUSTMENT', -1, 1, ?)`,
        ).run(FIXED_NOW),
      /CHECK constraint failed/,
    );
  } finally {
    db.close();
    database.cleanup();
  }
});

test("BUG-009: reconcileProduct menandai matched=false dan melaporkan issue jika delta SALE berbeda dari -quantity sale_items", () => {
  const { database, db } = setup();
  try {
    insertOpening(db, 1, 10, "LEDGER-OPEN-1");
    const saleItemId = insertSaleFixture(db, 1, 4);
    // Delta SALE seharusnya -4 (sesuai sale_items.quantity = 4), tetapi dicatat -2.
    const movement = db
      .prepare(
        `INSERT INTO inventory_movements (product_id, kind, delta, sale_item_id, actor_id, created_at_ms)
         VALUES (1, 'SALE', -2, ?, 2, ?)`,
      )
      .run(saleItemId, FIXED_NOW + 1);
    const movementId = Number(movement.lastInsertRowid);

    const report = reconcileProduct(db, 1);
    assert.equal(report.opening, 10);
    assert.equal(report.sale, -2);
    assert.equal(report.computedOnHand, 8);
    assert.equal(report.ledgerOnHand, 8);
    assert.equal(report.matched, false);
    assert.equal(report.issues.length, 1);
    assert.match(report.issues[0]!, /SALE/);
    assert.match(report.issues[0]!, new RegExp(`#${movementId}`));
    assert.match(report.issues[0]!, /delta -2/);
    assert.match(report.issues[0]!, /-4/);
  } finally {
    db.close();
    database.cleanup();
  }
});
