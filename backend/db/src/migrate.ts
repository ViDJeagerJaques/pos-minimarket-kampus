import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import {
  checkIntegrity,
  listSchemaObjects,
  openDatabase,
  readUserVersion,
  type IntegrityReport,
} from "./db.ts";
import { assertOutsideSourceTree, REPO_ROOT } from "./paths.ts";
import { createPreMigrationBackup } from "./backup.ts";

export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/i;

const FORBIDDEN_STATEMENTS = [
  "BEGIN",
  "COMMIT",
  "END TRANSACTION",
  "ROLLBACK",
  "SAVEPOINT",
  "RELEASE",
  "VACUUM",
  "ATTACH",
  "DETACH",
  "PRAGMA",
];

export type Migration = {
  version: number;
  name: string;
  fileName: string;
  filePath: string;
  sql: string;
  checksum: string;
};

export type AppliedMigration = {
  version: number;
  name: string;
  checksum: string;
  applied_at_ms: number;
};

export type MigrateOptions = {
  dbPath: string;
  migrationsDir?: string;
  repoRoot?: string;
  /** "auto" membuat snapshot sebelum migrasi yang mengubah database berisi data. */
  backup?: "auto" | "off";
  now?: () => number;
  log?: (line: string) => void;
};

export type MigrateResult = {
  dbPath: string;
  schemaVersion: number;
  appliedVersions: number[];
  skippedVersions: number[];
  backupPath: string | null;
  tables: string[];
  views: string[];
  integrity: IntegrityReport;
};

export class MigrationError extends Error {
  readonly version: number | null;
  readonly migrationName: string | null;

  constructor(message: string, options: { version?: number; migrationName?: string; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "MigrationError";
    this.version = options.version ?? null;
    this.migrationName = options.migrationName ?? null;
  }
}

/** Checksum stabil terhadap perbedaan checkout CRLF/LF dan BOM. */
export function migrationChecksum(sql: string): string {
  const normalized = sql.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function assertMigrationIsAtomic(fileName: string, sql: string): void {
  const statements = stripSqlComments(sql).toUpperCase();
  for (const keyword of FORBIDDEN_STATEMENTS) {
    const pattern = new RegExp(`(^|[^A-Z0-9_])${keyword}([^A-Z0-9_]|$)`);
    if (pattern.test(statements)) {
      throw new MigrationError(
        `Migrasi ${fileName} memuat pernyataan terlarang "${keyword}". ` +
          "Transaksi, PRAGMA koneksi, dan VACUUM dikelola oleh runner.",
        { migrationName: fileName },
      );
    }
  }
}

export function loadMigrations(migrationsDir: string = DEFAULT_MIGRATIONS_DIR): Migration[] {
  const entries = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".sql"))
    .map((entry) => entry.name);

  const migrations: Migration[] = [];
  for (const fileName of entries) {
    const match = MIGRATION_FILE_PATTERN.exec(fileName);
    if (!match) {
      throw new MigrationError(
        `Nama file migrasi tidak valid: ${fileName}. Gunakan format 0001_nama_migrasi.sql.`,
      );
    }
    const filePath = path.join(migrationsDir, fileName);
    const sql = readFileSync(filePath, "utf8");
    migrations.push({
      version: Number(match[1]),
      name: match[2],
      fileName,
      filePath,
      sql,
      checksum: migrationChecksum(sql),
    });
  }

  migrations.sort((left, right) => left.version - right.version);
  for (let index = 0; index < migrations.length; index += 1) {
    if (migrations[index].version === 0) {
      throw new MigrationError(`Versi migrasi harus >= 1: ${migrations[index].fileName}`);
    }
    if (index > 0 && migrations[index].version === migrations[index - 1].version) {
      throw new MigrationError(
        `Versi migrasi ganda: ${migrations[index - 1].fileName} dan ${migrations[index].fileName}`,
      );
    }
  }
  return migrations;
}

