import type { DatabaseSync } from "node:sqlite";

/**
 * Nama event audit yang diizinkan. `AUDIT_LOG.md` §3 (AUD-02) menetapkan
 * `PRODUCT_CREATED`, `PRICE_CHANGED`, dan `BARCODE_CHANGED`.
 * `PRODUCT_UPDATED`, `CATEGORY_*`, dan `SUPPLIER_*` adalah usulan penambahan
 * untuk atribut yang belum tercakup AUD-02; perlu review Naazmi/David sebelum
 * dianggap final. Service menolak nama event di luar daftar ini.
 */
export const AUDIT_ACTIONS = [
  "PRODUCT_CREATED",
  "PRODUCT_UPDATED",
  "PRICE_CHANGED",
  "BARCODE_CHANGED",
  "CATEGORY_CREATED",
  "CATEGORY_RENAMED",
  "SUPPLIER_CREATED",
  "SUPPLIER_RENAMED",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditValue = string | number | boolean | null;
export type AuditDetails = Record<string, AuditValue | AuditValue[]>;

const MAX_DETAILS_JSON_LENGTH = 2000;
const MAX_TEXT_LENGTH = 200;

function sanitizeValue(value: AuditValue): AuditValue {
  if (typeof value !== "string") {
    return value;
  }
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MAX_TEXT_LENGTH);
}

function sanitizeDetails(details: AuditDetails): string {
  const sanitized: Record<string, AuditValue | AuditValue[]> = {};
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

export type AuditEntry = {
  actorId: number;
  action: AuditAction;
  entityType: string;
  entityId: string | number;
  details: AuditDetails;
  nowMs: number;
};

/**
 * Menulis satu baris audit. Wajib dipanggil di dalam transaksi yang sama dengan
 * perubahan domain (AUDIT_LOG.md §4) agar tidak ada mutasi tanpa audit atau
 * audit sukses untuk operasi yang gagal.
 */
export function writeAudit(db: DatabaseSync, entry: AuditEntry): void {
  if (!AUDIT_ACTIONS.includes(entry.action)) {
    throw new Error(`Event audit tidak terdaftar: ${entry.action}`);
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