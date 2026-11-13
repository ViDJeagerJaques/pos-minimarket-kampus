import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { checkIntegrity, openDatabase } from "../db/src/db.ts";
import { REPO_ROOT } from "../db/src/paths.ts";
import { DEMO_PASSWORD_HASH_PLACEHOLDER } from "../db/src/seed.ts";
import { createTempDatabase, migrateFresh } from "../db/test/helpers.ts";
import {
  EXPECTED_QA_SNAPSHOT,
  QA_FIXED_TS,
  QaFixtureError,
  applyQaFixtures,
  resetAndSeedQaDatabase,
  snapshotSqliteState,
} from "./qa_fixtures.ts";
import { formatEvidenceMarkdown, verifySnapshotAgainstExpected } from "./qa_runner.ts";

test("fixture QA deterministik, idempotent, dan cocok dengan EXPECTED_QA_SNAPSHOT", () => {
  const database = createTempDatabase("pos-qa-test-");
  try {
    const first = resetAndSeedQaDatabase({
      dbPath: database.dbPath,
      confirmDevReset: true,
      env: {},
    });
    assert.equal(first.seeded, true);
    assert.equal(first.qaApplied, true);

    // Jalankan applyQaFixtures kedua kali -> tidak boleh menggandakan akun/SKU/stok.
    const rerun = applyQaFixtures({ dbPath: database.dbPath, env: {} });
    assert.equal(rerun.applied, false);

    const snapshot = snapshotSqliteState(database.dbPath);
    verifySnapshotAgainstExpected(snapshot);

    // Pastikan password_hash tetap placeholder (bukan kredensial nyata) dan ada akun nonaktif.
    const db = openDatabase(database.dbPath, { readOnly: true });
    try {
      const users = db.prepare("SELECT username, role, active, password_hash FROM users ORDER BY id").all() as Array<{
        username: string;
        role: string;
        active: number;
        password_hash: string;
      }>;
      assert.equal(users.length, 4);
      assert.ok(users.every((u) => u.password_hash === DEMO_PASSWORD_HASH_PLACEHOLDER));
      assert.equal(users[3]?.username, "demo.kasir.nonaktif");
      assert.equal(users[3]?.active, 0);

      // Harga historis pada sale_items tetap 5000 sementara harga katalog kini 6000.
      const priceCheck = db
        .prepare(
          `SELECT si.unit_price_rp AS historicalPrice, p.price_rp AS currentPrice
           FROM sale_items si JOIN products p ON p.id = si.product_id
           WHERE si.id = 303`,
        )
        .get() as { historicalPrice: number; currentPrice: number };
      assert.equal(priceCheck.historicalPrice, 5000);
      assert.equal(priceCheck.currentPrice, 6000);
    } finally {
      db.close();
    }
  } finally {
    database.cleanup();
  }
});

