import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { checkIntegrity, openDatabase, readUserVersion } from "../db/src/db.ts";
import { runMigrations } from "../db/src/migrate.ts";
import { assertOutsideSourceTree, REPO_ROOT, type Env } from "../db/src/paths.ts";
import { DEMO_PASSWORD_HASH_PLACEHOLDER, seedDemo } from "../db/src/seed.ts";

export const QA_FIXTURE_KEY = "qa-synthetic-v1";
export const QA_OPENING_BATCH_REF = "QA-OPENING-2026-11-13";
export const QA_FIXED_TS = 1_762_995_600_000;

export class QaFixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QaFixtureError";
  }
}

const FORBIDDEN_OPERATIONAL_NAMES = new Set([
  "pos.sqlite",
  "pos.db",
  "pos-prod.sqlite",
  "pos-production.sqlite",
  "production.sqlite",
  "operational.sqlite",
]);

/**
 * Guard eksplisit agar skrip reset/fixture TIDAK PERNAH menimpa database operasional
 * atau database yang berada di dalam source tree.
 */
export function assertSafeDevResetTarget(
  dbPath: string,
  env: Env = process.env,
  repoRoot: string = REPO_ROOT,
): void {
  if (env.NODE_ENV === "production") {
    throw new QaFixtureError("Reset QA ditolak: NODE_ENV=production.");
  }
  // Profil WAJIB eksplisit development atau test. Tanpa ini, environment yang
  // lupa menyetel POS_DB_PROFILE bisa menjalankan reset pada lokasi default.
  if (env.POS_DB_PROFILE !== "development" && env.POS_DB_PROFILE !== "test") {
    throw new QaFixtureError(
      `Reset QA ditolak: POS_DB_PROFILE harus diisi "development" atau "test" (saat ini: ${env.POS_DB_PROFILE ?? "kosong"}).`,
    );
  }
  assertOutsideSourceTree(dbPath, repoRoot);

  const resolved = path.resolve(dbPath);
  const baseName = path.basename(resolved).toLowerCase();
  if (FORBIDDEN_OPERATIONAL_NAMES.has(baseName)) {
    throw new QaFixtureError(
      `Reset QA ditolak: nama file "${baseName}" dicadangkan untuk database operasional/produksi.`,
    );
  }
  if (/(^|[\\/])(prod|production|operational)([\\/]|$)/i.test(resolved)) {
    throw new QaFixtureError(
      `Reset QA ditolak: path "${resolved}" mengarah ke direktori operasional/produksi.`,
    );
  }
}

/** Tabel bisnis yang dipantau baseline-nya. Tabel metadata (demo_seed_runs,
 *  qa_fixture_runs, schema_migrations) sengaja tidak dimasukkan. */
const BASELINE_TABLES = [
  "users",
  "categories",
  "suppliers",
  "products",
  "product_barcodes",
  "product_suppliers",
  "inventory_movements",
  "sales",
  "shifts",
] as const;

function tableExistsInDb(db: DatabaseSync, name: string): boolean {
  const row = db
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { found: number } | undefined;
  return row !== undefined;
}

/** Tambah kolom sederhana (TEXT/INTEGER) bila belum ada — perubahan skema aditif,
 *  tidak menyentuh DDL migrasi 0001 milik TASK-008. */
function addColumnIfMissing(
  db: DatabaseSync,
  table: string,
  column: string,
  type: "TEXT" | "INTEGER",
): void {
  const existing = db
    .prepare("SELECT 1 AS found FROM pragma_table_info(?) WHERE name = ?")
    .get(table, column) as { found: number } | undefined;
  if (!existing) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

function countRowsInDb(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number };
  return Number(row.total);
}

function collectBaselineCountsFor(db: DatabaseSync, tables: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    counts[table] = tableExistsInDb(db, table) ? countRowsInDb(db, table) : 0;
  }
  return counts;
}

