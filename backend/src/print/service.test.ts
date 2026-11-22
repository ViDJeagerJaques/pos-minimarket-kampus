import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  createTempDatabase,
  fixtureIds,
  FIXED_NOW,
  insertBaseFixture,
  insertSaleFixture,
  migrateFresh,
} from "../../db/test/helpers.ts";
import { AuthRequiredError, ForbiddenError } from "../auth/errors.ts";
import type { SessionUser } from "../auth/session.ts";
import { PrintValidationError, PrinterUnavailableError, SaleNotFoundError } from "./errors.ts";
import { createFailingPrinterAdapter } from "./printer.ts";
import { createPrintService, type PrintService } from "./service.ts";

const ids = fixtureIds();
const cashier: SessionUser = { userId: ids.cashierId, username: "kasir.fixture", role: "CASHIER" };
const otherCashier: SessionUser = { userId: ids.otherCashierId, username: "kasir.lain", role: "CASHIER" };
const admin: SessionUser = { userId: ids.adminId, username: "admin.fixture", role: "ADMIN" };

function setup(printer?: ReturnType<typeof createFailingPrinterAdapter>): {
  db: DatabaseSync;
  saleId: number;
  cleanup: () => void;
  print: PrintService;
} {
  const database = createTempDatabase("pos-print-");
  const db = database.open();
  migrateFresh(database);
  insertBaseFixture(db);
  const { saleId } = insertSaleFixture(db);
  db.prepare(
    `INSERT INTO checkout_attempt_quotes (attempt_key, quote_json, cash_received_rp, change_rp)
     VALUES (?, '{}', 10000, 5000)`,
  ).run("attempt-fixture-1");
  db.prepare(
    "INSERT INTO payments (sale_id, method_code, amount_rp) VALUES (?, 'CASH', 5000)",
  ).run(saleId);
  return {
    db,
    saleId,
    cleanup: () => {
      db.close();
      database.cleanup();
    },
    print: createPrintService(db, {
      ...(printer ? { printer } : {}),
      now: () => FIXED_NOW + 100,
    }),
  };
}

function counts(db: DatabaseSync): Record<string, number> {
  const result: Record<string, number> = {};
  for (const table of ["sales", "sale_items", "payments", "inventory_movements", "audit_log"]) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
    result[table] = Number(row.n);
  }
  return result;
}

test("TASK-021 AC-04.03: struk dibangun dari snapshot sale, bukan harga katalog terkini", () => {
  const ctx = setup();
  try {
    ctx.db.prepare("UPDATE products SET price_rp = 9999 WHERE id = 1").run();
    const view = ctx.print.getReceipt(cashier, ctx.saleId);
    assert.equal(view.demo, true);
    assert.equal(view.receipt.saleNo, "SALE-FX-0001");
    assert.equal(view.receipt.totalRp, 5000);
    assert.equal(view.receipt.items[0]?.unitPriceRp, 2500);
    assert.match(view.text, /2 x Rp2500 = Rp5000/);
    assert.match(view.text, /SALE-FX-0001/);
  } finally {
    ctx.cleanup();
  }
});

test("TASK-021 RC-09: cetak ulang 2x memakai nomor/isi sama tanpa mutasi sale/payment/stok", () => {
  const ctx = setup();
  try {
    const before = counts(ctx.db);
    const first = ctx.print.print(cashier, ctx.saleId);
    const second = ctx.print.print(cashier, ctx.saleId);
    const third = ctx.print.print(cashier, ctx.saleId);
    assert.equal(first.status, "PRINTED");
    assert.equal(first.channel, "VIRTUAL");
    assert.equal(first.saleNo, "SALE-FX-0001");
    assert.equal(first.text, second.text);
    assert.equal(first.text, third.text);
    assert.equal(first.saleNo, second.saleNo);
    assert.equal(first.printedAtMs, FIXED_NOW + 100);
    assert.deepEqual(counts(ctx.db), before);
    assert.equal(ctx.print.getReceipt(cashier, ctx.saleId).receipt.saleNo, first.saleNo);
  } finally {
    ctx.cleanup();
  }
});

