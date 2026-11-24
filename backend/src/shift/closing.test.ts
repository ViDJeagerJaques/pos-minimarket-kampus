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
import { ForbiddenError, ValidationError } from "../auth/errors.ts";
import type { SessionUser } from "../auth/session.ts";
import { createCheckoutService } from "../checkout/service.ts";
import { ShiftNotActiveError } from "../checkout/errors.ts";
import {
  CloseIdempotencyConflictError,
  ShiftClosedError,
  ShiftNotFoundError,
} from "./errors.ts";
import { createShiftService } from "./service.ts";

/**
 * TASK-022 (DEMO): angka setoran memakai simulasi TASK-002 §7 — modal
 * Rp100.000, tunai Rp500.000, QRIS Rp300.000, uang fisik Rp600.000, selisih 0.
 * SOP setoran pengelola masih PENDING; fixture ini bukan kebijakan produksi.
 */
const OPENING_CASH_RP = 100_000;
const CASH_SALES_RP = 500_000;
const QRIS_SALES_RP = 300_000;

function setup(nowShift = FIXED_NOW) {
  const database = createTempDatabase("pos-closing-test-");
  const db = database.open();
  migrateFresh(database);
  insertBaseFixture(db);
  const ids = fixtureIds();
  db.prepare(
    `INSERT INTO inventory_movements (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
     VALUES (1, 'OPENING', 400, 'OPEN-CLOSE-1', ?, ?)`,
  ).run(ids.adminId, FIXED_NOW);

  const admin: SessionUser = { userId: ids.adminId, username: "admin.fixture", role: "ADMIN" };
  const cashier: SessionUser = {
    userId: ids.cashierId,
    username: "kasir.fixture",
    role: "CASHIER",
  };
  const other: SessionUser = {
    userId: ids.otherCashierId,
    username: "kasir.lain",
    role: "CASHIER",
  };
  const shifts = createShiftService(db, { now: () => nowShift });
  const checkout = createCheckoutService(db, { now: () => FIXED_NOW + 10 });
  const shift = shifts.openShift(cashier, { openingCashRp: OPENING_CASH_RP });
  return { database, db, admin, cashier, other, shifts, checkout, shift };
}

function commitCash(
  service: ReturnType<typeof createCheckoutService>,
  actor: SessionUser,
  shiftId: number,
  attemptKey: string,
  quantity: number,
) {
  const prepared = service.prepare(actor, {
    attemptKey,
    shiftId,
    items: [{ productId: 1, quantity }],
    payment: { method: "CASH" },
  });
  return service.commit(actor, {
    attemptKey,
    requestHash: prepared.requestHash,
    paymentConfirmation: {
      method: "CASH",
      cashReceivedRp: prepared.quote.totalRp,
    },
  });
}

function commitQris(
  service: ReturnType<typeof createCheckoutService>,
  actor: SessionUser,
  shiftId: number,
  attemptKey: string,
  quantity: number,
) {
  const prepared = service.prepare(actor, {
    attemptKey,
    shiftId,
    items: [{ productId: 1, quantity }],
    payment: { method: "QRIS_MANUAL" },
  });
  return service.commit(actor, {
    attemptKey,
    requestHash: prepared.requestHash,
    paymentConfirmation: {
      method: "QRIS_MANUAL",
      merchantConfirmed: true,
      confirmedAmountRp: prepared.quote.totalRp,
    },
  });
}

