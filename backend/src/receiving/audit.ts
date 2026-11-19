import type { DatabaseSync } from "node:sqlite";

/**
 * AUDIT_LOG.md §3 AUD-03: `GOODS_RECEIPT_COMMITTED` dengan actor, ID
 * penerimaan, dan referensi ledger. Rincian item tidak diduplikasi ke JSON.
 */
export const RECEIVING_AUDIT_ACTIONS = ["GOODS_RECEIPT_COMMITTED"] as const;

export type ReceivingAuditAction = (typeof RECEIVING_AUDIT_ACTIONS)[number];
export type ReceivingAuditValue = string | number | boolean | null;
export type ReceivingAuditDetails = Record<string, ReceivingAuditValue | ReceivingAuditValue[]>;

const MAX_DETAILS_JSON_LENGTH = 2000;
const MAX_TEXT_LENGTH = 200;

function sanitizeValue(value: ReceivingAuditValue): ReceivingAuditValue {
  if (typeof value !== "string") {
    return value;
  }
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MAX_TEXT_LENGTH);
}

function sanitizeDetails(details: ReceivingAuditDetails): string {
  const sanitized: Record<string, ReceivingAuditValue | ReceivingAuditValue[]> = {};
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

export type ReceivingAuditEntry = {
  actorId: number;
  action: ReceivingAuditAction;
  entityType: "goods_receipts";
  entityId: number;
  details: ReceivingAuditDetails;
  nowMs: number;
};

export function writeReceivingAudit(db: DatabaseSync, entry: ReceivingAuditEntry): void {
  if (!RECEIVING_AUDIT_ACTIONS.includes(entry.action)) {
    throw new Error(`Event audit penerimaan tidak terdaftar: ${entry.action}`);
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
