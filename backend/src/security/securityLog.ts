/**
 * Log keamanan AUD-09 (`LOGIN_FAILED`, `ACCESS_DENIED`). Audit_LOG.md §4
 * menentukan event ini TIDAK masuk `audit_log` (tidak ada actor fiktif),
 * melainkan log keamanan terbatas. Modul ini hanya memformat ke baris JSON
 * dengan field yang diizinkan; sandi, token, digest, dan hash tidak pernah
 * menjadi field.
 */
export const SECURITY_LOG_ACTIONS = [
  "LOGIN_FAILED",
  "ACCESS_DENIED",
  "LOGOUT",
] as const;

export type SecurityLogAction = (typeof SECURITY_LOG_ACTIONS)[number];

export type SecurityLogEntry = {
  action: SecurityLogAction;
  /** Opsional di level service; lapisan HTTP selalu mengisi correlation id. */
  requestId?: string;
  username?: string;
  userId?: number;
  result: "FAILED" | "DENIED" | "OK";
};

export type SecurityLogSink = (line: string) => void;

export type SecurityLogger = {
  log(entry: SecurityLogEntry): void;
};

const MAX_TEXT_LENGTH = 200;

function sanitizeText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MAX_TEXT_LENGTH);
}

export function createSecurityLogger(
  options: { sink?: SecurityLogSink; now?: () => number } = {},
): SecurityLogger {
  const sink = options.sink ?? (() => {});
  const now = options.now ?? (() => Date.now());

  return {
    log(entry: SecurityLogEntry): void {
      if (!SECURITY_LOG_ACTIONS.includes(entry.action)) {
        throw new Error(`Event log keamanan tidak terdaftar: ${entry.action}`);
      }
      const record: Record<string, unknown> = {
        schemaVersion: 1,
        timestampMs: now(),
        action: entry.action,
        result: entry.result,
      };
      if (entry.requestId !== undefined) {
        record.requestId = sanitizeText(entry.requestId);
      }
      if (entry.username !== undefined) {
        record.username = sanitizeText(entry.username);
      }
      if (entry.userId !== undefined) {
        record.userId = entry.userId;
      }
      // Hanya field di atas yang boleh keluar; tidak ada password/token/hash.
      sink(JSON.stringify(record));
    },
  };
}
