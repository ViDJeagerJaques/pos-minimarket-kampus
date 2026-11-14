import { createHmac, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type Role = "ADMIN" | "CASHIER";

export type SessionUser = {
  userId: number;
  username: string;
  role: Role;
};

export type SessionStore = {
  /** Token mentah hanya dikembalikan ke pemanggil; yang disimpan adalah digest. */
  create(userId: number): { token: string; expiresAtMs: number };
  verify(token: string): SessionUser | null;
  revoke(token: string): boolean;
  revokeAllForUser(userId: number): number;
  purgeExpired(): number;
};

export type SessionStoreDeps = {
  /**
   * Secret proses (32+ byte acak per start server). Digest = HMAC-SHA256(secret,
   * token). Secret TIDAK disimpan di SQLite; restart backend membuat token lama
   * tidak valid (AUTHORIZATION.md AUTH-05) dan bocornya DB saja tidak cukup
   * untuk memalsukan sesi.
   */
  secret: Buffer;
  ttlMs: number;
  now?: () => number;
};

const MAX_TOKEN_LENGTH = 512;

function assertSecret(secret: Buffer): void {
  if (!Buffer.isBuffer(secret) || secret.length < 32) {
    throw new Error("Secret sesi wajib Buffer minimal 32 byte.");
  }
}

function assertTtl(ttlMs: number): void {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error("ttlMs sesi harus bilangan bulat positif.");
  }
}

export function createSessionStore(db: DatabaseSync, deps: SessionStoreDeps): SessionStore {
  assertSecret(deps.secret);
  assertTtl(deps.ttlMs);
  const now = deps.now ?? (() => Date.now());

  function digestToken(token: string): Buffer {
    return createHmac("sha256", deps.secret).update(token).digest();
  }

  return {
    create(userId: number): { token: string; expiresAtMs: number } {
      const token = randomBytes(32).toString("base64url");
      const expiresAtMs = now() + deps.ttlMs;
      db.prepare(
        `INSERT INTO sessions (token_digest, user_id, expires_at_ms, revoked_at_ms)
         VALUES (?, ?, ?, NULL)`,
      ).run(digestToken(token), userId, expiresAtMs);
      return { token, expiresAtMs };
    },

    verify(token: string): SessionUser | null {
      if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
        return null;
      }
      const row = db
        .prepare(
          `SELECT s.user_id, s.expires_at_ms, s.revoked_at_ms,
                  u.username, u.role, u.active
           FROM sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.token_digest = ?`,
        )
        .get(digestToken(token)) as
        | {
            user_id: number;
            expires_at_ms: number;
            revoked_at_ms: number | null;
            username: string;
            role: string;
            active: number;
          }
        | undefined;
      if (!row) {
        return null;
      }
      if (row.revoked_at_ms !== null) {
        return null;
      }
      if (Number(row.expires_at_ms) <= now()) {
        return null;
      }
      if (Number(row.active) !== 1) {
        return null;
      }
      if (row.role !== "ADMIN" && row.role !== "CASHIER") {
        return null;
      }
      return {
        userId: Number(row.user_id),
        username: String(row.username),
        role: row.role,
      };
    },

    revoke(token: string): boolean {
      if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
        return false;
      }
      const result = db
        .prepare(
          `UPDATE sessions SET revoked_at_ms = ?
           WHERE token_digest = ? AND revoked_at_ms IS NULL`,
        )
        .run(now(), digestToken(token));
      return Number(result.changes) > 0;
    },

    revokeAllForUser(userId: number): number {
      const result = db
        .prepare(
          `UPDATE sessions SET revoked_at_ms = ?
           WHERE user_id = ? AND revoked_at_ms IS NULL`,
        )
        .run(now(), userId);
      return Number(result.changes);
    },

    purgeExpired(): number {
      const result = db
        .prepare("DELETE FROM sessions WHERE expires_at_ms <= ?")
        .run(now());
      return Number(result.changes);
    },
  };
}
