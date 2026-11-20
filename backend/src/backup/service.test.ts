import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  createTempDatabase,
  FIXED_NOW,
  insertBaseFixture,
  migrateFresh,
} from "../../db/test/helpers.ts";
import { openDatabase } from "../../db/src/db.ts";
import { REPO_ROOT } from "../../db/src/paths.ts";
import {
  createBackup,
  restoreBackupToTestCopy,
  verifyBackup,
  type BackupServiceOptions,
} from "./service.ts";

function setup() {
  const database = createTempDatabase("pos-backup-test-");
  const db = database.open();
  migrateFresh(database);
  insertBaseFixture(db);
  db.prepare("INSERT INTO suppliers (id, name) VALUES (1, 'Supplier Uji')").run();
  db.prepare(
    `INSERT INTO shifts (id, cashier_id, opened_at_ms, closed_at_ms, opening_cash_rp)
     VALUES (10, 2, ?, ?, 50000)`,
  ).run(FIXED_NOW - 3_600_000, FIXED_NOW + 3_600_000);
  db.prepare(
    `INSERT INTO checkout_attempts (attempt_key, shift_id, cashier_id, request_hash, prepared_at_ms)
     VALUES ('co-backup-1', 10, 2, zeroblob(32), ?)`,
  ).run(FIXED_NOW);
  db.prepare(
    `INSERT INTO sales (id, sale_no, attempt_key, committed_at_ms, total_rp)
     VALUES (20, 'S-BACKUP-1', 'co-backup-1', ?, 5000)`,
  ).run(FIXED_NOW);
  db.prepare(
    `INSERT INTO sale_items (sale_id, product_id, sku_snapshot, name_snapshot, quantity, unit_price_rp, line_total_rp)
     VALUES (20, 1, 'FX-001', 'Fixture Produk', 2, 2500, 5000)`,
  ).run();
  db.prepare(
    `INSERT INTO payments (sale_id, method_code, amount_rp, verified_by, verified_at_ms)
     VALUES (20, 'CASH', 5000, NULL, NULL)`,
  ).run();
  db.prepare(
    `INSERT INTO inventory_movements (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
     VALUES (1, 'OPENING', 5, 'BACKUP-OPEN-1', 1, ?)`,
  ).run(FIXED_NOW - 7_200_000);
  db.prepare(
    `INSERT INTO inventory_movements (product_id, kind, delta, sale_item_id, actor_id, created_at_ms)
     VALUES (1, 'SALE', -2, 1, 2, ?)`,
  ).run(FIXED_NOW);
  db.prepare(
    `INSERT INTO goods_receipts (id, receipt_key, request_hash, supplier_id, received_by, committed_at_ms)
     VALUES (1, 'rcv-backup-1', zeroblob(32), 1, 1, ?)`,
  ).run(FIXED_NOW - 1_800_000);
  db.prepare(
    "INSERT INTO receipt_items (id, receipt_id, product_id, quantity) VALUES (1, 1, 1, 3)",
  ).run();
  db.prepare(
    `INSERT INTO inventory_movements (product_id, kind, delta, receipt_item_id, actor_id, created_at_ms)
     VALUES (1, 'RECEIPT', 3, 1, 1, ?)`,
  ).run(FIXED_NOW - 1_800_000);
  db.close();

  const env = {
    POS_DB_PATH: database.dbPath,
    POS_BACKUP_DIR: path.join(database.dir, "backups"),
    POS_RESTORE_TEST_DIR: path.join(database.dir, "restore-test"),
  };
  const options: BackupServiceOptions = {
    dbPath: database.dbPath,
    env,
    actorId: 1,
    now: () => FIXED_NOW,
  };
  return { database, env, options };
}