test("TASK-021: printer gagal => PRINTER_UNAVAILABLE, sale tetap utuh, tidak ada mutasi", () => {
  const ctx = setup(createFailingPrinterAdapter("printer mati (simulasi)"));
  try {
    const before = counts(ctx.db);
    assert.throws(
      () => ctx.print.print(cashier, ctx.saleId),
      (error: unknown) => {
        assert.ok(error instanceof PrinterUnavailableError);
        assert.equal(error.code, "PRINTER_UNAVAILABLE");
        assert.equal(error.httpStatus, 503);
        assert.equal(error.retryable, true);
        assert.match(error.message, /printer mati/);
        return true;
      },
    );
    assert.deepEqual(counts(ctx.db), before);
    const stillStored = ctx.print.getReceipt(cashier, ctx.saleId);
    assert.equal(stillStored.receipt.saleId, ctx.saleId);
    assert.equal(stillStored.receipt.saleNo, "SALE-FX-0001");
  } finally {
    ctx.cleanup();
  }
});

test("TASK-021 AUTH-07: cetak hanya CASHIER pemilik; ADMIN hanya membaca (K-03)", () => {
  const ctx = setup();
  try {
    assert.throws(() => ctx.print.getReceipt(otherCashier, ctx.saleId), ForbiddenError);
    assert.throws(() => ctx.print.print(otherCashier, ctx.saleId), ForbiddenError);
    assert.throws(() => ctx.print.print(admin, ctx.saleId), ForbiddenError);
    const adminView = ctx.print.getReceipt(admin, ctx.saleId);
    assert.equal(adminView.receipt.saleId, ctx.saleId);
  } finally {
    ctx.cleanup();
  }
});

test("TASK-021: akun nonaktif dan input/sale tidak valid ditolak tanpa data bocor", () => {
  const ctx = setup();
  try {
    ctx.db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(ids.cashierId);
    assert.throws(() => ctx.print.getReceipt(cashier, ctx.saleId), AuthRequiredError);
    ctx.db.prepare("UPDATE users SET active = 1 WHERE id = ?").run(ids.cashierId);
    assert.throws(() => ctx.print.print(cashier, 0), PrintValidationError);
    assert.throws(() => ctx.print.print(cashier, 99999), SaleNotFoundError);
    assert.throws(() => ctx.print.print(cashier, ctx.saleId, []), PrintValidationError);
  } finally {
    ctx.cleanup();
  }
});


test("Riwayat terbaru membatasi pemilik, mendukung ADMIN, dan hanya membaca DB", () => {
  const ctx = setup();
  try {
    const before = counts(ctx.db);
    const rows = ctx.print.getRecentSales(cashier);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].saleId, ctx.saleId);
    assert.equal(rows[0].method, "CASH");
    assert.deepEqual(ctx.print.getRecentSales(otherCashier), []);
    assert.deepEqual(ctx.print.getRecentSales(admin), rows);
    assert.deepEqual(counts(ctx.db), before);
    ctx.db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(cashier.userId);
    assert.throws(() => ctx.print.getRecentSales(cashier), AuthRequiredError);
  } finally { ctx.cleanup(); }
});

test("BUG-140: pembayaran ganda tetap menghasilkan 20 penjualan unik dengan metode pembayaran pertama", () => {
  const ctx = setup();
  try {
    for (let id = 21; id <= 40; id++) {
      const key = `recent-${id}`;
      ctx.db.prepare(`INSERT INTO checkout_attempts
        (attempt_key, shift_id, cashier_id, request_hash, prepared_at_ms)
        VALUES (?, 10, ?, zeroblob(32), ?)`)
        .run(key, cashier.userId, FIXED_NOW);
      ctx.db.prepare(`INSERT INTO sales (id, sale_no, attempt_key, committed_at_ms, total_rp)
        VALUES (?, ?, ?, ?, 5000)`)
        .run(id, `S-${id}`, key, FIXED_NOW + id);
      ctx.db.prepare("INSERT INTO payments (sale_id, method_code, amount_rp) VALUES (?, 'CASH', 5000)").run(id);
    }
    ctx.db.prepare(`INSERT INTO payments
      (sale_id, method_code, amount_rp, verified_by, verified_at_ms)
      VALUES (40, 'QRIS_MANUAL', 5000, ?, ?)`)
      .run(cashier.userId, FIXED_NOW + 40);
    const before = counts(ctx.db);
    const rows = ctx.print.getRecentSales(cashier);
    assert.equal(rows.length, 20);
    assert.equal(new Set(rows.map(row => row.saleId)).size, 20);
    assert.deepEqual(rows.map(row => row.saleId), Array.from({ length: 20 }, (_, i) => 40 - i));
    assert.equal(rows.filter(row => row.saleId === 40).length, 1);
    assert.equal(rows[0].method, "CASH");
    assert.deepEqual(counts(ctx.db), before);
  } finally { ctx.cleanup(); }
});
