import type { DatabaseSync } from "node:sqlite";

/**
 * Event audit akun sesuai AUDIT_LOG.md §3 (AUD-01). Nama di luar daftar ini
 * ditolak agar tidak ada string mentah dari UI.
 */
export const AUTH_AUDIT_ACTIONS = [
  "ACCOUNT_CREATED",
  "ACCOUNT_DISABLED",
  // Usulan penambahan AUD-01 untuk pemulihan akses; perlu review David/Naazmi.
  "ACCOUNT_ENABLED",
  "ROLE_CHANGED",
] as const;

export type AuthAuditAction = (typeof AUTH_AUDIT_ACTIONS)[number];
export type AuthAuditValue = string | number | boolean | null;
export type AuthAuditDetails = Record<string, AuthAuditValue | AuthAuditValue[]>;

const MAX_DETAILS_JSON_LENGTH = 2000;
const MAX_TEXT_LENGTH = 200;

function sanitizeValue(value: AuthAuditValue): AuthAuditValue {
  if (typeof value !== "string") {
    return value;
  }
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MAX_TEXT_LENGTH);
}

function sanitizeDetails(details: AuthAuditDetails): string {
  const sanitized: Record<string, AuthAuditValue | AuthAuditValue[]> = {};
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

export type AuthAuditEntry = {
  actorId: number;
  action: AuthAuditAction;
  entityType: "users";
  entityId: number;
  details: AuthAuditDetails;
  nowMs: number;
};

/**
 * Audit akun ditulis dalam transaksi yang sama dengan perubahan akun
 * (AUDIT_LOG.md §4). Tidak ada sandi/hash/token yang boleh masuk `details`.
 */
export function writeAuthAudit(db: DatabaseSync, entry: AuthAuditEntry): void {
  if (!AUTH_AUDIT_ACTIONS.includes(entry.action)) {
    throw new Error(`Event audit akun tidak terdaftar: ${entry.action}`);
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