/** Baseline yang dipakai guard reset: kondisi SAAT FIXTURE QA selesai dipasang.
 *  Lebih longgar dari baseline seed, jadi reset ulang pada DB fixture utuh tetap sah,
 *  tetapi data tambahan di luar fixture QA ditolak. */
function qaBaselineCounts(db: DatabaseSync): Record<string, number> {
  return collectBaselineCountsFor(db, BASELINE_TABLES);
}

/**
 * Bandingkan isi DB dengan baseline saat seed. Tabel bisnis yang jumlah barisnya
 * NAIK berarti ada data tambahan setelah seed — reset ditolak agar data itu
 * tidak hilang diam-dian. Penurunan masih diperbolehkan (mis. rollback uji).
 */
function assertNoExtraDataAfterSeed(
  db: DatabaseSync,
  baseline: Record<string, number>,
  demoSeedKey: string,
): void {
  const grown: string[] = [];
  for (const table of BASELINE_TABLES) {
    const current = tableExistsInDb(db, table) ? countRowsInDb(db, table) : 0;
    if (current > (baseline[table] ?? 0)) {
      grown.push(`${table}=${baseline[table] ?? 0}→${current}`);
    }
  }
  if (grown.length > 0) {
    throw new QaFixtureError(
      `Reset QA ditolak: database "${demoSeedKey}" sudah berisi data tambahan setelah seed (${grown.join(", ")}). ` +
        "Hapus/reset manual atau pakai database baru; jangan timpa data yang sudah bertambah.",
    );
  }
}

function assertExistingDbIsNotOperational(dbPath: string): void {
  if (!existsSync(dbPath)) {
    return;
  }
  const db = openDatabase(dbPath, { readOnly: true });
  try {
    const hasUsersTable = db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='users'")
      .get();
    if (!hasUsersTable) {
      return;
    }
    const userCount = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
    if (userCount === 0) {
      return;
    }
    const hasDemoRuns = db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='demo_seed_runs'")
      .get();
    if (!hasDemoRuns) {
      throw new QaFixtureError(
        "Reset QA ditolak: database sudah berisi data tanpa penanda demo_seed_runs (kemungkinan DB operasional).",
      );
    }
    const runRow = db
      .prepare(
        "SELECT run_key, baseline_counts_json, baseline_user_version FROM demo_seed_runs LIMIT 1",
      )
      .get() as
      | { run_key: string; baseline_counts_json: string | null; baseline_user_version: number | null }
      | undefined;
    if (!runRow) {
      throw new QaFixtureError(
        "Reset QA ditolak: database berisi data tetapi demo_seed_runs kosong.",
      );
    }

    // Guard baru: DB yang punya penanda demo tapi ternyata bertambah isinya
    // (mis. transaksi nyata masuk) tidak boleh dihapus oleh reset QA.
    // Baseline yang dipakai = kondisi SAAT FIXTURE QA selesai (paling mutakhir),
    // fallback ke baseline seed bila fixture QA belum pernah dipasang.
    const qaRow = db
      .prepare("SELECT baseline_counts_json FROM qa_fixture_runs WHERE run_key = ? LIMIT 1")
      .get(QA_FIXTURE_KEY) as { baseline_counts_json: string | null } | undefined;

    const rawBaseline = qaRow?.baseline_counts_json ?? runRow.baseline_counts_json;
    if (rawBaseline !== null && rawBaseline !== "") {
      let baseline: Record<string, number>;
      try {
        baseline = JSON.parse(rawBaseline) as Record<string, number>;
      } catch {
        throw new QaFixtureError(
          "Reset QA ditolak: baseline_counts_json tidak dapat dibaca.",
        );
      }
      assertNoExtraDataAfterSeed(db, baseline, runRow.run_key);
    }
  } finally {
    db.close();
  }
}

/**
 * Daftar expected values deterministik setelah seedDemo + applyQaFixtures.
 * Dipakai oleh test runner dan laporan bukti untuk memverifikasi isi SQLite,
 * bukan sekadar status "test passed".
 */
