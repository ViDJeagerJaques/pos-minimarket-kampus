import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  createTempDatabase,
  FIXED_NOW,
  fixtureIds,
  insertBaseFixture,
  insertSaleFixture,
  migrateFresh,
} from "../../db/test/helpers.ts";
import { writeAudit } from "./audit.ts";
import { ConflictError, ForbiddenError, NotFoundError, SessionInvalidError, ValidationError } from "./errors.ts";
import { createCatalogService } from "./service.ts";
import type { Actor } from "./types.ts";

/**
 * Bukti service katalog TASK-010 pada SQLite sementara (di luar source tree).
 *
 * Yang TIDAK dibuktikan di sini dan tetap bergantung pada TASK-009/TASK-011:
 * - status HTTP 403 pada endpoint POST/PATCH (belum ada server Express/sesi),
 * - alur UI kasir/admin,
 * - integrasi checkout yang memakai lookup ini.
 */
function setup(deps: { now?: () => number } = {}) {
  const database = createTempDatabase("pos-catalog-test-");
  const db = database.open();
  migrateFresh(database);
  insertBaseFixture(db);
  const service = createCatalogService(db, { now: deps.now ?? (() => FIXED_NOW) });
  const ids = fixtureIds();
  const admin: Actor = { userId: ids.adminId, role: "ADMIN" };
  const cashier: Actor = { userId: ids.cashierId, role: "CASHIER" };
  return { database, db, service, admin, cashier };
}

type Counts = {
  categories: number;
  suppliers: number;
  products: number;
  barcodes: number;
  supplierLinks: number;
  audit: number;
};

function tableCounts(db: DatabaseSync): Counts {
  const count = (table: string): number =>
    Number((db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total);
  return {
    categories: count("categories"),
    suppliers: count("suppliers"),
    products: count("products"),
    barcodes: count("product_barcodes"),
    supplierLinks: count("product_suppliers"),
    audit: count("audit_log"),
  };
}

function isCatalogError(
  error: unknown,
  ctor: new (...args: never[]) => Error,
  code?: string,
  field?: string | null,
): boolean {
  if (!(error instanceof ctor)) {
    return false;
  }
  const candidate = error as Error & { code?: string; field?: string | null; httpStatus?: number };
  if (code !== undefined && candidate.code !== code) {
    return false;
  }
  if (field !== undefined && candidate.field !== field) {
    return false;
  }
  return true;
}

function auditRows(db: DatabaseSync, action: string) {
  return (db
    .prepare("SELECT * FROM audit_log WHERE action = ? ORDER BY id")
    .all(action) as Array<Record<string, unknown>>).map((row) => ({ ...row }));
}

/** `assert.throws` di Node tidak mengembalikan error; helper ini mengambilnya. */
function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("Operasi seharusnya melempar error, tetapi berhasil.");
}

