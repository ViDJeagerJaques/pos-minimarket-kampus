import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createTempDatabase, FIXED_NOW, insertBaseFixture, migrateFresh } from "../../db/test/helpers.ts";
import { loadMigrations, runMigrations } from "../../db/src/migrate.ts";
import { inspectBackup } from "../../db/src/backup.ts";
import { AuthRequiredError, ForbiddenError } from "../auth/errors.ts";
import type { SessionUser } from "../auth/session.ts";
import { createAdjustmentService, type AdjustStockInput } from "./adjustments.ts";
import { InventoryError } from "./errors.ts";
import { getStockBalance, reconcileProduct } from "./ledger.ts";

const admin: SessionUser = { userId: 1, username: "admin.fixture", role: "ADMIN" };
const input = { adjustmentKey: "adj-demo-1", productId: 1, expectedOnHand: 5, targetOnHand: 3, reason: "DEMO hitung fisik" };
function setup() {
  const database = createTempDatabase("pos-adjustment-");
  migrateFresh(database);
  const db = database.open();
  insertBaseFixture(db);
  db.prepare(`INSERT INTO inventory_movements (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
    VALUES (1, 'OPENING', 5, 'DEMO-ADJUSTMENT', 1, ?)`).run(FIXED_NOW);
  return { database, db, service: createAdjustmentService(db, { now: () => FIXED_NOW + 1 }) };
}

test("AC-07.03: 5 -> 3 menghasilkan delta -2, audit ADMIN, saldo view dan ledger konsisten", () => {
  const { database, db, service } = setup();
  try {
    const result = service.adjustStock(admin, input);
    assert.equal(result.delta, -2);
    assert.equal(result.previousOnHand, 5);
    assert.equal(result.onHand, 3);
    assert.equal(result.actorId, 1);
    assert.equal(result.committedAtMs, FIXED_NOW + 1);
    assert.equal(getStockBalance(db, 1)?.onHand, 3);
    const movement = db.prepare("SELECT * FROM inventory_movements WHERE id = ?").get(result.movementId)!;
    assert.equal(movement.kind, "ADJUSTMENT");
    assert.equal(movement.adjustment_reason, input.reason);
    assert.equal(movement.actor_id, 1);
    const audit = db.prepare("SELECT * FROM audit_log WHERE action = 'INVENTORY_ADJUSTED'").get()!;
    assert.equal(audit.actor_id, 1);
    assert.equal(audit.created_at_ms, result.committedAtMs);
    assert.deepEqual(JSON.parse(String(audit.details)), {
      schemaVersion: 1, movementId: result.movementId, delta: -2, reason: input.reason,
      previousOnHand: 5, onHand: 3,
    });
    assert.equal(db.prepare("SELECT on_hand FROM stock_balances WHERE product_id = 1").get()!.on_hand, 3);
    assert.equal(reconcileProduct(db, 1).matched, true);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
  } finally { db.close(); database.cleanup(); }
});

test("retry setelah restart mengembalikan snapshot asli meskipun saldo kemudian berubah", () => {
  const { database, db, service } = setup();
  let reopened: ReturnType<typeof database.open> | undefined;
  try {
    const first = service.adjustStock(admin, input);
    service.adjustStock(admin, { ...input, adjustmentKey: "adj-demo-2", expectedOnHand: 3, targetOnHand: 7 });
    db.close();
    reopened = database.open();
    const retry = createAdjustmentService(reopened).adjustStock(admin, input);
    assert.deepEqual(retry, { ...first, duplicate: true });
    assert.equal(getStockBalance(reopened, 1)?.onHand, 7);
    assert.equal(reopened.prepare("SELECT count(*) AS n FROM audit_log").get()!.n, 2);
  } finally { if (db.isOpen) db.close(); reopened?.close(); database.cleanup(); }
});

