import type { DatabaseSync } from "node:sqlite";
import { writeInventoryAudit } from "./audit.ts";
import { ConflictError, NotFoundError, ValidationError } from "./errors.ts";
import type { OpeningFixtureEntry, OpeningFixtureResult } from "./types.ts";

/**
 * Fixture saldo awal sintetis untuk pengujian/QA. Bukan penerimaan operasional
 * (TASK-025) dan bukan checkout (TASK-016).
 *
 * Pencegahan duplikasi:
 *  - partial unique index `ux_movements_opening_product` menjamin maksimal satu
 *    mutasi OPENING per produk, bahkan saat dua proses bersamaan;
 *  - fixture dengan `batchRef` sama untuk produk yang sama dilewati
 *    (idempoten), sedangkan batch berbeda ditolak 409.
 *
 * Semua mutasi + audit berada dalam satu transaksi; kegagalan di tengah
 * rollback utuh.
 */
export type ApplyOpeningFixtureInput = {
  batchRef: string;
  entries: OpeningFixtureEntry[];
  actorId: number;
  now?: () => number;
};

const MAX_BATCH_REF_LENGTH = 80;

function normalizeBatchRef(value: unknown): string {
  if (typeof value !== "string") {
    throw new ValidationError("batchRef harus berupa teks.", "batchRef");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("batchRef tidak boleh kosong.", "batchRef");
  }
  if (trimmed.length > MAX_BATCH_REF_LENGTH) {
    throw new ValidationError(
      `batchRef maksimum ${MAX_BATCH_REF_LENGTH} karakter.`,
      "batchRef",
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new ValidationError("batchRef memuat karakter kontrol.", "batchRef");
  }
  return trimmed;
}

function normalizeEntries(value: unknown): OpeningFixtureEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError("entries harus daftar tidak kosong.", "entries");
  }
  const seen = new Set<number>();
  const entries: OpeningFixtureEntry[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      throw new ValidationError("entries harus objek.", "entries");
    }
    const productId = (item as { productId?: unknown }).productId;
    const quantity = (item as { quantity?: unknown }).quantity;
    if (
      typeof productId !== "number" ||
      !Number.isSafeInteger(productId) ||
      productId <= 0
    ) {
      throw new ValidationError("productId harus ID positif.", "entries");
    }
    if (
      typeof quantity !== "number" ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0
    ) {
      throw new ValidationError("quantity harus bilangan bulat positif.", "entries");
    }
    if (seen.has(productId)) {
      throw new ValidationError(`productId ganda di entries: ${productId}.`, "entries");
    }
    seen.add(productId);
    entries.push({ productId, quantity });
  }
  return entries;
}

function assertActiveActor(db: DatabaseSync, actorId: number): void {
  const row = db
    .prepare("SELECT 1 AS found FROM users WHERE id = ? AND active = 1")
    .get(actorId) as { found: number } | undefined;
  if (!row) {
    throw new ValidationError("actorId bukan pengguna aktif.", "actorId");
  }
}

export function applyOpeningFixture(
  db: DatabaseSync,
  input: ApplyOpeningFixtureInput,
): OpeningFixtureResult {
  const batchRef = normalizeBatchRef(input?.batchRef);
  const entries = normalizeEntries(input?.entries);
  const actorId = input?.actorId;
  if (typeof actorId !== "number" || !Number.isSafeInteger(actorId) || actorId <= 0) {
    throw new ValidationError("actorId harus ID positif.", "actorId");
  }
  const now = input.now ?? (() => Date.now());

  const applied: OpeningFixtureResult["applied"] = [];
  const skipped: OpeningFixtureResult["skipped"] = [];

  db.exec("BEGIN IMMEDIATE");
  try {
    assertActiveActor(db, actorId);
    const productStmt = db.prepare("SELECT id, sku FROM products WHERE id = ?");
    const openingStmt = db.prepare(
      "SELECT opening_batch_ref FROM inventory_movements WHERE product_id = ? AND kind = 'OPENING'",
    );
    const insertMovement = db.prepare(
      `INSERT INTO inventory_movements (
         product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms
       ) VALUES (?, 'OPENING', ?, ?, ?, ?)`,
    );

    for (const entry of entries) {
      const product = productStmt.get(entry.productId) as { id: number; sku: string } | undefined;
      if (!product) {
        throw new NotFoundError(`Produk ${entry.productId} tidak ditemukan.`);
      }
      const existing = openingStmt.get(entry.productId) as
        | { opening_batch_ref: string }
        | undefined;
      if (existing) {
        if (String(existing.opening_batch_ref) === batchRef) {
          skipped.push({
            productId: entry.productId,
            sku: String(product.sku),
            batchRef,
          });
          continue;
        }
        throw new ConflictError(
          `Produk ${entry.productId} sudah punya saldo awal batch ${String(
            existing.opening_batch_ref,
          )}.`,
          "batchRef",
        );
      }
      try {
        insertMovement.run(entry.productId, entry.quantity, batchRef, actorId, now());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("UNIQUE constraint failed")) {
          throw new ConflictError(
            `Produk ${entry.productId} sudah punya saldo awal lain.`,
            "batchRef",
          );
        }
        throw error;
      }
      writeInventoryAudit(db, {
        actorId,
        action: "STOCK_OPENING_IMPORTED",
        entityType: "products",
        entityId: entry.productId,
        details: { sku: String(product.sku), batchRef, quantity: entry.quantity },
        nowMs: now(),
      });
      applied.push({
        productId: entry.productId,
        sku: String(product.sku),
        quantity: entry.quantity,
      });
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Error asli tetap dilempar.
    }
    throw error;
  }

  return { batchRef, applied, skipped };
}
