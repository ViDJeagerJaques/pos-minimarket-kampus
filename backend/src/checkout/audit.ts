import type { DatabaseSync } from "node:sqlite";

const ALLOWED_CHECKOUT_AUDIT_ACTIONS = new Set<string>(["CHECKOUT_COMMITTED"]);

export type CheckoutAuditEntry = {
  actorId: number;
  action: "CHECKOUT_COMMITTED";
  entityType: "sales";
  entityId: number;
  details: Record<string, unknown>;
  nowMs: number;
};

/**
 * Mencatat audit domain checkout di dalam transaksi yang sama (AUTHORIZATION.md §5).
 * Whitelist event mencegah penulisan event sembarangan.
 */
export function writeCheckoutAudit(db: DatabaseSync, entry: CheckoutAuditEntry): void {
  if (!ALLOWED_CHECKOUT_AUDIT_ACTIONS.has(entry.action)) {
    throw new Error(`Event audit checkout tidak terdaftar: ${String(entry.action)}.`);
  }
  db.prepare(
    `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, details, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.actorId,
    entry.action,
    entry.entityType,
    entry.entityId,
    JSON.stringify(entry.details),
    entry.nowMs,
  );
}

