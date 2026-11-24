import type { DatabaseSync } from "node:sqlite";
import { AuthRequiredError, ForbiddenError, ValidationError } from "../auth/errors.ts";
import type { SessionUser } from "../auth/session.ts";
import { writeShiftAudit } from "./audit.ts";
import { computeShiftCloseHash } from "./closeHash.ts";
import {
  CloseIdempotencyConflictError,
  ShiftAlreadyOpenError,
  ShiftClosedError,
  ShiftNotFoundError,
} from "./errors.ts";

/**
 * Pembukaan shift eksplisit (TASK-014).
 *
 * Baseline konservatif sebelum keputusan DEC-019: hanya CASHIER yang membuka
 * shift, pemilik diambil dari sesi, dan satu shift aktif per PC. ADMIN ditolak
 * 403 (AUTHORIZATION.md §3 dan SECURITY.md §4: ADMIN bukan otomatis kasir).
 * API_CONTRACT.md §3 sudah diselaraskan: ADMIN belum diizinkan selama
 * DEC-019 masih PENDING.
 */
export type ShiftDto = {
  id: number;
  cashierId: number;
  openedAtMs: number;
  openingCashRp: number | null;
};

export type ShiftClosingTotals = {
  cashRp: number;
  qrisManualRp: number;
  totalSalesRp: number;
  saleCount: number;
};

export type ShiftClosingDto = {
  shiftId: number;
  closeKey: string;
  requestHash: string;
  closedAtMs: number;
  closedBy: number;
  openingCashRp: number | null;
  /** DEMO: modal (atau 0 bila tidak tercatat) + total CASH. QRIS tidak masuk laci. */
  expectedCashRp: number;
  declaredCashRp: number | null;
  varianceRp: number | null;
  varianceNote: string | null;
  totals: ShiftClosingTotals;
};

export type ShiftClosePreviewDto = {
  shiftId: number;
  openingCashRp: number | null;
  cashTotalRp: number;
  qrisTotalRp: number;
  expectedCashRp: number;
  saleCount: number;
};

export type CloseShiftInput = {
  closeKey?: unknown;
  declaredCashRp?: unknown;
  varianceNote?: unknown;
};

export type ShiftService = {
  openShift(actor: SessionUser, input: { openingCashRp?: unknown }): ShiftDto;
  getCurrentShift(actor: SessionUser): ShiftDto | null;
  closeShift(actor: SessionUser, shiftId: unknown, input: CloseShiftInput): ShiftClosingDto;
  getClosePreview(actor: SessionUser, shiftId: unknown): ShiftClosePreviewDto;
  getClosing(actor: SessionUser, shiftId: unknown): ShiftClosingDto;
};

const MAX_OPENING_CASH_RP = 1_000_000_000;
const MAX_CLOSE_KEY_LENGTH = 80;
const MAX_DECLARED_CASH_RP = 1_000_000_000;
const MAX_VARIANCE_NOTE_LENGTH = 500;

function normalizeVarianceNote(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new ValidationError("Catatan selisih harus berupa teks.", "varianceNote");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > MAX_VARIANCE_NOTE_LENGTH) {
    throw new ValidationError(
      `Catatan selisih maksimal ${MAX_VARIANCE_NOTE_LENGTH} karakter.`,
      "varianceNote",
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new ValidationError("Catatan selisih memuat karakter kontrol.", "varianceNote");
  }
  return trimmed;
}

function normalizeOpeningCash(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_OPENING_CASH_RP
  ) {
    throw new ValidationError(
      `openingCashRp harus bilangan bulat 0-${MAX_OPENING_CASH_RP}.`,
      "openingCashRp",
    );
  }
  return value;
}

function normalizeCloseKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new ValidationError("closeKey harus berupa teks.", "closeKey");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_CLOSE_KEY_LENGTH) {
    throw new ValidationError(
      `closeKey harus 1-${MAX_CLOSE_KEY_LENGTH} karakter.`,
      "closeKey",
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new ValidationError("closeKey memuat karakter kontrol.", "closeKey");
  }
  return trimmed;
}

