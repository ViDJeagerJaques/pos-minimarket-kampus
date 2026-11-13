import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./db.ts";
import { assertOutsideSourceTree, REPO_ROOT, type Env } from "./paths.ts";

export const DEMO_SEED_KEY = "demo-synthetic-v1";
export const DEMO_OPENING_BATCH_REF = "DEMO-OPENING-2026-11-13";

/**
 * Timestamp tetap agar seed deterministik. Nilainya hanya fixture DEMO dan
 * tidak boleh dipakai sebagai waktu operasional.
 */
const DEMO_TS = 1_762_992_000_000;

/**
 * Hash sengaja tidak valid untuk login. TASK-009 hanya boleh menerima format
 * hash yang didukung (mis. `scrypt$...`); string ini harus ditolak sehingga
 * akun demo tidak bisa dipakai masuk sebelum bootstrap akun resmi dibuat.
 */
export const DEMO_PASSWORD_HASH_PLACEHOLDER = "DEMO_LOCKED_NO_LOGIN";

export type SeedOptions = {
  dbPath: string;
  /** Harus true; CLI hanya mengirim true bila flag --demo diberikan. */
  allowDemo: boolean;
  env?: Env;
  repoRoot?: string;
  now?: () => number;
  log?: (line: string) => void;
};

export type SeedResult = {
  dbPath: string;
  seeded: boolean;
  skippedReason: string | null;
  counts: Record<string, number>;
};

export class SeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedError";
  }
}

type DemoProduct = {
  id: number;
  categoryId: number;
  sku: string;
  name: string;
  priceRp: number;
  barcode: string;
  supplierId: number;
  openingQuantity: number;
};

const DEMO_USERS = [
  { id: 1, username: "demo.admin", role: "ADMIN" },
  { id: 2, username: "demo.kasir.pagi", role: "CASHIER" },
  { id: 3, username: "demo.kasir.sore", role: "CASHIER" },
] as const;

const DEMO_CATEGORIES = [
  { id: 1, name: "DEMO Minuman" },
  { id: 2, name: "DEMO Makanan Ringan" },
  { id: 3, name: "DEMO Sembako" },
] as const;

const DEMO_SUPPLIERS = [
  { id: 1, name: "DEMO PT Sumber Sintetis" },
  { id: 2, name: "DEMO CV Distribusi Uji" },
] as const;

const DEMO_PRODUCTS: DemoProduct[] = [
  {
    id: 1,
    categoryId: 1,
    sku: "DEMO-001",
    name: "DEMO Air Mineral Botol 600 ml",
    priceRp: 3000,
    barcode: "0000000000017",
    supplierId: 1,
    openingQuantity: 24,
  },
  {
    id: 2,
    categoryId: 1,
    sku: "DEMO-002",
    name: "DEMO Teh Kemasan 350 ml",
    priceRp: 4000,
    barcode: "8991234567890",
    supplierId: 1,
    openingQuantity: 12,
  },
  {
    id: 3,
    categoryId: 2,
    sku: "DEMO-003",
    name: "DEMO Keripik Singkong 60 g",
    priceRp: 5000,
    barcode: "0000000000034",
    supplierId: 2,
    openingQuantity: 8,
  },
  {
    id: 4,
    categoryId: 3,
    sku: "DEMO-004",
    name: "DEMO Beras Premium 1 kg",
    priceRp: 15000,
    barcode: "8999876543210",
    supplierId: 2,
    openingQuantity: 5,
  },
];

function tableExists(db: DatabaseSync, name: string): boolean {
  const row = db
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { found: number } | undefined;
  return row !== undefined;
}

function countRows(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number };
  return Number(row.total);
}

function collectCounts(db: DatabaseSync): Record<string, number> {
  const tables = [
    "users",
    "categories",
    "suppliers",
    "products",
    "product_barcodes",
    "product_suppliers",
    "inventory_movements",
    "sales",
    "shifts",
  ];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    counts[table] = tableExists(db, table) ? countRows(db, table) : 0;
  }
  return counts;
}

/**
 * Seed sintetis berlabel DEMO. Pengaman berlapis:
 *   1. flag --demo wajib (allowDemo=true);
 *   2. NODE_ENV=production ditolak;
 *   3. POS_DB_PROFILE=operational ditolak;
 *   4. database harus kosong dari data bisnis dan belum pernah di-seed.
 */