export const EXPECTED_QA_SNAPSHOT = {
  userVersion: 1,
  counts: {
    users: 4,
    categories: 3,
    suppliers: 2,
    products: 8,
    product_barcodes: 8,
    shifts: 2,
    shift_closings: 1,
    shift_closing_totals: 2,
    checkout_attempts: 4,
    sales: 3,
    sale_items: 3,
    payments: 3,
    inventory_movements: 10,
    audit_log: 2,
  },
  stockBalances: [
    { productId: 1, sku: "DEMO-001", barcode: "0000000000017", priceRp: 3000, onHand: 22 },
    { productId: 2, sku: "DEMO-002", barcode: "8991234567890", priceRp: 4000, onHand: 12 },
    { productId: 3, sku: "DEMO-003", barcode: "0000000000034", priceRp: 5000, onHand: 7 },
    { productId: 4, sku: "DEMO-004", barcode: "8999876543210", priceRp: 15000, onHand: 5 },
    { productId: 5, sku: "QA-STOK-0", barcode: "0000000000058", priceRp: 2000, onHand: 0 },
    { productId: 6, sku: "QA-STOK-1", barcode: "0000000000065", priceRp: 4500, onHand: 1 },
    { productId: 7, sku: "QA-STOK-10", barcode: "0000000000072", priceRp: 7500, onHand: 10 },
    { productId: 8, sku: "QA-HARGA-UBAH", barcode: "0000000000089", priceRp: 6000, onHand: 9 },
  ],
  shifts: {
    closedShiftId: 101,
    closedShiftOpeningCashRp: 100000,
    closedShiftCashTotalRp: 6000,
    closedShiftQrisTotalRp: 10000,
    closedShiftDeclaredCashRp: 106000,
    closedShiftVarianceRp: 0,
    activeShiftId: 102,
    activeShiftCashierId: 3,
  },
  preparedAttemptKey: "attempt-qa-prepared-1",
  shiftClosingTotals: [
    { shiftId: 101, methodCode: "CASH", amountRp: 6000 },
    { shiftId: 101, methodCode: "QRIS_MANUAL", amountRp: 10000 },
  ],
  closedShiftSummary: [{ shiftId: 101, declaredCashRp: 106000, varianceRp: 0 }],
  preparedAttemptsWithoutSale: [
    { attemptKey: "attempt-qa-prepared-1", shiftId: 102, hasSale: 0 },
  ],
  payments: [
    { id: 1, saleId: 201, methodCode: "CASH", amountRp: 6000, evidenceRef: null, verifiedBy: null },
    { id: 2, saleId: 202, methodCode: "QRIS_MANUAL", amountRp: 5000, evidenceRef: "DEMO-QRIS-REF-001", verifiedBy: 2 },
    { id: 3, saleId: 203, methodCode: "QRIS_MANUAL", amountRp: 5000, evidenceRef: "DEMO-QRIS-REF-002", verifiedBy: 2 },
  ],
} as const;

