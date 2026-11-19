import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTempDatabase,
  fixtureIds,
  insertBaseFixture,
  migrateFresh,
} from "../../db/test/helpers.ts";
import { ForbiddenError, ValidationError } from "../auth/errors.ts";
import type { SessionUser } from "../auth/session.ts";
import { createReportService } from "./service.ts";

// Zona operasional belum disahkan; fixture memakai epoch ms UTC dan batas
// setengah terbuka [start, end) sesuai DATABASE.md §2.
const MIDNIGHT = Date.UTC(2026, 10, 15);
const HOUR = 3_600_000;

function setup() {
  const database = createTempDatabase("pos-report-test-");
  const db = database.open();
  migrateFresh(database);
  insertBaseFixture(db);
  const ids = fixtureIds();
  db.prepare(
    "INSERT INTO products (id, category_id, sku, name, price_rp, active) VALUES (2, 1, 'FX-002', 'Produk Dua', 1000, 1)",
  ).run();
  db.prepare("INSERT INTO suppliers (id, name) VALUES (1, 'Supplier Uji')").run();

  // Dua shift melintasi tengah malam: shift 10 sudah ditutup, shift 11 aktif.
  db.prepare(
    `INSERT INTO shifts (id, cashier_id, opened_at_ms, closed_at_ms, opening_cash_rp)
     VALUES (10, ?, ?, ?, 50000)`,
  ).run(ids.cashierId, MIDNIGHT - 2 * HOUR, MIDNIGHT + HOUR);
  db.prepare(
    `INSERT INTO shifts (id, cashier_id, opened_at_ms, opening_cash_rp)
     VALUES (11, ?, ?, 50000)`,
  ).run(ids.otherCashierId, MIDNIGHT + 2 * HOUR);

  const attempt = db.prepare(
    `INSERT INTO checkout_attempts (attempt_key, shift_id, cashier_id, request_hash, prepared_at_ms, abandoned_at_ms)
     VALUES (?, ?, ?, zeroblob(32), ?, ?)`,
  );
  attempt.run("co-before", 10, ids.cashierId, MIDNIGHT - HOUR, null);
  attempt.run("co-midnight", 10, ids.cashierId, MIDNIGHT, null);
  attempt.run("co-after", 10, ids.cashierId, MIDNIGHT + 30 * 60_000, null);
  attempt.run("co-next", 11, ids.otherCashierId, MIDNIGHT + 3 * HOUR, null);
  attempt.run("co-draft", 10, ids.cashierId, MIDNIGHT, null);
  attempt.run("co-abandoned", 10, ids.cashierId, MIDNIGHT, MIDNIGHT + 10 * 60_000);

  const sale = db.prepare(
    `INSERT INTO sales (id, sale_no, attempt_key, committed_at_ms, total_rp)
     VALUES (?, ?, ?, ?, ?)`,
  );
  sale.run(1, "S-000001", "co-before", MIDNIGHT - HOUR, 5000);
  sale.run(2, "S-000002", "co-midnight", MIDNIGHT, 2500);
  sale.run(3, "S-000003", "co-after", MIDNIGHT + 30 * 60_000, 2500);
  sale.run(4, "S-000004", "co-next", MIDNIGHT + 3 * HOUR, 2500);

  const item = db.prepare(
    `INSERT INTO sale_items (sale_id, product_id, sku_snapshot, name_snapshot, quantity, unit_price_rp, line_total_rp)
     VALUES (?, 1, 'FX-001', 'Fixture Produk', ?, 2500, ?)`,
  );
  item.run(1, 2, 5000);
  item.run(2, 1, 2500);
  item.run(3, 1, 2500);
  item.run(4, 1, 2500);

  const pay = db.prepare(
    `INSERT INTO payments (sale_id, method_code, amount_rp, verified_by, verified_at_ms)
     VALUES (?, ?, ?, ?, ?)`,
  );
  pay.run(1, "CASH", 5000, null, null);
  pay.run(2, "QRIS_MANUAL", 2500, ids.cashierId, MIDNIGHT);
  pay.run(3, "CASH", 2500, null, null);
  pay.run(4, "CASH", 2500, null, null);

  db.prepare(
    `INSERT INTO inventory_movements (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
     VALUES (1, 'OPENING', 10, 'REPORT-OPEN-1', ?, ?)`,
  ).run(ids.adminId, MIDNIGHT - 3 * HOUR);
  db.prepare(
    `INSERT INTO goods_receipts (id, receipt_key, request_hash, supplier_id, received_by, committed_at_ms, supplier_ref)
     VALUES (1, 'rcv-report-1', zeroblob(32), 1, ?, ?, 'SJ-1')`,
  ).run(ids.adminId, MIDNIGHT - 2 * HOUR);
  db.prepare(
    "INSERT INTO receipt_items (id, receipt_id, product_id, quantity) VALUES (1, 1, 1, 5)",
  ).run();
  db.prepare(
    `INSERT INTO inventory_movements (product_id, kind, delta, receipt_item_id, actor_id, created_at_ms)
     VALUES (1, 'RECEIPT', 5, 1, ?, ?)`,
  ).run(ids.adminId, MIDNIGHT - 2 * HOUR);
  const saleMovement = db.prepare(
    `INSERT INTO inventory_movements (product_id, kind, delta, sale_item_id, actor_id, created_at_ms)
     VALUES (1, 'SALE', ?, ?, ?, ?)`,
  );
  for (const [itemId, qty, time] of [
    [1, -2, MIDNIGHT - HOUR],
    [2, -1, MIDNIGHT],
    [3, -1, MIDNIGHT + 30 * 60_000],
    [4, -1, MIDNIGHT + 3 * HOUR],
  ] as Array<[number, number, number]>) {
    saleMovement.run(qty, itemId, ids.cashierId, time);
  }

  const admin: SessionUser = { userId: ids.adminId, username: "admin.fixture", role: "ADMIN" };
  const cashier: SessionUser = { userId: ids.cashierId, username: "kasir.fixture", role: "CASHIER" };
  return { database, db, admin, cashier };
}

