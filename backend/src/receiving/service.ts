import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { AuthRequiredError, ForbiddenError } from "../auth/errors.ts";
import type { SessionUser } from "../auth/session.ts";
import { writeReceivingAudit } from "./audit.ts";
import { IdempotencyConflictError, NotFoundError, ValidationError } from "./errors.ts";

/**
 * Penerimaan barang TASK-025 (DEMO). Tidak ada tabel draft: draft adalah niat
 * di klien yang dibatalkan dengan membuangnya, sehingga tidak ada saldo yang
 * berubah. `receiptKey` adalah identitas upaya; `request_hash` kanonis dibuat
 * backend dari isi penerimaan, bukan dipercaya dari klien.
 *
 * Semua dokumen + item + mutasi ledger + audit ditulis dalam satu transaksi.
 */
export type ReceiptItemInput = { productId: unknown; quantity: unknown };

export type ReceiveGoodsInput = {
  receiptKey?: unknown;
  supplierId?: unknown;
  items?: unknown;
  supplierRef?: unknown;
};

export type ReceiptResultItem = {
  receiptItemId: number;
  productId: number;
  sku: string;
  name: string;
  quantity: number;
  movementId: number;
};

export type ReceiptResult = {
  receiptId: number;
  receiptKey: string;
  requestHash: string;
  supplierId: number;
  supplierRef: string | null;
  committedAtMs: number;
  totalQuantity: number;
  items: ReceiptResultItem[];
  /** true bila hasil diambil dari penerimaan yang sudah tersimpan (retry identik). */
  duplicate: boolean;
};

export type ReceivingService = {
  receiveGoods(actor: SessionUser, input: ReceiveGoodsInput): ReceiptResult;
};

const RECEIPT_HASH_VERSION = "goods-receipt-v1";
const MAX_RECEIPT_KEY_LENGTH = 128;
const MAX_SUPPLIER_REF_LENGTH = 120;
const MAX_QUANTITY = 1_000_000;

function assertReceiptKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new ValidationError("receiptKey harus berupa teks.", "receiptKey");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_RECEIPT_KEY_LENGTH) {
    throw new ValidationError(
      `receiptKey harus 1-${MAX_RECEIPT_KEY_LENGTH} karakter.`,
      "receiptKey",
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new ValidationError("receiptKey memuat karakter kontrol.", "receiptKey");
  }
  return trimmed;
}

function assertPositiveInt(value: unknown, field: string, max = Number.MAX_SAFE_INTEGER): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > max
  ) {
    throw new ValidationError(`${field} harus bilangan bulat 1-${max}.`, field);
  }
  return value;
}

function assertSupplierRef(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new ValidationError("supplierRef harus berupa teks.", "supplierRef");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > MAX_SUPPLIER_REF_LENGTH) {
    throw new ValidationError(
      `supplierRef maksimum ${MAX_SUPPLIER_REF_LENGTH} karakter.`,
      "supplierRef",
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new ValidationError("supplierRef memuat karakter kontrol.", "supplierRef");
  }
  return trimmed;
}

function parseItems(raw: unknown): Array<{ productId: number; quantity: number }> {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ValidationError("items wajib berisi minimal satu item.", "items");
  }
  const seen = new Set<number>();
  const items: Array<{ productId: number; quantity: number }> = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new ValidationError("Setiap item harus objek { productId, quantity }.", "items");
    }
    const obj = entry as ReceiptItemInput;
    const productId = assertPositiveInt(obj.productId, "items.productId");
    if (seen.has(productId)) {
      throw new ValidationError(`productId ganda di items: ${productId}.`, "items");
    }
    seen.add(productId);
    items.push({
      productId,
      quantity: assertPositiveInt(obj.quantity, "items.quantity", MAX_QUANTITY),
    });
  }
  items.sort((a, b) => a.productId - b.productId);
  return items;
}

