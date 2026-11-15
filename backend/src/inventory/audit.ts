import type { DatabaseSync } from "node:sqlite";

/**
 * Audit untuk impor saldo awal. AUDIT_LOG.md §3 (AUD-04) hanya mencantumkan
 * `INVENTORY_ADJUSTED`; event `STOCK_OPENING_IMPORTED` adalah **usulan
 * kontrak** karena DATABASE.md §13 memerintahkan audit "impor stok". Usulan
 * ini dicatat untuk review David/Naazmi, bukan disahkan diam-diam.
 */
export const INVENTORY_AUDIT_ACTIONS = ["STOCK_OPENING_IMPORTED"] as const;

export type InventoryAuditAction = (typeof INVENTORY_AUDIT_ACTIONS)[number];
export type InventoryAuditValue = string | number | boolean | null;
export type InventoryAuditDetails = Record<string, InventoryAuditValue | InventoryAuditValue[]>;

const MAX_DETAILS_JSON_LENGTH = 2000;
const MAX_TEXT_LENGTH = 200;

function sanitizeValue(value: InventoryAuditValue): InventoryAuditValue {
  if (typeof value !== "string") {
    return value;
  }
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MAX_TEXT_LENGTH);
}

function sanitizeDetails(details: InventoryAuditDetails): string {
  const sanitized: Record<string, InventoryAuditValue | InventoryAuditValue[]> = {};
  for (const [key, value] of Object.entries(details)) {
    sanitized[key] = Array.isArray(value) ? value.map(sanitizeValue) : sanitizeValue(value);
  }
  const json = JSON.stringify({ schemaVersion: 1, ...sanitized });
  if (json.length > MAX_DETAILS_JSON_LENGTH) {
    throw new Error(
      `Details audit terlalu besar (${json.length} > ${MAX_DETAILS_JSON_LENGTH} karakter).`,
    );
  }
  return json;
}

export type InventoryAuditEntry = {
  actorId: number;
  action: InventoryAuditAction;
  entityType: "products";
  entityId: number;
  details: InventoryAuditDetails;
  nowMs: number;
};

/** Audit impor saldo awal ditulis dalam transaksi fixture yang sama. */
export function writeInventoryAudit(db: DatabaseSync, entry: InventoryAuditEntry): void {
  if (!INVENTORY_AUDIT_ACTIONS.includes(entry.action)) {
    throw new Error(`Event audit inventaris tidak terdaftar: ${entry.action}`);
  }
  db.prepare(
    `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, details, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.actorId,
    entry.action,
    entry.entityType,
    String(entry.entityId),
    sanitizeDetails(entry.details),
    entry.nowMs,
  );
}