test("guard reset menolak tanpa flag, NODE_ENV=production, path repo, nama operasional, dan DB non-demo", () => {
  const database = createTempDatabase("pos-qa-guard-");
  try {
    assert.throws(
      () => resetAndSeedQaDatabase({ dbPath: database.dbPath, confirmDevReset: false, env: {} }),
      (e: unknown) => e instanceof QaFixtureError && /confirm-dev-reset/.test(e.message),
    );
    assert.throws(
      () =>
        resetAndSeedQaDatabase({
          dbPath: database.dbPath,
          confirmDevReset: true,
          env: { NODE_ENV: "production" },
        }),
      (e: unknown) => e instanceof QaFixtureError && /production/.test(e.message),
    );
    assert.throws(
      () =>
        resetAndSeedQaDatabase({
          dbPath: database.dbPath,
          confirmDevReset: true,
          env: { POS_DB_PROFILE: "operational" },
        }),
      (e: unknown) => e instanceof QaFixtureError && /POS_DB_PROFILE/.test(e.message),
    );
    assert.throws(
      () =>
        resetAndSeedQaDatabase({
          dbPath: path.join(REPO_ROOT, "backend", "pos-dev.sqlite"),
          confirmDevReset: true,
          env: {},
        }),
      /source tree/,
    );
    assert.throws(
      () =>
        resetAndSeedQaDatabase({
          dbPath: path.join(database.dir, "pos.sqlite"),
          confirmDevReset: true,
          env: {},
        }),
      (e: unknown) => e instanceof QaFixtureError && /operasional\/produksi/.test(e.message),
    );

    // DB yang sudah berisi user non-demo (tanpa demo_seed_runs) harus ditolak.
    migrateFresh(database);
    const db = database.open();
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, active, created_at_ms)
       VALUES (1, 'kasir.operasional', 'scrypt$real', 'CASHIER', 1, 1)`,
    ).run();
    db.close();

    assert.throws(
      () => resetAndSeedQaDatabase({ dbPath: database.dbPath, confirmDevReset: true, env: {} }),
      (e: unknown) => e instanceof QaFixtureError && /demo_seed_runs/.test(e.message),
    );
  } finally {
    database.cleanup();
  }
});

test("AC-03.05: kegagalan di tengah transaksi checkout rollback utuh tanpa mutasi parsial", () => {
  const database = createTempDatabase("pos-qa-ac0305-");
  try {
    resetAndSeedQaDatabase({ dbPath: database.dbPath, confirmDevReset: true, env: {} });
    const before = snapshotSqliteState(database.dbPath);

    const db = database.open();
    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare(
        `INSERT INTO checkout_attempts (attempt_key, shift_id, cashier_id, request_hash, prepared_at_ms)
         VALUES ('attempt-rollback-1', 102, 3, zeroblob(32), ?)`,
      ).run(QA_FIXED_TS + 5_000_000);
      db.prepare(
        `INSERT INTO sales (id, sale_no, attempt_key, committed_at_ms, total_rp)
         VALUES (299, 'S-QA-ROLLBACK', 'attempt-rollback-1', ?, 4500)`,
      ).run(QA_FIXED_TS + 5_000_000);
      // Simulasikan kegagalan CHECK pada payments (QRIS_MANUAL tanpa verified_by).
      assert.throws(() => {
        db.prepare(
          "INSERT INTO payments (sale_id, method_code, amount_rp) VALUES (299, 'QRIS_MANUAL', 4500)",
        ).run();
      });
      db.exec("ROLLBACK");
    } finally {
      db.close();
    }

    const after = snapshotSqliteState(database.dbPath);
    assert.deepEqual(after.counts, before.counts);
    assert.deepEqual(after.stockBalances, before.stockBalances);
  } finally {
    database.cleanup();
  }
});

test("AC-04.01 & AC-04.02: idempotency attempt_key dan pemulihan status PREPARED lintas buka ulang DB", () => {
  const database = createTempDatabase("pos-qa-ac0401-");
  try {
    resetAndSeedQaDatabase({ dbPath: database.dbPath, confirmDevReset: true, env: {} });
    const db = database.open();
    try {
      // AC-04.02: attempt-qa-prepared-1 ditemukan setelah koneksi dibuka ulang, belum ada sale.
      const pending = db
        .prepare(
          `SELECT a.attempt_key, s.id AS sale_id
           FROM checkout_attempts a
           LEFT JOIN sales s ON s.attempt_key = a.attempt_key
           WHERE a.attempt_key = ?`,
        )
        .get(EXPECTED_QA_SNAPSHOT.preparedAttemptKey) as { attempt_key: string; sale_id: number | null };
      assert.equal(pending.attempt_key, EXPECTED_QA_SNAPSHOT.preparedAttemptKey);
      assert.equal(pending.sale_id, null);

      // AC-04.01: satu attempt_key hanya boleh menghasilkan paling banyak satu sale (UNIQUE sales.attempt_key).
      assert.throws(() => {
        db.prepare(
          `INSERT INTO sales (id, sale_no, attempt_key, committed_at_ms, total_rp)
           VALUES (298, 'S-QA-DUP', 'attempt-qa-cash-1', ?, 6000)`,
        ).run(QA_FIXED_TS + 5_000_000);
      }, /UNIQUE constraint failed: sales\.attempt_key/);
    } finally {
      db.close();
    }
  } finally {
    database.cleanup();
  }
});

test("AC-05.01 & AC-06.02: satu shift aktif per stasiun dan tutup shift konsisten", () => {
  const database = createTempDatabase("pos-qa-ac0501-");
  try {
    resetAndSeedQaDatabase({ dbPath: database.dbPath, confirmDevReset: true, env: {} });
    const db = database.open();
    try {
      // Shift 102 masih aktif -> pembukaan shift kedua ditolak oleh ux_shifts_single_open.
      assert.throws(() => {
        db.prepare(
          "INSERT INTO shifts (id, cashier_id, opened_at_ms, opening_cash_rp) VALUES (103, 2, ?, 100000)",
        ).run(QA_FIXED_TS + 6_000_000);
      }, /ux_shifts_single_open/);

      // Shift 101 sudah ditutup -> penutupan ulang ditolak oleh PK shift_closings.
      assert.throws(() => {
        db.prepare(
          `INSERT INTO shift_closings (shift_id, close_key, request_hash, closed_by, declared_cash_rp, variance_rp)
           VALUES (101, 'close-qa-101-dup', zeroblob(32), 2, 106000, 0)`,
        ).run();
      }, /UNIQUE constraint failed: shift_closings\.shift_id/);
    } finally {
      db.close();
    }
  } finally {
    database.cleanup();
  }
});

test("AC-09.01 & AC-09.02: backup konsisten dapat dipulihkan dan cadangan rusak ditolak", () => {
  const database = createTempDatabase("pos-qa-ac0901-");
  try {
    resetAndSeedQaDatabase({ dbPath: database.dbPath, confirmDevReset: true, env: {} });
    const backupPath = path.join(database.dir, "qa-backup.sqlite");
    const corruptPath = path.join(database.dir, "qa-corrupt.sqlite");

    const db = database.open();
    try {
      db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }

    const backupSnapshot = snapshotSqliteState(backupPath);
    verifySnapshotAgainstExpected(backupSnapshot);

    // Cadangan rusak harus gagal pemeriksaan sebelum menimpa DB aktif.
    writeFileSync(corruptPath, "bukan file sqlite yang valid", "utf8");
    const corruptDb = openDatabase(corruptPath, { readOnly: true });
    try {
      assert.throws(() => {
        checkIntegrity(corruptDb);
      });
    } finally {
      corruptDb.close();
    }

    // Pastikan format bukti markdown dapat dibuat dari snapshot nyata.
    const md = formatEvidenceMarkdown({
      command: "node --test backend/qa/qa_fixtures.test.ts",
      actualResult: "PASS",
      snapshot: backupSnapshot,
      reviewer: "Rahmat",
      dateIso: "2026-11-13T00:00:00.000Z",
    });
    assert.match(md, /PRAGMA integrity_check.*`ok`/);
    assert.match(md, /0000000000058/);
  } finally {
    database.cleanup();
  }
});
