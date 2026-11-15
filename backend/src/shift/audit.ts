import type { DatabaseSync } from "node:sqlite";

/**
 * AUD-05 sudah mencantumkan `SHIFT_OPENED` dan `SHIFT_CLOSED`; tidak ada
 * usulan event baru di modul ini. Nilai kas sengaja tidak diduplikasi ke
 * audit (AUDIT_LOG.md §3: nilai kas tetap di tabel shift/closing).
 */
export const SHIFT_AUDIT_ACTIONS = ["SHIFT_OPENED", "SHIFT_CLOSED"] as const;

export type ShiftAuditAction = (typeof SHIFT_AUDIT_ACTIONS)[number];
export type ShiftAuditValue = string | number | boolean | null;
export type ShiftAuditDetails = Record<string, ShiftAuditValue | ShiftAuditValue[]>;

const MAX_DETAILS_JSON_LENGTH = 2000;
const MAX_TEXT_LENGTH = 200;

function sanitizeValue(value: ShiftAuditValue): ShiftAuditValue {
  if (typeof value !== "string") {
    return value;
  }
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MAX_TEXT_LENGTH);
}

function sanitizeDetails(details: ShiftAuditDetails): string {
  const sanitized: Record<string, ShiftAuditValue | ShiftAuditValue[]> = {};
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

export type ShiftAuditEntry = {
  actorId: number;
  action: ShiftAuditAction;
  entityType: "shifts";
  entityId: number;
  details: ShiftAuditDetails;
  nowMs: number;
};

export function writeShiftAudit(db: DatabaseSync, entry: ShiftAuditEntry): void {
  if (!SHIFT_AUDIT_ACTIONS.includes(entry.action)) {
    throw new Error(`Event audit shift tidak terdaftar: ${entry.action}`);
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
