import { openDatabase, readUserVersion } from "../../db/src/db.ts";
import { assertOutsideSourceTree, resolveDatabasePath } from "../../db/src/paths.ts";
import { bootstrapFirstAdmin } from "./bootstrap.ts";

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
    assertOutsideSourceTree(options.dbPath);

    const db = openDatabase(options.dbPath);
    try {
      if (readUserVersion(db) < 1) {
        throw new Error("Skema belum diterapkan. Jalankan `npm run db:migrate` terlebih dahulu.");
      }
      const created = bootstrapFirstAdmin(db, {
        username: options.username,
        password: process.env.POS_BOOTSTRAP_PASSWORD,
      });
      if (options.json) {
        process.stdout.write(
          `${JSON.stringify({ created: true, username: created.username, role: "ADMIN" }, null, 2)}\n`,
        );
      } else {
        process.stdout.write(`Akun ADMIN dibuat: ${created.username}\n`);
      }
      return 0;
    } finally {
      db.close();
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` ||
    process.argv[1].endsWith("auth/cli.ts") ||
    process.argv[1].endsWith("auth\\cli.ts"));

if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`GAGAL: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