test("key sama dengan target, alasan, produk, saldo awal atau actor berbeda ditolak tanpa mutasi", () => {
  const { database, db, service } = setup();
  try {
    service.adjustStock(admin, input);
    for (const patch of [{ targetOnHand: 2 }, { reason: "DEMO lain" }, { productId: 9 }, { expectedOnHand: 6 }]) {
      assert.throws(() => service.adjustStock(admin, { ...input, ...patch }),
        (e) => e instanceof InventoryError && e.code === "IDEMPOTENCY_CONFLICT");
    }
    db.prepare("UPDATE users SET role = 'ADMIN' WHERE id = 3").run();
    assert.throws(() => service.adjustStock({ ...admin, userId: 3 }, input),
      (e) => e instanceof InventoryError && e.code === "IDEMPOTENCY_CONFLICT");
    assert.equal(db.prepare("SELECT count(*) AS n FROM inventory_adjustments").get()!.n, 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM audit_log").get()!.n, 1);
    assert.equal(getStockBalance(db, 1)?.onHand, 3);
  } finally { db.close(); database.cleanup(); }
});

for (const patch of [
  { targetOnHand: -1 }, { targetOnHand: 1.5 }, { targetOnHand: "3" },
  { targetOnHand: Number.MAX_SAFE_INTEGER + 1 }, { targetOnHand: 5 },
  { expectedOnHand: -1 }, { reason: " " }, { reason: "x\ny" },
  { reason: "x".repeat(201) }, { adjustmentKey: "" }, { productId: 0 },
] satisfies AdjustStockInput[]) {
  test(`input invalid tanpa mutasi: ${JSON.stringify(patch)}`, () => {
    const { database, db, service } = setup();
    try {
      assert.throws(() => service.adjustStock(admin, { ...input, ...patch }),
        (e) => e instanceof InventoryError && e.httpStatus === 422);
      assert.equal(getStockBalance(db, 1)?.onHand, 5);
      assert.equal(db.prepare("SELECT count(*) AS n FROM audit_log").get()!.n, 0);
      assert.equal(db.prepare("SELECT count(*) AS n FROM inventory_adjustments").get()!.n, 0);
    } finally { db.close(); database.cleanup(); }
  });
}

test("CASHIER, actor demoted/nonaktif, produk hilang dan saldo stale ditolak", () => {
  const { database, db, service } = setup();
  try {
    assert.throws(() => service.adjustStock({ ...admin, userId: 2, role: "CASHIER" }, input), ForbiddenError);
    assert.throws(() => service.adjustStock({ ...admin, userId: 2 }, input), ForbiddenError);
    db.prepare("UPDATE users SET active = 0 WHERE id = 1").run();
    assert.throws(() => service.adjustStock(admin, input), AuthRequiredError);
    db.prepare("UPDATE users SET active = 1 WHERE id = 1").run();
    assert.throws(() => service.adjustStock(admin, { ...input, productId: 99 }),
      (e) => e instanceof InventoryError && e.httpStatus === 404);
    assert.throws(() => service.adjustStock(admin, { ...input, expectedOnHand: 4 }),
      (e) => e instanceof InventoryError && e.httpStatus === 409);
    assert.equal(getStockBalance(db, 1)?.onHand, 5);
    assert.equal(db.prepare("SELECT count(*) AS n FROM audit_log").get()!.n, 0);
  } finally { db.close(); database.cleanup(); }
});

for (const table of ["inventory_adjustments", "audit_log"]) {
  test(`kegagalan insert ${table} rollback mutasi, key, audit; key dapat dicoba ulang`, () => {
    const { database, db, service } = setup();
    try {
      db.exec(`CREATE TRIGGER fail_adjustment BEFORE INSERT ON ${table}
        BEGIN SELECT RAISE(ABORT, 'DEMO injected failure'); END;`);
      assert.throws(() => service.adjustStock(admin, input), /DEMO injected failure/);
      assert.equal(getStockBalance(db, 1)?.onHand, 5);
      assert.equal(db.prepare("SELECT count(*) AS n FROM inventory_adjustments").get()!.n, 0);
      assert.equal(db.prepare("SELECT count(*) AS n FROM audit_log").get()!.n, 0);
      db.exec("DROP TRIGGER fail_adjustment");
      assert.equal(service.adjustStock(admin, input).delta, -2);
    } finally { db.close(); database.cleanup(); }
  });
}

test("migrasi v2 berisi data -> v3 aditif, backup valid, riwayat lama utuh", () => {
  const database = createTempDatabase("pos-adjustment-upgrade-");
  try {
    const dir = path.join(database.dir, "v2");
    mkdirSync(dir);
    for (const m of loadMigrations().filter((m) => m.version <= 2)) {
      copyFileSync(m.filePath, path.join(dir, m.fileName));
    }
    runMigrations({ dbPath: database.dbPath, migrationsDir: dir, backup: "off" });
    const old = database.open();
    try {
      insertBaseFixture(old);
      old.exec(`INSERT INTO inventory_movements (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
        VALUES (1, 'OPENING', 5, 'DEMO-OLD', 1, 1)`);
    } finally { old.close(); }
    const upgraded = runMigrations({ dbPath: database.dbPath });
    assert.deepEqual(upgraded.appliedVersions, [3, 4]);
    assert.ok(upgraded.backupPath);
    assert.equal(inspectBackup(upgraded.backupPath).userVersion, 2);
    assert.equal(upgraded.integrity.foreignKeyViolations, 0);
    const db = database.open();
    try {
      assert.equal(getStockBalance(db, 1)?.onHand, 5);
      assert.equal(createAdjustmentService(db).adjustStock(admin, input).onHand, 3);
      assert.equal(db.prepare("SELECT delta FROM inventory_movements WHERE kind = 'OPENING'").get()!.delta, 5);
    } finally { db.close(); }
  } finally { database.cleanup(); }
});


test("saldo nol dan penambahan pada produk nonaktif tetap melalui ledger bertanda", () => {
  const { database, db, service } = setup();
  try {
    db.prepare("UPDATE products SET active = 0 WHERE id = 1").run();
    const zero = service.adjustStock(admin, { ...input, targetOnHand: 0 });
    assert.equal(zero.delta, -5);
    const positive = service.adjustStock(admin, {
      ...input, adjustmentKey: "adj-positive", expectedOnHand: 0, targetOnHand: 2,
    });
    assert.equal(positive.delta, 2);
    assert.equal(getStockBalance(db, 1)?.onHand, 2);
    assert.equal(reconcileProduct(db, 1).matched, true);
    assert.throws(() => service.adjustStock(admin, { ...input, adjustmentKey: "adj-stale" }),
      (e) => e instanceof InventoryError && e.httpStatus === 409);
    assert.equal(db.prepare("SELECT count(*) AS n FROM inventory_adjustments").get()!.n, 2);
  } finally { db.close(); database.cleanup(); }
});