test("AC-08.01: filter [start,end) memilih penjualan COMMITTED tepat satu kali", () => {
  const { database, db, admin } = setup();
  try {
    const service = createReportService(db);
    const report = service.getDailyReport(admin, {
      startMs: MIDNIGHT - 2 * HOUR,
      endMs: MIDNIGHT + 2 * HOUR,
    });
    assert.equal(report.startMs, MIDNIGHT - 2 * HOUR);
    assert.equal(report.endMs, MIDNIGHT + 2 * HOUR);
    assert.equal(report.cash.totalRp, 7500);
    assert.equal(report.cash.count, 2);
    assert.equal(report.qrisManual.totalRp, 2500);
    assert.equal(report.qrisManual.count, 1);
    assert.equal(report.qrisManual.verifiedCount, 1);
    assert.equal(report.totalRp, 10_000);
    assert.equal(report.saleCount, 3);
    assert.deepEqual(
      report.sales.map((row) => row.saleNo).sort(),
      ["S-000001", "S-000002", "S-000003"],
    );
    assert.equal(report.sales.some((row) => row.saleNo === "S-000004"), false);
    assert.equal(report.salesTruncated, false);
    // QRIS tidak masuk kas laci.
    assert.equal(report.cash.totalRp + report.qrisManual.totalRp, report.totalRp);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("AC-08.01: sale tepat di start masuk, di end tidak masuk; filter shift memisahkan dua shift", () => {
  const { database, db, admin } = setup();
  try {
    const service = createReportService(db);
    const boundary = service.getDailyReport(admin, {
      startMs: MIDNIGHT,
      endMs: MIDNIGHT + HOUR,
    });
    assert.deepEqual(
      boundary.sales.map((row) => row.saleNo).sort(),
      ["S-000002", "S-000003"],
    );
    assert.equal(boundary.saleCount, 2);

    const nextShift = service.getDailyReport(admin, {
      startMs: MIDNIGHT - 3 * HOUR,
      endMs: MIDNIGHT + 5 * HOUR,
      shiftId: 11,
    });
    assert.equal(nextShift.shiftId, 11);
    assert.deepEqual(
      nextShift.sales.map((row) => row.saleNo),
      ["S-000004"],
    );
    assert.equal(nextShift.totalRp, 2500);

    const oldShift = service.getDailyReport(admin, {
      startMs: MIDNIGHT - 3 * HOUR,
      endMs: MIDNIGHT + 5 * HOUR,
      shiftId: 10,
    });
    assert.equal(oldShift.saleCount, 3, "shift yang ditutup tetap masuk rekap");
  } finally {
    db.close();
    database.cleanup();
  }
});

test("AC-08.02: laporan stok dari ledger dengan saldo, komponen, dan sumber mutasi", () => {
  const { database, db, admin } = setup();
  try {
    const service = createReportService(db);
    const report = service.getStockReport(admin, { lowStockThreshold: 2 });
    const product1 = report.products.find((row) => row.productId === 1);
    assert.ok(product1);
    assert.equal(product1.onHand, 10);
    assert.equal(product1.opening, 10);
    assert.equal(product1.receipt, 5);
    assert.equal(product1.sale, -5);
    assert.equal(product1.adjustment, 0);
    assert.equal(product1.matched, true);
    assert.equal(product1.low, false);
    assert.equal(product1.zero, false);
    assert.equal(product1.movements.length, 6);
    assert.ok(product1.movements.some((movement) => movement.sourceRef === "rcv-report-1"));
    assert.ok(product1.movements.some((movement) => movement.sourceRef === "S-000002"));
    assert.equal(product1.movementsTruncated, false);

    const product2 = report.products.find((row) => row.productId === 2);
    assert.ok(product2);
    assert.equal(product2.onHand, 0);
    assert.equal(product2.zero, true);
    assert.equal(product2.low, false);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("Laporan stok membatasi rincian ke 20 entri terbaru tanpa mengubah rekonsiliasi", () => {
  const { database, db, admin } = setup();
  try {
    for (let i = 0; i < 25; i += 1) {
      db.prepare(
        `INSERT INTO inventory_movements (product_id, kind, delta, adjustment_reason, actor_id, created_at_ms)
         VALUES (2, 'ADJUSTMENT', 1, 'uji batas rincian', ?, ?)`,
      ).run(admin.userId, MIDNIGHT + i * 1000);
    }
    const oldest = (
      db
        .prepare("SELECT MIN(id) AS id FROM inventory_movements WHERE product_id = 2")
        .get() as { id: number }
    ).id;
    const newest = (
      db
        .prepare("SELECT MAX(id) AS id FROM inventory_movements WHERE product_id = 2")
        .get() as { id: number }
    ).id;
    const expectedIds = (
      db
        .prepare(
          "SELECT id FROM inventory_movements WHERE product_id = 2 ORDER BY id DESC LIMIT 20",
        )
        .all() as Array<{ id: number }>
    )
      .map((row) => row.id)
      .sort((a, b) => a - b);
    const service = createReportService(db);
    const report = service.getStockReport(admin, {});
    const product2 = report.products.find((row) => row.productId === 2);
    assert.ok(product2);
    assert.equal(product2.onHand, 25, "agregat memakai seluruh mutasi");
    assert.equal(product2.movements.length, 20);
    assert.equal(product2.movementsTruncated, true);
    assert.equal(
      product2.movements.some((movement) => movement.id === oldest),
      false,
      "entri terlama dibuang dari rincian",
    );
    assert.equal(
      product2.movements.some((movement) => movement.id === newest),
      true,
      "mutasi terbaru tetap muncul",
    );
    const ids = product2.movements.map((movement) => movement.id);
    assert.deepEqual(ids, [...ids].sort((a, b) => a - b), "urutan lama→baru dipertahankan");
    assert.deepEqual(ids, expectedIds, "tepat 20 ID mutasi terbaru");
  } finally {
    db.close();
    database.cleanup();
  }
});

test("AC-01.03/AC-08.01: CASHIER ditolak; filter invalid tidak mengubah data", () => {
  const { database, db, admin, cashier } = setup();
  try {
    const service = createReportService(db);
    const before = (db.prepare("SELECT COUNT(*) AS total FROM sales").get() as { total: number }).total;
    assert.throws(
      () => service.getDailyReport(cashier, { startMs: 0, endMs: MIDNIGHT }),
      (error: unknown) => error instanceof ForbiddenError && error.httpStatus === 403,
    );
    assert.throws(
      () => service.getStockReport(cashier, {}),
      (error: unknown) => error instanceof ForbiddenError && error.httpStatus === 403,
    );

    for (const filter of [
      { startMs: -1, endMs: MIDNIGHT },
      { startMs: MIDNIGHT, endMs: MIDNIGHT },
      { startMs: MIDNIGHT, endMs: MIDNIGHT - 1 },
      { startMs: 0, endMs: MIDNIGHT, shiftId: -1 },
    ]) {
      assert.throws(
        () => service.getDailyReport(admin, filter),
        (error: unknown) => error instanceof ValidationError && error.httpStatus === 422,
      );
    }
    assert.throws(
      () => service.getStockReport(admin, { lowStockThreshold: -1 }),
      (error: unknown) => error instanceof ValidationError,
    );
    assert.equal((db.prepare("SELECT COUNT(*) AS total FROM sales").get() as { total: number }).total, before);
  } finally {
    db.close();
    database.cleanup();
  }
});
