import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { inspectBackup } from "../src/backup.ts";
import { loadMigrations, MigrationError, runMigrations } from "../src/migrate.ts";
import { createTempDatabase } from "./helpers.ts";

function copyMigrations(destinationDir: string): void {
  mkdirSync(destinationDir, { recursive: true });
  for (const migration of loadMigrations()) {
    copyFileSync(migration.filePath, path.join(destinationDir, migration.fileName));
  }
}

function tableNames(dbPath: string): string[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
  } finally {
    db.close();
  }
}

function scalar(dbPath: string, sql: string): number {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare(sql).get() as Record<string, number>;
    return Number(Object.values(row)[0]);
  } finally {
    db.close();
  }
}

test("migrasi gagal di tengah tidak meninggalkan skema parsial dan dapat dipulihkan", () => {
  const database = createTempDatabase();
  const migrationsDir = path.join(database.dir, "migrations-copy");
  try {
    copyMigrations(migrationsDir);
    runMigrations({ dbPath: database.dbPath, migrationsDir, backup: "off" });

    const db = new DatabaseSync(database.dbPath);
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, active, created_at_ms)
       VALUES (1, 'data.lama', 'fixture$hash', 'ADMIN', 1, 1)`,
    ).run();
    db.close();

    const failingMigration = path.join(migrationsDir, "0002_gagal_di_tengah.sql");
    writeFileSync(
      failingMigration,
      [
        "CREATE TABLE tabel_parsial (id INTEGER PRIMARY KEY) STRICT;",
        "INSERT INTO tabel_parsial (id) VALUES (1);",
        "INSERT INTO tabel_yang_tidak_ada (id) VALUES (1);",
        "",
      ].join("\n"),
      "utf8",
    );

    assert.throws(
      () => runMigrations({ dbPath: database.dbPath, migrationsDir, backup: "auto" }),
      (error: unknown) =>
        error instanceof MigrationError && /0002_gagal_di_tengah\.sql gagal/.test(error.message),
    );

    // Tidak ada keadaan parsial: versi, metadata, dan objek tetap pada v1.
    assert.equal(scalar(database.dbPath, "PRAGMA user_version"), 1);
    assert.equal(scalar(database.dbPath, "SELECT COUNT(*) AS total FROM schema_migrations"), 1);
    assert.equal(
      scalar(database.dbPath, "SELECT COUNT(*) AS total FROM users"),
      1,
      "data lama harus tetap ada",
    );
    const tablesAfterFailure = tableNames(database.dbPath);
    assert.ok(!tablesAfterFailure.includes("tabel_parsial"));
    assert.equal(scalar(database.dbPath, "SELECT COUNT(*) AS total FROM pragma_integrity_check"), 1);
    assert.equal(
      scalar(database.dbPath, "SELECT COUNT(*) AS total FROM pragma_foreign_key_check"),
      0,
    );

    // Cadangan pramigrasi tersedia sebagai titik pemulihan yang valid.
    const backupDir = path.join(path.dirname(database.dbPath), "backups");
    const backups = readdirSync(backupDir);
    assert.equal(backups.length, 1);
    const backup = inspectBackup(path.join(backupDir, backups[0]));
    assert.equal(backup.integrity, "ok");
    assert.equal(backup.userVersion, 1);

    // Perbaikan pada salinan: file yang sama dibetulkan lalu migrasi diulang.
    writeFileSync(
      failingMigration,
      [
        "CREATE TABLE tabel_parsial (id INTEGER PRIMARY KEY) STRICT;",
        "INSERT INTO tabel_parsial (id) VALUES (1);",
        "",
      ].join("\n"),
      "utf8",
    );
    const recovered = runMigrations({ dbPath: database.dbPath, migrationsDir, backup: "auto" });
    assert.deepEqual(recovered.appliedVersions, [2]);
    assert.equal(recovered.schemaVersion, 2);
    assert.equal(scalar(database.dbPath, "SELECT COUNT(*) AS total FROM tabel_parsial"), 1);
    assert.equal(recovered.integrity.integrity, "ok");
  } finally {
    database.cleanup();
  }
});

test("kegagalan pada migrasi pertama tidak meninggalkan tabel bisnis parsial", () => {
  const database = createTempDatabase();
  const migrationsDir = path.join(database.dir, "migrations-copy");
  mkdirSync(migrationsDir, { recursive: true });
  try {
    const migrationPath = path.join(migrationsDir, "0001_awal_rusak.sql");
    writeFileSync(
      migrationPath,
      [
        "CREATE TABLE tabel_awal (id INTEGER PRIMARY KEY) STRICT;",
        "CREATE TABLE tabel_rusak (id INTEGER PRIMARY KEY) STRICT,;",
        "",
      ].join("\n"),
      "utf8",
    );

    assert.throws(
      () => runMigrations({ dbPath: database.dbPath, migrationsDir, backup: "auto" }),
      (error: unknown) => error instanceof MigrationError,
    );
    assert.equal(scalar(database.dbPath, "PRAGMA user_version"), 0);
    const tables = tableNames(database.dbPath);
    assert.deepEqual(tables, ["schema_migrations"]);
    assert.equal(scalar(database.dbPath, "SELECT COUNT(*) AS total FROM pragma_integrity_check"), 1);

    writeFileSync(
      migrationPath,
      "CREATE TABLE tabel_awal (id INTEGER PRIMARY KEY) STRICT;\n",
      "utf8",
    );
    const recovered = runMigrations({ dbPath: database.dbPath, migrationsDir, backup: "auto" });
    assert.deepEqual(recovered.appliedVersions, [1]);
    assert.equal(recovered.schemaVersion, 1);
    assert.ok(tableNames(database.dbPath).includes("tabel_awal"));
  } finally {
    database.cleanup();
  }
});

test("file migrasi dengan pernyataan transaksi/PRAGMA ditolak sebelum menyentuh skema", () => {
  const database = createTempDatabase();
  const migrationsDir = path.join(database.dir, "migrations-copy");
  try {
    copyMigrations(migrationsDir);
    runMigrations({ dbPath: database.dbPath, migrationsDir, backup: "off" });

    for (const [fileName, body, expected] of [
      ["0002_commit_manual.sql", "CREATE TABLE x (id INTEGER) STRICT;\nCOMMIT;\n", /COMMIT/],
      ["0003_pragma_fk.sql", "PRAGMA foreign_keys = OFF;\n", /PRAGMA/],
      ["0004_vacuum.sql", "VACUUM;\n", /VACUUM/],
    ] as const) {
      const filePath = path.join(migrationsDir, fileName);
      writeFileSync(filePath, body, "utf8");
      assert.throws(
        () => runMigrations({ dbPath: database.dbPath, migrationsDir, backup: "off" }),
        (error: unknown) =>
          error instanceof MigrationError && expected.test(error.message),
        `harus ditolak: ${fileName}`,
      );
      assert.equal(
        existsSync(path.join(migrationsDir, fileName)),
        true,
        "file uji tetap ada, hanya tidak dieksekusi",
      );
      assert.equal(scalar(database.dbPath, "PRAGMA user_version"), 1);
    }
  } finally {
    database.cleanup();
  }
});