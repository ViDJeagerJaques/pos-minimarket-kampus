import type { DatabaseSync } from "node:sqlite";
import { writeAuthAudit } from "./audit.ts";
import { bootstrapFirstAdmin, hasAnyUser } from "./bootstrap.ts";
import {
  AuthRequiredError,
  ConflictError,
  ForbiddenError,
  InvalidCredentialsError,
  NotFoundError,
  ValidationError,
} from "./errors.ts";
import {
  hashPassword,
  spendUnknownUsernameCost,
  verifyPassword,
} from "./password.ts";
import { assertId, assertPassword, assertRole, assertUsername } from "./validation.ts";
import type { Role, SessionStore, SessionUser } from "./session.ts";
import type { SecurityLogger } from "../security/securityLog.ts";

export type UserDto = {
  id: number;
  username: string;
  role: Role;
  active: boolean;
};

export type CreateUserInput = {
  username: string;
  password: string;
  role: Role;
};

export type UpdateUserInput = {
  active?: boolean;
  role?: Role;
};

export type LoginResult = {
  token: string;
  user: UserDto;
};

export type AuthServiceDeps = {
  sessions: SessionStore;
  securityLog: SecurityLogger;
  now?: () => number;
};

export type AuthService = ReturnType<typeof createAuthService>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUniqueConstraint(message: string, column: string): boolean {
  return message.includes("UNIQUE constraint failed") && message.includes(column);
}

