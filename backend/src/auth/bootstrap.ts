import type { DatabaseSync } from "node:sqlite";
import { writeAuthAudit } from "./audit.ts";
import { ConflictError } from "./errors.ts";
import { hashPassword } from "./password.ts";
import type { UserDto } from "./service.ts";
import { assertPassword, assertUsername } from "./validation.ts";

export function hasAnyUser(db: DatabaseSync): boolean {
  const row = db
    .prepare("SELECT EXISTS(SELECT 1 FROM users) AS has_users")
    .get() as { has_users: number } | undefined;
  return Number(row?.has_users ?? 0) === 1;
}

const RESERVED_DEMO_USERNAMES = new Set([
  "demo.admin",
  "demo.kasir.pagi",
  "demo.kasir.sore",
]);

function hasDemoSeedRun(db: DatabaseSync): boolean {
  const seedTable = db
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'demo_seed_runs'")
    .get() as { found: number } | undefined;
  if (!seedTable) {
    return false;
  }
  const run = db
    .prepare("SELECT 1 AS found FROM demo_seed_runs WHERE run_key = 'demo-synthetic-v1'")
    .get() as { found: number } | undefined;
  return Boolean(run);
}

function countRealUsers(db: DatabaseSync): number {
  const seededDemo = hasDemoSeedRun(db);
  const existing = db
    .prepare(
      seededDemo
        ? `SELECT COUNT(*) AS total FROM users
           WHERE NOT (
             (id = 1 AND username = 'demo.admin' AND role = 'ADMIN')
             OR (id = 2 AND username = 'demo.kasir.pagi' AND role = 'CASHIER')
             OR (id = 3 AND username = 'demo.kasir.sore' AND role = 'CASHIER')
           )`
        : "SELECT COUNT(*) AS total FROM users",
    )
    .get() as { total: number };
  return Number(existing.total);
}

export function needsFirstAdminSetup(db: DatabaseSync): boolean {
  const table = db
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get() as { found: number } | undefined;
  if (!table) {
    return false;
  }
  if (countRealUsers(db) > 0) {
    return false;
  }
  const usable = db
    .prepare(
      "SELECT EXISTS(SELECT 1 FROM users WHERE active = 1 AND password_hash != 'DEMO_LOCKED_NO_LOGIN') AS has_usable",
    )
    .get() as { has_usable: number } | undefined;
  return Number(usable?.has_usable ?? 0) === 0;
}

/**
 * Membuat akun ADMIN pertama secara atomik hanya ketika belum ada akun asli.
 * Dipakai bersama oleh CLI `bootstrap-admin` dan endpoint setup awal `POST /auth/bootstrap-admin`.
 */
export function bootstrapFirstAdmin(
  db: DatabaseSync,
  input: { username?: unknown; password?: unknown; nowMs?: number },
): UserDto {
  const nowMs = input?.nowMs ?? Date.now();

  db.exec("BEGIN IMMEDIATE");
  try {
    const table = db
      .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'users'")
      .get() as { found: number } | undefined;
    if (!table) {
      throw new Error("Tabel users tidak tersedia.");
    }
    if (!needsFirstAdminSetup(db)) {
      throw new ConflictError(
        "Bootstrap ADMIN hanya berlaku saat belum ada akun asli. Buat akun tambahan lewat endpoint ADMIN.",
        "username",
      );
    }
    const username = assertUsername(input?.username);
    if (RESERVED_DEMO_USERNAMES.has(username.toLowerCase())) {
      throw new ConflictError(
        "Username demo dicadangkan untuk seed DEMO; gunakan username admin asli.",
        "username",
      );
    }
    const password = assertPassword(input?.password);
    const result = db
      .prepare(
        `INSERT INTO users (username, password_hash, role, active, created_at_ms)
         VALUES (?, ?, 'ADMIN', 1, ?)`,
      )
      .run(username, hashPassword(password), nowMs);
    const adminId = Number(result.lastInsertRowid);
    writeAuthAudit(db, {
      actorId: adminId,
      action: "ACCOUNT_CREATED",
      entityType: "users",
      entityId: adminId,
      details: { username, role: "ADMIN", active: true, bootstrap: true },
      nowMs,
    });
    db.exec("COMMIT");
    return { id: adminId, username, role: "ADMIN", active: true };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Error asli tetap dilempar.
    }
    throw error;
  }
}
