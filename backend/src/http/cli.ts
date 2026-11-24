import { randomBytes } from "node:crypto";
import { openDatabase, readUserVersion } from "../../db/src/db.ts";
import { assertOutsideSourceTree, resolveDatabasePath } from "../../db/src/paths.ts";
import { createAuthService } from "../auth/service.ts";
import { createSessionStore } from "../auth/session.ts";
import { createCatalogService } from "../catalog/service.ts";
import { createSecurityLogger } from "../security/securityLog.ts";
import { createShiftService } from "../shift/service.ts";
import { createCheckoutService } from "../checkout/service.ts";
import { createPrintService } from "../print/service.ts";
import { createReportService } from "../reports/service.ts";
import { createAdjustmentService } from "../inventory/adjustments.ts";
import { createReceivingService } from "../receiving/service.ts";
import { createSheetsSyncService } from "../sync/sheetsSync.ts";
import { startHttpServer } from "./app.ts";

/**
 * Menjalankan server lokal DEMO hanya di 127.0.0.1.
 *
 * Penggunaan:
 *   node src/http/cli.ts serve [--db <file>] [--port <n>] [--session-ttl-ms <n>]
 *
 * Secret sesi dibuat acak setiap proses; restart memerlukan login ulang
 * (AUTHORIZATION.md AUTH-05). Secret tidak disimpan di database/repo.
 */
type Options = {
  command: string;
  dbPath: string;
  port: number | undefined;
  sessionTtlMs: number;
  staticDir: string | undefined;
};

const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_SESSION_TTL_MS = 5 * 60 * 1000;
const MAX_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("Port tidak valid: nilai kosong");
  }
  const parsed = Number(trimmed);
  // 0 = minta OS memilih port bebas; dipakai skrip E2E agar tidak ada race.
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Port tidak valid: ${value}`);
  }
  return parsed;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Nilai bilangan bulat positif diperlukan: ${value}`);
  }
  return parsed;
}

export function parseArgs(argv: string[]): Options {
  const [command, ...rest] = argv;
  const options: Options = {
    command: command ?? "",
    dbPath: resolveDatabasePath(),
    port: undefined,
    sessionTtlMs: DEFAULT_SESSION_TTL_MS,
    staticDir: undefined,
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
    } else if (arg === "--port") {
      options.port = parsePort(rest[index + 1], 0);
      index += 1;
    } else if (arg === "--session-ttl-ms") {
      options.sessionTtlMs = parsePositiveInt(
        rest[index + 1],
        DEFAULT_SESSION_TTL_MS,
      );
      index += 1;
    } else if (arg === "--static-dir") {
      const value = rest[index + 1];
      if (!value) {
        throw new Error("--static-dir memerlukan path direktori.");
      }
      options.staticDir = value;
      index += 1;
    } else {
      throw new Error(`Argumen tidak dikenal: ${arg}`);
    }
  }
  return options;
}

function usage(): string {
  return [
    "Penggunaan:",
    "  node src/http/cli.ts serve [--db <file>] [--port <n>] [--session-ttl-ms <n>]",
    "",
    "Server hanya bind 127.0.0.1. Base API: /api/v1.",
  ].join("\n");
}

async function main(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  if (options.command !== "serve") {
    process.stderr.write(`${usage()}\n`);
    return 2;
  }
  if (options.sessionTtlMs < MIN_SESSION_TTL_MS || options.sessionTtlMs > MAX_SESSION_TTL_MS) {
    throw new Error(
      `session-ttl-ms harus ${MIN_SESSION_TTL_MS}-${MAX_SESSION_TTL_MS}.`,
    );
  }
  assertOutsideSourceTree(options.dbPath);

  const db = openDatabase(options.dbPath);
  try {
    if (readUserVersion(db) < 1) {
      throw new Error("Skema belum diterapkan. Jalankan `npm run db:migrate` terlebih dahulu.");
    }
    const sessions = createSessionStore(db, {
      secret: randomBytes(32),
      ttlMs: options.sessionTtlMs,
    });
    const securityLog = createSecurityLogger({
      sink: (line) => process.stderr.write(`${line}\n`),
    });
    const auth = createAuthService(db, { sessions, securityLog });
    const catalog = createCatalogService(db);
    const shift = createShiftService(db);
    const checkout = createCheckoutService(db);
    const reports = createReportService(db);
    const receiving = createReceivingService(db);
    // DEMO: adapter virtual (pratinjau), bukan printer fisik/ESC-POS.
    const print = createPrintService(db);
    const sheetsSync = createSheetsSyncService({ db, dbPath: options.dbPath });
    const running = await startHttpServer({
      backupDbPath: options.dbPath,
      auth,
      sessions,
      securityLog,
      catalog,
      shift,
      checkout,
      reports,
      receiving,
      adjustments: createAdjustmentService(db),
      print,
      sheetsSync,
      staticDir: options.staticDir,
      port: options.port,
    });
    void sheetsSync.flush();
    process.stdout.write(
      `Server DEMO berjalan di ${running.url} (base /api/v1).\n` +
        `Login: POST /api/v1/auth/login. Secret sesi hanya di memori proses ini.\n`,
    );

    const shutdown = () => {
      void running.close().finally(() => {
        db.close();
        process.exit(0);
      });
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return 0;
  } catch (error) {
    db.close();
    throw error;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` ||
    process.argv[1].endsWith("http/cli.ts") ||
    process.argv[1].endsWith("http\\cli.ts"));

if (invokedDirectly) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`GAGAL: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
