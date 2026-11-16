import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { canonicalCheckoutPayload, CHECKOUT_HASH_VERSION } from "../../../shared/checkoutHash.ts";
import { ForbiddenError } from "../auth/errors.ts";
import type { SessionUser } from "../auth/session.ts";
import {
  createTempDatabase,
  FIXED_NOW,
  fixtureIds,
  insertBaseFixture,
  migrateFresh,
} from "../../db/test/helpers.ts";
import { getStockBalance } from "../inventory/ledger.ts";
import { createShiftService } from "../shift/service.ts";
import {
  AttemptAbandonedError,
  IdempotencyConflictError,
  InsufficientStockError,
  PriceChangedError,
  ShiftNotActiveError,
  ValidationError,
} from "./errors.ts";
import { computeCheckoutHash, createCheckoutService } from "./service.ts";

function setup() {
  const database = createTempDatabase("pos-checkout-test-");
  const db = database.open();
  migrateFresh(database);
  insertBaseFixture(db);
  const ids = fixtureIds();
  db.prepare(
    `INSERT INTO products (id, category_id, sku, name, price_rp, active)
     VALUES (2, 1, 'FX-002', 'Produk Kedua', 2500, 1)`,
  ).run();
  db.prepare(
    `INSERT INTO products (id, category_id, sku, name, price_rp, active)
     VALUES (3, 1, 'FX-OFF', 'Produk Nonaktif', 1500, 0)`,
  ).run();
  db.prepare(
    `INSERT INTO inventory_movements (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
     VALUES (1, 'OPENING', 5, 'OPEN-CO-1', ?, ?)`,
  ).run(ids.adminId, FIXED_NOW);
  db.prepare(
    `INSERT INTO inventory_movements (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
     VALUES (2, 'OPENING', 1, 'OPEN-CO-2', ?, ?)`,
  ).run(ids.adminId, FIXED_NOW);

  const shiftService = createShiftService(db, { now: () => FIXED_NOW });
  const cashier: SessionUser = {
    userId: ids.cashierId,
    username: "kasir.fixture",
    role: "CASHIER",
  };
  const admin: SessionUser = {
    userId: ids.adminId,
    username: "admin.fixture",
    role: "ADMIN",
  };
  const shift = shiftService.openShift(cashier, { openingCashRp: 50000 });
  return { database, db, cashier, admin, shift };
}

