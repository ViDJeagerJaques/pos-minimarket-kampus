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

/**
 * Membuat akun ADMIN pertama secara atomik hanya ketika tabel `users` masih kosong.
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
    const existing = db.prepare("SELECT COUNT(*) AS total FROM users").get() as {
      total: number;
    };
    if (Number(existing.total) > 0) {
      throw new ConflictError(
        "Bootstrap ADMIN hanya berlaku saat belum ada akun. Buat akun tambahan lewat endpoint ADMIN.",
        "username",
      );
    }
    const username = assertUsername(input?.username);
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
