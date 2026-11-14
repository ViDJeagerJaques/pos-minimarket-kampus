import type { DatabaseSync } from "node:sqlite";
import { writeAudit } from "./audit.ts";
import { assertActor, canSeeInactive, requireAdmin } from "./authz.ts";
import {
  ConflictError,
  NotFoundError,
  SessionInvalidError,
  ValidationError,
} from "./errors.ts";
import type {
  Actor,
  CategoryDto,
  CreateCategoryInput,
  CreateProductInput,
  CreateSupplierInput,
  LookupOptions,
  ProductDto,
  SupplierDto,
  UpdateProductInput,
} from "./types.ts";

const MAX_NAME_LENGTH = 120;
const MAX_SKU_LENGTH = 64;
const MAX_BARCODE_LENGTH = 64;
const MAX_QUERY_LENGTH = 80;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type ProductRow = {
  id: number;
  category_id: number;
  category_name: string;
  sku: string;
  name: string;
  price_rp: number;
  active: number;
  stock_on_hand: number;
};

function normalizeText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} harus berupa teks.`, field);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(`${field} tidak boleh kosong.`, field);
  }
  if (trimmed.length > maxLength) {
    throw new ValidationError(`${field} maksimum ${maxLength} karakter.`, field);
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new ValidationError(`${field} memuat karakter kontrol.`, field);
  }
  return trimmed;
}

/**
 * Barcode diperlakukan sebagai string agar nol di depan tidak hilang dan angka
 * yang dikirim sebagai number ditolak (DATABASE.md §7, DATA_PROTECTION.md §4).
 */
function normalizeBarcode(value: unknown, field = "barcode"): string {
  if (typeof value !== "string") {
    throw new ValidationError("Barcode harus berupa teks, bukan angka.", field);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("Barcode tidak boleh kosong.", field);
  }
  if (trimmed.length > MAX_BARCODE_LENGTH) {
    throw new ValidationError(`Barcode maksimum ${MAX_BARCODE_LENGTH} karakter.`, field);
  }
  if (!/^[\x21-\x7e]+$/.test(trimmed)) {
    throw new ValidationError("Barcode hanya boleh karakter ASCII yang terlihat tanpa spasi.", field);
  }
  return trimmed;
}

function normalizeSku(value: unknown): string {
  const sku = normalizeText(value, "sku", MAX_SKU_LENGTH);
  if (/\s/.test(sku)) {
    throw new ValidationError("SKU tidak boleh memuat spasi.", "sku");
  }
  return sku;
}

/** Uang disimpan sebagai INTEGER rupiah; float/NaN/negatif ditolak. */
function assertPriceRp(value: unknown, field = "priceRp"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError(
      `${field} harus bilangan bulat rupiah yang tidak negatif.`,
      field,
    );
  }
  return value;
}

function assertId(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError(`${field} harus ID positif.`, field);
  }
  return value;
}

function assertLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError("limit harus bilangan bulat positif.", "limit");
  }
  return Math.min(value, MAX_LIMIT);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function isUniqueConstraint(message: string, column: string): boolean {
  return message.includes("UNIQUE constraint failed") && message.includes(column);
}

function isForeignKeyConstraint(message: string): boolean {
  return message.includes("FOREIGN KEY constraint failed");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type CatalogServiceDeps = {
  /** Jam backend (epoch ms). Dapat diganti pada tes, bukan dari input klien. */
  now?: () => number;
};

export type CatalogService = ReturnType<typeof createCatalogService>;

export function createCatalogService(db: DatabaseSync, deps: CatalogServiceDeps = {}) {
  const now = deps.now ?? (() => Date.now());

  function withTransaction<T>(operation: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Error asli tetap dilempar.
      }
      throw error;
    }
  }

  /**
   * Defense-in-depth: actor harus berasal dari akun aktif dan `role` yang
   * dikirim harus sama dengan role tersimpan. TASK-009 tetap wajib
   * memverifikasi token sesi; cek ini mencegah penulisan dengan sesi basi atau
   * objek actor yang dipalsukan pemanggil.
   */
  function assertActiveActor(actor: Actor): void {
    const row = db
      .prepare("SELECT role, active FROM users WHERE id = ?")
      .get(actor.userId) as { role: string; active: number } | undefined;
    if (!row || Number(row.active) !== 1 || String(row.role) !== actor.role) {
      throw new SessionInvalidError();
    }
  }

  /** Validasi bentuk actor lalu cocokkan dengan akun tersimpan (semua operasi). */
  function requireVerifiedActor(actorInput: Actor): Actor {
    const actor = assertActor(actorInput);
    assertActiveActor(actor);
    return actor;
  }

  function requireCategory(categoryId: number): void {
    const row = db.prepare("SELECT 1 AS found FROM categories WHERE id = ?").get(categoryId) as
      | { found: number }
      | undefined;
    if (!row) {
      throw new ValidationError("Kategori tidak ditemukan.", "categoryId");
    }
  }

  function requireSuppliers(supplierIds: number[]): void {
    const statement = db.prepare("SELECT 1 AS found FROM suppliers WHERE id = ?");
    for (const supplierId of supplierIds) {
      if (!statement.get(supplierId)) {
        throw new ValidationError(`Supplier ${supplierId} tidak ditemukan.`, "supplierIds");
      }
    }
  }

  function requireProductRow(productId: number): ProductRow {
    const row = db
      .prepare(
        `SELECT p.id, p.category_id, c.name AS category_name, p.sku, p.name,
                p.price_rp, p.active,
                COALESCE((SELECT SUM(m.delta) FROM inventory_movements m
                          WHERE m.product_id = p.id), 0) AS stock_on_hand
         FROM products p JOIN categories c ON c.id = p.category_id
         WHERE p.id = ?`,
      )
      .get(productId) as ProductRow | undefined;
    if (!row) {
      throw new NotFoundError("Produk tidak ditemukan.");
    }
    return row;
  }

  function toProductDto(row: ProductRow): ProductDto {
    const barcodes = (
      db
        .prepare("SELECT barcode FROM product_barcodes WHERE product_id = ? ORDER BY barcode")
        .all(row.id) as Array<{ barcode: string }>
    ).map((entry) => entry.barcode);
    const supplierIds = (
      db
        .prepare("SELECT supplier_id FROM product_suppliers WHERE product_id = ? ORDER BY supplier_id")
        .all(row.id) as Array<{ supplier_id: number }>
    ).map((entry) => Number(entry.supplier_id));
    return {
      id: Number(row.id),
      categoryId: Number(row.category_id),
      categoryName: String(row.category_name),
      sku: String(row.sku),
      name: String(row.name),
      priceRp: Number(row.price_rp),
      active: Number(row.active) === 1,
      barcodes,
      supplierIds,
      stockOnHand: Number(row.stock_on_hand),
    };
  }

  function normalizeBarcodeList(barcodes: string[] | undefined): string[] {
    if (barcodes === undefined) {
      return [];
    }
    if (!Array.isArray(barcodes)) {
      throw new ValidationError("barcodes harus berupa daftar teks.", "barcodes");
    }
    const normalized: string[] = [];
    for (const barcode of barcodes) {
      const value = normalizeBarcode(barcode);
      if (normalized.includes(value)) {
        throw new ValidationError(`Barcode ganda di dalam permintaan: ${value}.`, "barcodes");
      }
      normalized.push(value);
    }
    return normalized;
  }

  function normalizeSupplierIds(supplierIds: number[] | undefined): number[] {
    if (supplierIds === undefined) {
      return [];
    }
    if (!Array.isArray(supplierIds)) {
      throw new ValidationError("supplierIds harus berupa daftar ID.", "supplierIds");
    }
    const normalized: number[] = [];
    for (const supplierId of supplierIds) {
      const value = assertId(supplierId, "supplierIds");
      if (!normalized.includes(value)) {
        normalized.push(value);
      }
    }
    return normalized;
  }

  // ---------------------------------------------------------------------------
  // Kategori & supplier
  // ---------------------------------------------------------------------------

  function listCategories(actorInput: Actor): CategoryDto[] {
    requireVerifiedActor(actorInput);
    const rows = db
      .prepare("SELECT id, name FROM categories ORDER BY name COLLATE NOCASE")
      .all() as Array<{ id: number; name: string }>;
    return rows.map((row) => ({ id: Number(row.id), name: String(row.name) }));
  }

  function createCategory(actorInput: Actor, input: CreateCategoryInput): CategoryDto {
    const actor = requireVerifiedActor(actorInput);
    requireAdmin(actor);
    const name = normalizeText(input?.name, "name", MAX_NAME_LENGTH);
    return withTransaction(() => {
      assertActiveActor(actor);
      let result: { lastInsertRowid: number | bigint };
      try {
        result = db.prepare("INSERT INTO categories (name) VALUES (?)").run(name);
      } catch (error) {
        if (isUniqueConstraint(errorMessage(error), "categories.name")) {
          throw new ConflictError("DUPLICATE_CATEGORY", "Nama kategori sudah dipakai.", "name");
        }
        throw error;
      }
      const categoryId = Number(result.lastInsertRowid);
      writeAudit(db, {
        actorId: actor.userId,
        action: "CATEGORY_CREATED",
        entityType: "categories",
        entityId: categoryId,
        details: { name },
        nowMs: now(),
      });
      return { id: categoryId, name };
    });
  }

  function renameCategory(actorInput: Actor, categoryId: number, input: CreateCategoryInput): CategoryDto {
    const actor = requireVerifiedActor(actorInput);
    requireAdmin(actor);
    const id = assertId(categoryId, "categoryId");
    const name = normalizeText(input?.name, "name", MAX_NAME_LENGTH);
    return withTransaction(() => {
      assertActiveActor(actor);
      const current = db.prepare("SELECT name FROM categories WHERE id = ?").get(id) as
        | { name: string }
        | undefined;
      if (!current) {
        throw new NotFoundError("Kategori tidak ditemukan.");
      }
      if (String(current.name) === name) {
        return { id, name };
      }
      try {
        db.prepare("UPDATE categories SET name = ? WHERE id = ?").run(name, id);
      } catch (error) {
        if (isUniqueConstraint(errorMessage(error), "categories.name")) {
          throw new ConflictError("DUPLICATE_CATEGORY", "Nama kategori sudah dipakai.", "name");
        }
        throw error;
      }
      writeAudit(db, {
        actorId: actor.userId,
        action: "CATEGORY_RENAMED",
        entityType: "categories",
        entityId: id,
        details: { oldName: String(current.name), newName: name },
        nowMs: now(),
      });
      return { id, name };
    });
  }

  function listSuppliers(actorInput: Actor): SupplierDto[] {
    requireVerifiedActor(actorInput);
    const rows = db
      .prepare("SELECT id, name FROM suppliers ORDER BY name COLLATE NOCASE")
      .all() as Array<{ id: number; name: string }>;
    return rows.map((row) => ({ id: Number(row.id), name: String(row.name) }));
  }

  function createSupplier(actorInput: Actor, input: CreateSupplierInput): SupplierDto {
    const actor = requireVerifiedActor(actorInput);
    requireAdmin(actor);
    const name = normalizeText(input?.name, "name", MAX_NAME_LENGTH);
    return withTransaction(() => {
      assertActiveActor(actor);
      const result = db.prepare("INSERT INTO suppliers (name) VALUES (?)").run(name);
      const supplierId = Number(result.lastInsertRowid);
      writeAudit(db, {
        actorId: actor.userId,
        action: "SUPPLIER_CREATED",
        entityType: "suppliers",
        entityId: supplierId,
        details: { name },
        nowMs: now(),
      });
      return { id: supplierId, name };
    });
  }

  function renameSupplier(actorInput: Actor, supplierId: number, input: CreateSupplierInput): SupplierDto {
    const actor = requireVerifiedActor(actorInput);
    requireAdmin(actor);
    const id = assertId(supplierId, "supplierId");
    const name = normalizeText(input?.name, "name", MAX_NAME_LENGTH);
    return withTransaction(() => {
      assertActiveActor(actor);
      const current = db.prepare("SELECT name FROM suppliers WHERE id = ?").get(id) as
        | { name: string }
        | undefined;
      if (!current) {
        throw new NotFoundError("Supplier tidak ditemukan.");
      }
      if (String(current.name) === name) {
        return { id, name };
      }
      db.prepare("UPDATE suppliers SET name = ? WHERE id = ?").run(name, id);
      writeAudit(db, {
        actorId: actor.userId,
        action: "SUPPLIER_RENAMED",
        entityType: "suppliers",
        entityId: id,
        details: { oldName: String(current.name), newName: name },
        nowMs: now(),
      });
      return { id, name };
    });
  }

  // ---------------------------------------------------------------------------
  // Produk & barcode
  // ---------------------------------------------------------------------------

  function listProducts(actorInput: Actor, options: LookupOptions = {}): ProductDto[] {
    const actor = requireVerifiedActor(actorInput);
    const includeInactive = canSeeInactive(actor, options.includeInactive);
    const limit = assertLimit(options.limit);
    const barcode =
      options.barcode === undefined || options.barcode === "" ? null : normalizeBarcode(options.barcode);
    const query =
      options.query === undefined || options.query.trim() === ""
        ? null
        : normalizeText(options.query, "query", MAX_QUERY_LENGTH);
    const pattern = query === null ? null : `%${escapeLike(query)}%`;

    const rows = db
      .prepare(
        `SELECT p.id, p.category_id, c.name AS category_name, p.sku, p.name,
                p.price_rp, p.active,
                COALESCE((SELECT SUM(m.delta) FROM inventory_movements m
                          WHERE m.product_id = p.id), 0) AS stock_on_hand
         FROM products p
         JOIN categories c ON c.id = p.category_id
         WHERE (? = 1 OR p.active = 1)
           AND (? IS NULL OR p.name LIKE ? ESCAPE '\\' COLLATE NOCASE
                OR p.sku LIKE ? ESCAPE '\\' COLLATE NOCASE)
           AND (? IS NULL OR EXISTS (
                 SELECT 1 FROM product_barcodes b
                 WHERE b.product_id = p.id AND b.barcode = ?))
         ORDER BY p.active DESC, p.name COLLATE NOCASE
         LIMIT ?`,
      )
      .all(
        includeInactive ? 1 : 0,
        pattern,
        pattern,
        pattern,
        barcode,
        barcode,
        limit,
      ) as ProductRow[];
    return rows.map(toProductDto);
  }

  function getProduct(actorInput: Actor, productId: number, options: LookupOptions = {}): ProductDto {
    const actor = requireVerifiedActor(actorInput);
    const includeInactive = canSeeInactive(actor, options.includeInactive);
    const id = assertId(productId, "productId");
    const row = requireProductRow(id);
    if (!includeInactive && Number(row.active) !== 1) {
      // CASHIER tidak boleh mengetahui produk nonaktif lewat lookup penjualan.
      throw new NotFoundError("Produk tidak ditemukan.");
    }
    return toProductDto(row);
  }

  /**
   * Lookup scan barcode. CASHIER hanya mendapat produk aktif; barcode tidak
   * dikenal atau produk nonaktif menghasilkan `null` (AC-02.02, AC-03.01).
   */
  function findByBarcode(
    actorInput: Actor,
    barcodeInput: string,
    options: LookupOptions = {},
  ): ProductDto | null {
    const actor = requireVerifiedActor(actorInput);
    const includeInactive = canSeeInactive(actor, options.includeInactive);
    const barcode = normalizeBarcode(barcodeInput);
    const row = db
      .prepare(
        `SELECT p.id, p.category_id, c.name AS category_name, p.sku, p.name,
                p.price_rp, p.active,
                COALESCE((SELECT SUM(m.delta) FROM inventory_movements m
                          WHERE m.product_id = p.id), 0) AS stock_on_hand
         FROM products p
         JOIN categories c ON c.id = p.category_id
         JOIN product_barcodes b ON b.product_id = p.id
         WHERE b.barcode = ? AND (? = 1 OR p.active = 1)`,
      )
      .get(barcode, includeInactive ? 1 : 0) as ProductRow | undefined;
    return row ? toProductDto(row) : null;
  }

  function createProduct(actorInput: Actor, input: CreateProductInput): ProductDto {
    const actor = requireVerifiedActor(actorInput);
    requireAdmin(actor);
    const categoryId = assertId(input?.categoryId, "categoryId");
    const sku = normalizeSku(input?.sku);
    const name = normalizeText(input?.name, "name", MAX_NAME_LENGTH);
    const priceRp = assertPriceRp(input?.priceRp);
    const barcodes = normalizeBarcodeList(input?.barcodes);
    const supplierIds = normalizeSupplierIds(input?.supplierIds);

    return withTransaction(() => {
      assertActiveActor(actor);
      requireCategory(categoryId);
      requireSuppliers(supplierIds);
      let productId: number;
      try {
        const result = db
          .prepare(
            `INSERT INTO products (category_id, sku, name, price_rp, active)
             VALUES (?, ?, ?, ?, 1)`,
          )
          .run(categoryId, sku, name, priceRp);
        productId = Number(result.lastInsertRowid);
      } catch (error) {
        const message = errorMessage(error);
        if (isUniqueConstraint(message, "products.sku")) {
          throw new ConflictError("DUPLICATE_SKU", "SKU sudah dipakai produk lain.", "sku");
        }
        if (isForeignKeyConstraint(message)) {
          throw new ValidationError("Referensi kategori tidak valid.", "categoryId");
        }
        throw error;
      }

      const insertBarcode = db.prepare(
        "INSERT INTO product_barcodes (barcode, product_id) VALUES (?, ?)",
      );
      for (const barcode of barcodes) {
        try {
          insertBarcode.run(barcode, productId);
        } catch (error) {
          const message = errorMessage(error);
          if (message.includes("product_barcodes")) {
            throw new ConflictError(
              "DUPLICATE_BARCODE",
              `Barcode ${barcode} sudah dipakai produk lain.`,
              "barcodes",
            );
          }
          throw error;
        }
      }

      const insertSupplier = db.prepare(
        "INSERT INTO product_suppliers (product_id, supplier_id) VALUES (?, ?)",
      );
      for (const supplierId of supplierIds) {
        insertSupplier.run(productId, supplierId);
      }

      writeAudit(db, {
        actorId: actor.userId,
        action: "PRODUCT_CREATED",
        entityType: "products",
        entityId: productId,
        details: { sku, name, priceRp, barcodeCount: barcodes.length },
        nowMs: now(),
      });
      for (const barcode of barcodes) {
        writeAudit(db, {
          actorId: actor.userId,
          action: "BARCODE_CHANGED",
          entityType: "products",
          entityId: productId,
          details: { barcode, change: "ADDED" },
          nowMs: now(),
        });
      }
      return toProductDto(requireProductRow(productId));
    });
  }

  function updateProduct(
    actorInput: Actor,
    productId: number,
    input: UpdateProductInput,
  ): ProductDto {
    const actor = requireVerifiedActor(actorInput);
    requireAdmin(actor);
    const id = assertId(productId, "productId");

    const hasName = input?.name !== undefined;
    const hasCategory = input?.categoryId !== undefined;
    const hasPrice = input?.priceRp !== undefined;
    const hasActive = input?.active !== undefined;
    if (!hasName && !hasCategory && !hasPrice && !hasActive) {
      throw new ValidationError("Tidak ada atribut produk yang diubah.", "patch");
    }
    const name = hasName ? normalizeText(input.name, "name", MAX_NAME_LENGTH) : null;
    const categoryId = hasCategory ? assertId(input.categoryId, "categoryId") : null;
    const priceRp = hasPrice ? assertPriceRp(input.priceRp) : null;
    if (hasActive && typeof input.active !== "boolean") {
      throw new ValidationError("active harus boolean.", "active");
    }

    return withTransaction(() => {
      assertActiveActor(actor);
      const current = requireProductRow(id);
      if (categoryId !== null) {
        requireCategory(categoryId);
      }

      const changedFields: string[] = [];
      if (name !== null && name !== String(current.name)) {
        db.prepare("UPDATE products SET name = ? WHERE id = ?").run(name, id);
        changedFields.push("name");
      }
      if (categoryId !== null && categoryId !== Number(current.category_id)) {
        db.prepare("UPDATE products SET category_id = ? WHERE id = ?").run(categoryId, id);
        changedFields.push("categoryId");
      }
      if (hasActive && (input.active === true ? 1 : 0) !== Number(current.active)) {
        db.prepare("UPDATE products SET active = ? WHERE id = ?").run(
          input.active === true ? 1 : 0,
          id,
        );
        changedFields.push("active");
      }
      if (priceRp !== null && priceRp !== Number(current.price_rp)) {
        // Hanya master harga yang berubah; snapshot di `sale_items` tidak disentuh.
        db.prepare("UPDATE products SET price_rp = ? WHERE id = ?").run(priceRp, id);
        writeAudit(db, {
          actorId: actor.userId,
          action: "PRICE_CHANGED",
          entityType: "products",
          entityId: id,
          details: {
            sku: String(current.sku),
            oldPriceRp: Number(current.price_rp),
            newPriceRp: priceRp,
          },
          nowMs: now(),
        });
      }
      if (changedFields.length > 0) {
        writeAudit(db, {
          actorId: actor.userId,
          action: "PRODUCT_UPDATED",
          entityType: "products",
          entityId: id,
          details: { sku: String(current.sku), changedFields },
          nowMs: now(),
        });
      }
      return toProductDto(requireProductRow(id));
    });
  }

  function setProductSuppliers(
    actorInput: Actor,
    productId: number,
    supplierIdsInput: number[],
  ): ProductDto {
    const actor = requireVerifiedActor(actorInput);
    requireAdmin(actor);
    const id = assertId(productId, "productId");
    const supplierIds = normalizeSupplierIds(supplierIdsInput);

    return withTransaction(() => {
      assertActiveActor(actor);
      const current = requireProductRow(id);
      requireSuppliers(supplierIds);
      db.prepare("DELETE FROM product_suppliers WHERE product_id = ?").run(id);
      const insert = db.prepare(
        "INSERT INTO product_suppliers (product_id, supplier_id) VALUES (?, ?)",
      );
      for (const supplierId of supplierIds) {
        insert.run(id, supplierId);
      }
      writeAudit(db, {
        actorId: actor.userId,
        action: "PRODUCT_UPDATED",
        entityType: "products",
        entityId: id,
        details: { sku: String(current.sku), changedFields: ["supplierIds"], supplierIds },
        nowMs: now(),
      });
      return toProductDto(requireProductRow(id));
    });
  }

  function addBarcode(actorInput: Actor, productId: number, barcodeInput: string): ProductDto {
    const actor = requireVerifiedActor(actorInput);
    requireAdmin(actor);
    const id = assertId(productId, "productId");
    const barcode = normalizeBarcode(barcodeInput);

    return withTransaction(() => {
      assertActiveActor(actor);
      const current = requireProductRow(id);
      try {
        db.prepare("INSERT INTO product_barcodes (barcode, product_id) VALUES (?, ?)").run(
          barcode,
          id,
        );
      } catch (error) {
        if (errorMessage(error).includes("product_barcodes")) {
          throw new ConflictError(
            "DUPLICATE_BARCODE",
            `Barcode ${barcode} sudah dipakai produk lain.`,
            "barcode",
          );
        }
        throw error;
      }
      writeAudit(db, {
        actorId: actor.userId,
        action: "BARCODE_CHANGED",
        entityType: "products",
        entityId: id,
        details: { sku: String(current.sku), barcode, change: "ADDED" },
        nowMs: now(),
      });
      return toProductDto(requireProductRow(id));
    });
  }

  function removeBarcode(actorInput: Actor, productId: number, barcodeInput: string): ProductDto {
    const actor = requireVerifiedActor(actorInput);
    requireAdmin(actor);
    const id = assertId(productId, "productId");
    const barcode = normalizeBarcode(barcodeInput);

    return withTransaction(() => {
      assertActiveActor(actor);
      const current = requireProductRow(id);
      const existing = db
        .prepare("SELECT 1 AS found FROM product_barcodes WHERE product_id = ? AND barcode = ?")
        .get(id, barcode) as { found: number } | undefined;
      if (!existing) {
        throw new NotFoundError("Barcode tidak terdaftar pada produk ini.");
      }
      db.prepare("DELETE FROM product_barcodes WHERE product_id = ? AND barcode = ?").run(id, barcode);
      writeAudit(db, {
        actorId: actor.userId,
        action: "BARCODE_CHANGED",
        entityType: "products",
        entityId: id,
        details: { sku: String(current.sku), barcode, change: "REMOVED" },
        nowMs: now(),
      });
      return toProductDto(requireProductRow(id));
    });
  }

  return {
    listCategories,
    createCategory,
    renameCategory,
    listSuppliers,
    createSupplier,
    renameSupplier,
    listProducts,
    getProduct,
    findByBarcode,
    createProduct,
    updateProduct,
    setProductSuppliers,
    addBarcode,
    removeBarcode,
  };
}