function computeRequestHash(intent: {
  receiptKey: string;
  supplierId: number;
  receivedBy: number;
  supplierRef: string | null;
  items: Array<{ productId: number; quantity: number }>;
}): { hex: string; bytes: Buffer } {
  const canonical = JSON.stringify({
    version: RECEIPT_HASH_VERSION,
    receiptKey: intent.receiptKey,
    supplierId: intent.supplierId,
    receivedBy: intent.receivedBy,
    supplierRef: intent.supplierRef,
    items: intent.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
  });
  const bytes = createHash("sha256").update(canonical, "utf8").digest();
  return { hex: bytes.toString("hex"), bytes };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createReceivingService(
  db: DatabaseSync,
  deps: { now?: () => number } = {},
): ReceivingService {
  const now = deps.now ?? (() => Date.now());

  function assertActiveAdmin(actor: SessionUser): void {
    const row = db
      .prepare("SELECT role, active FROM users WHERE id = ?")
      .get(actor.userId) as { role: string; active: number } | undefined;
    if (!row || Number(row.active) !== 1) {
      throw new AuthRequiredError("Sesi ADMIN tidak lagi valid.");
    }
    if (String(row.role) !== "ADMIN") {
      throw new ForbiddenError("Hanya ADMIN yang boleh menerima barang.");
    }
  }

  function loadResult(receiptId: number, duplicate: boolean): ReceiptResult {
    const receipt = db
      .prepare(
        `SELECT id, receipt_key, request_hash, supplier_id, supplier_ref, committed_at_ms
         FROM goods_receipts WHERE id = ?`,
      )
      .get(receiptId) as
      | {
          id: number;
          receipt_key: string;
          request_hash: Uint8Array;
          supplier_id: number;
          supplier_ref: string | null;
          committed_at_ms: number;
        }
      | undefined;
    if (!receipt) {
      throw new NotFoundError("Penerimaan tidak ditemukan.");
    }
    const rows = db
      .prepare(
        `SELECT ri.id AS receipt_item_id, ri.product_id, p.sku, p.name, ri.quantity,
                m.id AS movement_id
         FROM receipt_items ri
         JOIN products p ON p.id = ri.product_id
         LEFT JOIN inventory_movements m
           ON m.receipt_item_id = ri.id AND m.product_id = ri.product_id
         WHERE ri.receipt_id = ?
         ORDER BY ri.id`,
      )
      .all(receiptId) as Array<{
      receipt_item_id: number;
      product_id: number;
      sku: string;
      name: string;
      quantity: number;
      movement_id: number | null;
    }>;
    const items: ReceiptResultItem[] = rows.map((row) => {
      if (row.movement_id === null) {
        throw new Error("Mutasi penerimaan tidak lengkap.");
      }
      return {
        receiptItemId: Number(row.receipt_item_id),
        productId: Number(row.product_id),
        sku: String(row.sku),
        name: String(row.name),
        quantity: Number(row.quantity),
        movementId: Number(row.movement_id),
      };
    });
    return {
      receiptId: Number(receipt.id),
      receiptKey: String(receipt.receipt_key),
      requestHash: Buffer.from(receipt.request_hash).toString("hex"),
      supplierId: Number(receipt.supplier_id),
      supplierRef: receipt.supplier_ref === null ? null : String(receipt.supplier_ref),
      committedAtMs: Number(receipt.committed_at_ms),
      totalQuantity: items.reduce((total, item) => total + item.quantity, 0),
      items,
      duplicate,
    };
  }

  return {
    receiveGoods(actor, input) {
      if (actor.role !== "ADMIN") {
        throw new ForbiddenError("Hanya ADMIN yang boleh menerima barang.");
      }
      const receiptKey = assertReceiptKey(input?.receiptKey);
      const supplierId = assertPositiveInt(input?.supplierId, "supplierId");
      const items = parseItems(input?.items);
      const supplierRef = assertSupplierRef(input?.supplierRef);
      const hash = computeRequestHash({
        receiptKey,
        supplierId,
        receivedBy: actor.userId,
        supplierRef,
        items,
      });
      const committedAtMs = now();

      db.exec("BEGIN IMMEDIATE");
      try {
        assertActiveAdmin(actor);

        // Idempotensi diperiksa sebelum validasi katalog: retry harus mengembalikan
        // hasil lama apa pun kondisi katalog saat ini.
        const existing = db
          .prepare("SELECT id, request_hash FROM goods_receipts WHERE receipt_key = ?")
          .get(receiptKey) as { id: number; request_hash: Uint8Array } | undefined;
        if (existing) {
          if (Buffer.compare(Buffer.from(existing.request_hash), hash.bytes) !== 0) {
            throw new IdempotencyConflictError();
          }
          const result = loadResult(Number(existing.id), true);
          db.exec("COMMIT");
          return result;
        }

        const supplier = db.prepare("SELECT id FROM suppliers WHERE id = ?").get(supplierId) as
          | { id: number }
          | undefined;
        if (!supplier) {
          throw new NotFoundError(`Supplier ${supplierId} tidak ditemukan.`);
        }
        const productStmt = db.prepare("SELECT id, sku, name, active FROM products WHERE id = ?");
        for (const item of items) {
          const product = productStmt.get(item.productId) as
            | { id: number; sku: string; name: string; active: number }
            | undefined;
          if (!product) {
            throw new NotFoundError(`Produk ${item.productId} tidak ditemukan.`);
          }
          if (Number(product.active) !== 1) {
            throw new ValidationError(`Produk "${product.sku}" tidak aktif.`, "items");
          }
        }

        let receiptId: number;
        try {
          const inserted = db
            .prepare(
              `INSERT INTO goods_receipts
                 (receipt_key, request_hash, supplier_id, received_by, committed_at_ms, supplier_ref)
               VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(receiptKey, hash.bytes, supplierId, actor.userId, committedAtMs, supplierRef);
          receiptId = Number(inserted.lastInsertRowid);
        } catch (error) {
          if (errorMessage(error).includes("UNIQUE constraint failed")) {
            throw new IdempotencyConflictError();
          }
          throw error;
        }

        const insertItem = db.prepare(
          "INSERT INTO receipt_items (receipt_id, product_id, quantity) VALUES (?, ?, ?)",
        );
        const insertMovement = db.prepare(
          `INSERT INTO inventory_movements
             (product_id, kind, delta, receipt_item_id, actor_id, created_at_ms)
           VALUES (?, 'RECEIPT', ?, ?, ?, ?)`,
        );
        let totalQuantity = 0;
        for (const item of items) {
          const itemResult = insertItem.run(receiptId, item.productId, item.quantity);
          const receiptItemId = Number(itemResult.lastInsertRowid);
          insertMovement.run(
            item.productId,
            item.quantity,
            receiptItemId,
            actor.userId,
            committedAtMs,
          );
          totalQuantity += item.quantity;
        }

        writeReceivingAudit(db, {
          actorId: actor.userId,
          action: "GOODS_RECEIPT_COMMITTED",
          entityType: "goods_receipts",
          entityId: receiptId,
          details: { receiptKey, supplierId, itemCount: items.length, totalQuantity },
          nowMs: committedAtMs,
        });
        db.exec("COMMIT");
        return loadResult(receiptId, false);
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // Error asli tetap dilempar.
        }
        throw error;
      }
    },
  };
}
