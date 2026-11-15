import type { DatabaseSync } from "node:sqlite";
import { AuthRequiredError, ForbiddenError, ValidationError } from "../auth/errors.ts";
import type { SessionUser } from "../auth/session.ts";
import { writeShiftAudit } from "./audit.ts";
import { ShiftAlreadyOpenError } from "./errors.ts";

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

export type ShiftService = {
  openShift(actor: SessionUser, input: { openingCashRp?: unknown }): ShiftDto;
  getCurrentShift(actor: SessionUser): ShiftDto | null;
};

const MAX_OPENING_CASH_RP = 1_000_000_000;

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