export function seedDemo(options: SeedOptions): SeedResult {
  const env = options.env ?? process.env;
  if (!options.allowDemo) {
    throw new SeedError("Seed demo ditolak: jalankan hanya dengan flag --demo.");
  }
  if (env.NODE_ENV === "production") {
    throw new SeedError("Seed demo ditolak: NODE_ENV=production.");
  }
  if (env.POS_DB_PROFILE === "operational") {
    throw new SeedError("Seed demo ditolak: POS_DB_PROFILE=operational.");
  }
  assertOutsideSourceTree(options.dbPath, options.repoRoot ?? REPO_ROOT);

  const log = options.log ?? (() => {});
  const now = options.now ?? (() => Date.now());
  const db = openDatabase(options.dbPath);
  try {
    if (!tableExists(db, "products") || !tableExists(db, "schema_migrations")) {
      throw new SeedError("Skema belum tersedia. Jalankan `db:migrate` sebelum seed demo.");
    }

    if (tableExists(db, "demo_seed_runs")) {
      const already = db
        .prepare("SELECT 1 AS found FROM demo_seed_runs WHERE run_key = ?")
        .get(DEMO_SEED_KEY) as { found: number } | undefined;
      if (already) {
        return {
          dbPath: options.dbPath,
          seeded: false,
          skippedReason: `Seed ${DEMO_SEED_KEY} sudah pernah dijalankan.`,
          counts: collectCounts(db),
        };
      }
    }

    const before = collectCounts(db);
    const nonEmpty = Object.entries(before).filter(([, total]) => total > 0);
    if (nonEmpty.length > 0) {
      throw new SeedError(
        "Seed demo hanya untuk database kosong. Tabel berisi data: " +
          nonEmpty.map(([table, total]) => `${table}=${total}`).join(", "),
      );
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(
        `CREATE TABLE IF NOT EXISTS demo_seed_runs (
           run_key TEXT PRIMARY KEY,
           applied_at_ms INTEGER NOT NULL CHECK (applied_at_ms >= 0)
         ) STRICT`,
      );

      const insertUser = db.prepare(
        `INSERT INTO users (id, username, password_hash, role, active, created_at_ms)
         VALUES (?, ?, ?, ?, 1, ?)`,
      );
      for (const user of DEMO_USERS) {
        insertUser.run(user.id, user.username, DEMO_PASSWORD_HASH_PLACEHOLDER, user.role, DEMO_TS);
      }

      const insertCategory = db.prepare("INSERT INTO categories (id, name) VALUES (?, ?)");
      for (const category of DEMO_CATEGORIES) {
        insertCategory.run(category.id, category.name);
      }

      const insertSupplier = db.prepare("INSERT INTO suppliers (id, name) VALUES (?, ?)");
      for (const supplier of DEMO_SUPPLIERS) {
        insertSupplier.run(supplier.id, supplier.name);
      }

      const insertProduct = db.prepare(
        `INSERT INTO products (id, category_id, sku, name, price_rp, active)
         VALUES (?, ?, ?, ?, ?, 1)`,
      );
      const insertBarcode = db.prepare(
        "INSERT INTO product_barcodes (barcode, product_id) VALUES (?, ?)",
      );
      const insertProductSupplier = db.prepare(
        "INSERT INTO product_suppliers (product_id, supplier_id) VALUES (?, ?)",
      );
      const insertOpeningMovement = db.prepare(
        `INSERT INTO inventory_movements (
           product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms
         ) VALUES (?, 'OPENING', ?, ?, 1, ?)`,
      );
      for (const product of DEMO_PRODUCTS) {
        insertProduct.run(
          product.id,
          product.categoryId,
          product.sku,
          product.name,
          product.priceRp,
        );
        insertBarcode.run(product.barcode, product.id);
        insertProductSupplier.run(product.id, product.supplierId);
        insertOpeningMovement.run(
          product.id,
          product.openingQuantity,
          DEMO_OPENING_BATCH_REF,
          DEMO_TS,
        );
      }

      db.prepare("INSERT INTO demo_seed_runs (run_key, applied_at_ms) VALUES (?, ?)").run(
        DEMO_SEED_KEY,
        now(),
      );
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Error asli tetap dilempar.
      }
      throw new SeedError(
        `Seed demo gagal dan di-rollback: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const counts = collectCounts(db);
    log(`Seed ${DEMO_SEED_KEY} diterapkan (data sintetis DEMO).`);
    return { dbPath: options.dbPath, seeded: true, skippedReason: null, counts };
  } finally {
    db.close();
  }
}