function countRows(db: DatabaseSync, table: string): number {
  return Number(
    (db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total,
  );
}

function snapshot(db: DatabaseSync) {
  return {
    closings: countRows(db, "shift_closings"),
    totals: countRows(db, "shift_closing_totals"),
    audits: countRows(db, "audit_log"),
    closedShifts: countRows(db, "shifts"),
  };
}

test("AC-06.01: rekap CASH vs QRIS dan selisih fixture DEMO tersimpan", () => {
  const { database, db, cashier, shifts, checkout, shift } = setup();
  try {
    const cash = commitCash(checkout, cashier, shift.id, "close-cash-1", 200);
    const qris = commitQris(checkout, cashier, shift.id, "close-qris-1", 120);
    assert.equal(cash.payment.method, "CASH");
    assert.equal(qris.payment.method, "QRIS_MANUAL");

    const closing = shifts.closeShift(cashier, shift.id, {
      closeKey: "close-valid-1",
      declaredCashRp: OPENING_CASH_RP + CASH_SALES_RP,
    });
    assert.equal(closing.shiftId, shift.id);
    assert.equal(closing.totals.cashRp, CASH_SALES_RP);
    assert.equal(closing.totals.qrisManualRp, QRIS_SALES_RP);
    assert.equal(closing.totals.totalSalesRp, CASH_SALES_RP + QRIS_SALES_RP);
    assert.equal(closing.totals.saleCount, 2);
    assert.equal(closing.expectedCashRp, OPENING_CASH_RP + CASH_SALES_RP);
    assert.equal(closing.declaredCashRp, OPENING_CASH_RP + CASH_SALES_RP);
    assert.equal(closing.varianceRp, 0);
    assert.equal(closing.closedBy, cashier.userId);
    assert.equal(typeof closing.requestHash, "string");

    const totals = db
      .prepare("SELECT method_code, amount_rp FROM shift_closing_totals WHERE shift_id = ? ORDER BY method_code")
      .all(shift.id) as Array<{ method_code: string; amount_rp: number }>;
    assert.deepEqual(
      totals.map((row) => ({ ...row })),
      [
      { method_code: "CASH", amount_rp: CASH_SALES_RP },
      { method_code: "QRIS_MANUAL", amount_rp: QRIS_SALES_RP },
    ]);
    const stored = db
      .prepare("SELECT declared_cash_rp, variance_rp FROM shift_closings WHERE shift_id = ?")
      .get(shift.id) as { declared_cash_rp: number; variance_rp: number };
    assert.equal(stored.declared_cash_rp, OPENING_CASH_RP + CASH_SALES_RP);
    assert.equal(stored.variance_rp, 0);
    const closed = db.prepare("SELECT closed_at_ms FROM shifts WHERE id = ?").get(shift.id) as {
      closed_at_ms: number;
    };
    assert.equal(Number(closed.closed_at_ms), FIXED_NOW);
    assert.equal(shifts.getCurrentShift(cashier), null);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("AC-06.03: closeKey sama + payload sama idempoten; payload beda 409 tanpa perubahan", () => {
  const { database, db, cashier, shifts, shift } = setup();
  try {
    const input = { closeKey: "close-idem-1", declaredCashRp: OPENING_CASH_RP };
    const first = shifts.closeShift(cashier, shift.id, input);
    const before = snapshot(db);
    const retry = shifts.closeShift(cashier, shift.id, { ...input });
    assert.deepEqual(retry, first);
    assert.deepEqual(snapshot(db), before, "retry identik tidak menulis ulang");

    assert.throws(
      () =>
        shifts.closeShift(cashier, shift.id, {
          closeKey: "close-idem-1",
          declaredCashRp: OPENING_CASH_RP + 1,
        }),
      (error: unknown) =>
        error instanceof CloseIdempotencyConflictError && error.httpStatus === 409,
    );
    assert.throws(
      () => shifts.closeShift(cashier, shift.id + 1, input),
      (error: unknown) => error instanceof CloseIdempotencyConflictError,
    );
    assert.deepEqual(snapshot(db), before);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("AC-06.02/06.03: input invalid, non-owner, dan ADMIN ditolak tanpa menutup shift", () => {
  const { database, db, admin, cashier, other, shifts, shift } = setup();
  try {
    for (const input of [
      { closeKey: "", declaredCashRp: 0 },
      { closeKey: "close-bad-1", declaredCashRp: -1 },
      { closeKey: "close-bad-1", declaredCashRp: 1.5 },
    ]) {
      assert.throws(
        () => shifts.closeShift(cashier, shift.id, input),
        (error: unknown) =>
          error instanceof Error && error.name === "ValidationError",
      );
    }
    assert.throws(
      () => shifts.closeShift(admin, shift.id, { closeKey: "close-admin-1" }),
      (error: unknown) => error instanceof ForbiddenError && error.httpStatus === 403,
    );
    assert.throws(
      () => shifts.closeShift(other, shift.id, { closeKey: "close-other-1" }),
      (error: unknown) => error instanceof ForbiddenError && error.httpStatus === 403,
    );
    assert.throws(
      () => shifts.closeShift(cashier, 9999, { closeKey: "close-missing-1" }),
      (error: unknown) => error instanceof ShiftNotFoundError,
    );
    assert.equal(countRows(db, "shift_closings"), 0);
    assert.equal(shifts.getCurrentShift(cashier)?.id, shift.id);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("AC-06.02: checkout commit lebih dulu masuk rekap; close lebih dulu menolak checkout", async () => {
  // Urutan A: commit lebih dulu.
  {
    const { database, db, cashier, shifts, checkout, shift } = setup();
    try {
      const results = await Promise.allSettled([
        Promise.resolve().then(() =>
          commitCash(checkout, cashier, shift.id, "race-commit-1", 4),
        ),
        Promise.resolve().then(() =>
          shifts.closeShift(cashier, shift.id, { closeKey: "race-close-1" }),
        ),
      ]);
      assert.equal(results[0]?.status, "fulfilled");
      assert.equal(results[1]?.status, "fulfilled");
      const closing = (results[1] as PromiseFulfilledResult<{ totals: { saleCount: number } }>).value;
      assert.equal(closing.totals.saleCount, 1);
      assert.equal(countRows(db, "sales"), 1);
    } finally {
      db.close();
      database.cleanup();
    }
  }

  // Urutan B: tutup lebih dulu, checkout setelahnya ditolak.
  {
    const { database, db, cashier, shifts, checkout, shift } = setup();
    try {
      const results = await Promise.allSettled([
        Promise.resolve().then(() =>
          shifts.closeShift(cashier, shift.id, { closeKey: "race-close-2" }),
        ),
        Promise.resolve().then(() =>
          commitCash(checkout, cashier, shift.id, "race-late-commit", 4),
        ),
      ]);
      assert.equal(results[0]?.status, "fulfilled");
      assert.equal(results[1]?.status, "rejected");
      const reason = (results[1] as PromiseRejectedResult).reason;
      assert.ok(reason instanceof ShiftNotActiveError);
      assert.equal(countRows(db, "sales"), 0);
      const closing = (results[0] as PromiseFulfilledResult<{ totals: { saleCount: number } }>).value;
      assert.equal(closing.totals.saleCount, 0);
    } finally {
      db.close();
      database.cleanup();
    }
  }
});

test("Kegagalan sebelum commit mempertahankan shift aktif", () => {
  const { database, db, cashier, shift } = setup();
  try {
    const failing = createShiftService(db, { now: () => -1 });
    assert.throws(
      () => failing.closeShift(cashier, shift.id, { closeKey: "close-fail-1" }),
      /CHECK constraint failed|NOT NULL constraint failed/,
    );
    assert.equal(countRows(db, "shift_closings"), 0);
    assert.equal(countRows(db, "shift_closing_totals"), 0);
    const active = db.prepare("SELECT closed_at_ms FROM shifts WHERE id = ?").get(shift.id) as {
      closed_at_ms: number | null;
    };
    assert.equal(active.closed_at_ms, null);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("Shift tertutup tidak bisa dibuka ulang; penutupan lain ditolak", () => {
  const { database, db, cashier, shifts, shift } = setup();
  try {
    shifts.closeShift(cashier, shift.id, { closeKey: "close-done-1" });
    assert.throws(
      () => shifts.closeShift(cashier, shift.id, { closeKey: "close-done-2" }),
      (error: unknown) => error instanceof ShiftClosedError,
    );
    assert.equal(countRows(db, "shift_closings"), 1);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("pratinjau DEMO CASH/QRIS read-only konsisten dengan hasil tutup", () => {
  const { database, db, cashier, shifts, checkout, shift } = setup();
  try {
    commitCash(checkout, cashier, shift.id, "preview-cash", 200);
    commitQris(checkout, cashier, shift.id, "preview-qris", 120);
    const before = snapshot(db);
    const preview = shifts.getClosePreview(cashier, shift.id);
    assert.deepEqual(preview, { shiftId: shift.id, openingCashRp: OPENING_CASH_RP, cashTotalRp: CASH_SALES_RP, qrisTotalRp: QRIS_SALES_RP, expectedCashRp: OPENING_CASH_RP + CASH_SALES_RP, saleCount: 2 });
    assert.deepEqual(shifts.getClosePreview(cashier, shift.id), preview);
    assert.deepEqual(snapshot(db), before);
    assert.equal(shifts.getCurrentShift(cashier)?.id, shift.id);
    assert.throws(() => shifts.getClosing(cashier, shift.id), ShiftNotFoundError);
    const closing = shifts.closeShift(cashier, shift.id, { closeKey: "preview-close", declaredCashRp: OPENING_CASH_RP + CASH_SALES_RP });
    assert.equal(preview.cashTotalRp, closing.totals.cashRp);
    assert.equal(preview.qrisTotalRp, closing.totals.qrisManualRp);
    assert.equal(preview.expectedCashRp, closing.expectedCashRp);
    assert.equal(preview.saleCount, closing.totals.saleCount);
    assert.deepEqual(shifts.getClosing(cashier, shift.id), closing);
    assert.throws(() => shifts.getClosePreview(cashier, shift.id), ShiftClosedError);
  } finally { db.close(); database.cleanup(); }
});

test("BUG-232: selisih kas wajib catatan selisih dan tersimpan di hasil penutupan", () => {
  const { database, db, cashier, shifts, checkout, shift } = setup();
  try {
    commitCash(checkout, cashier, shift.id, "note-cash", 200);
    const expected = OPENING_CASH_RP + CASH_SALES_RP;
    assert.throws(
      () =>
        shifts.closeShift(cashier, shift.id, {
          closeKey: "close-note-missing",
          declaredCashRp: expected - 10_000,
        }),
      (error: unknown) => error instanceof ValidationError && error.field === "varianceNote",
    );

    const closing = shifts.closeShift(cashier, shift.id, {
      closeKey: "close-note-ok",
      declaredCashRp: expected - 10_000,
      varianceNote: "Salah hitung uang kembalian",
    });
    assert.equal(closing.varianceRp, -10_000);
    assert.equal(closing.varianceNote, "Salah hitung uang kembalian");
    assert.deepEqual(shifts.getClosing(cashier, shift.id), closing);
  } finally {
    db.close();
    database.cleanup();
  }
});
