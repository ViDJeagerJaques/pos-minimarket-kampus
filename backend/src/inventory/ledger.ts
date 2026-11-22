import type { DatabaseSync } from "node:sqlite";
import { InsufficientStockError, NotFoundError, ValidationError } from "./errors.ts";
import type {
  MovementKind,
  ReconciliationReport,
  StockBalance,
  StockMovementHistoryEntry,
} from "./types.ts";

/**
 * Ledger adalah sumber saldo tunggal (DATABASE.md §9). Modul ini hanya
 * membaca/agregasi `inventory_movements`; tidak ada kolom saldo yang bisa
 * diubah langsung. Katalog (`catalog/service.ts`) memakai agregasi yang sama
 * untuk `stockOnHand`, sehingga saldo barang dan ledger tetap sinkron.
 */

function assertProductId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError("productId harus ID positif.", "productId");
  }
  return value;
}

export function listStockBalances(db: DatabaseSync, productIds?: number[]): StockBalance[] {
  const filters: string[] = [];
  const params: Array<number> = [];
  if (productIds !== undefined) {
    if (productIds.length === 0) {
      return [];
    }
    const normalized: number[] = [];
    for (const value of productIds) {
      const id = assertProductId(value);
      if (!normalized.includes(id)) {
        normalized.push(id);
      }
    }
    filters.push(`p.id IN (${normalized.map(() => "?").join(", ")})`);
    params.push(...normalized);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT p.id, p.sku, p.name,
              COALESCE((SELECT SUM(m.delta) FROM inventory_movements m
                        WHERE m.product_id = p.id), 0) AS on_hand,
              EXISTS(SELECT 1 FROM inventory_movements m
                     WHERE m.product_id = p.id) AS has_movements
       FROM products p
       ${where}
       ORDER BY p.sku COLLATE NOCASE, p.id`,
    )
    .all(...params) as Array<{
    id: number;
    sku: string;
    name: string;
    on_hand: number;
    has_movements: number;
  }>;
  return rows.map((row) => ({
    productId: Number(row.id),
    sku: String(row.sku),
    name: String(row.name),
    onHand: Number(row.on_hand),
    hasMovements: Number(row.has_movements) === 1,
  }));
}

export function getStockBalance(db: DatabaseSync, productId: unknown): StockBalance | null {
  const id = assertProductId(productId);
  const rows = listStockBalances(db, [id]);
  return rows.length === 0 ? null : rows[0]!;
}

export function listStockMovements(
  db: DatabaseSync,
  productId: unknown,
  options: { limit?: number } = {},
): StockMovementHistoryEntry[] {
  const id = assertProductId(productId);
  const limit = options.limit;
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) {
    throw new ValidationError("limit harus bilangan bulat positif.", "limit");
  }
  const base = `SELECT m.id, m.kind, m.delta, m.created_at_ms, m.actor_id,
          m.sale_item_id, m.receipt_item_id, m.opening_batch_ref, m.adjustment_reason,
          si.quantity AS sale_quantity,
          s.sale_no AS sale_no,
          ri.quantity AS receipt_quantity,
          r.receipt_key AS receipt_key
   FROM inventory_movements m
   LEFT JOIN sale_items si ON si.id = m.sale_item_id
   LEFT JOIN sales s ON s.id = si.sale_id
   LEFT JOIN receipt_items ri ON ri.id = m.receipt_item_id
   LEFT JOIN goods_receipts r ON r.id = ri.receipt_id
   WHERE m.product_id = ?`;
  // Bila dibatasi, ambil entri TERBARU lalu kembalikan dalam urutan lama→baru
  // agar perilaku tampilan tidak berubah.
  const sql =
    limit === undefined
      ? `${base} ORDER BY m.id`
      : `SELECT * FROM (${base} ORDER BY m.id DESC LIMIT ?) ORDER BY id`;
  const rows = db.prepare(sql).all(...(limit === undefined ? [id] : [id, limit])) as Array<{
    id: number;
    kind: string;
    delta: number;
    created_at_ms: number;
    actor_id: number;
    sale_item_id: number | null;
    receipt_item_id: number | null;
    opening_batch_ref: string | null;
    adjustment_reason: string | null;
    sale_quantity: number | null;
    sale_no: string | null;
    receipt_quantity: number | null;
    receipt_key: string | null;
  }>;

  return rows.map((row) => {
    const kind = row.kind as MovementKind;
    let sourceType: StockMovementHistoryEntry["sourceType"] = null;
    let sourceId: number | null = null;
    let sourceRef: string | null = null;
    let sourceQuantity: number | null = null;
    if (kind === "OPENING") {
      sourceType = "OPENING";
      sourceRef = row.opening_batch_ref;
    } else if (kind === "SALE") {
      sourceType = "SALE_ITEM";
      sourceId = row.sale_item_id;
      sourceRef = row.sale_no;
      sourceQuantity = row.sale_quantity === null ? null : Number(row.sale_quantity);
    } else if (kind === "RECEIPT") {
      sourceType = "RECEIPT_ITEM";
      sourceId = row.receipt_item_id;
      sourceRef = row.receipt_key;
      sourceQuantity = row.receipt_quantity === null ? null : Number(row.receipt_quantity);
    } else if (kind === "ADJUSTMENT") {
      sourceType = "ADJUSTMENT";
    }
    return {
      id: Number(row.id),
      kind,
      delta: Number(row.delta),
      createdAtMs: Number(row.created_at_ms),
      actorId: Number(row.actor_id),
      sourceType,
      sourceId,
      sourceRef,
      sourceQuantity,
      adjustmentReason: row.adjustment_reason,
    };
  });
}

function sumByKind(rows: Array<{ kind: string; delta: number }>, kind: MovementKind): number {
  return rows
    .filter((row) => row.kind === kind)
    .reduce((total, row) => total + Number(row.delta), 0);
}

export function reconcileProduct(db: DatabaseSync, productId: unknown): ReconciliationReport {
  const id = assertProductId(productId);
  const balance = getStockBalance(db, id);
  if (!balance) {
    throw new NotFoundError("Produk tidak ditemukan.");
  }
  const rows = db
    .prepare("SELECT kind, delta FROM inventory_movements WHERE product_id = ? ORDER BY id")
    .all(id) as Array<{ kind: string; delta: number }>;

  const opening = sumByKind(rows, "OPENING");
  const receipt = sumByKind(rows, "RECEIPT");
  const sale = Math.abs(sumByKind(rows, "SALE"));
  const adjustment = sumByKind(rows, "ADJUSTMENT");
  const ledgerOnHand = rows.reduce((total, row) => total + Number(row.delta), 0);
  const computedOnHand = opening + receipt - sale + adjustment;

  const issues: string[] = [];
  const openingCount = rows.filter((row) => row.kind === "OPENING").length;
  if (openingCount > 1) {
    issues.push(`OPENING lebih dari satu (${openingCount}); maksimal satu per produk.`);
  }
  const illegal = db
    .prepare(
      `SELECT COUNT(*) AS total FROM inventory_movements
       WHERE product_id = ? AND (
         (kind = 'SALE' AND sale_item_id IS NULL)
         OR (kind = 'RECEIPT' AND receipt_item_id IS NULL)
         OR (kind = 'ADJUSTMENT' AND (adjustment_reason IS NULL OR length(trim(adjustment_reason)) = 0))
         OR (kind = 'OPENING' AND (opening_batch_ref IS NULL OR length(trim(opening_batch_ref)) = 0))
       )`,
    )
    .get(id) as { total: number };
  if (Number(illegal.total) > 0) {
    issues.push(`${Number(illegal.total)} mutasi tanpa sumber/alasan yang sah.`);
  }
  const saleMismatches = db
    .prepare(
      `SELECT m.id, m.delta, m.sale_item_id, si.quantity AS sale_quantity
       FROM inventory_movements m
       LEFT JOIN sale_items si ON si.id = m.sale_item_id
       WHERE m.product_id = ?
         AND m.kind = 'SALE'
         AND m.sale_item_id IS NOT NULL
         AND (si.id IS NULL OR m.delta != -si.quantity)
       ORDER BY m.id`,
    )
    .all(id) as Array<{
    id: number;
    delta: number;
    sale_item_id: number;
    sale_quantity: number | null;
  }>;
  for (const mismatch of saleMismatches) {
    if (mismatch.sale_quantity === null) {
      issues.push(
        `Mutasi SALE #${Number(mismatch.id)} (sale_item_id=${Number(mismatch.sale_item_id)}): item penjualan sumber tidak ditemukan.`,
      );
    } else {
      issues.push(
        `Mutasi SALE #${Number(mismatch.id)} (sale_item_id=${Number(mismatch.sale_item_id)}): delta ${Number(mismatch.delta)} tidak sama dengan -quantity (-${Number(mismatch.sale_quantity)}).`,
      );
    }
  }
  if (ledgerOnHand < 0) {
    issues.push(`Saldo ledger negatif (${ledgerOnHand}).`);
  }
  if (computedOnHand !== ledgerOnHand) {
    issues.push(
      `Komponen ${computedOnHand} tidak sama dengan ledger ${ledgerOnHand}.`,
    );
  }

  return {
    productId: id,
    sku: balance.sku,
    opening,
    receipt,
    sale,
    adjustment,
    computedOnHand,
    ledgerOnHand,
    matched: issues.length === 0,
    issues,
  };
}

