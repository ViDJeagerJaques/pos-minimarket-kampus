import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "../src/db.ts";
import {
  DEMO_PASSWORD_HASH_PLACEHOLDER,
  DEMO_SEED_KEY,
  SeedError,
  seedDemo,
} from "../src/seed.ts";
import { createTempDatabase, migrateFresh } from "./helpers.ts";

test("seed demo idempotent: dua kali jalan tidak menggandakan data", () => {
  const database = createTempDatabase();
  try {
    migrateFresh(database);
    const first = seedDemo({
      dbPath: database.dbPath,
      allowDemo: true,
      env: {},
      now: () => 1_762_992_000_000,
    });
    assert.equal(first.seeded, true);
    assert.equal(first.counts.users, 3);
    assert.equal(first.counts.products, 4);
    assert.equal(first.counts.inventory_movements, 4);

    const second = seedDemo({ dbPath: database.dbPath, allowDemo: true, env: {} });
    assert.equal(second.seeded, false);
    assert.match(second.skippedReason ?? "", new RegExp(DEMO_SEED_KEY));
    assert.deepEqual(second.counts, first.counts);

    const db = openDatabase(database.dbPath, { readOnly: true });
    try {
      const barcodes = db
        .prepare("SELECT barcode FROM product_barcodes ORDER BY barcode")
        .all() as Array<{ barcode: string }>;
      assert.ok(barcodes.some((row) => row.barcode === "0000000000017"));
      const balances = db
        .prepare("SELECT product_id, on_hand FROM stock_balances ORDER BY product_id")
        .all() as Array<{ product_id: number; on_hand: number }>;
      assert.deepEqual(
        balances.map((row) => ({ product_id: row.product_id, on_hand: row.on_hand })),
        [
          { product_id: 1, on_hand: 24 },
          { product_id: 2, on_hand: 12 },
          { product_id: 3, on_hand: 8 },
          { product_id: 4, on_hand: 5 },
        ],
      );
      const hashes = db
        .prepare("SELECT DISTINCT password_hash FROM users")
        .all() as Array<{ password_hash: string }>;
      assert.deepEqual(
        hashes.map((row) => row.password_hash),
        [DEMO_PASSWORD_HASH_PLACEHOLDER],
      );
      const runs = db.prepare("SELECT COUNT(*) AS total FROM demo_seed_runs").get() as {
        total: number;
      };
      assert.equal(runs.total, 1);
      const usernamePrefixes = db
        .prepare("SELECT username FROM users")
        .all() as Array<{ username: string }>;
      assert.ok(usernamePrefixes.every((row) => row.username.startsWith("demo.")));
    } finally {
      db.close();
    }
  } finally {
    database.cleanup();
  }
});

test("seed demo menolak permintaan tanpa flag --demo", () => {
  const database = createTempDatabase();
  try {
    migrateFresh(database);
    assert.throws(
      () => seedDemo({ dbPath: database.dbPath, allowDemo: false, env: {} }),
      (error: unknown) => error instanceof SeedError && /--demo/.test(error.message),
    );
  } finally {
    database.cleanup();
  }
});

test("seed demo menolak NODE_ENV=production dan profil operasional", () => {
  const database = createTempDatabase();
  try {
    migrateFresh(database);
    assert.throws(
      () =>
        seedDemo({
          dbPath: database.dbPath,
          allowDemo: true,
          env: { NODE_ENV: "production" },
        }),
      (error: unknown) => error instanceof SeedError && /production/.test(error.message),
    );
    assert.throws(
      () =>
        seedDemo({
          dbPath: database.dbPath,
          allowDemo: true,
          env: { POS_DB_PROFILE: "operational" },
        }),
      (error: unknown) => error instanceof SeedError && /operational/.test(error.message),
    );
  } finally {
    database.cleanup();
  }
});

test("seed demo menolak database yang sudah berisi data", () => {
  const database = createTempDatabase();
  try {
    migrateFresh(database);
    const db = openDatabase(database.dbPath);
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, active, created_at_ms)
       VALUES (1, 'admin.nyata', 'scrypt$contoh', 'ADMIN', 1, 1)`,
    ).run();
    db.close();

    assert.throws(
      () => seedDemo({ dbPath: database.dbPath, allowDemo: true, env: {} }),
      (error: unknown) => error instanceof SeedError && /database kosong/.test(error.message),
    );
  } finally {
    database.cleanup();
  }
});

test("seed demo menolak database yang belum dimigrasi", () => {
  const database = createTempDatabase();
  try {
    assert.throws(
      () => seedDemo({ dbPath: database.dbPath, allowDemo: true, env: {} }),
      (error: unknown) => error instanceof SeedError && /db:migrate/.test(error.message),
    );
  } finally {
    database.cleanup();
  }
});