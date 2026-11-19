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
import { ForbiddenError } from "../auth/errors.ts";
import type { SessionUser } from "../auth/session.ts";
import { getStockBalance } from "../inventory/ledger.ts";
import { writeReceivingAudit } from "./audit.ts";
import { IdempotencyConflictError, NotFoundError, ValidationError } from "./errors.ts";
import { createReceivingService, type ReceiveGoodsInput } from "./service.ts";

function setup() {
  const database = createTempDatabase("pos-receiving-test-");
  const db = database.open();
  migrateFresh(database);
  insertBaseFixture(db);
  const ids = fixtureIds();
  db.prepare("INSERT INTO suppliers (id, name) VALUES (1, 'Supplier Uji')").run();
  db.prepare(
    "INSERT INTO products (id, category_id, sku, name, price_rp, active) VALUES (2, 1, 'FX-002', 'Produk Dua', 1000, 1)",
  ).run();
  db.prepare(
    "INSERT INTO products (id, category_id, sku, name, price_rp, active) VALUES (3, 1, 'FX-OFF', 'Produk Nonaktif', 1500, 0)",
  ).run();
  db.prepare(
    `INSERT INTO inventory_movements (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
     VALUES (1, 'OPENING', 2, 'RECEIVE-OPEN-1', ?, ?)`,
  ).run(ids.adminId, FIXED_NOW);
  const admin: SessionUser = { userId: ids.adminId, username: "admin.fixture", role: "ADMIN" };
  const cashier: SessionUser = { userId: ids.cashierId, username: "kasir.fixture", role: "CASHIER" };
  return { database, db, admin, cashier };
}

const BASE_INPUT: ReceiveGoodsInput = {
  receiptKey: "rcv-1",
  supplierId: 1,
  items: [{ productId: 1, quantity: 5 }],
  supplierRef: "SJ-001",
};

function countRows(db: DatabaseSync, table: string): number {
  return Number(
    (db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total,
  );
}

function snapshot(db: DatabaseSync) {
  return {
    receipts: countRows(db, "goods_receipts"),
    items: countRows(db, "receipt_items"),
    movements: countRows(db, "inventory_movements"),
    audit: countRows(db, "audit_log"),
  };
}

test("AC-07.01: ADMIN menerima +5 -> satu dokumen, satu mutasi RECEIPT, saldo naik", () => {
  const { database, db, admin } = setup();
  try {
    const service = createReceivingService(db, { now: () => FIXED_NOW });
    const before = getStockBalance(db, 1)?.onHand;
    assert.equal(before, 2);

    const result = service.receiveGoods(admin, BASE_INPUT);
    assert.equal(result.duplicate, false);
    assert.equal(result.receiptKey, "rcv-1");
    assert.equal(result.supplierRef, "SJ-001");
    assert.equal(result.totalQuantity, 5);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.quantity, 5);
    assert.equal(result.items[0]?.movementId > 0, true);
    assert.equal(getStockBalance(db, 1)?.onHand, 7);

    assert.deepEqual(snapshot(db), { receipts: 1, items: 1, movements: 2, audit: 1 });
    const receipt = db
      .prepare("SELECT received_by, supplier_id, committed_at_ms FROM goods_receipts")
      .get() as { received_by: number; supplier_id: number; committed_at_ms: number };
    assert.equal(receipt.received_by, admin.userId, "actor berasal dari sesi, bukan body");
    assert.equal(receipt.committed_at_ms, FIXED_NOW);

    const movement = db
      .prepare("SELECT kind, delta, receipt_item_id, actor_id FROM inventory_movements WHERE kind = 'RECEIPT'")
      .get() as { kind: string; delta: number; receipt_item_id: number; actor_id: number };
    assert.equal(movement.delta, 5);
    assert.equal(movement.receipt_item_id, result.items[0]?.receiptItemId);
    assert.equal(movement.actor_id, admin.userId);

    const audit = db.prepare("SELECT * FROM audit_log").get() as {
      action: string;
      entity_type: string;
      entity_id: string;
      details: string;
    };
    assert.equal(audit.action, "GOODS_RECEIPT_COMMITTED");
    assert.equal(audit.entity_type, "goods_receipts");
    assert.equal(audit.entity_id, String(result.receiptId));
    const details = JSON.parse(audit.details) as Record<string, unknown>;
    assert.equal(details.receiptKey, "rcv-1");
    assert.equal(details.totalQuantity, 5);
    assert.equal(JSON.stringify(details).includes("SJ-001"), false, "referensi mentah tidak diduplikasi");
  } finally {
    db.close();
    database.cleanup();
  }
});

