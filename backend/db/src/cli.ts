import { inspectDatabase } from "./db.ts";
import { inspectBackup } from "./backup.ts";
import { runMigrations } from "./migrate.ts";
import { defaultDataDir, resolveDatabasePath } from "./paths.ts";
import { seedDemo } from "./seed.ts";

type Options = {
  command: string;
  dbPath: string;
  dbPathExplicit: boolean;
  migrationsDir: string | undefined;
  demo: boolean;
  backup: "auto" | "off";
  json: boolean;
};

function parseArgs(argv: string[]): Options {
  const [command, ...rest] = argv;
  const options: Options = {
    command: command ?? "",
    dbPath: resolveDatabasePath(),
    dbPathExplicit: false,
    migrationsDir: undefined,
    demo: false,
    backup: "auto",
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
      options.dbPathExplicit = true;
      index += 1;
    } else if (arg === "--migrations") {
      const value = rest[index + 1];
      if (!value) {
        throw new Error("--migrations memerlukan path direktori.");
      }
      options.migrationsDir = value;
      index += 1;
    } else if (arg === "--demo") {
      options.demo = true;
    } else if (arg === "--no-backup") {
      options.backup = "off";
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`Argumen tidak dikenal: ${arg}`);
    }
  }
  return options;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage(): string {
  return [
    "Penggunaan:",
    "  node db/src/cli.ts path",
    "  node db/src/cli.ts migrate [--db <file>] [--migrations <dir>] [--no-backup] [--json]",
    "  node db/src/cli.ts verify  [--db <file>] [--json]",
    "  node db/src/cli.ts seed --demo [--db <file>] [--json]",
    "  node db/src/cli.ts inspect-backup --db <file> [--json]",
    "",
    `Default data dir: ${defaultDataDir()}`,
    "Override lokasi: POS_DB_PATH atau POS_DATA_DIR (wajib di luar source tree).",
  ].join("\n");
}

function main(argv: string[]): number {
  const options = parseArgs(argv);
  switch (options.command) {
    case "path": {
      printJson({ dbPath: options.dbPath, dataDir: defaultDataDir() });
      return 0;
    }
    case "migrate": {
      const result = runMigrations({
        dbPath: options.dbPath,
        migrationsDir: options.migrationsDir,
        backup: options.backup,
        log: (line) => {
          if (!options.json) {
            process.stdout.write(`${line}\n`);
          }
        },
      });
      if (options.json) {
        printJson(result);
      } else {
        process.stdout.write(
          `Migrasi selesai. Skema versi ${result.schemaVersion}; ` +
            `diterapkan: [${result.appliedVersions.join(", ") || "-"}]; ` +
            `integrity_check=${result.integrity.integrity}; ` +
            `foreign_key_check=${result.integrity.foreignKeyViolations} baris.\n` +
            `Database: ${result.dbPath}\n`,
        );
      }
      return result.integrity.integrity === "ok" && result.integrity.foreignKeyViolations === 0
        ? 0
        : 1;
    }
    case "verify": {
      const report = inspectDatabase(options.dbPath, { readOnly: true });
      if (options.json) {
        printJson(report);
      } else {
        process.stdout.write(
          [
            `Database      : ${report.dbPath}`,
            `SQLite        : ${report.sqliteVersion}`,
            `user_version  : ${report.userVersion}`,
            `foreign_keys  : ${report.foreignKeysOn ? "ON" : "OFF"}`,
            `journal_mode  : ${report.journalMode}`,
            `synchronous   : ${report.synchronous} (2=FULL)`,
            `busy_timeout  : ${report.busyTimeoutMs} ms`,
            `integrity     : ${report.integrity}`,
            `foreign_key_ch: ${report.foreignKeyViolations} baris pelanggaran`,
            `migrasi       : ${report.appliedMigrations.map((row) => `${row.version}:${row.name}`).join(", ") || "-"}`,
            `tabel         : ${report.tables.join(", ")}`,
          ].join("\n") + "\n",
        );
      }
      return report.integrity === "ok" && report.foreignKeyViolations === 0 ? 0 : 1;
    }
    case "seed": {
      const result = seedDemo({
        dbPath: options.dbPath,
        allowDemo: options.demo,
        log: (line) => {
          if (!options.json) {
            process.stdout.write(`${line}\n`);
          }
        },
      });
      if (options.json) {
        printJson(result);
      } else {
        process.stdout.write(
          `${result.seeded ? "Seed demo diterapkan" : `Seed dilewati: ${result.skippedReason}`}\n` +
            `Database: ${result.dbPath}\n`,
        );
      }
      return 0;
    }
    case "inspect-backup": {
      if (!options.dbPathExplicit) {
        throw new Error("inspect-backup memerlukan --db <file-cadangan> secara eksplisit.");
      }
      const report = inspectBackup(options.dbPath);
      if (options.json) {
        printJson(report);
      } else {
        process.stdout.write(
          `Cadangan   : ${report.backupPath}\n` +
            `user_version: ${report.userVersion}\n` +
            `integrity  : ${report.integrity}\n` +
            `foreign_key: ${report.foreignKeyViolations} baris pelanggaran\n`,
        );
      }
      return report.integrity === "ok" && report.foreignKeyViolations === 0 ? 0 : 1;
    }
    case "":
    case "help":
    case "--help":
      process.stdout.write(`${usage()}\n`);
      return 0;
    default:
      process.stderr.write(`Perintah tidak dikenal: ${options.command}\n\n${usage()}\n`);
      return 2;
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`GAGAL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}