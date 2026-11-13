import { statfsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ensureParentDirectory } from "./paths.ts";

export type IntegrityReport = {
  integrity: string;
  foreignKeyViolations: number;
  foreignKeyViolationSamples: Array<Record<string, unknown>>;
};

export type DatabaseInspection = IntegrityReport & {
  dbPath: string;
  sqliteVersion: string;
  userVersion: number;
  foreignKeysOn: boolean;
  journalMode: string;
  synchronous: number;
  busyTimeoutMs: number;
  tables: string[];
  views: string[];
  appliedMigrations: Array<{
    version: number;
    name: string;
    checksum: string;
    applied_at_ms: number;
  }>;
};

export const WRITER_BUSY_TIMEOUT_MS = 5000;

/**
 * Membuka database dengan pengaturan koneksi penulis yang disepakati baseline
 * (DATABASE.md §15): FK aktif, WAL, synchronous=FULL, busy_timeout terbatas.
 * foreign_keys diverifikasi, bukan diasumsikan, sesuai DB-INV-01.
 */
export function openDatabase(dbPath: string, options: { readOnly?: boolean } = {}): DatabaseSync {
  if (dbPath !== ":memory:") {
    ensureParentDirectory(dbPath);
  }
  const db = new DatabaseSync(dbPath, { readOnly: options.readOnly === true });
  db.exec("PRAGMA foreign_keys = ON");
  const foreignKeys = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
  if (foreignKeys.foreign_keys !== 1) {
    db.close();
    throw new Error(`PRAGMA foreign_keys gagal diaktifkan untuk ${dbPath}`);
  }
  db.exec(`PRAGMA busy_timeout = ${WRITER_BUSY_TIMEOUT_MS}`);
  if (options.readOnly !== true) {
    if (dbPath !== ":memory:") {
      // WAL tidak berlaku untuk database in-memory. Koneksi read-only tidak
      // boleh mengubah journal_mode.
      db.prepare("PRAGMA journal_mode = WAL").get();
    }
    db.exec("PRAGMA synchronous = FULL");
    assertFreeDiskSpace(dbPath);
  }
  return db;
}

export function assertFreeDiskSpace(dbPath: string, minimumBytes = 100 * 1024 * 1024): void {
  if (dbPath === ":memory:") {
    return;
  }
  try {
    const stats = statfsSync(path.dirname(path.resolve(dbPath)));
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    if (Number.isFinite(freeBytes) && freeBytes < minimumBytes) {
      throw new Error(
        `Ruang disk di ${path.dirname(path.resolve(dbPath))} tersisa ` +
          `${Math.round(freeBytes / (1024 * 1024))} MB. Hentikan migrasi dan kosongkan disk ` +
          "(DATABASE.md §17.3).",
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Ruang disk")) {
      throw error;
    }
    // statfs tidak tersedia pada semua platform/filesystem; jangan gagal karena ini.
  }
}

export function readUserVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return Number(row.user_version);
}

export function checkIntegrity(db: DatabaseSync, sampleLimit = 5): IntegrityReport {
  const integrityRows = db.prepare("PRAGMA integrity_check").all() as Array<{
    integrity_check: string;
  }>;
  const integrity = integrityRows.map((row) => row.integrity_check).join("; ");
  const violations = db.prepare("PRAGMA foreign_key_check").all() as Array<
    Record<string, unknown>
  >;
  return {
    integrity,
    foreignKeyViolations: violations.length,
    foreignKeyViolationSamples: violations.slice(0, sampleLimit),
  };
}

export function listSchemaObjects(db: DatabaseSync): { tables: string[]; views: string[] } {
  const rows = db
    .prepare(
      `SELECT type, name FROM sqlite_master
       WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
       ORDER BY type, name`,
    )
    .all() as Array<{ type: string; name: string }>;
  return {
    tables: rows.filter((row) => row.type === "table").map((row) => row.name),
    views: rows.filter((row) => row.type === "view").map((row) => row.name),
  };
}

function readPragmaNumber(db: DatabaseSync, pragma: string): number {
  const row = db.prepare(pragma).get() as Record<string, number> | undefined;
  if (!row) {
    return Number.NaN;
  }
  const value = Object.values(row)[0];
  return Number(value);
}

export function inspectDatabase(dbPath: string, options: { readOnly?: boolean } = {}): DatabaseInspection {
  const db = openDatabase(dbPath, { readOnly: options.readOnly ?? true });
  try {
    const journalModeRow = db.prepare("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    const objects = listSchemaObjects(db);
    let appliedMigrations: DatabaseInspection["appliedMigrations"] = [];
    if (objects.tables.includes("schema_migrations")) {
      appliedMigrations = db
        .prepare(
          `SELECT version, name, checksum, applied_at_ms FROM schema_migrations
           ORDER BY version`,
        )
        .all() as DatabaseInspection["appliedMigrations"];
    }
    const integrity = checkIntegrity(db);
    const versionRow = db.prepare("SELECT sqlite_version() AS version").get() as {
      version: string;
    };
    return {
      dbPath,
      sqliteVersion: versionRow.version,
      userVersion: readUserVersion(db),
      foreignKeysOn: readPragmaNumber(db, "PRAGMA foreign_keys") === 1,
      journalMode: String(journalModeRow.journal_mode),
      synchronous: readPragmaNumber(db, "PRAGMA synchronous"),
      busyTimeoutMs: readPragmaNumber(db, "PRAGMA busy_timeout"),
      tables: objects.tables,
      views: objects.views,
      appliedMigrations,
      ...integrity,
    };
  } finally {
    db.close();
  }
}