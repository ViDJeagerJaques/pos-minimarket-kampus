import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  createTempDatabase,
  FIXED_NOW,
  migrateFresh,
} from "../../db/test/helpers.ts";
import { ForbiddenError, ValidationError } from "../auth/errors.ts";
import type { SessionUser } from "../auth/session.ts";
import { writeShiftAudit } from "./audit.ts";
import { ShiftAlreadyOpenError } from "./errors.ts";
import { createShiftService } from "./service.ts";

function setup() {
  const database = createTempDatabase("pos-shift-test-");
  const db = database.open();
  migrateFresh(database);
  const insert = db.prepare(
    `INSERT INTO users (id, username, password_hash, role, active, created_at_ms)
     VALUES (?, ?, 'scrypt$fixture-not-a-real-hash', ?, 1, ?)`,
  );
  insert.run(1, "admin.shift", "ADMIN", FIXED_NOW);
  insert.run(2, "kasir.shift", "CASHIER", FIXED_NOW);
  insert.run(3, "kasir.lain", "CASHIER", FIXED_NOW);
  const admin: SessionUser = { userId: 1, username: "admin.shift", role: "ADMIN" };
  const cashier: SessionUser = { userId: 2, username: "kasir.shift", role: "CASHIER" };
  const other: SessionUser = { userId: 3, username: "kasir.lain", role: "CASHIER" };
  return { database, db, admin, cashier, other };
}

function activeShifts(db: DatabaseSync): Array<Record<string, unknown>> {
  return (db.prepare("SELECT * FROM shifts WHERE closed_at_ms IS NULL").all() as Array<
    Record<string, unknown>
  >).map((row) => ({ ...row }));
}

function auditRows(db: DatabaseSync) {
  return (db.prepare("SELECT * FROM audit_log ORDER BY id").all() as Array<
    Record<string, unknown>
  >).map((row) => ({ ...row }));
}

test("AC-05.01: CASHIER membuka shift; pemilik dari sesi; satu shift aktif", () => {
  const { database, db, cashier } = setup();
  try {
    const service = createShiftService(db, { now: () => FIXED_NOW });
    const shift = service.openShift(cashier, { openingCashRp: 50000 });
    assert.equal(shift.cashierId, 2);
    assert.equal(shift.openedAtMs, FIXED_NOW);
    assert.equal(shift.openingCashRp, 50000);
    assert.equal(activeShifts(db).length, 1);

    assert.throws(
      () => service.openShift(cashier, {}),
      (error: unknown) => error instanceof ShiftAlreadyOpenError && error.httpStatus === 409,
    );
    assert.equal(activeShifts(db).length, 1);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("AC-05.01 baseline konservatif: ADMIN ditolak membuka shift tanpa mengubah DB", () => {
  const { database, db, admin } = setup();
  try {
    const service = createShiftService(db, { now: () => FIXED_NOW });
    assert.throws(
      () => service.openShift(admin, { openingCashRp: 0 }),
      (error: unknown) => error instanceof ForbiddenError && error.httpStatus === 403,
    );
    assert.equal(activeShifts(db).length, 0);
    assert.equal(auditRows(db).length, 0);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("Nominal awal invalid ditolak; nol/null dan nilai bulat diterima", () => {
  const { database, db, cashier } = setup();
  try {
    const service = createShiftService(db, { now: () => FIXED_NOW });
    for (const openingCashRp of [-1, 1.5, "100", Number.NaN, 1_000_000_001]) {
      assert.throws(
        () => service.openShift(cashier, { openingCashRp }),
        (error: unknown) => error instanceof ValidationError && error.field === "openingCashRp",
        `nominal ${String(openingCashRp)} harus ditolak`,
      );
    }
    assert.equal(activeShifts(db).length, 0);

    const zero = service.openShift(cashier, { openingCashRp: 0 });
    assert.equal(zero.openingCashRp, 0);
    assert.throws(
      () => service.openShift(cashier, {}),
      (error: unknown) => error instanceof ShiftAlreadyOpenError,
    );
  } finally {
    db.close();
    database.cleanup();
  }
});

test("AC-05.02: shift tetap tersimpan; kasir lain tidak mengambil alih", () => {
  const { database, db, cashier, other, admin } = setup();
  try {
    const service = createShiftService(db, { now: () => FIXED_NOW });
    const shift = service.openShift(cashier, { openingCashRp: 25000 });

    // Simulasi logout/restart: service baru pada DB yang sama.
    const restarted = createShiftService(db, { now: () => FIXED_NOW + 1000 });
    assert.deepEqual(restarted.getCurrentShift(cashier), shift);
    assert.equal(restarted.getCurrentShift(other), null);
    assert.deepEqual(restarted.getCurrentShift(admin), shift);

    assert.throws(
      () => restarted.openShift(other, {}),
      (error: unknown) => error instanceof ShiftAlreadyOpenError,
    );
    assert.equal(activeShifts(db).length, 1);
    assert.equal(restarted.getCurrentShift(cashier)?.id, shift.id);
    assert.equal(restarted.getCurrentShift(cashier)?.openedAtMs, FIXED_NOW);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("Dua request buka bersamaan: tepat satu shift aktif", async () => {
  const { database, db, cashier, other } = setup();
  try {
    const service = createShiftService(db, { now: () => FIXED_NOW });
    const results = await Promise.allSettled([
      Promise.resolve().then(() => service.openShift(cashier, { openingCashRp: 1000 })),
      Promise.resolve().then(() => service.openShift(other, { openingCashRp: 2000 })),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(activeShifts(db).length, 1);
    const shift = activeShifts(db)[0]!;
    assert.equal(shift.cashier_id, 2);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("Audit SHIFT_OPENED tercatat; kegagalan audit membatalkan pembukaan", () => {
  const { database, db, cashier } = setup();
  try {
    const service = createShiftService(db, { now: () => FIXED_NOW });
    service.openShift(cashier, { openingCashRp: 5000 });
    const audit = auditRows(db);
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.action, "SHIFT_OPENED");
    assert.equal(audit[0]?.entity_type, "shifts");
    assert.equal(audit[0]?.actor_id, 2);

    // Kosongkan shift agar kegagalan audit diuji pada pembukaan baru.
    db.prepare("DELETE FROM shifts").run();
    const failing = createShiftService(db, { now: () => -1 });
    assert.throws(
      () => failing.openShift(cashier, {}),
      /CHECK constraint failed|NOT NULL constraint failed/,
    );
    assert.equal(activeShifts(db).length, 0, "pembukaan gagal tidak menambah shift");
    assert.equal(auditRows(db).length, 1);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("Constraint DB menolak shift aktif kedua dan whitelist audit menolak event asing", () => {
  const { database, db, cashier } = setup();
  try {
    const service = createShiftService(db, { now: () => FIXED_NOW });
    service.openShift(cashier, {});
    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO shifts (cashier_id, opened_at_ms, opening_cash_rp, closed_at_ms)
           VALUES (3, ?, 0, NULL)`,
        ).run(FIXED_NOW),
      /UNIQUE constraint failed/,
    );
    assert.throws(
      () =>
        writeShiftAudit(db, {
          actorId: 1,
          action: "SHIFT_DELETED" as never,
          entityType: "shifts",
          entityId: 1,
          details: {},
          nowMs: FIXED_NOW,
        }),
      /Event audit shift tidak terdaftar/,
    );
  } finally {
    db.close();
    database.cleanup();
  }
});
