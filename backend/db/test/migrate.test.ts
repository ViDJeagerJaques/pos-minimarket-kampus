import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { inspectBackup } from "../src/backup.ts";
import { inspectDatabase, openDatabase } from "../src/db.ts";
import { loadMigrations, MigrationError, runMigrations } from "../src/migrate.ts";
import { createTempDatabase, migrateFresh } from "./helpers.ts";

function copyMigrations(destinationDir: string): void {
  mkdirSync(destinationDir, { recursive: true });
  for (const migration of loadMigrations()) {
    copyFileSync(migration.filePath, path.join(destinationDir, migration.fileName));
  }
}

function schemaSignature(dbPath: string): string {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const objects = db
      .prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")
      .all();
    const applied = db
      .prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version")
      .all();
    return JSON.stringify({ objects, applied });
  } finally {
    db.close();
  }
}

test("migrasi dari database kosong membuat skema versi 1 dan lulus integrity check", () => {
  const database = createTempDatabase();
  try {
    const result = migrateFresh(database);
    assert.equal(result.schemaVersion, 1);
    assert.deepEqual(result.appliedVersions, [1]);
    assert.equal(result.integrity.integrity, "ok");
    assert.equal(result.integrity.foreignKeyViolations, 0);
    assert.ok(result.tables.includes("users"));
    assert.ok(result.tables.includes("sales"));
    assert.ok(result.tables.includes("inventory_movements"));
    assert.ok(result.tables.includes("schema_migrations"));
    assert.deepEqual(result.views, ["stock_balances"]);

    const report = inspectDatabase(database.dbPath);
    assert.equal(report.userVersion, 1);
    assert.equal(report.foreignKeysOn, true);
    assert.equal(report.journalMode, "wal");
    assert.equal(report.synchronous, 2);
    assert.deepEqual(
      report.appliedMigrations.map((row) => row.version),
      [1],
    );
  } finally {
    database.cleanup();
  }
});

test("migrasi kedua tidak menggandakan tabel, indeks, maupun baris metadata", () => {
  const database = createTempDatabase();
  try {
    migrateFresh(database);
    const before = schemaSignature(database.dbPath);
    const second = runMigrations({ dbPath: database.dbPath, backup: "off" });
    const after = schemaSignature(database.dbPath);

    assert.deepEqual(second.appliedVersions, []);
    assert.deepEqual(second.skippedVersions, [1]);
    assert.equal(second.schemaVersion, 1);
    assert.equal(before, after);
    assert.equal(second.integrity.integrity, "ok");
  } finally {
    database.cleanup();
  }
});

test("migrasi yang sudah diterapkan bersifat immutable: isi berubah ditolak", () => {
  const database = createTempDatabase();
  const migrationsDir = path.join(database.dir, "migrations-copy");
  try {
    copyMigrations(migrationsDir);
    runMigrations({ dbPath: database.dbPath, migrationsDir, backup: "off" });

    const file = path.join(migrationsDir, "0001_core_schema.sql");
    writeFileSync(file, `${readFileSync(file, "utf8")}\n-- perubahan tanpa versi baru\n`, "utf8");

    assert.throws(
      () => runMigrations({ dbPath: database.dbPath, migrationsDir, backup: "off" }),
      (error: unknown) =>
        error instanceof MigrationError && /berubah setelah diterapkan/.test(error.message),
    );
  } finally {
    database.cleanup();
  }
});

test("file migrasi yang sudah diterapkan tidak boleh hilang", () => {
  const database = createTempDatabase();
  const migrationsDir = path.join(database.dir, "migrations-copy");
  try {
    copyMigrations(migrationsDir);
    runMigrations({ dbPath: database.dbPath, migrationsDir, backup: "off" });
    // Direktori kosong: seolah file migrasi terhapus dari repo.
    const emptyDir = path.join(database.dir, "migrations-empty");
    mkdirSync(emptyDir, { recursive: true });

    assert.throws(
      () => runMigrations({ dbPath: database.dbPath, migrationsDir: emptyDir, backup: "off" }),
      (error: unknown) =>
        error instanceof MigrationError && /tidak ada/.test(error.message),
    );
  } finally {
    database.cleanup();
  }
});

test("database dengan skema lebih baru daripada tool ditolak", () => {
  const database = createTempDatabase();
  try {
    migrateFresh(database);
    const db = openDatabase(database.dbPath);
    db.exec("PRAGMA user_version = 99");
    db.close();

    assert.throws(
      () => runMigrations({ dbPath: database.dbPath, backup: "off" }),
      (error: unknown) =>
        error instanceof MigrationError && /lebih baru/.test(error.message),
    );
  } finally {
    database.cleanup();
  }
});

test("migrasi baru pada database berisi data membuat cadangan pramigrasi yang valid", () => {
  const database = createTempDatabase();
  const migrationsDir = path.join(database.dir, "migrations-copy");
  try {
    copyMigrations(migrationsDir);
    runMigrations({ dbPath: database.dbPath, migrationsDir, backup: "off" });
    const db = openDatabase(database.dbPath);
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, active, created_at_ms)
       VALUES (1, 'cadangan.uji', 'fixture$hash', 'ADMIN', 1, 1)`,
    ).run();
    db.close();

    writeFileSync(
      path.join(migrationsDir, "0002_tabel_uji.sql"),
      "CREATE TABLE tabel_uji_cadangan (id INTEGER PRIMARY KEY) STRICT;\n",
      "utf8",
    );
    const result = runMigrations({
      dbPath: database.dbPath,
      migrationsDir,
      backup: "auto",
      now: () => 1_762_992_000_000,
    });

    assert.deepEqual(result.appliedVersions, [2]);
    assert.ok(result.backupPath);
    assert.equal(result.schemaVersion, 2);
    assert.ok(existsSync(result.backupPath));
    const backup = inspectBackup(result.backupPath);
    assert.equal(backup.integrity, "ok");
    assert.equal(backup.foreignKeyViolations, 0);
    assert.equal(backup.userVersion, 1);
  } finally {
    database.cleanup();
  }
});