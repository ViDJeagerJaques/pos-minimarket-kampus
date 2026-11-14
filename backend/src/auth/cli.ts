import { openDatabase, readUserVersion } from "../../db/src/db.ts";
import { assertOutsideSourceTree, resolveDatabasePath } from "../../db/src/paths.ts";
import { writeAuthAudit } from "./audit.ts";
import { hashPassword } from "./password.ts";
import { assertPassword, assertUsername } from "./validation.ts";

/**
 * Bootstrap ADMIN pertama, terpisah dari alur kasir dan dari seed DEMO.
 * Sandi dibaca dari environment `POS_BOOTSTRAP_PASSWORD` (tidak pernah dari
 * argv/repo/log). Perintah hanya berlaku saat tabel users masih kosong.
 *
 * Penggunaan:
 *   POS_BOOTSTRAP_PASSWORD=... node src/auth/cli.ts bootstrap-admin \
 *     --username admin --db <file>
 */
type Options = {
  command: string;
  dbPath: string;
  username: string;
  json: boolean;
};

function parseArgs(argv: string[]): Options {
  const [command, ...rest] = argv;
  const options: Options = {
    command: command ?? "",
    dbPath: resolveDatabasePath(),
    username: "",
    json: false,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--db") {
      const value = rest[index + 1];
      if (!value) {
        throw new Error("--db memerlukan path file.");
      }
      options.dbPath = value;
      index += 1;
    } else if (arg === "--username") {
      const value = rest[index + 1];
      if (!value) {
        throw new Error("--username memerlukan nilai.");
      }
      options.username = value;
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`Argumen tidak dikenal: ${arg}`);
    }
  }
  return options;
}

function usage(): string {
  return [
    "Penggunaan:",
    "  POS_BOOTSTRAP_PASSWORD=... node src/auth/cli.ts bootstrap-admin --username <nama> [--db <file>] [--json]",
    "",
    "Hanya berlaku bila belum ada akun. Sandi tidak pernah dicetak.",
  ].join("\n");
}

export function main(argv: string[]): number {
  try {
    const options = parseArgs(argv);
    if (options.command !== "bootstrap-admin") {
      process.stderr.write(`${usage()}\n`);
      return 2;
    }
    const username = assertUsername(options.username);
    const password = assertPassword(process.env.POS_BOOTSTRAP_PASSWORD);
    assertOutsideSourceTree(options.dbPath);

    const db = openDatabase(options.dbPath);
    try {
      if (readUserVersion(db) < 1) {
        throw new Error("Skema belum diterapkan. Jalankan `npm run db:migrate` terlebih dahulu.");
      }
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
        throw new Error(
          "Bootstrap ADMIN hanya berlaku saat belum ada akun. Buat akun tambahan lewat endpoint ADMIN.",
        );
      }

      const now = Date.now();
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = db
          .prepare(
            `INSERT INTO users (username, password_hash, role, active, created_at_ms)
             VALUES (?, ?, 'ADMIN', 1, ?)`,
          )
          .run(username, hashPassword(password), now);
        const adminId = Number(result.lastInsertRowid);
        writeAuthAudit(db, {
          actorId: adminId,
          action: "ACCOUNT_CREATED",
          entityType: "users",
          entityId: adminId,
          details: { username, role: "ADMIN", active: true, bootstrap: true },
          nowMs: now,
        });
        db.exec("COMMIT");
        if (options.json) {
          process.stdout.write(`${JSON.stringify({ created: true, username, role: "ADMIN" }, null, 2)}\n`);
        } else {
          process.stdout.write(`Akun ADMIN dibuat: ${username}\n`);
        }
        return 0;
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // Error asli tetap dilempar.
        }
        throw error;
      }
    } finally {
      db.close();
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`GAGAL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
