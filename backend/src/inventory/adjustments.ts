import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { AuthRequiredError, ForbiddenError } from "../auth/errors.ts";
import type { SessionUser } from "../auth/session.ts";
import { writeInventoryAudit } from "./audit.ts";
import { ConflictError, InventoryError, NotFoundError, ValidationError } from "./errors.ts";
import { getStockBalance } from "./ledger.ts";

export type AdjustStockInput = {
  adjustmentKey?: unknown;
  productId?: unknown;
  expectedOnHand?: unknown;
  targetOnHand?: unknown;
  reason?: unknown;
};
export type AdjustmentResult = {
  adjustmentKey: string;
  requestHash: string;
  movementId: number;
  productId: number;
  previousOnHand: number;
  onHand: number;
  delta: number;
  reason: string;
  actorId: number;
  committedAtMs: number;
  duplicate: boolean;
};
export type AdjustmentService = {
  adjustStock(actor: SessionUser, input: AdjustStockInput): AdjustmentResult;
};

function integer(value: unknown, field: string, min = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) {
    throw new ValidationError(`${field} harus integer aman minimal ${min}.`, field);
  }
  return value;
}
function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value) ||
      value.trim().length === 0 || value.trim().length > max) {
    throw new ValidationError(`${field} wajib 1–${max} karakter tanpa karakter kontrol.`, field);
  }
  return value.trim();
}

/** DEMO konservatif: koreksi absolut dengan cek saldo awal, ledger tetap sumber tunggal. */
export function createAdjustmentService(
  db: DatabaseSync, options: { now?: () => number } = {},
): AdjustmentService {
  const now = options.now ?? Date.now;
  return {
    adjustStock(actor, input) {
      if (actor.role !== "ADMIN") throw new ForbiddenError("Koreksi stok hanya untuk ADMIN.");
      const adjustmentKey = text(input?.adjustmentKey, "adjustmentKey", 128);
      const productId = integer(input?.productId, "productId", 1);
      const expectedOnHand = integer(input?.expectedOnHand, "expectedOnHand");
      const targetOnHand = integer(input?.targetOnHand, "targetOnHand");
      const reason = text(input?.reason, "reason", 200);
      if (targetOnHand === expectedOnHand) throw new ValidationError("Koreksi harus mengubah saldo.", "targetOnHand");
      const hash = createHash("sha256").update(JSON.stringify([
        "inventory-adjustment-v1", actor.userId, productId, expectedOnHand, targetOnHand, reason,
      ])).digest();
      db.exec("BEGIN IMMEDIATE");
      try {
        const account = db.prepare("SELECT role, active FROM users WHERE id = ?").get(actor.userId) as
          { role: string; active: number } | undefined;
        if (!account || account.active !== 1) throw new AuthRequiredError("Sesi ADMIN tidak lagi valid.");
        if (account.role !== "ADMIN") throw new ForbiddenError("Koreksi stok hanya untuk ADMIN.");
        const stored = db.prepare(`
          SELECT a.request_hash, a.previous_on_hand, a.on_hand, m.id, m.product_id,
                 m.delta, m.adjustment_reason, m.actor_id, m.created_at_ms
          FROM inventory_adjustments a JOIN inventory_movements m ON m.id = a.movement_id
          WHERE a.adjustment_key = ?
        `).get(adjustmentKey) as {
          request_hash: Uint8Array; previous_on_hand: number; on_hand: number;
          id: number; product_id: number; delta: number; adjustment_reason: string;
          actor_id: number; created_at_ms: number;
        } | undefined;
        if (stored) {
          if (!hash.equals(stored.request_hash)) {
            throw new InventoryError("IDEMPOTENCY_CONFLICT", 409, "adjustmentKey sudah dipakai untuk niat berbeda.");
          }
          const result: AdjustmentResult = {
            adjustmentKey, requestHash: hash.toString("hex"), movementId: stored.id,
            productId: stored.product_id, previousOnHand: stored.previous_on_hand,
            onHand: stored.on_hand, delta: stored.delta, reason: stored.adjustment_reason,
            actorId: stored.actor_id, committedAtMs: stored.created_at_ms, duplicate: true,
          };
          db.exec("COMMIT");
          return result;
        }
        const balance = getStockBalance(db, productId);
        if (!balance) throw new NotFoundError();
        if (!Number.isSafeInteger(balance.onHand) || balance.onHand !== expectedOnHand) {
          throw new ConflictError("Saldo berubah. Periksa saldo dan hitung ulang sebelum koreksi baru.", "expectedOnHand");
        }
        const delta = targetOnHand - balance.onHand;
        const committedAtMs = integer(now(), "committedAtMs");
        const movement = db.prepare(`
          INSERT INTO inventory_movements (product_id, kind, delta, adjustment_reason, actor_id, created_at_ms)
          VALUES (?, 'ADJUSTMENT', ?, ?, ?, ?)
        `).run(productId, delta, reason, actor.userId, committedAtMs);
        const movementId = Number(movement.lastInsertRowid);
        db.prepare(`INSERT INTO inventory_adjustments
          (adjustment_key, request_hash, movement_id, previous_on_hand, on_hand) VALUES (?, ?, ?, ?, ?)`)
          .run(adjustmentKey, hash, movementId, balance.onHand, targetOnHand);
        writeInventoryAudit(db, {
          actorId: actor.userId, action: "INVENTORY_ADJUSTED", entityType: "products", entityId: productId,
          details: { movementId, delta, reason, previousOnHand: balance.onHand, onHand: targetOnHand },
          nowMs: committedAtMs,
        });
        db.exec("COMMIT");
        return {
          adjustmentKey, requestHash: hash.toString("hex"), movementId, productId,
          previousOnHand: balance.onHand, onHand: targetOnHand, delta, reason,
          actorId: actor.userId, committedAtMs, duplicate: false,
        };
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch { /* Pertahankan error asli. */ }
        throw error;
      }
    },
  };
}