test("AC-02.01: ADMIN menyimpan kategori, supplier, produk, lalu CASHIER dapat mencarinya", () => {
  const { database, db, service, admin, cashier } = setup();
  try {
    const category = service.createCategory(admin, { name: "  Makanan Ringan  " });
    assert.deepEqual({ ...category }, { id: 2, name: "Makanan Ringan" });

    const renamedCategory = service.renameCategory(admin, category.id, { name: "Snack" });
    assert.deepEqual({ ...renamedCategory }, { id: 2, name: "Snack" });

    const supplier = service.createSupplier(admin, { name: "PT Supplier Uji" });
    assert.deepEqual({ ...supplier }, { id: 1, name: "PT Supplier Uji" });
    const renamedSupplier = service.renameSupplier(admin, supplier.id, { name: "CV Supplier Uji" });
    assert.deepEqual({ ...renamedSupplier }, { id: 1, name: "CV Supplier Uji" });

    const product = service.createProduct(admin, {
      categoryId: category.id,
      sku: "SKU-001",
      name: "Keripik Uji",
      priceRp: 5000,
      barcodes: ["0012345678905"],
      supplierIds: [supplier.id],
    });
    assert.equal(product.id, 2);
    assert.equal(product.categoryId, 2);
    assert.equal(product.categoryName, "Snack");
    assert.equal(product.priceRp, 5000);
    assert.equal(product.active, true);
    assert.deepEqual(product.barcodes, ["0012345678905"]);
    assert.deepEqual(product.supplierIds, [1]);
    assert.equal(product.stockOnHand, 0);

    // AC-02.01: kasir dapat mencari produk yang baru dibuat admin.
    const foundByQuery = service.listProducts(cashier, { query: "keripik" });
    assert.equal(foundByQuery.length, 1);
    assert.equal(foundByQuery[0]?.sku, "SKU-001");
    assert.deepEqual(service.listCategories(cashier).map((row) => row.name).sort(), [
      "Fixture Kategori",
      "Snack",
    ]);
    assert.deepEqual(service.listSuppliers(cashier), [{ id: 1, name: "CV Supplier Uji" }]);

    const duplicateSku = catchError(() =>
      service.createProduct(admin, {
        categoryId: category.id,
        sku: "SKU-001",
        name: "Produk Duplikat",
        priceRp: 1000,
      }),
    );
    assert.equal(
      isCatalogError(duplicateSku, ConflictError, "DUPLICATE_SKU", "sku"),
      true,
      "SKU duplikat harus 409 DUPLICATE_SKU",
    );
    assert.equal((duplicateSku as ConflictError).httpStatus, 409);

    // Relasi yang tidak ada ditolak sebelum data tersimpan (AC-02.01).
    const beforeInvalid = tableCounts(db);
    assert.throws(
      () =>
        service.createProduct(admin, {
          categoryId: 999,
          sku: "SKU-BAD-CAT",
          name: "Kategori Hilang",
          priceRp: 1000,
        }),
      (error: unknown) => isCatalogError(error, ValidationError, "VALIDATION_ERROR", "categoryId"),
    );
    assert.throws(
      () =>
        service.createProduct(admin, {
          categoryId: category.id,
          sku: "SKU-BAD-SUP",
          name: "Supplier Hilang",
          priceRp: 1000,
          supplierIds: [999],
        }),
      (error: unknown) => isCatalogError(error, ValidationError, "VALIDATION_ERROR", "supplierIds"),
    );
    assert.deepEqual(tableCounts(db), beforeInvalid);

    // Validasi input backend.
    assert.throws(
      () =>
        service.createProduct(admin, {
          categoryId: category.id,
          sku: "SKU-BAD-NAME",
          name: "   ",
          priceRp: 1000,
        }),
      (error: unknown) => isCatalogError(error, ValidationError, "VALIDATION_ERROR", "name"),
    );
    assert.throws(
      () =>
        service.createProduct(admin, {
          categoryId: category.id,
          sku: "SKU BAD SKU",
          name: "SKU Berspasi",
          priceRp: 1000,
        }),
      (error: unknown) => isCatalogError(error, ValidationError, "VALIDATION_ERROR", "sku"),
    );
    assert.throws(
      () =>
        service.createProduct(admin, {
          categoryId: category.id,
          sku: "SKU-BAD-PRICE",
          name: "Harga Pecahan",
          priceRp: 1000.5,
        }),
      (error: unknown) => isCatalogError(error, ValidationError, "VALIDATION_ERROR", "priceRp"),
    );
    assert.throws(
      () =>
        service.createProduct(admin, {
          categoryId: category.id,
          sku: "SKU-NEG-PRICE",
          name: "Harga Negatif",
          priceRp: -1,
        }),
      (error: unknown) => isCatalogError(error, ValidationError, "VALIDATION_ERROR", "priceRp"),
    );
    assert.throws(
      () =>
        service.createProduct(admin, {
          categoryId: category.id,
          sku: "SKU-BAD-BARCODE",
          name: "Barcode Angka",
          priceRp: 1000,
          barcodes: [12345 as unknown as string],
        }),
      (error: unknown) => isCatalogError(error, ValidationError, "VALIDATION_ERROR", "barcode"),
    );

    // Audit penting tercatat bersama perubahan master.
    assert.deepEqual(
      auditRows(db, "PRODUCT_CREATED").map((row) => row.entity_id),
      ["2"],
    );
    assert.equal(auditRows(db, "PRICE_CHANGED").length, 0);
    assert.equal(auditRows(db, "CATEGORY_RENAMED").length, 1);
    assert.equal(auditRows(db, "SUPPLIER_RENAMED").length, 1);
    assert.equal(auditRows(db, "BARCODE_CHANGED").length, 1);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("AC-02.02: barcode duplikat ditolak oleh constraint DB dan service; nol awal dipertahankan", () => {
  const { database, db, service, admin, cashier } = setup();
  try {
    const productA = service.createProduct(admin, {
      categoryId: 1,
      sku: "SKU-A",
      name: "Produk Barcode A",
      priceRp: 2500,
      barcodes: ["00123"],
    });
    const productB = service.createProduct(admin, {
      categoryId: 1,
      sku: "SKU-B",
      name: "Produk Barcode B",
      priceRp: 3000,
    });

    // Constraint DB menjadi pertahanan terakhir, bukan hanya validasi service.
    assert.throws(
      () =>
        db
          .prepare("INSERT INTO product_barcodes (barcode, product_id) VALUES (?, ?)")
          .run("00123", productB.id),
      /UNIQUE constraint failed: product_barcodes\.barcode/,
    );

    assert.throws(
      () => service.addBarcode(admin, productB.id, "00123"),
      (error: unknown) => isCatalogError(error, ConflictError, "DUPLICATE_BARCODE", "barcode"),
    );

    // Produk baru dengan barcode duplikat harus rollback utuh, bukan menyisakan produk yatim.
    const before = tableCounts(db);
    assert.throws(
      () =>
        service.createProduct(admin, {
          categoryId: 1,
          sku: "SKU-C",
          name: "Produk Barcode Duplikat",
          priceRp: 1000,
          barcodes: ["00123"],
        }),
      (error: unknown) => isCatalogError(error, ConflictError, "DUPLICATE_BARCODE"),
    );
    assert.deepEqual(tableCounts(db), before);

    // Duplikat di dalam satu permintaan ditolak sebelum menyentuh database.
    assert.throws(
      () =>
        service.createProduct(admin, {
          categoryId: 1,
          sku: "SKU-D",
          name: "Barcode Ganda Internal",
          priceRp: 1000,
          barcodes: ["00123", "00123"],
        }),
      (error: unknown) => isCatalogError(error, ValidationError, "VALIDATION_ERROR", "barcodes"),
    );

    // Nol awal tidak boleh dipotong/dinormalisasi menjadi angka.
    const scanned = service.findByBarcode(cashier, "00123");
    assert.equal(scanned?.id, productA.id);
    assert.deepEqual(scanned?.barcodes, ["00123"]);
    assert.equal(service.findByBarcode(cashier, "123"), null);

    // AC-02.02: selama X masih dipakai produk A (walau nonaktif), X tidak bisa
    // dipasang ke produk lain dan scan tetap mengarah ke produk A.
    service.updateProduct(admin, productA.id, { active: false });
    assert.throws(
      () => service.addBarcode(admin, productB.id, "00123"),
      (error: unknown) => isCatalogError(error, ConflictError, "DUPLICATE_BARCODE"),
    );
    assert.equal(service.findByBarcode(cashier, "00123"), null);

    service.updateProduct(admin, productA.id, { active: true });
    const afterReactivate = service.findByBarcode(cashier, "00123");
    assert.equal(afterReactivate?.id, productA.id);
    assert.equal(afterReactivate?.active, true);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("AC-02.02/AC-03.01: lookup hanya produk aktif; nonaktif, kode asing, dan includeInactive CASHIER ditolak", () => {
  const { database, db, service, admin, cashier } = setup();
  try {
    const inactive = service.createProduct(admin, {
      categoryId: 1,
      sku: "SKU-OFF",
      name: "Produk Nonaktif Uji",
      priceRp: 1500,
      barcodes: ["00999888"],
    });
    const active = service.createProduct(admin, {
      categoryId: 1,
      sku: "SKU-ON",
      name: "Produk Aktif Uji",
      priceRp: 2000,
      barcodes: ["00777"],
    });
    service.updateProduct(admin, inactive.id, { active: false });

    // Scan kode valid milik produk nonaktif tidak boleh menambah item.
    assert.equal(service.findByBarcode(cashier, "00999888"), null);
    // Kode tak dikenal juga null, bukan melempar error ke keranjang.
    assert.equal(service.findByBarcode(cashier, "TIDAK-ADA"), null);
    // Pencarian manual hanya menampilkan produk aktif.
    assert.deepEqual(
      service.listProducts(cashier, { query: "Uji" }).map((row) => row.sku),
      ["SKU-ON"],
    );
    assert.throws(
      () => service.getProduct(cashier, inactive.id),
      (error: unknown) => isCatalogError(error, NotFoundError, "NOT_FOUND"),
    );
    assert.throws(
      () => service.listProducts(cashier, { query: "Produk", includeInactive: true }),
      (error: unknown) => isCatalogError(error, ForbiddenError, "FORBIDDEN"),
    );

    // ADMIN tetap dapat mengelola produk nonaktif.
    const adminView = service.findByBarcode(admin, "00999888", { includeInactive: true });
    assert.equal(adminView?.id, inactive.id);
    assert.equal(adminView?.active, false);
    assert.deepEqual(
      service.listProducts(admin, { query: "Uji", includeInactive: true }).map((row) => row.sku).sort(),
      ["SKU-OFF", "SKU-ON"],
    );
    assert.equal(service.getProduct(admin, inactive.id, { includeInactive: true }).active, false);
    assert.equal(service.findByBarcode(cashier, "00777")?.id, active.id);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("AC-02.03: perubahan harga hanya mengubah master + audit, snapshot penjualan tetap", () => {
  const { database, db, service, admin, cashier } = setup();
  try {
    insertSaleFixture(db);
    const saleBefore = {
      ...(db.prepare("SELECT * FROM sales WHERE id = 20").get() as Record<string, unknown>),
    };
    const itemBefore = {
      ...(db.prepare("SELECT * FROM sale_items WHERE sale_id = 20").get() as Record<string, unknown>),
    };
    assert.equal(itemBefore.unit_price_rp, 2500);
    assert.equal(itemBefore.line_total_rp, 5000);

    const updated = service.updateProduct(admin, 1, { priceRp: 3000 });
    assert.equal(updated.priceRp, 3000);

    // Riwayat penjualan tidak boleh ikut berubah.
    assert.deepEqual(
      { ...(db.prepare("SELECT * FROM sales WHERE id = 20").get() as Record<string, unknown>) },
      saleBefore,
    );
    assert.deepEqual(
      {
        ...(db.prepare("SELECT * FROM sale_items WHERE sale_id = 20").get() as Record<string, unknown>),
      },
      itemBefore,
    );

    // Keranjang baru memakai harga master yang baru.
    const lookup = service.listProducts(cashier, { query: "Fixture Produk" });
    assert.equal(lookup[0]?.priceRp, 3000);

    const priceAudit = auditRows(db, "PRICE_CHANGED");
    assert.equal(priceAudit.length, 1);
    assert.equal(priceAudit[0]?.actor_id, 1);
    assert.equal(priceAudit[0]?.entity_type, "products");
    assert.equal(priceAudit[0]?.entity_id, "1");
    assert.equal(priceAudit[0]?.created_at_ms, FIXED_NOW);
    const details = JSON.parse(String(priceAudit[0]?.details)) as Record<string, unknown>;
    assert.equal(details.oldPriceRp, 2500);
    assert.equal(details.newPriceRp, 3000);
    assert.equal(details.sku, "FX-001");

    // Harga tidak berubah = tidak ada audit palsu.
    service.updateProduct(admin, 1, { priceRp: 3000 });
    assert.equal(auditRows(db, "PRICE_CHANGED").length, 1);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("Otorisasi: CASHIER ditolak 403 tanpa perubahan data; aktor nonaktif/basi ditolak 401", () => {
  const { database, db, service, admin, cashier } = setup();
  try {
    const before = tableCounts(db);
    const writeOperations: Array<[string, () => unknown]> = [
      ["createCategory", () => service.createCategory(cashier, { name: "Kasir Tidak Boleh" })],
      ["renameCategory", () => service.renameCategory(cashier, 1, { name: "Kasir Tidak Boleh" })],
      ["createSupplier", () => service.createSupplier(cashier, { name: "Kasir Tidak Boleh" })],
      ["renameSupplier", () => service.renameSupplier(cashier, 1, { name: "Kasir Tidak Boleh" })],
      [
        "createProduct",
        () =>
          service.createProduct(cashier, {
            categoryId: 1,
            sku: "SKU-KASIR",
            name: "Dibuat Kasir",
            priceRp: 1000,
          }),
      ],
      ["updateProduct", () => service.updateProduct(cashier, 1, { priceRp: 1 })],
      ["setProductSuppliers", () => service.setProductSuppliers(cashier, 1, [])],
      ["addBarcode", () => service.addBarcode(cashier, 1, "00123")],
      ["removeBarcode", () => service.removeBarcode(cashier, 1, "00123")],
    ];

    for (const [name, operation] of writeOperations) {
      const error = catchError(operation);
      assert.equal(
        isCatalogError(error, ForbiddenError, "FORBIDDEN"),
        true,
        `${name} harus ditolak untuk CASHIER`,
      );
      assert.equal((error as ForbiddenError).httpStatus, 403, `${name} harus memetakan ke HTTP 403`);
    }
    assert.deepEqual(tableCounts(db), before, "penolakan role tidak boleh mengubah data");

    // ADMIN dapat menulis (kontrol positif agar tes tidak lulus karena semua ditolak).
    service.createCategory(admin, { name: "Kategori Kontrol" });
    const beforeSpoof = tableCounts(db);

    // Actor harus berasal dari sesi/akun yang valid, bukan body request.
    assert.throws(
      () => service.createCategory({ userId: 999, role: "ADMIN" }, { name: "Hantu" }),
      (error: unknown) => isCatalogError(error, SessionInvalidError, "SESSION_INVALID"),
    );
    assert.throws(
      () => service.createCategory({ userId: 0, role: "ADMIN" }, { name: "Nol" }),
      (error: unknown) => isCatalogError(error, ValidationError, "VALIDATION_ERROR", "actor.userId"),
    );
    assert.throws(
      () =>
        service.createCategory(
          { userId: 1, role: "SUPERVISOR" } as unknown as Actor,
          { name: "Role Asing" },
        ),
      (error: unknown) => isCatalogError(error, ValidationError, "VALIDATION_ERROR", "actor.role"),
    );

    // Role dari objek actor tidak boleh dipercaya: harus sama dengan role tersimpan.
    const spoofedAdmin: Actor = { userId: fixtureIds().cashierId, role: "ADMIN" };
    assert.throws(
      () => service.listProducts(spoofedAdmin, { includeInactive: true }),
      (error: unknown) => isCatalogError(error, SessionInvalidError, "SESSION_INVALID"),
    );
    assert.throws(
      () => service.createCategory(spoofedAdmin, { name: "Kategori Palsu" }),
      (error: unknown) => isCatalogError(error, SessionInvalidError, "SESSION_INVALID"),
    );
    assert.deepEqual(tableCounts(db), beforeSpoof, "actor palsu tidak boleh mengubah data");

    db.prepare("UPDATE users SET active = 0 WHERE id = 1").run();
    assert.throws(
      () => service.createCategory(admin, { name: "Akun Nonaktif" }),
      (error: unknown) => isCatalogError(error, SessionInvalidError, "SESSION_INVALID"),
    );
    assert.throws(
      () => service.listProducts(admin, {}),
      (error: unknown) => isCatalogError(error, SessionInvalidError, "SESSION_INVALID"),
    );
  } finally {
    db.close();
    database.cleanup();
  }
});

test("Audit atomik: kegagalan audit membatalkan perubahan domain; event di luar daftar ditolak", () => {
  const { database, db, service } = setup({ now: () => -1 });
  try {
    const admin: Actor = { userId: fixtureIds().adminId, role: "ADMIN" };
    const before = tableCounts(db);

    assert.throws(
      () => service.createCategory(admin, { name: "Kategori Gagal Audit" }),
      /CHECK constraint failed|NOT NULL constraint failed/,
    );
    assert.throws(
      () =>
        service.createProduct(admin, {
          categoryId: 1,
          sku: "SKU-AUDIT-FAIL",
          name: "Produk Gagal Audit",
          priceRp: 1000,
          barcodes: ["00555"],
        }),
      /CHECK constraint failed|NOT NULL constraint failed/,
    );
    assert.deepEqual(tableCounts(db), before, "tidak boleh ada mutasi tanpa audit");

    assert.throws(
      () =>
        writeAudit(db, {
          actorId: fixtureIds().adminId,
          action: "DELETE_EVERYTHING" as never,
          entityType: "products",
          entityId: 1,
          details: {},
          nowMs: FIXED_NOW,
        }),
      /Event audit tidak terdaftar/,
    );
  } finally {
    db.close();
    database.cleanup();
  }
});

test("Pemeliharaan barcode/supplier, pencarian manual, escape LIKE, dan limit", () => {
  const { database, db, service, admin, cashier } = setup();
  try {
    const product = service.createProduct(admin, {
      categoryId: 1,
      sku: "SKU-MAINT",
      name: "Produk Pemeliharaan",
      priceRp: 4500,
      barcodes: ["0001"],
    });
    const supplier = service.createSupplier(admin, { name: "Supplier Pemeliharaan" });

    const withBarcode = service.addBarcode(admin, product.id, "0002");
    assert.deepEqual(withBarcode.barcodes, ["0001", "0002"]);
    assert.equal(auditRows(db, "BARCODE_CHANGED").filter((row) => row.entity_id === String(product.id)).length, 2);

    const removed = service.removeBarcode(admin, product.id, "0002");
    assert.deepEqual(removed.barcodes, ["0001"]);
    assert.throws(
      () => service.removeBarcode(admin, product.id, "0002"),
      (error: unknown) => isCatalogError(error, NotFoundError, "NOT_FOUND"),
    );

    const linked = service.setProductSuppliers(admin, product.id, [supplier.id]);
    assert.deepEqual(linked.supplierIds, [supplier.id]);
    assert.deepEqual(service.setProductSuppliers(admin, product.id, []).supplierIds, []);

    // Pencarian SKU case-insensitive dan aman terhadap wildcard LIKE.
    assert.equal(service.listProducts(cashier, { query: "sku-maint" }).length, 1);
    service.createProduct(admin, {
      categoryId: 1,
      sku: "SKU-PERSEN",
      name: "Diskon 100%",
      priceRp: 100,
    });
    assert.deepEqual(
      service.listProducts(cashier, { query: "100%" }).map((row) => row.sku),
      ["SKU-PERSEN"],
    );
    assert.deepEqual(
      service.listProducts(cashier, { query: "%" }).map((row) => row.sku),
      ["SKU-PERSEN"],
    );

    assert.throws(
      () => service.listProducts(cashier, { limit: 0 }),
      (error: unknown) => isCatalogError(error, ValidationError, "VALIDATION_ERROR", "limit"),
    );
    assert.throws(
      () => service.listProducts(cashier, { limit: 1.5 }),
      (error: unknown) => isCatalogError(error, ValidationError, "VALIDATION_ERROR", "limit"),
    );
    // limit di atas batas dipotong ke 100, bukan error.
    assert.equal(service.listProducts(cashier, { limit: 500 }).length <= 100, true);
  } finally {
    db.close();
    database.cleanup();
  }
});