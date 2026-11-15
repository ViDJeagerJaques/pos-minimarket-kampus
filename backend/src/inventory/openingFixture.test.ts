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
import { writeInventoryAudit } from "./audit.ts";
import { ConflictError, NotFoundError, ValidationError } from "./errors.ts";
import { applyOpeningFixture } from "./openingFixture.ts";
import { getStockBalance, listStockBalances } from "./ledger.ts";

const BATCH = "OPENING-TEST-1";

function setup() {
  const database = createTempDatabase("pos-opening-test-");
  const db = database.open();
  migrateFresh(database);
  insertBaseFixture(db);
  db.prepare(
    "INSERT INTO products (id, category_id, sku, name, price_rp, active) VALUES (2, 1, 'FX-002', 'Produk Dua', 1500, 1)",
  ).run();
  return { database, db };
}

function counts(db: DatabaseSync) {
  const count = (table: string): number =>
    Number(
      (db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total,
    );
  return { movements: count("inventory_movements"), audit: count("audit_log") };
}

function auditRows(db: DatabaseSync) {
  return (db.prepare("SELECT * FROM audit_log ORDER BY id").all() as Array<
    Record<string, unknown>
  >).map((row) => ({ ...row }));
}

test("Fixture +10/+5 tersimpan; menjalankan dua kali batch sama tidak menggandakan stok", () => {
  const { database, db } = setup();
  try {
    const adminId = fixtureIds().adminId;
    const first = applyOpeningFixture(db, {
      batchRef: BATCH,
      entries: [
        { productId: 1, quantity: 10 },
        { productId: 2, quantity: 5 },
      ],
      actorId: adminId,
      now: () => FIXED_NOW,
    });
    assert.deepEqual(first.applied, [
      { productId: 1, sku: "FX-001", quantity: 10 },
      { productId: 2, sku: "FX-002", quantity: 5 },
    ]);
    assert.deepEqual(first.skipped, []);
    assert.equal(getStockBalance(db, 1)?.onHand, 10);
    assert.equal(getStockBalance(db, 2)?.onHand, 5);
    assert.deepEqual(counts(db), { movements: 2, audit: 2 });

    const second = applyOpeningFixture(db, {
      batchRef: BATCH,
      entries: [
        { productId: 1, quantity: 10 },
        { productId: 2, quantity: 5 },
      ],
      actorId: adminId,
      now: () => FIXED_NOW,
    });
    assert.deepEqual(second.applied, []);
    assert.equal(second.skipped.length, 2);
    assert.equal(getStockBalance(db, 1)?.onHand, 10, "stok tidak boleh ganda");
    assert.equal(getStockBalance(db, 2)?.onHand, 5, "stok tidak boleh ganda");
    assert.deepEqual(counts(db), { movements: 2, audit: 2 });

    const audit = auditRows(db);
    assert.equal(audit.length, 2);
    const details = JSON.parse(String(audit[0]?.details)) as Record<string, unknown>;
    assert.equal(details.batchRef, BATCH);
    assert.equal(details.quantity, 10);
    assert.equal(details.sku, "FX-001");
    for (const row of audit) {
      const blob = JSON.stringify(row);
      assert.equal(blob.includes("password"), false);
      assert.equal(blob.includes("token"), false);
      assert.equal(blob.includes("scrypt$"), false);
    }
  } finally {
    db.close();
    database.cleanup();
  }
});

test("Batch berbeda ditolak 409 tanpa mengubah saldo/ledger/audit", () => {
  const { database, db } = setup();
  try {
    const adminId = fixtureIds().adminId;
    applyOpeningFixture(db, {
      batchRef: BATCH,
      entries: [{ productId: 1, quantity: 10 }],
      actorId: adminId,
      now: () => FIXED_NOW,
    });
    const before = counts(db);
    assert.throws(
      () =>
        applyOpeningFixture(db, {
          batchRef: "OPENING-TEST-2",
          entries: [{ productId: 1, quantity: 10 }],
          actorId: adminId,
          now: () => FIXED_NOW,
        }),
      (error: unknown) => error instanceof ConflictError && error.httpStatus === 409,
    );
    assert.equal(getStockBalance(db, 1)?.onHand, 10);
    assert.deepEqual(counts(db), before);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("Kegagalan di tengah fixture rollback utuh (produk tidak ada)", () => {
  const { database, db } = setup();
  try {
    const adminId = fixtureIds().adminId;
    assert.throws(
      () =>
        applyOpeningFixture(db, {
          batchRef: BATCH,
          entries: [
            { productId: 1, quantity: 10 },
            { productId: 9999, quantity: 1 },
          ],
          actorId: adminId,
          now: () => FIXED_NOW,
        }),
      (error: unknown) => error instanceof NotFoundError,
    );
    assert.equal(getStockBalance(db, 1)?.onHand, 0);
    assert.deepEqual(counts(db), { movements: 0, audit: 0 });
    assert.equal(listStockBalances(db).every((row) => row.onHand === 0), true);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("Input tidak valid ditolak sebelum transaksi; audit gagal membatalkan mutasi", () => {
  const { database, db } = setup();
  try {
    const adminId = fixtureIds().adminId;
    const invalid: Array<[string, unknown]> = [
      ["entries kosong", { batchRef: BATCH, entries: [], actorId: adminId }],
      ["batch kosong", { batchRef: "   ", entries: [{ productId: 1, quantity: 1 }], actorId: adminId }],
      ["qty nol", { batchRef: BATCH, entries: [{ productId: 1, quantity: 0 }], actorId: adminId }],
      ["product ganda", { batchRef: BATCH, entries: [{ productId: 1, quantity: 1 }, { productId: 1, quantity: 2 }], actorId: adminId }],
      ["actor tidak aktif", { batchRef: BATCH, entries: [{ productId: 1, quantity: 1 }], actorId: 9999 }],
    ];
    for (const [label, input] of invalid) {
      assert.throws(
        () => applyOpeningFixture(db, input as never),
        (error: unknown) => error instanceof ValidationError,
        label,
      );
    }
    assert.deepEqual(counts(db), { movements: 0, audit: 0 });

    assert.throws(
      () =>
        applyOpeningFixture(db, {
          batchRef: BATCH,
          entries: [{ productId: 1, quantity: 10 }],
          actorId: adminId,
          now: () => -1,
        }),
      /CHECK constraint failed|NOT NULL constraint failed/,
    );
    assert.deepEqual(counts(db), { movements: 0, audit: 0 });
    assert.equal(getStockBalance(db, 1)?.onHand, 0);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("Whitelist audit inventaris menolak event di luar daftar", () => {
  const { database, db } = setup();
  try {
    assert.throws(
      () =>
        writeInventoryAudit(db, {
          actorId: fixtureIds().adminId,
          action: "DELETE_STOCK" as never,
          entityType: "products",
          entityId: 1,
          details: {},
          nowMs: FIXED_NOW,
        }),
      /Event audit inventaris tidak terdaftar/,
    );
  } finally {
    db.close();
    database.cleanup();
  }
});