function hashFile(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function countRows(dbPath: string, table: string): number {
  const db = openDatabase(dbPath, { readOnly: true });
  try {
    return Number((db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total);
  } finally {
    db.close();
  }
}

test("AC-09.01/09.02: backup konsisten dan restore ke salinan uji menghasilkan data yang sama", () => {
  const { database, options } = setup();
  try {
    const backup = createBackup(options);
    assert.equal(backup.fileName, path.basename(backup.destinationPath));
    assert.equal(backup.fileName.startsWith("pos_"), true);
    const manifest = JSON.parse(readFileSync(backup.manifestPath as string, "utf8")) as {
      fileName: string;
    };
    assert.equal(manifest.fileName, backup.fileName);
    assert.equal(backup.integrity, "ok");
    assert.equal(backup.foreignKeyViolations, 0);
    assert.ok(backup.sizeBytes > 0);
    assert.equal(backup.sha256.length, 64);
    assert.equal(backup.createdAtMs, FIXED_NOW);
    assert.equal(backup.schemaVersion > 0, true);
    assert.equal(backup.counts.sales, 1);
    assert.equal(backup.counts.sale_items, 1);
    assert.equal(backup.counts.payments, 1);
    assert.equal(backup.counts.shifts, 1);
    assert.equal(backup.counts.inventory_movements, 3);
    assert.equal(existsSync(backup.manifestPath as string), true);

    const verified = verifyBackup(backup.destinationPath, backup.sha256);
    assert.equal(verified.sha256, backup.sha256);

    const restore = restoreBackupToTestCopy({
      backupPath: backup.destinationPath,
      env: options.env,
      now: () => FIXED_NOW,
    });
    assert.equal(restore.report.sha256, backup.sha256);
    assert.notEqual(restore.destinationPath, database.dbPath);
    assert.notEqual(restore.destinationPath, backup.destinationPath);
    assert.equal(existsSync(restore.destinationPath), true);
    assert.deepEqual(restore.report.counts, backup.counts);

    assert.equal(countRows(restore.destinationPath, "sales"), 1);
    assert.equal(countRows(restore.destinationPath, "sale_items"), 1);
    assert.equal(countRows(restore.destinationPath, "payments"), 1);
    assert.equal(countRows(restore.destinationPath, "shifts"), 1);
    assert.equal(countRows(restore.destinationPath, "inventory_movements"), 3);
    const sale = openDatabase(restore.destinationPath, { readOnly: true });
    try {
      const row = sale.prepare("SELECT sale_no, total_rp FROM sales").get() as {
        sale_no: string;
        total_rp: number;
      };
      assert.equal(row.sale_no, "S-BACKUP-1");
      assert.equal(row.total_rp, 5000);
      const stock = sale
        .prepare("SELECT COALESCE(SUM(delta), 0) AS on_hand FROM inventory_movements WHERE product_id = 1")
        .get() as { on_hand: number };
      assert.equal(stock.on_hand, 6);
    } finally {
      sale.close();
    }
  } finally {
    database.cleanup();
  }
});

test("Tujuan backup tidak dapat ditulis: error jelas, backup baik tetap utuh", () => {
  const { database, options } = setup();
  try {
    const first = createBackup(options);
    const beforeHash = hashFile(first.destinationPath);
    const blocked = path.join(options.env!.POS_BACKUP_DIR!, "blocked");
    writeFileSync(blocked, "bukan direktori");

    assert.throws(
      () => createBackup({ ...options, destinationDir: blocked }),
      /EEXIST|ENOTDIR|direktori/i,
    );
    assert.equal(hashFile(first.destinationPath), beforeHash, "backup lama tidak berubah");
    assert.equal(existsSync(first.destinationPath), true);
  } finally {
    database.cleanup();
  }
});

test("Backup rusak ditolak tanpa menimpa database operasional", () => {
  const { database, options } = setup();
  try {
    const backup = createBackup(options);
    const operationalHash = hashFile(database.dbPath);
    const corruptPath = path.join(database.dir, "rusak.sqlite");
    writeFileSync(corruptPath, Buffer.from("bukan database sqlite yang valid"));

    assert.throws(() => verifyBackup(corruptPath), /integrity/i);
    assert.throws(
      () => restoreBackupToTestCopy({ backupPath: corruptPath, env: options.env }),
      /integrity/i,
    );
    assert.equal(hashFile(database.dbPath), operationalHash, "database aktif tidak berubah");
    assert.equal(existsSync(backup.destinationPath), true, "backup baik tidak dihapus");
    assert.equal(
      readdirCount(options.env!.POS_RESTORE_TEST_DIR!),
      0,
      "tidak ada salinan restore dari file rusak",
    );
  } finally {
    database.cleanup();
  }
});

function readdirCount(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).length;
}

test("Root cadangan/restore dibatasi backend", () => {
  const { database, options } = setup();
  try {
    const backup = createBackup(options);
    assert.throws(
      () => createBackup({ ...options, destinationDir: database.dir }),
      /direktori yang diizinkan|root cadangan/i,
    );
    assert.throws(
      () =>
        restoreBackupToTestCopy({
          backupPath: backup.destinationPath,
          env: options.env,
          destinationDir: database.dir,
        }),
      /direktori yang diizinkan|root cadangan/i,
    );
    const backups = readdirCount(options.env!.POS_BACKUP_DIR!);
    assert.equal(backups >= 1, true);
  } finally {
    database.cleanup();
  }
});

test("BUG-097: symlink di root tidak boleh mengarahkan tulisan keluar root atau ke repo", () => {
  const { database, options } = setup();
  try {
    const backup = createBackup(options);
    const root = options.env!.POS_BACKUP_DIR!;
    const outside = path.join(database.dir, "outside");
    mkdirSync(outside, { recursive: true });
    const escapeOutside = path.join(root, "escape-outside");
    const escapeRepo = path.join(root, "escape-repo");
    symlinkSync(outside, escapeOutside, "junction");
    symlinkSync(REPO_ROOT, escapeRepo, "junction");

    assert.throws(
      () => createBackup({ ...options, destinationDir: escapeOutside }),
      /Direktori ditolak/,
    );
    assert.throws(
      () => createBackup({ ...options, destinationDir: escapeRepo }),
      /repository|Direktori ditolak/,
    );
    assert.throws(
      () =>
        restoreBackupToTestCopy({
          backupPath: backup.destinationPath,
          env: options.env,
          destinationDir: escapeOutside,
        }),
      /Direktori ditolak/,
    );
  } finally {
    database.cleanup();
  }
});

test("BUG-099: baris di WAL sidecar tidak boleh hilang saat restore salinan uji", () => {
  const { database, options } = setup();
  try {
    const writer = openDatabase(database.dbPath);
    writer
      .prepare(
        `INSERT INTO users (username, password_hash, role, active, created_at_ms)
         VALUES ('wal.extra', 'x', 'CASHIER', 1, ?)`,
      )
      .run(FIXED_NOW);
    const sidecarBackup = path.join(database.dir, "dengan-wal.sqlite");
    copyFileSync(database.dbPath, sidecarBackup);
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = `${database.dbPath}${suffix}`;
      if (existsSync(sidecar)) {
        copyFileSync(sidecar, `${sidecarBackup}${suffix}`);
      }
    }
    const sourceReport = verifyBackup(sidecarBackup);
    assert.equal(sourceReport.counts.users, 4, "WAL ikut diverifikasi pada sumber");
    writer.close();

    assert.throws(
      () => restoreBackupToTestCopy({ backupPath: sidecarBackup, env: options.env }),
      /Salinan uji tidak cocok/,
    );
    assert.equal(readdirCount(options.env!.POS_RESTORE_TEST_DIR!), 0);
  } finally {
    database.cleanup();
  }
});