function normalizeDeclaredCash(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_DECLARED_CASH_RP
  ) {
    throw new ValidationError(
      `declaredCashRp harus bilangan bulat 0-${MAX_DECLARED_CASH_RP} atau null.`,
      "declaredCashRp",
    );
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toDto(row: {
  id: number;
  cashier_id: number;
  opened_at_ms: number;
  opening_cash_rp: number | null;
}): ShiftDto {
  return {
    id: Number(row.id),
    cashierId: Number(row.cashier_id),
    openedAtMs: Number(row.opened_at_ms),
    openingCashRp:
      row.opening_cash_rp === null ? null : Number(row.opening_cash_rp),
  };
}

export function createShiftService(db: DatabaseSync, deps: { now?: () => number } = {}): ShiftService {
  const now = deps.now ?? (() => Date.now());

  function assertActiveCashier(actor: SessionUser): void {
    const row = db
      .prepare("SELECT role, active FROM users WHERE id = ?")
      .get(actor.userId) as { role: string; active: number } | undefined;
    if (!row || Number(row.active) !== 1) {
      throw new AuthRequiredError("Sesi CASHIER tidak lagi valid.");
    }
    if (String(row.role) !== "CASHIER") {
      throw new ForbiddenError("Hanya CASHIER yang boleh membuka shift.");
    }
  }

  function assertOwnedShift(actor: SessionUser, shiftIdInput: unknown) {
    if (actor.role !== "CASHIER") throw new ForbiddenError("Hanya CASHIER pemilik shift yang diizinkan.");
    if (typeof shiftIdInput !== "number" || !Number.isSafeInteger(shiftIdInput) || shiftIdInput <= 0) {
      throw new ValidationError("shiftId harus ID positif.", "shiftId");
    }
    assertActiveCashier(actor);
    const shift = db.prepare("SELECT id, cashier_id, opening_cash_rp, closed_at_ms FROM shifts WHERE id = ?")
      .get(shiftIdInput) as { id: number; cashier_id: number; opening_cash_rp: number | null; closed_at_ms: number | null } | undefined;
    if (!shift) throw new ShiftNotFoundError();
    if (Number(shift.cashier_id) !== actor.userId) throw new ForbiddenError("Akses ditolak: shift bukan milik kasir ini.");
    return shift;
  }

  // Digunakan baik oleh preview maupun close di dalam transaksi masing-masing.
  function calculateTotals(shiftId: number): ShiftClosingTotals {
    const paymentRows = db.prepare(
      `SELECT p.method_code AS method_code, COALESCE(SUM(p.amount_rp), 0) AS total_rp
       FROM payments p JOIN sales s ON s.id = p.sale_id
       JOIN checkout_attempts ca ON ca.attempt_key = s.attempt_key
       WHERE ca.shift_id = ? GROUP BY p.method_code`,
    ).all(shiftId) as Array<{ method_code: string; total_rp: number }>;
    let cashRp = 0;
    let qrisManualRp = 0;
    for (const row of paymentRows) {
      if (row.method_code === "CASH") cashRp = Number(row.total_rp);
      else if (row.method_code === "QRIS_MANUAL") qrisManualRp = Number(row.total_rp);
    }
    const saleCount = Number((db.prepare(
      `SELECT COUNT(*) AS total FROM sales s
       JOIN checkout_attempts ca ON ca.attempt_key = s.attempt_key WHERE ca.shift_id = ?`,
    ).get(shiftId) as { total: number }).total);
    return { cashRp, qrisManualRp, totalSalesRp: cashRp + qrisManualRp, saleCount };
  }

  function readSnapshot<T>(read: () => T): T {
    db.exec("BEGIN");
    try {
      const result = read();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function loadClosing(shiftId: number, closeKey: string, requestHash: string): ShiftClosingDto {
    const closing = db
      .prepare(
        `SELECT shift_id, close_key, closed_by, declared_cash_rp, variance_rp, variance_note
         FROM shift_closings WHERE close_key = ?`,
      )
      .get(closeKey) as
      | {
          shift_id: number;
          close_key: string;
          closed_by: number;
          declared_cash_rp: number | null;
          variance_rp: number | null;
          variance_note: string | null;
        }
      | undefined;
    if (!closing || Number(closing.shift_id) !== shiftId) {
      throw new CloseIdempotencyConflictError();
    }
    const shift = db
      .prepare("SELECT closed_at_ms, opening_cash_rp FROM shifts WHERE id = ?")
      .get(shiftId) as { closed_at_ms: number; opening_cash_rp: number | null } | undefined;
    if (!shift) {
      throw new ShiftNotFoundError();
    }
    const totalRows = db
      .prepare("SELECT method_code, amount_rp FROM shift_closing_totals WHERE shift_id = ?")
      .all(shiftId) as Array<{ method_code: string; amount_rp: number }>;
    let cashRp = 0;
    let qrisManualRp = 0;
    for (const row of totalRows) {
      if (row.method_code === "CASH") {
        cashRp = Number(row.amount_rp);
      } else if (row.method_code === "QRIS_MANUAL") {
        qrisManualRp = Number(row.amount_rp);
      }
    }
    const saleCount = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS total FROM sales s
             JOIN checkout_attempts ca ON ca.attempt_key = s.attempt_key
             WHERE ca.shift_id = ?`,
          )
          .get(shiftId) as { total: number }
      ).total,
    );
    const openingCashRp =
      shift.opening_cash_rp === null ? null : Number(shift.opening_cash_rp);
    return {
      shiftId,
      closeKey,
      requestHash,
      closedAtMs: Number(shift.closed_at_ms),
      closedBy: Number(closing.closed_by),
      openingCashRp,
      expectedCashRp: (openingCashRp ?? 0) + cashRp,
      declaredCashRp:
        closing.declared_cash_rp === null ? null : Number(closing.declared_cash_rp),
      varianceRp: closing.variance_rp === null ? null : Number(closing.variance_rp),
      varianceNote: closing.variance_note === null ? null : String(closing.variance_note),
      totals: {
        cashRp,
        qrisManualRp,
        totalSalesRp: cashRp + qrisManualRp,
        saleCount,
      },
    };
  }

  return {
    openShift(actor, input) {
      if (actor.role !== "CASHIER") {
        throw new ForbiddenError("Hanya CASHIER yang boleh membuka shift.");
      }
      const openingCashRp = normalizeOpeningCash(input?.openingCashRp);
      const openedAtMs = now();

      db.exec("BEGIN IMMEDIATE");
      try {
        // Pemeriksaan ulang di transaksi penulis (AUTHORIZATION.md §5).
        assertActiveCashier(actor);
        const active = db
          .prepare("SELECT id FROM shifts WHERE closed_at_ms IS NULL LIMIT 1")
          .get() as { id: number } | undefined;
        if (active) {
          throw new ShiftAlreadyOpenError();
        }
        let shiftId: number;
        try {
          const result = db
            .prepare(
              `INSERT INTO shifts (cashier_id, opened_at_ms, opening_cash_rp, closed_at_ms)
               VALUES (?, ?, ?, NULL)`,
            )
            .run(actor.userId, openedAtMs, openingCashRp);
          shiftId = Number(result.lastInsertRowid);
        } catch (error) {
          // Constraint `ux_shifts_single_open` menjaga dua request bersamaan.
          if (errorMessage(error).includes("UNIQUE constraint failed")) {
            throw new ShiftAlreadyOpenError();
          }
          throw error;
        }
        writeShiftAudit(db, {
          actorId: actor.userId,
          action: "SHIFT_OPENED",
          entityType: "shifts",
          entityId: shiftId,
          details: {},
          nowMs: now(),
        });
        db.exec("COMMIT");
        return {
          id: shiftId,
          cashierId: actor.userId,
          openedAtMs,
          openingCashRp,
        };
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // Error asli tetap dilempar.
        }
        throw error;
      }
    },

    closeShift(actor, shiftIdInput, input) {
      if (actor.role !== "CASHIER") {
        throw new ForbiddenError("Hanya CASHIER pemilik shift yang boleh menutup shift.");
      }
      if (
        typeof shiftIdInput !== "number" ||
        !Number.isSafeInteger(shiftIdInput) ||
        shiftIdInput <= 0
      ) {
        throw new ValidationError("shiftId harus ID positif.", "shiftId");
      }
      const shiftId = shiftIdInput;
      const closeKey = normalizeCloseKey(input?.closeKey);
      const declaredCashRp = normalizeDeclaredCash(input?.declaredCashRp);
      const varianceNote = normalizeVarianceNote(input?.varianceNote);
      const hash = computeShiftCloseHash({
        shiftId,
        cashierId: actor.userId,
        closeKey,
        declaredCashRp,
        varianceNote,
      });

      db.exec("BEGIN IMMEDIATE");
      try {
        assertActiveCashier(actor);
        const existing = db
          .prepare("SELECT shift_id, request_hash FROM shift_closings WHERE close_key = ?")
          .get(closeKey) as { shift_id: number; request_hash: Uint8Array } | undefined;
        if (existing) {
          if (
            Number(existing.shift_id) !== shiftId ||
            Buffer.compare(Buffer.from(existing.request_hash), hash.bytes) !== 0
          ) {
            throw new CloseIdempotencyConflictError();
          }
          const result = loadClosing(shiftId, closeKey, hash.hex);
          db.exec("COMMIT");
          return result;
        }

        const shift = db
          .prepare(
            "SELECT id, cashier_id, opening_cash_rp, closed_at_ms FROM shifts WHERE id = ?",
          )
          .get(shiftId) as
          | {
              id: number;
              cashier_id: number;
              opening_cash_rp: number | null;
              closed_at_ms: number | null;
            }
          | undefined;
        if (!shift) {
          throw new ShiftNotFoundError();
        }
        if (Number(shift.cashier_id) !== actor.userId) {
          throw new ForbiddenError("Akses ditolak: shift bukan milik kasir ini.");
        }
        if (shift.closed_at_ms !== null) {
          throw new ShiftClosedError();
        }

        // Rekap hanya dari sale yang sudah COMMITTED (tabel sales). QRIS
        // tidak masuk laci kas (DEC-016, rumus usulan/DEMO).
        const { cashRp, qrisManualRp, saleCount } = calculateTotals(shiftId);
        const openingCashRp =
          shift.opening_cash_rp === null ? null : Number(shift.opening_cash_rp);
        const expectedCashRp = (openingCashRp ?? 0) + cashRp;
        const varianceRp = declaredCashRp === null ? null : declaredCashRp - expectedCashRp;
        if (varianceRp !== null && varianceRp !== 0 && varianceNote === null) {
          throw new ValidationError(
            "Catatan selisih wajib diisi jika terdapat selisih kas.",
            "varianceNote",
          );
        }
        const closedAtMs = now();

        try {
          db.prepare(
            `INSERT INTO shift_closings
               (shift_id, close_key, request_hash, closed_by, declared_cash_rp, variance_rp, variance_note)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(shiftId, closeKey, hash.bytes, actor.userId, declaredCashRp, varianceRp, varianceNote);
        } catch (error) {
          if (errorMessage(error).includes("UNIQUE constraint failed")) {
            throw new CloseIdempotencyConflictError();
          }
          throw error;
        }
        const insertTotal = db.prepare(
          "INSERT INTO shift_closing_totals (shift_id, method_code, amount_rp) VALUES (?, ?, ?)",
        );
        insertTotal.run(shiftId, "CASH", cashRp);
        insertTotal.run(shiftId, "QRIS_MANUAL", qrisManualRp);
        db.prepare("UPDATE shifts SET closed_at_ms = ? WHERE id = ?").run(closedAtMs, shiftId);
        writeShiftAudit(db, {
          actorId: actor.userId,
          action: "SHIFT_CLOSED",
          entityType: "shifts",
          entityId: shiftId,
          details: { closeKey, saleCount },
          nowMs: closedAtMs,
        });
        db.exec("COMMIT");
        return {
          shiftId,
          closeKey,
          requestHash: hash.hex,
          closedAtMs,
          closedBy: actor.userId,
          openingCashRp,
          expectedCashRp,
          declaredCashRp,
          varianceRp,
          varianceNote,
          totals: {
            cashRp,
            qrisManualRp,
            totalSalesRp: cashRp + qrisManualRp,
            saleCount,
          },
        };
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // Error asli tetap dilempar.
        }
        throw error;
      }
    },

    getClosePreview(actor, shiftIdInput) {
      return readSnapshot(() => {
        const shift = assertOwnedShift(actor, shiftIdInput);
        if (shift.closed_at_ms !== null) throw new ShiftClosedError("Shift sudah ditutup; pratinjau tidak tersedia.");
        const totals = calculateTotals(Number(shift.id));
        const openingCashRp = shift.opening_cash_rp === null ? null : Number(shift.opening_cash_rp);
        return {
          shiftId: Number(shift.id), openingCashRp,
          cashTotalRp: totals.cashRp, qrisTotalRp: totals.qrisManualRp,
          expectedCashRp: (openingCashRp ?? 0) + totals.cashRp,
          saleCount: totals.saleCount,
        };
      });
    },

    getClosing(actor, shiftIdInput) {
      return readSnapshot(() => {
        const shift = assertOwnedShift(actor, shiftIdInput);
        const closing = db.prepare("SELECT close_key, request_hash FROM shift_closings WHERE shift_id = ?")
          .get(shift.id) as { close_key: string; request_hash: Uint8Array } | undefined;
        if (!closing || shift.closed_at_ms === null) throw new ShiftNotFoundError("Hasil penutupan shift tidak ditemukan.");
        return loadClosing(Number(shift.id), closing.close_key, Buffer.from(closing.request_hash).toString("hex"));
      });
    },

    getCurrentShift(actor) {
      const row = db
        .prepare(
          `SELECT id, cashier_id, opened_at_ms, opening_cash_rp
           FROM shifts WHERE closed_at_ms IS NULL
           ORDER BY id LIMIT 1`,
        )
        .get() as
        | {
            id: number;
            cashier_id: number;
            opened_at_ms: number;
            opening_cash_rp: number | null;
          }
        | undefined;
      if (!row) {
        return null;
      }
      // CASHIER hanya melihat shift miliknya; kasir lain tidak mengambil alih.
      if (actor.role === "CASHIER" && Number(row.cashier_id) !== actor.userId) {
        return null;
      }
      return toDto(row);
    },
  };
}