function ensureMetadataSchema(db: DatabaseSync): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       checksum TEXT NOT NULL,
       applied_at_ms INTEGER NOT NULL
     ) STRICT`,
  );
}

function readAppliedMigrations(db: DatabaseSync): AppliedMigration[] {
  return db
    .prepare(
      `SELECT version, name, checksum, applied_at_ms FROM schema_migrations ORDER BY version`,
    )
    .all() as AppliedMigration[];
}

function assertMigrationsAreImmutable(
  applied: AppliedMigration[],
  migrations: Migration[],
): void {
  const byVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  for (const row of applied) {
    const file = byVersion.get(row.version);
    if (!file) {
      throw new MigrationError(
        `Database sudah menerapkan migrasi versi ${row.version} (${row.name}), tetapi ` +
          "file migrasinya tidak ada. Jangan menghapus file migrasi yang sudah dipakai.",
        { version: row.version },
      );
    }
    if (file.checksum !== row.checksum) {
      throw new MigrationError(
        `Migrasi ${file.fileName} berubah setelah diterapkan (checksum berbeda). ` +
          "Migrasi bersifat immutable; buat file baru 0002/0003/... untuk perubahan skema.",
        { version: row.version, migrationName: file.name },
      );
    }
  }
  const highestApplied = applied.reduce((max, row) => Math.max(max, row.version), 0);
  for (const migration of migrations) {
    if (migration.version < highestApplied && !applied.some((row) => row.version === migration.version)) {
      throw new MigrationError(
        `Migrasi ${migration.fileName} disisipkan dengan versi lebih kecil dari ` +
          `versi yang sudah diterapkan (${highestApplied}). Tambahkan migrasi baru dengan versi lebih besar.`,
        { version: migration.version, migrationName: migration.name },
      );
    }
  }
}

function applyOneMigration(db: DatabaseSync, migration: Migration, now: () => number): void {
  assertMigrationIsAtomic(migration.fileName, migration.sql);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(migration.sql);
    db.prepare(
      `INSERT INTO schema_migrations (version, name, checksum, applied_at_ms)
       VALUES (?, ?, ?, ?)`,
    ).run(migration.version, migration.name, migration.checksum, now());
    // user_version ikut transaksi sehingga tidak ada versi skema "setengah jalan".
    db.exec(`PRAGMA user_version = ${migration.version}`);
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Koneksi mungkin sudah tidak dalam transaksi; error asli tetap dilaporkan.
    }
    throw new MigrationError(
      `Migrasi ${migration.fileName} gagal dan di-rollback. ` +
        "Skema versi sebelumnya dipertahankan; perbaiki file pada salinan lalu ulangi. " +
        `Penyebab: ${error instanceof Error ? error.message : String(error)}`,
      {
        version: migration.version,
        migrationName: migration.name,
        cause: error,
      },
    );
  }
}

/**
 * Menjalankan migrasi yang belum diterapkan. Satu file = satu transaksi.
 * Rerun pada database yang sudah mutakhir tidak mengubah skema maupun data.
 */
export function runMigrations(options: MigrateOptions): MigrateResult {
  const dbPath = options.dbPath;
  assertOutsideSourceTree(dbPath, options.repoRoot ?? REPO_ROOT);
  const migrations = loadMigrations(options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR);
  const now = options.now ?? (() => Date.now());
  const log = options.log ?? (() => {});
  const backupMode = options.backup ?? "auto";

  const db = openDatabase(dbPath);
  try {
    ensureMetadataSchema(db);
    const applied = readAppliedMigrations(db);
    const appliedVersions = new Set(applied.map((row) => row.version));
    assertMigrationsAreImmutable(applied, migrations);

    const currentVersion = readUserVersion(db);
    const latestVersion = migrations.reduce((max, migration) => Math.max(max, migration.version), 0);
    if (currentVersion > latestVersion) {
      throw new MigrationError(
        `Skema database (user_version=${currentVersion}) lebih baru daripada migrasi yang ` +
          `tersedia (${latestVersion}). Jangan turunkan skema dengan tool lama; gunakan ` +
          "versi aplikasi yang sesuai atau pulihkan cadangan.",
        { version: currentVersion },
      );
    }

    const pending = migrations.filter((migration) => !appliedVersions.has(migration.version));
    if (pending.length === 0) {
      log(`Tidak ada migrasi baru. Skema di versi ${currentVersion}.`);
      const objects = listSchemaObjects(db);
      return {
        dbPath,
        schemaVersion: currentVersion,
        appliedVersions: [],
        skippedVersions: migrations.map((migration) => migration.version),
        backupPath: null,
        tables: objects.tables,
        views: objects.views,
        integrity: checkIntegrity(db),
      };
    }

    let backupPath: string | null = null;
    if (backupMode === "auto" && applied.length > 0) {
      backupPath = createPreMigrationBackup(db, dbPath, currentVersion, now);
      log(`Cadangan pramigrasi dibuat: ${backupPath}`);
    }

    const appliedNow: number[] = [];
    for (const migration of pending) {
      log(`Menerapkan ${migration.fileName} ...`);
      applyOneMigration(db, migration, now);
      appliedNow.push(migration.version);
    }

    const integrity = checkIntegrity(db);
    const objects = listSchemaObjects(db);
    const schemaVersion = readUserVersion(db);
    if (integrity.integrity !== "ok" || integrity.foreignKeyViolations > 0) {
      throw new MigrationError(
        `Skema versi ${schemaVersion} terpasang, tetapi pemeriksaan integritas gagal: ` +
          `integrity_check="${integrity.integrity}", foreign_key_check=${integrity.foreignKeyViolations} baris. ` +
          (backupPath ? `Pulihkan cadangan pramigrasi: ${backupPath}` : "Periksa database sebelum dipakai."),
        { version: schemaVersion },
      );
    }

    return {
      dbPath,
      schemaVersion,
      appliedVersions: appliedNow,
      skippedVersions: [...appliedVersions].sort((left, right) => left - right),
      backupPath,
      tables: objects.tables,
      views: objects.views,
      integrity,
    };
  } finally {
    db.close();
  }
}