test("AC-01.03: CASHIER ditolak 403 tanpa perubahan DB", () => {
  const { database, db, cashier } = setup();
  try {
    const service = createReceivingService(db, { now: () => FIXED_NOW });
    const before = snapshot(db);
    assert.throws(
      () => service.receiveGoods(cashier, BASE_INPUT),
      (error: unknown) => error instanceof ForbiddenError && error.httpStatus === 403,
    );
    assert.deepEqual(snapshot(db), before);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("AC-07.02: receiptKey sama dua kali -> satu penerimaan; isi beda -> 409", () => {
  const { database, db, admin } = setup();
  try {
    const service = createReceivingService(db, { now: () => FIXED_NOW });
    const first = service.receiveGoods(admin, BASE_INPUT);
    const afterFirst = snapshot(db);

    const retry = service.receiveGoods(admin, { ...BASE_INPUT });
    assert.equal(retry.duplicate, true);
    assert.deepEqual(retry, { ...first, duplicate: true });
    assert.deepEqual(snapshot(db), afterFirst);
    assert.equal(getStockBalance(db, 1)?.onHand, 7);

    assert.throws(
      () =>
        service.receiveGoods(admin, {
          ...BASE_INPUT,
          items: [{ productId: 1, quantity: 6 }],
        }),
      (error: unknown) =>
        error instanceof IdempotencyConflictError && error.httpStatus === 409,
    );
    assert.throws(
      () => service.receiveGoods(admin, { ...BASE_INPUT, supplierRef: "SJ-002" }),
      (error: unknown) => error instanceof IdempotencyConflictError,
    );
    assert.deepEqual(snapshot(db), afterFirst);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("AC-07.01/07.02: input invalid dan draft yang dibatalkan tidak mengubah stok", () => {
  const { database, db, admin } = setup();
  try {
    const service = createReceivingService(db, { now: () => FIXED_NOW });
    const before = snapshot(db);
    const invalid: ReceiveGoodsInput[] = [
      { ...BASE_INPUT, receiptKey: "" },
      { ...BASE_INPUT, supplierId: 999 },
      { ...BASE_INPUT, items: [] },
      { ...BASE_INPUT, items: [{ productId: 1, quantity: 0 }] },
      { ...BASE_INPUT, items: [{ productId: 1, quantity: 1.5 }] },
      { ...BASE_INPUT, items: [{ productId: 999, quantity: 1 }] },
      { ...BASE_INPUT, items: [{ productId: 3, quantity: 1 }] },
      {
        ...BASE_INPUT,
        items: [
          { productId: 1, quantity: 1 },
          { productId: 1, quantity: 2 },
        ],
      },
    ];
    for (const input of invalid) {
      assert.throws(
        () => service.receiveGoods(admin, input),
        (error: unknown) =>
          error instanceof ValidationError || error instanceof NotFoundError,
      );
    }
    // Draft dibatalkan = klien membuang niat; tidak ada pemanggilan commit.
    assert.deepEqual(snapshot(db), before);
    assert.equal(getStockBalance(db, 1)?.onHand, 2);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("AC-07.02: gagal di tengah commit melakukan rollback utuh", () => {
  const { database, db, admin } = setup();
  try {
    db.exec(
      `CREATE TRIGGER test_fail_second_receipt AFTER INSERT ON inventory_movements
       WHEN NEW.product_id = 2 BEGIN SELECT RAISE(ABORT, 'gagal uji'); END`,
    );
    const service = createReceivingService(db, { now: () => FIXED_NOW });
    const before = snapshot(db);
    assert.throws(
      () =>
        service.receiveGoods(admin, {
          ...BASE_INPUT,
          receiptKey: "rcv-fail-1",
          items: [
            { productId: 1, quantity: 5 },
            { productId: 2, quantity: 3 },
          ],
        }),
      /gagal uji/,
    );
    assert.deepEqual(snapshot(db), before);
    assert.equal(getStockBalance(db, 1)?.onHand, 2);
    assert.equal(getStockBalance(db, 2)?.onHand, 0);
  } finally {
    db.exec("DROP TRIGGER IF EXISTS test_fail_second_receipt");
    db.close();
    database.cleanup();
  }
});

test("Beberapa item: total saldo cocok dengan ledger dan audit ringkas", () => {
  const { database, db, admin } = setup();
  try {
    const service = createReceivingService(db, { now: () => FIXED_NOW });
    const result = service.receiveGoods(admin, {
      ...BASE_INPUT,
      items: [
        { productId: 1, quantity: 5 },
        { productId: 2, quantity: 3 },
      ],
    });
    assert.equal(result.totalQuantity, 8);
    assert.equal(result.items.length, 2);
    assert.equal(getStockBalance(db, 1)?.onHand, 7);
    assert.equal(getStockBalance(db, 2)?.onHand, 3);
    assert.equal(countRows(db, "receipt_items"), 2);
    assert.equal(countRows(db, "inventory_movements"), 3);
    assert.throws(
      () =>
        writeReceivingAudit(db, {
          actorId: admin.userId,
          action: "DELETE_STOCK" as never,
          entityType: "goods_receipts",
          entityId: 1,
          details: {},
          nowMs: FIXED_NOW,
        }),
      /Event audit penerimaan tidak terdaftar/,
    );
  } finally {
    db.close();
    database.cleanup();
  }
});
