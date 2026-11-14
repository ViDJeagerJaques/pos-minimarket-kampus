import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../src/migrate.ts";
import {
  assertOutsideSourceTree,
  defaultDataDir,
  isInsideSourceTree,
  REPO_ROOT,
  resolveDatabasePath,
} from "../src/paths.ts";
import { createTempDatabase } from "./helpers.ts";

test("lokasi default database berada di luar source tree", () => {
  if (process.platform === "win32") {
    const fakeEnv = { LOCALAPPDATA: "C:\\Users\\contoh\\AppData\\Local" };
    assert.equal(
      defaultDataDir(fakeEnv),
      path.join("C:\\Users\\contoh\\AppData\\Local", "PosMinimarketKampus", "data"),
    );
    const dbPath = resolveDatabasePath(fakeEnv);
    assert.equal(isInsideSourceTree(dbPath), false);
  } else {
    const defaultDir = defaultDataDir({});
    assert.equal(
      defaultDir,
      path.join(homedir(), ".local", "share", "pos-minimarket-kampus", "data"),
    );
    assert.equal(isInsideSourceTree(resolveDatabasePath({})), false);

    const posixEnv = { POS_DATA_DIR: "/var/tmp/pos-minimarket-data" };
    assert.equal(defaultDataDir(posixEnv), "/var/tmp/pos-minimarket-data");
    assert.equal(isInsideSourceTree(resolveDatabasePath(posixEnv)), false);
  }
  assert.equal(isInsideSourceTree(path.join(REPO_ROOT, "data", "pos-dev.sqlite")), true);
});

test("POS_DB_PATH dipakai sebagai override dan guard source tree menolak path repo", () => {
  const outsidePath =
    process.platform === "win32" ? "D:\\pos-data\\dev.sqlite" : "/var/tmp/pos-data/dev.sqlite";
  const override = resolveDatabasePath({ POS_DB_PATH: outsidePath });
  assert.equal(path.resolve(override), path.resolve(outsidePath));

  assert.throws(
    () => assertOutsideSourceTree(path.join(REPO_ROOT, "backend", "db", "dev.sqlite")),
    /Menolak database di dalam source tree/,
  );
  assert.doesNotThrow(() => assertOutsideSourceTree(outsidePath, REPO_ROOT));
});

test("runner migrasi menolak database di dalam repo tanpa membuat file", () => {
  const guardedPath = path.join(REPO_ROOT, "backend", "db", "harusnya-tidak-dibuat.sqlite");
  assert.equal(existsSync(guardedPath), false);
  assert.throws(
    () => runMigrations({ dbPath: guardedPath, backup: "off" }),
    /Menolak database di dalam source tree/,
  );
  assert.equal(existsSync(guardedPath), false);
});

test("database hasil migrasi tidak memuat tabel khusus seed demo", () => {
  const database = createTempDatabase();
  try {
    runMigrations({ dbPath: database.dbPath, backup: "off" });
    const db = new DatabaseSync(database.dbPath, { readOnly: true });
    try {
      const names = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
          name: string;
        }>
      ).map((row) => row.name);
      assert.ok(!names.includes("demo_seed_runs"));
    } finally {
      db.close();
    }
  } finally {
    database.cleanup();
  }
});

test(".gitignore mengecualikan database, WAL/SHM, dan cadangan", () => {
  const content = readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8");
  for (const pattern of [
    "*.sqlite",
    "*.sqlite-wal",
    "*.sqlite-shm",
    "*.db-journal",
    "backups/",
    "node_modules/",
  ]) {
    assert.ok(content.includes(pattern), `.gitignore harus memuat ${pattern}`);
  }
});