export function applyQaFixtures(options: {
  dbPath: string;
  env?: Env;
  repoRoot?: string;
}): { applied: boolean; skippedReason: string | null } {
  const env = options.env ?? process.env;
  assertSafeDevResetTarget(options.dbPath, env, options.repoRoot ?? REPO_ROOT);

  const db = openDatabase(options.dbPath);
  try {
    const hasMarker = db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='qa_fixture_runs'")
      .get();
    if (hasMarker) {
      const existing = db
        .prepare("SELECT 1 AS ok FROM qa_fixture_runs WHERE run_key = ?")
        .get(QA_FIXTURE_KEY);
      if (existing) {
        return { applied: false, skippedReason: `Fixture ${QA_FIXTURE_KEY} sudah terpasang.` };
      }
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(
        `CREATE TABLE IF NOT EXISTS qa_fixture_runs (
           run_key TEXT PRIMARY KEY,
           applied_at_ms INTEGER NOT NULL CHECK (applied_at_ms >= 0)
         ) STRICT`,
      );
      addColumnIfMissing(db, "qa_fixture_runs", "baseline_counts_json", "TEXT");

      // 1. Akun kasir nonaktif sintetis (melengkapi 3 akun seedDemo: admin, kasir pagi, kasir sore).
      db.prepare(
        `INSERT INTO users (id, username, password_hash, role, active, created_at_ms)
         VALUES (4, 'demo.kasir.nonaktif', ?, 'CASHIER', 0, ?)`,
      ).run(DEMO_PASSWORD_HASH_PLACEHOLDER, QA_FIXED_TS);

      // 2. Produk QA: stok 0, stok 1, stok 10, serta produk harga berubah (barcode nol awal).
      const qaProducts = [
        { id: 5, cat: 2, sku: "QA-STOK-0", name: "QA Produk Stok Nol", price: 2000, barcode: "0000000000058", qty: 0 },
        { id: 6, cat: 2, sku: "QA-STOK-1", name: "QA Produk Stok Satu", price: 4500, barcode: "0000000000065", qty: 1 },
        { id: 7, cat: 1, sku: "QA-STOK-10", name: "QA Produk Stok Sepuluh", price: 7500, barcode: "0000000000072", qty: 10 },
        { id: 8, cat: 3, sku: "QA-HARGA-UBAH", name: "QA Produk Harga Berubah", price: 6000, barcode: "0000000000089", qty: 10 },
      ];

      const insProd = db.prepare(
        "INSERT INTO products (id, category_id, sku, name, price_rp, active) VALUES (?, ?, ?, ?, ?, 1)",
      );
      const insBar = db.prepare("INSERT INTO product_barcodes (barcode, product_id) VALUES (?, ?)");
      const insSup = db.prepare("INSERT INTO product_suppliers (product_id, supplier_id) VALUES (?, 1)");
      const insOpen = db.prepare(
        `INSERT INTO inventory_movements (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
         VALUES (?, 'OPENING', ?, ?, 1, ?)`,
      );

      for (const p of qaProducts) {
        insProd.run(p.id, p.cat, p.sku, p.name, p.price);
        insBar.run(p.barcode, p.id);
        insSup.run(p.id);
        if (p.qty > 0) {
          insOpen.run(p.id, p.qty, QA_OPENING_BATCH_REF, QA_FIXED_TS);
        }
      }

      // 3. Dua shift berurutan: Shift 101 (DITUTUP) & Shift 102 (AKTIF).
      db.prepare(
        `INSERT INTO shifts (id, cashier_id, opened_at_ms, closed_at_ms, opening_cash_rp)
         VALUES (101, 2, ?, ?, 100000)`,
      ).run(QA_FIXED_TS, QA_FIXED_TS + 3_600_000);

      // 3a. Penjualan tunai pada Shift 101 (2 x DEMO-001 @3000 = Rp6.000).
      db.prepare(
        `INSERT INTO checkout_attempts (attempt_key, shift_id, cashier_id, request_hash, prepared_at_ms)
         VALUES ('attempt-qa-cash-1', 101, 2, zeroblob(32), ?)`,
      ).run(QA_FIXED_TS + 60_000);
      db.prepare(
        `INSERT INTO sales (id, sale_no, attempt_key, committed_at_ms, total_rp)
         VALUES (201, 'S-QA-000201', 'attempt-qa-cash-1', ?, 6000)`,
      ).run(QA_FIXED_TS + 61_000);
      db.prepare(
        `INSERT INTO sale_items (id, sale_id, product_id, sku_snapshot, name_snapshot, quantity, unit_price_rp, line_total_rp)
         VALUES (301, 201, 1, 'DEMO-001', 'DEMO Air Mineral Botol 600 ml', 2, 3000, 6000)`,
      ).run();
      db.prepare(
        "INSERT INTO payments (sale_id, method_code, amount_rp) VALUES (201, 'CASH', 6000)",
      ).run();
      db.prepare(
        `INSERT INTO inventory_movements (product_id, kind, delta, sale_item_id, actor_id, created_at_ms)
         VALUES (1, 'SALE', -2, 301, 2, ?)`,
      ).run(QA_FIXED_TS + 61_000);

      // 3b. Penjualan QRIS_MANUAL dummy pada Shift 101 (1 x DEMO-003 @5000 = Rp5.000).
      db.prepare(
        `INSERT INTO checkout_attempts (attempt_key, shift_id, cashier_id, request_hash, prepared_at_ms)
         VALUES ('attempt-qa-qris-1', 101, 2, zeroblob(32), ?)`,
      ).run(QA_FIXED_TS + 120_000);
      db.prepare(
        `INSERT INTO sales (id, sale_no, attempt_key, committed_at_ms, total_rp)
         VALUES (202, 'S-QA-000202', 'attempt-qa-qris-1', ?, 5000)`,
      ).run(QA_FIXED_TS + 121_000);
      db.prepare(
        `INSERT INTO sale_items (id, sale_id, product_id, sku_snapshot, name_snapshot, quantity, unit_price_rp, line_total_rp)
         VALUES (302, 202, 3, 'DEMO-003', 'DEMO Keripik Singkong 60 g', 1, 5000, 5000)`,
      ).run();
      db.prepare(
        `INSERT INTO payments (sale_id, method_code, amount_rp, evidence_ref, verified_by, verified_at_ms)
         VALUES (202, 'QRIS_MANUAL', 5000, 'DEMO-QRIS-REF-001', 2, ?)`,
      ).run(QA_FIXED_TS + 121_000);
      db.prepare(
        `INSERT INTO inventory_movements (product_id, kind, delta, sale_item_id, actor_id, created_at_ms)
         VALUES (3, 'SALE', -1, 302, 2, ?)`,
      ).run(QA_FIXED_TS + 121_000);

      // 3c. Kasus harga berubah (AC-02.03 / AC-03.03): transaksi lama snapshot Rp5.000, master kini Rp6.000.
      db.prepare(
        `INSERT INTO checkout_attempts (attempt_key, shift_id, cashier_id, request_hash, prepared_at_ms)
         VALUES ('attempt-qa-price-1', 101, 2, zeroblob(32), ?)`,
      ).run(QA_FIXED_TS + 180_000);
      db.prepare(
        `INSERT INTO sales (id, sale_no, attempt_key, committed_at_ms, total_rp)
         VALUES (203, 'S-QA-000203', 'attempt-qa-price-1', ?, 5000)`,
      ).run(QA_FIXED_TS + 181_000);
      db.prepare(
        `INSERT INTO sale_items (id, sale_id, product_id, sku_snapshot, name_snapshot, quantity, unit_price_rp, line_total_rp)
         VALUES (303, 203, 8, 'QA-HARGA-UBAH', 'QA Produk Harga Berubah', 1, 5000, 5000)`,
      ).run();
      db.prepare(
        `INSERT INTO payments (sale_id, method_code, amount_rp, evidence_ref, verified_by, verified_at_ms)
         VALUES (203, 'QRIS_MANUAL', 5000, 'DEMO-QRIS-REF-002', 2, ?)`,
      ).run(QA_FIXED_TS + 181_000);
      db.prepare(
        `INSERT INTO inventory_movements (product_id, kind, delta, sale_item_id, actor_id, created_at_ms)
         VALUES (8, 'SALE', -1, 303, 2, ?)`,
      ).run(QA_FIXED_TS + 181_000);

      // Penutupan Shift 101 (Tunai 6000 + modal 100000 = 106000; QRIS terpisah 10000).
      db.prepare(
        `INSERT INTO shift_closings (shift_id, close_key, request_hash, closed_by, declared_cash_rp, variance_rp)
         VALUES (101, 'close-qa-101', zeroblob(32), 2, 106000, 0)`,
      ).run();
      db.prepare(
        `INSERT INTO shift_closing_totals (shift_id, method_code, amount_rp)
         VALUES (101, 'CASH', 6000), (101, 'QRIS_MANUAL', 10000)`,
      ).run();
      db.prepare(
        `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, details, created_at_ms)
         VALUES (1, 'PRICE_CHANGE', 'product', '8', '{"oldPriceRp":5000,"newPriceRp":6000}', ?),
                (2, 'SHIFT_CLOSE', 'shift', '101', '{"declaredCashRp":106000,"varianceRp":0}', ?)`,
      ).run(QA_FIXED_TS + 200_000, QA_FIXED_TS + 3_600_000);

      // 4. Shift 102 (AKTIF, milik demo.kasir.sore) + 1 attempt PREPARED untuk uji pemulihan (AC-04.02).
      db.prepare(
        `INSERT INTO shifts (id, cashier_id, opened_at_ms, closed_at_ms, opening_cash_rp)
         VALUES (102, 3, ?, NULL, 100000)`,
      ).run(QA_FIXED_TS + 3_700_000);
      db.prepare(
        `INSERT INTO checkout_attempts (attempt_key, shift_id, cashier_id, request_hash, prepared_at_ms)
         VALUES (?, 102, 3, zeroblob(32), ?)`,
      ).run(EXPECTED_QA_SNAPSHOT.preparedAttemptKey, QA_FIXED_TS + 3_800_000);

      db.prepare(
        "INSERT INTO qa_fixture_runs (run_key, applied_at_ms, baseline_counts_json) VALUES (?, ?, ?)",
      ).run(QA_FIXTURE_KEY, QA_FIXED_TS, JSON.stringify(qaBaselineCounts(db)));
      db.exec("COMMIT");
      return { applied: true, skippedReason: null };
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Error asli tetap dilempar.
      }
      throw new QaFixtureError(
        `Gagal memasang fixture QA: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } finally {
    db.close();
  }
}

export function resetAndSeedQaDatabase(options: {
  dbPath: string;
  confirmDevReset: boolean;
  env?: Env;
  repoRoot?: string;
}): { dbPath: string; seeded: boolean; qaApplied: boolean } {
  if (!options.confirmDevReset) {
    throw new QaFixtureError(
      "Reset QA ditolak: wajib menyertakan flag --confirm-dev-reset.",
    );
  }
  const env = options.env ?? process.env;
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  assertSafeDevResetTarget(options.dbPath, env, repoRoot);
  assertExistingDbIsNotOperational(options.dbPath);

  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const target = `${options.dbPath}${suffix}`;
    if (existsSync(target)) {
      rmSync(target, { force: true });
    }
  }

  runMigrations({ dbPath: options.dbPath, backup: "off", repoRoot });
  const seedRes = seedDemo({ dbPath: options.dbPath, allowDemo: true, env, repoRoot });
  const qaRes = applyQaFixtures({ dbPath: options.dbPath, env, repoRoot });
  return { dbPath: options.dbPath, seeded: seedRes.seeded, qaApplied: qaRes.applied };
}

export type SqliteSnapshot = {
  dbPath: string;
  userVersion: number;
  integrity: string;
  foreignKeyViolations: number;
  counts: Record<string, number>;
  stockBalances: Array<{
    productId: number;
    sku: string;
    barcode: string;
    priceRp: number;
    onHand: number;
  }>;
  shifts: Array<{
    id: number;
    cashierId: number;
    closedAtMs: number | null;
    openingCashRp: number | null;
  }>;
  /** Nilai penutupan shift 101 (tunai/QRIS/declared/variance) — bukan sekadar jumlah baris. */
  shiftClosingTotals: Array<{ shiftId: number; methodCode: string; amountRp: number }>;
  closedShiftSummary: Array<{
    shiftId: number;
    declaredCashRp: number | null;
    varianceRp: number | null;
  }>;
  /** Checkout attempt yang masih PREPARED tanpa sale terkait (kasus AC-04.02). */
  preparedAttemptsWithoutSale: Array<{ attemptKey: string; shiftId: number; hasSale: number }>;
  /** Pembayaran: metode + nominal, termasuk verifikasi QRIS_MANUAL. */
  payments: Array<{
    id: number;
    saleId: number;
    methodCode: string;
    amountRp: number;
    evidenceRef: string | null;
    verifiedBy: number | null;
  }>;
};

export function snapshotSqliteState(dbPath: string): SqliteSnapshot {
  const db: DatabaseSync = openDatabase(dbPath, { readOnly: true });
  try {
    const integrity = checkIntegrity(db);
    const tables = Object.keys(EXPECTED_QA_SNAPSHOT.counts);
    const counts: Record<string, number> = {};
    for (const table of tables) {
      counts[table] = Number(
        (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n,
      );
    }
    const stockBalances = db
      .prepare(
        `SELECT p.id AS productId, p.sku, b.barcode, p.price_rp AS priceRp, sb.on_hand AS onHand
         FROM products p
         JOIN product_barcodes b ON b.product_id = p.id
         JOIN stock_balances sb ON sb.product_id = p.id
         ORDER BY p.id`,
      )
      .all() as SqliteSnapshot["stockBalances"];
    const shifts = db
      .prepare(
        `SELECT id, cashier_id AS cashierId, closed_at_ms AS closedAtMs, opening_cash_rp AS openingCashRp
         FROM shifts ORDER BY id`,
      )
      .all() as SqliteSnapshot["shifts"];

    const shiftClosingTotals = db
      .prepare(
        `SELECT shift_id AS shiftId, method_code AS methodCode, amount_rp AS amountRp
         FROM shift_closing_totals ORDER BY shift_id, method_code`,
      )
      .all() as SqliteSnapshot["shiftClosingTotals"];

    const closedShiftSummary = db
      .prepare(
        `SELECT shift_id AS shiftId, declared_cash_rp AS declaredCashRp, variance_rp AS varianceRp
         FROM shift_closings ORDER BY shift_id`,
      )
      .all() as SqliteSnapshot["closedShiftSummary"];

    const preparedAttemptsWithoutSale = db
      .prepare(
        `SELECT ca.attempt_key AS attemptKey, ca.shift_id AS shiftId,
                (SELECT COUNT(*) FROM sales s WHERE s.attempt_key = ca.attempt_key) AS hasSale
         FROM checkout_attempts ca
         WHERE ca.attempt_key NOT IN (SELECT attempt_key FROM sales)
         ORDER BY ca.attempt_key`,
      )
      .all() as SqliteSnapshot["preparedAttemptsWithoutSale"];

    const payments = db
      .prepare(
        `SELECT id, sale_id AS saleId, method_code AS methodCode, amount_rp AS amountRp,
                evidence_ref AS evidenceRef, verified_by AS verifiedBy
         FROM payments ORDER BY id`,
      )
      .all() as SqliteSnapshot["payments"];

    return {
      dbPath,
      userVersion: readUserVersion(db),
      integrity: integrity.integrity,
      foreignKeyViolations: integrity.foreignKeyViolations,
      counts,
      stockBalances: stockBalances.map((r) => ({ ...r })),
      shifts: shifts.map((s) => ({ ...s })),
      shiftClosingTotals: shiftClosingTotals.map((r) => ({ ...r })),
      closedShiftSummary: closedShiftSummary.map((r) => ({ ...r })),
      preparedAttemptsWithoutSale: preparedAttemptsWithoutSale.map((r) => ({ ...r })),
      payments: payments.map((r) => ({ ...r })),
    };
  } finally {
    db.close();
  }
}