export function createAuthService(db: DatabaseSync, deps: AuthServiceDeps) {
  const now = deps.now ?? (() => Date.now());

  function withTransaction<T>(operation: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Error asli tetap dilempar.
      }
      throw error;
    }
  }

  function requireAdmin(actor: SessionUser): void {
    if (actor.role !== "ADMIN") {
      throw new ForbiddenError();
    }
  }

  /** Pemeriksaan ulang di transaksi agar penonaktifan/perpindahan role tidak lewat. */
  function assertActiveAdmin(actor: SessionUser): void {
    const row = db
      .prepare("SELECT role, active FROM users WHERE id = ?")
      .get(actor.userId) as { role: string; active: number } | undefined;
    if (!row || Number(row.active) !== 1 || String(row.role) !== "ADMIN") {
      throw new AuthRequiredError("Sesi ADMIN tidak lagi valid.");
    }
  }

  function findUserRow(userId: number): {
    id: number;
    username: string;
    role: Role;
    active: boolean;
  } {
    const row = db
      .prepare("SELECT id, username, role, active FROM users WHERE id = ?")
      .get(userId) as
      | { id: number; username: string; role: string; active: number }
      | undefined;
    if (!row) {
      throw new NotFoundError("Akun tidak ditemukan.");
    }
    if (row.role !== "ADMIN" && row.role !== "CASHIER") {
      throw new NotFoundError("Akun tidak ditemukan.");
    }
    return {
      id: Number(row.id),
      username: String(row.username),
      role: row.role,
      active: Number(row.active) === 1,
    };
  }

  function toDto(user: { id: number; username: string; role: Role; active: boolean }): UserDto {
    return { id: user.id, username: user.username, role: user.role, active: user.active };
  }

  return {
    getBootstrapStatus(): { needsSetup: boolean } {
      return { needsSetup: !hasAnyUser(db) };
    },

    bootstrapAdmin(input: { username?: unknown; password?: unknown }): UserDto {
      return bootstrapFirstAdmin(db, {
        username: input?.username,
        password: input?.password,
        nowMs: now(),
      });
    },

    resolveToken(token: string): SessionUser | null {
      return deps.sessions.verify(token);
    },

    /**
     * Login generik: pesan dan status sama untuk username tidak dikenal,
     * sandi salah, dan akun nonaktif (AC-01.02). Biaya komputasi juga serupa.
     */
    login(input: { username?: unknown; password?: unknown }): LoginResult {
      const username = assertUsername(input?.username);
      // Sandi pendek/kosong tetap diproses sebagai kredensial salah (401
      // generik), bukan 422, agar tidak menjadi oracle aturan sandi.
      if (
        typeof input?.password !== "string" ||
        input.password.length === 0 ||
        input.password.length > 1024
      ) {
        throw new ValidationError("password harus berupa teks.", "password");
      }
      const password = input.password;

      const row = db
        .prepare(
          "SELECT id, username, password_hash, role, active FROM users WHERE username = ? COLLATE NOCASE",
        )
        .get(username) as
        | {
            id: number;
            username: string;
            password_hash: string;
            role: string;
            active: number;
          }
        | undefined;

      if (!row) {
        spendUnknownUsernameCost(password);
        deps.securityLog.log({
          action: "LOGIN_FAILED",
          username,
          result: "FAILED",
        });
        throw new InvalidCredentialsError();
      }

      const hashMatches = verifyPassword(password, String(row.password_hash));
      if (!hashMatches || Number(row.active) !== 1) {
        deps.securityLog.log({
          action: "LOGIN_FAILED",
          username,
          userId: Number(row.id),
          result: "FAILED",
        });
        throw new InvalidCredentialsError();
      }

      const session = deps.sessions.create(Number(row.id));
      return {
        token: session.token,
        user: {
          id: Number(row.id),
          username: String(row.username),
          role: row.role === "ADMIN" ? "ADMIN" : "CASHIER",
          active: true,
        },
      };
    },

    logout(actor: SessionUser, token: string): { loggedOut: boolean } {
      const revoked = deps.sessions.revoke(token);
      if (!revoked) {
        throw new AuthRequiredError("Sesi tidak valid atau sudah berakhir.");
      }
      deps.securityLog.log({
        action: "LOGOUT",
        username: actor.username,
        userId: actor.userId,
        result: "OK",
      });
      return { loggedOut: true };
    },

    me(actor: SessionUser): UserDto {
      return {
        id: actor.userId,
        username: actor.username,
        role: actor.role,
        active: true,
      };
    },

    listUsers(actor: SessionUser): UserDto[] {
      requireAdmin(actor);
      const rows = db
        .prepare("SELECT id, username, role, active FROM users ORDER BY username COLLATE NOCASE")
        .all() as Array<{ id: number; username: string; role: string; active: number }>;
      return rows.map((row) =>
        toDto({
          id: Number(row.id),
          username: String(row.username),
          role: row.role === "ADMIN" ? "ADMIN" : "CASHIER",
          active: Number(row.active) === 1,
        }),
      );
    },

    createUser(actor: SessionUser, input: CreateUserInput): UserDto {
      requireAdmin(actor);
      const username = assertUsername(input?.username);
      const password = assertPassword(input?.password);
      const role = assertRole(input?.role);

      return withTransaction(() => {
        assertActiveAdmin(actor);
        const existing = db
          .prepare("SELECT 1 AS found FROM users WHERE username = ? COLLATE NOCASE")
          .get(username) as { found: number } | undefined;
        if (existing) {
          throw new ConflictError("Nama pengguna sudah dipakai.", "username");
        }
        let userId: number;
        try {
          const result = db
            .prepare(
              `INSERT INTO users (username, password_hash, role, active, created_at_ms)
               VALUES (?, ?, ?, 1, ?)`,
            )
            .run(username, hashPassword(password), role, now());
          userId = Number(result.lastInsertRowid);
        } catch (error) {
          if (isUniqueConstraint(errorMessage(error), "users.username")) {
            throw new ConflictError("Nama pengguna sudah dipakai.", "username");
          }
          throw error;
        }
        writeAuthAudit(db, {
          actorId: actor.userId,
          action: "ACCOUNT_CREATED",
          entityType: "users",
          entityId: userId,
          details: { username, role, active: true },
          nowMs: now(),
        });
        return toDto({ id: userId, username, role, active: true });
      });
    },

    updateUser(actor: SessionUser, userId: unknown, input: UpdateUserInput): UserDto {
      requireAdmin(actor);
      const id = assertId(userId, "userId");
      const hasActive = input?.active !== undefined;
      const hasRole = input?.role !== undefined;
      if (!hasActive && !hasRole) {
        throw new ValidationError("Tidak ada perubahan akun.", "patch");
      }
      if (hasActive && typeof input.active !== "boolean") {
        throw new ValidationError("active harus boolean.", "active");
      }
      const nextRole = hasRole ? assertRole(input.role, "role") : null;

      return withTransaction(() => {
        assertActiveAdmin(actor);
        const current = findUserRow(id);
        const nextActive = hasActive ? (input.active as boolean) : current.active;

        // Jangan hilangkan satu-satunya ADMIN aktif (AUTHORIZATION.md §3).
        const demotingOrDisabling =
          !nextActive || (nextRole !== null && nextRole !== "ADMIN");
        if (current.active && current.role === "ADMIN" && demotingOrDisabling) {
          const admins = db
            .prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'ADMIN' AND active = 1")
            .get() as { total: number };
          if (Number(admins.total) <= 1) {
            throw new ConflictError(
              "Tidak dapat menonaktifkan atau menurunkan admin terakhir.",
              "active",
            );
          }
        }

        if (hasActive && nextActive !== current.active) {
          db.prepare("UPDATE users SET active = ? WHERE id = ?").run(
            nextActive ? 1 : 0,
            id,
          );
          writeAuthAudit(db, {
            actorId: actor.userId,
            action: nextActive ? "ACCOUNT_ENABLED" : "ACCOUNT_DISABLED",
            entityType: "users",
            entityId: id,
            details: { username: current.username, active: nextActive },
            nowMs: now(),
          });
        }
        if (nextRole !== null && nextRole !== current.role) {
          db.prepare("UPDATE users SET role = ? WHERE id = ?").run(nextRole, id);
          writeAuthAudit(db, {
            actorId: actor.userId,
            action: "ROLE_CHANGED",
            entityType: "users",
            entityId: id,
            details: {
              username: current.username,
              oldRole: current.role,
              newRole: nextRole,
            },
            nowMs: now(),
          });
        }

        // Sesi target dicabut saat status/role berubah agar izin lama tidak menetap.
        if (
          (hasActive && nextActive !== current.active) ||
          (nextRole !== null && nextRole !== current.role)
        ) {
          deps.sessions.revokeAllForUser(id);
        }

        return findUserRow(id);
      });
    },
  };
}