export function reconcileAll(db: DatabaseSync): ReconciliationReport[] {
  const products = db.prepare("SELECT id FROM products ORDER BY id").all() as Array<{
    id: number;
  }>;
  return products.map((row) => reconcileProduct(db, Number(row.id)));
}

/**
 * Penjaga aturan DEC-018 (PROPOSED): stok negatif ditolak. Pemanggil
 * (checkout TASK-016) harus memakai ini di dalam transaksi penulis dan
 * mengulang pemeriksaan sebelum commit.
 */
export function assertSufficientStock(
  db: DatabaseSync,
  productId: unknown,
  requiredQuantity: unknown,
): void {
  const id = assertProductId(productId);
  if (
    typeof requiredQuantity !== "number" ||
    !Number.isSafeInteger(requiredQuantity) ||
    requiredQuantity <= 0
  ) {
    throw new ValidationError("requiredQuantity harus bilangan bulat positif.", "quantity");
  }
  const balance = getStockBalance(db, id);
  if (!balance) {
    throw new NotFoundError("Produk tidak ditemukan.");
  }
  if (balance.onHand < requiredQuantity) {
    throw new InsufficientStockError(
      `Stok tidak cukup: saldo ${balance.onHand}, diminta ${requiredQuantity}.`,
    );
  }
}