function counts(db: DatabaseSync) {
  const count = (table: string) =>
    Number((db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total);
  return {
    attempts: count("checkout_attempts"),
    sales: count("sales"),
    saleItems: count("sale_items"),
    payments: count("payments"),
    movements: count("inventory_movements"),
    audits: count("audit_log"),
  };
}

test("Golden vector requestHash kanonis deterministik terlepas dari urutan item", () => {
  const canonicalA = canonicalCheckoutPayload({
    version: CHECKOUT_HASH_VERSION,
    cashierId: 2,
    shiftId: 10,
    items: [
      { productId: 2, quantity: 1, unitPriceRp: 2500, lineTotalRp: 2500 },
      { productId: 1, quantity: 3, unitPriceRp: 1000, lineTotalRp: 3000 },
    ],
    totalRp: 5500,
    paymentMethod: "CASH",
  });
  const canonicalB = canonicalCheckoutPayload({
    version: CHECKOUT_HASH_VERSION,
    cashierId: 2,
    shiftId: 10,
    items: [
      { productId: 1, quantity: 3, unitPriceRp: 1000, lineTotalRp: 3000 },
      { productId: 2, quantity: 1, unitPriceRp: 2500, lineTotalRp: 2500 },
    ],
    totalRp: 5500,
    paymentMethod: "CASH",
  });

  const expectedCanonical =
    '{"version":"checkout-v1","cashierId":2,"shiftId":10,"items":[{"productId":1,"quantity":3,"unitPriceRp":1000,"lineTotalRp":3000},{"productId":2,"quantity":1,"unitPriceRp":2500,"lineTotalRp":2500}],"totalRp":5500,"paymentMethod":"CASH"}';
  assert.equal(canonicalA, expectedCanonical);
  assert.equal(canonicalB, expectedCanonical);

  const expectedHash = createHash("sha256").update(expectedCanonical, "utf8").digest("hex");
  const { hex } = computeCheckoutHash({
    cashierId: 2,
    shiftId: 10,
    items: [
      { productId: 1, sku: "A", name: "A", quantity: 3, unitPriceRp: 1000, lineTotalRp: 3000 },
      { productId: 2, sku: "B", name: "B", quantity: 1, unitPriceRp: 2500, lineTotalRp: 2500 },
    ],
    totalRp: 5500,
    payment: { method: "CASH" },
  });
  assert.equal(hex, expectedHash);
  assert.equal(
    expectedHash,
    "ded188d099c1cb1c7d89896945589d92790fb9dca854593aaa76ec2c9e0335ad",
  );
});

test("AC-03.02 & AC-03.06: menolak keranjang kosong, qty invalid, produk nonaktif, shift tidak aktif, dan stok kurang tanpa mutasi", () => {
  const { database, db, cashier, admin, shift } = setup();
  try {
    const checkout = createCheckoutService(db, { now: () => FIXED_NOW + 10 });
    const before = counts(db);

    assert.throws(
      () =>
        checkout.prepare(admin, {
          attemptKey: "co-admin",
          shiftId: shift.id,
          items: [{ productId: 1, quantity: 1 }],
          payment: { method: "CASH" },
        }),
      (error: unknown) => error instanceof ForbiddenError,
    );
    assert.throws(
      () =>
        checkout.prepare(cashier, {
          attemptKey: "co-empty",
          shiftId: shift.id,
          items: [],
          payment: { method: "CASH" },
        }),
      (error: unknown) => error instanceof ValidationError,
    );
    assert.throws(
      () =>
        checkout.prepare(cashier, {
          attemptKey: "co-neg",
          shiftId: shift.id,
          items: [{ productId: 1, quantity: 0 }],
          payment: { method: "CASH" },
        }),
      (error: unknown) => error instanceof ValidationError,
    );
    assert.throws(
      () =>
        checkout.prepare(cashier, {
          attemptKey: "co-inactive",
          shiftId: shift.id,
          items: [{ productId: 3, quantity: 1 }],
          payment: { method: "CASH" },
        }),
      (error: unknown) => error instanceof ValidationError,
    );
    assert.throws(
      () =>
        checkout.prepare(cashier, {
          attemptKey: "co-noshift",
          shiftId: 9999,
          items: [{ productId: 1, quantity: 1 }],
          payment: { method: "CASH" },
        }),
      (error: unknown) => error instanceof ShiftNotActiveError,
    );
    assert.throws(
      () =>
        checkout.prepare(cashier, {
          attemptKey: "co-stock",
          shiftId: shift.id,
          items: [{ productId: 2, quantity: 2 }],
          payment: { method: "CASH" },
        }),
      (error: unknown) => error instanceof InsufficientStockError && error.httpStatus === 409,
    );

    assert.deepEqual(counts(db), before);
    assert.equal(getStockBalance(db, 2)?.onHand, 1);

    // Koreksi ke qty 1 berhasil dan stok menjadi 0
    const prepared = checkout.prepare(cashier, {
      attemptKey: "co-stock-ok",
      shiftId: shift.id,
      items: [{ productId: 2, quantity: 1 }],
      payment: { method: "CASH" },
    });
    const committed = checkout.commit(cashier, {
      attemptKey: prepared.attemptKey,
      requestHash: prepared.requestHash,
      paymentConfirmation: { method: "CASH", cashReceivedRp: 5000 },
    });
    assert.equal(committed.status, "COMMITTED");
    assert.equal(committed.payment.changeRp, 2500);
    assert.equal(getStockBalance(db, 2)?.onHand, 0);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("AC-03.03 & AC-03.06 saat commit: harga berubah -> 409 PRICE_CHANGED; stok turun setelah prepare -> 409 INSUFFICIENT_STOCK", () => {
  const { database, db, cashier, admin, shift } = setup();
  try {
    const checkout = createCheckoutService(db, { now: () => FIXED_NOW + 10 });

    const preparedPrice = checkout.prepare(cashier, {
      attemptKey: "co-price-change",
      shiftId: shift.id,
      items: [{ productId: 1, quantity: 2 }],
      payment: { method: "CASH" },
    });
    // Harga produk 1 berubah setelah prepare
    db.prepare("UPDATE products SET price_rp = 1500 WHERE id = 1").run();

    assert.throws(
      () =>
        checkout.commit(cashier, {
          attemptKey: preparedPrice.attemptKey,
          requestHash: preparedPrice.requestHash,
          paymentConfirmation: { method: "CASH", cashReceivedRp: 5000 },
        }),
      (error: unknown) => error instanceof PriceChangedError && error.httpStatus === 409,
    );
    assert.equal(counts(db).sales, 0);
    assert.equal(getStockBalance(db, 1)?.onHand, 5);

    // Buat quote baru dengan attemptKey baru setelah harga berubah -> berhasil
    const rePrepared = checkout.prepare(cashier, {
      attemptKey: "co-price-change-v2",
      shiftId: shift.id,
      items: [{ productId: 1, quantity: 2 }],
      payment: { method: "CASH" },
    });
    assert.equal(rePrepared.quote.totalRp, 3000);

    // Stok produk 2 turun setelah prepare -> commit ditolak 409 tanpa mutasi
    const preparedStock = checkout.prepare(cashier, {
      attemptKey: "co-stock-race",
      shiftId: shift.id,
      items: [{ productId: 2, quantity: 1 }],
      payment: { method: "CASH" },
    });
    db.prepare(
      `INSERT INTO inventory_movements (product_id, kind, delta, adjustment_reason, actor_id, created_at_ms)
       VALUES (2, 'ADJUSTMENT', -1, 'rusak uji', ?, ?)`,
    ).run(admin.userId, FIXED_NOW + 15);

    assert.throws(
      () =>
        checkout.commit(cashier, {
          attemptKey: preparedStock.attemptKey,
          requestHash: preparedStock.requestHash,
          paymentConfirmation: { method: "CASH", cashReceivedRp: 5000 },
        }),
      (error: unknown) => error instanceof InsufficientStockError && error.httpStatus === 409,
    );
    assert.equal(counts(db).sales, 0);
    assert.equal(getStockBalance(db, 2)?.onHand, 0);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("AC-03.05: error sebelum COMMIT melakukan rollback penuh tanpa sale/payment/movement parsial", () => {
  const { database, db, cashier, shift } = setup();
  try {
    const checkout = createCheckoutService(db, { now: () => FIXED_NOW + 10 });
    const prepared = checkout.prepare(cashier, {
      attemptKey: "co-rollback",
      shiftId: shift.id,
      items: [{ productId: 1, quantity: 2 }],
      payment: { method: "CASH" },
    });
    const before = counts(db);

    db.exec(`
      CREATE TRIGGER test_fail_checkout_audit
      BEFORE INSERT ON audit_log
      BEGIN
        SELECT RAISE(ABORT, 'audit checkout failed');
      END;
    `);
    try {
      assert.throws(
        () =>
          checkout.commit(cashier, {
            attemptKey: prepared.attemptKey,
            requestHash: prepared.requestHash,
            paymentConfirmation: { method: "CASH", cashReceivedRp: 5000 },
          }),
        /audit checkout failed/,
      );
      assert.deepEqual(counts(db), before);
      assert.equal(getStockBalance(db, 1)?.onHand, 5);
    } finally {
      db.exec("DROP TRIGGER IF EXISTS test_fail_checkout_audit;");
    }
  } finally {
    db.close();
    database.cleanup();
  }
});

test("AC-04.01 & AC-03.04: dua commit paralel identik -> satu sale/payment/mutasi; key sama niat beda -> 409; retry sesudah shift tutup & status lookup", async () => {
  const { database, db, cashier, admin, shift } = setup();
  try {
    const checkout = createCheckoutService(db, { now: () => FIXED_NOW + 10 });
    const prepared = checkout.prepare(cashier, {
      attemptKey: "co-parallel-1",
      shiftId: shift.id,
      items: [
        { productId: 1, quantity: 2 },
        { productId: 2, quantity: 1 },
      ],
      payment: { method: "QRIS_MANUAL" },
    });

    // Tanpa merchantConfirmed -> ditolak 422
    assert.throws(
      () =>
        checkout.commit(cashier, {
          attemptKey: prepared.attemptKey,
          requestHash: prepared.requestHash,
          paymentConfirmation: {
            method: "QRIS_MANUAL",
            merchantConfirmed: false,
            confirmedAmountRp: prepared.quote.totalRp,
          },
        }),
      (error: unknown) => error instanceof ValidationError && error.httpStatus === 422,
    );

    // Dua commit paralel identik
    const [r1, r2] = await Promise.all([
      Promise.resolve().then(() =>
        checkout.commit(cashier, {
          attemptKey: prepared.attemptKey,
          requestHash: prepared.requestHash,
          paymentConfirmation: {
            method: "QRIS_MANUAL",
            merchantConfirmed: true,
            confirmedAmountRp: prepared.quote.totalRp,
          },
        }),
      ),
      Promise.resolve().then(() =>
        checkout.commit(cashier, {
          attemptKey: prepared.attemptKey,
          requestHash: prepared.requestHash,
          paymentConfirmation: {
            method: "QRIS_MANUAL",
            merchantConfirmed: true,
            confirmedAmountRp: prepared.quote.totalRp,
          },
        }),
      ),
    ]);

    assert.equal(r1.saleId, r2.saleId);
    assert.equal(r1.saleNo, r2.saleNo);
    assert.equal(r1.payment.verifiedBy, cashier.userId);
    assert.equal(counts(db).sales, 1);
    assert.equal(counts(db).payments, 1);
    assert.equal(counts(db).saleItems, 2);
    assert.equal(getStockBalance(db, 1)?.onHand, 3);
    assert.equal(getStockBalance(db, 2)?.onHand, 0);

    // Kunci sama + requestHash berbeda -> 409 IDEMPOTENCY_CONFLICT
    assert.throws(
      () =>
        checkout.commit(cashier, {
          attemptKey: prepared.attemptKey,
          requestHash: "0".repeat(64),
          paymentConfirmation: {
            method: "QRIS_MANUAL",
            merchantConfirmed: true,
            confirmedAmountRp: prepared.quote.totalRp,
          },
        }),
      (error: unknown) => error instanceof IdempotencyConflictError && error.httpStatus === 409,
    );

    // Kunci sama + metode bayar berbeda -> 409 IDEMPOTENCY_CONFLICT
    assert.throws(
      () =>
        checkout.commit(cashier, {
          attemptKey: prepared.attemptKey,
          requestHash: prepared.requestHash,
          paymentConfirmation: { method: "CASH", cashReceivedRp: 10000 },
        }),
      (error: unknown) => error instanceof IdempotencyConflictError && error.httpStatus === 409,
    );

    // Tutup shift, lalu retry commit identik & status lookup (simulasi response hilang)
    db.prepare("UPDATE shifts SET closed_at_ms = ? WHERE id = ?").run(FIXED_NOW + 50, shift.id);
    const retryAfterClose = checkout.commit(cashier, {
      attemptKey: prepared.attemptKey,
      requestHash: prepared.requestHash,
      paymentConfirmation: {
        method: "QRIS_MANUAL",
        merchantConfirmed: true,
        confirmedAmountRp: prepared.quote.totalRp,
      },
    });
    assert.equal(retryAfterClose.saleId, r1.saleId);
    assert.equal(counts(db).sales, 1);

    const statusByOwner = checkout.getStatus(cashier, prepared.attemptKey);
    assert.equal(statusByOwner.status, "COMMITTED");
    if (statusByOwner.status === "COMMITTED") {
      assert.equal(statusByOwner.saleId, r1.saleId);
      assert.equal(statusByOwner.saleNo, r1.saleNo);
    }
    const statusByAdmin = checkout.getStatus(admin, prepared.attemptKey);
    assert.equal(statusByAdmin.status, "COMMITTED");
  } finally {
    db.close();
    database.cleanup();
  }
});

test("AC-04.01: attempt ABANDONED tidak dapat di-commit", () => {
  const { database, db, cashier, shift } = setup();
  try {
    const checkout = createCheckoutService(db, { now: () => FIXED_NOW + 10 });
    const prepared = checkout.prepare(cashier, {
      attemptKey: "co-abandoned-1",
      shiftId: shift.id,
      items: [{ productId: 1, quantity: 1 }],
      payment: { method: "CASH" },
    });
    db.prepare("UPDATE checkout_attempts SET abandoned_at_ms = ? WHERE attempt_key = ?").run(
      FIXED_NOW + 20,
      prepared.attemptKey,
    );

    assert.throws(
      () =>
        checkout.commit(cashier, {
          attemptKey: prepared.attemptKey,
          requestHash: prepared.requestHash,
          paymentConfirmation: { method: "CASH", cashReceivedRp: 5000 },
        }),
      (error: unknown) => error instanceof AttemptAbandonedError && error.httpStatus === 409,
    );
    const status = checkout.getStatus(cashier, prepared.attemptKey);
    assert.equal(status.status, "ABANDONED");
  } finally {
    db.close();
    database.cleanup();
  }
});

test("BUG-014: retry commit dan status lookup mempertahankan cashReceivedRp/changeRp untuk CASH serta changeRp=0 untuk QRIS_MANUAL", () => {
  const { database, db, cashier, shift } = setup();
  try {
    const checkout = createCheckoutService(db, { now: () => FIXED_NOW + 10 });

    const cashPrep = checkout.prepare(cashier, {
      attemptKey: "co-bug014-cash",
      shiftId: shift.id,
      items: [{ productId: 2, quantity: 1 }],
      payment: { method: "CASH" },
    });
    const cashFirst = checkout.commit(cashier, {
      attemptKey: cashPrep.attemptKey,
      requestHash: cashPrep.requestHash,
      paymentConfirmation: { method: "CASH", cashReceivedRp: 5000 },
    });
    assert.equal(cashFirst.payment.cashReceivedRp, 5000);
    assert.equal(cashFirst.payment.changeRp, 2500);

    const cashRetry = checkout.commit(cashier, {
      attemptKey: cashPrep.attemptKey,
      requestHash: cashPrep.requestHash,
      paymentConfirmation: { method: "CASH", cashReceivedRp: 5000 },
    });
    assert.deepEqual(cashRetry, cashFirst);

    const cashStatus = checkout.getStatus(cashier, cashPrep.attemptKey);
    assert.deepEqual(cashStatus, cashFirst);

    const qrisPrep = checkout.prepare(cashier, {
      attemptKey: "co-bug014-qris",
      shiftId: shift.id,
      items: [{ productId: 1, quantity: 1 }],
      payment: { method: "QRIS_MANUAL" },
    });
    const qrisFirst = checkout.commit(cashier, {
      attemptKey: qrisPrep.attemptKey,
      requestHash: qrisPrep.requestHash,
      paymentConfirmation: {
        method: "QRIS_MANUAL",
        merchantConfirmed: true,
        confirmedAmountRp: qrisPrep.quote.totalRp,
      },
    });
    assert.equal(qrisFirst.payment.cashReceivedRp, null);
    assert.equal(qrisFirst.payment.changeRp, 0);

    const qrisRetry = checkout.commit(cashier, {
      attemptKey: qrisPrep.attemptKey,
      requestHash: qrisPrep.requestHash,
      paymentConfirmation: {
        method: "QRIS_MANUAL",
        merchantConfirmed: true,
        confirmedAmountRp: qrisPrep.quote.totalRp,
      },
    });
    assert.deepEqual(qrisRetry, qrisFirst);

    const qrisStatus = checkout.getStatus(cashier, qrisPrep.attemptKey);
    assert.deepEqual(qrisStatus, qrisFirst);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("BUG-015: prepare identik mengembalikan quote tersimpan meskipun harga produk berubah setelah prepare awal", () => {
  const { database, db, cashier, shift } = setup();
  try {
    const checkout = createCheckoutService(db, { now: () => FIXED_NOW + 10 });

    const first = checkout.prepare(cashier, {
      attemptKey: "co-bug015-replay",
      shiftId: shift.id,
      items: [{ productId: 1, quantity: 2 }],
      payment: { method: "CASH" },
    });

    // Harga berubah setelah prepare pertama
    db.prepare("UPDATE products SET price_rp = 9999 WHERE id = 1").run();

    // Retry prepare identik harus mengembalikan quote lama, bukan IDEMPOTENCY_CONFLICT
    const replay = checkout.prepare(cashier, {
      attemptKey: "co-bug015-replay",
      shiftId: shift.id,
      items: [{ productId: 1, quantity: 2 }],
      payment: { method: "CASH" },
    });
    assert.deepEqual(replay, first);

    // Prepare dengan key sama tetapi isi berbeda tetap ditolak 409 IDEMPOTENCY_CONFLICT
    assert.throws(
      () =>
        checkout.prepare(cashier, {
          attemptKey: "co-bug015-replay",
          shiftId: shift.id,
          items: [{ productId: 1, quantity: 3 }],
          payment: { method: "CASH" },
        }),
      (error: unknown) => error instanceof IdempotencyConflictError && error.httpStatus === 409,
    );
  } finally {
    db.close();
    database.cleanup();
  }
});
