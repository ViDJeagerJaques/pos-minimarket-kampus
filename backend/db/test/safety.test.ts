import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
  const fakeEnv = { LOCALAPPDATA: "C:\\Users\\contoh\\AppData\\Local" };
  assert.equal(
    defaultDataDir(fakeEnv),
    path.join("C:\\Users\\contoh\\AppData\\Local", "PosMinimarketKampus", "data"),
  );
  const dbPath = resolveDatabasePath(fakeEnv);
  assert.equal(isInsideSourceTree(dbPath), false);
  assert.equal(isInsideSourceTree(path.join(REPO_ROOT, "data", "pos-dev.sqlite")), true);
});

test("POS_DB_PATH dipakai sebagai override dan guard source tree menolak path repo", () => {
  const override = resolveDatabasePath({ POS_DB_PATH: "D:\\pos-data\\dev.sqlite" });
  assert.equal(path.resolve(override), path.resolve("D:\\pos-data\\dev.sqlite"));

  assert.throws(
    () => assertOutsideSourceTree(path.join(REPO_ROOT, "backend", "db", "dev.sqlite")),
    /Menolak database di dalam source tree/,
  );
  assert.doesNotThrow(() => assertOutsideSourceTree("D:\\pos-data\\dev.sqlite", REPO_ROOT));
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