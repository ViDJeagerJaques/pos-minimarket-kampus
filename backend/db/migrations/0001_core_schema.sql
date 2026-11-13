-- ---------------------------------------------------------------------------
-- 0001_core_schema.sql
--
-- Sumber DDL : docs/architecture/DATABASE.md v0.2.1 §6 (DDL PROPOSED) dan §16
--              (indeks). Tidak ada tabel bisnis tambahan di luar dokumen itu.
-- Status     : BASELINE DEMO untuk TASK-008. Bukan izin produksi.
-- Versi      : 1 (dicatat di PRAGMA user_version dan tabel schema_migrations)
--
-- Aturan file migrasi:
--   * Immutable setelah diterapkan. Perubahan skema = file baru (0002, 0003, ...).
--   * Jangan menulis BEGIN/COMMIT/ROLLBACK di sini; runner membungkus setiap
--     file dalam satu transaksi (BEGIN IMMEDIATE ... COMMIT).
--   * Jangan menulis PRAGMA foreign_keys/journal_mode di sini; runner mengatur
--     dan memverifikasi PRAGMA untuk setiap koneksi.
--
-- Keputusan TASK-001 yang BELUM selesai tidak diselesaikan di file ini:
--   D-04/K-05 (snapshot niat di checkout_attempts), D-05/K-06 (isi requestHash),
--   D-07/K-10 (uang diterima/kembalian pada payments), D-09/K-11 (kunci
--   idempotensi koreksi stok). Struktur di bawah adalah baseline DATABASE.md
--   apa adanya; penyelesaiannya harus menjadi migrasi aditif baru setelah
--   review. Endpoint checkout tetap BLOCKED sampai keputusan tersebut diambil.
-- ---------------------------------------------------------------------------

CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(username)) > 0),
    password_hash TEXT NOT NULL CHECK (length(password_hash) > 0),
    role TEXT NOT NULL CHECK (role IN ('ADMIN', 'CASHIER')),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0)
) STRICT;

CREATE TABLE sessions (
    token_digest BLOB NOT NULL PRIMARY KEY CHECK (length(token_digest) = 32),
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > 0),
    revoked_at_ms INTEGER CHECK (revoked_at_ms >= 0)
) STRICT;

CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0)
) STRICT;
CREATE TABLE suppliers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0)
) STRICT;
CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    sku TEXT NOT NULL UNIQUE CHECK (length(trim(sku)) > 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    price_rp INTEGER NOT NULL CHECK (price_rp >= 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
) STRICT;
CREATE TABLE product_barcodes (
    barcode TEXT NOT NULL PRIMARY KEY CHECK (length(trim(barcode)) > 0),
    product_id INTEGER NOT NULL REFERENCES products(id)
) STRICT;
CREATE TABLE product_suppliers (
    product_id INTEGER NOT NULL REFERENCES products(id),
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    PRIMARY KEY (product_id, supplier_id)
) STRICT;

CREATE TABLE shifts (
    id INTEGER PRIMARY KEY,
    cashier_id INTEGER NOT NULL REFERENCES users(id),
    opened_at_ms INTEGER NOT NULL CHECK (opened_at_ms >= 0),
    closed_at_ms INTEGER CHECK (closed_at_ms >= opened_at_ms),
    opening_cash_rp INTEGER CHECK (opening_cash_rp >= 0),
    UNIQUE (id, cashier_id)
) STRICT;
CREATE UNIQUE INDEX ux_shifts_single_open ON shifts ((1))
    WHERE closed_at_ms IS NULL;

CREATE TABLE shift_closings (
    shift_id INTEGER PRIMARY KEY,
    close_key TEXT NOT NULL UNIQUE CHECK (length(close_key) > 0),
    request_hash BLOB NOT NULL CHECK (length(request_hash) = 32),
    closed_by INTEGER NOT NULL,
    declared_cash_rp INTEGER CHECK (declared_cash_rp >= 0),
    variance_rp INTEGER,
    FOREIGN KEY (shift_id, closed_by) REFERENCES shifts(id, cashier_id)
) STRICT;
CREATE TABLE shift_closing_totals (
    shift_id INTEGER NOT NULL REFERENCES shift_closings(shift_id),
    method_code TEXT NOT NULL CHECK (length(method_code) > 0),
    amount_rp INTEGER NOT NULL CHECK (amount_rp >= 0),
    PRIMARY KEY (shift_id, method_code)
) STRICT;

CREATE TABLE checkout_attempts (
    attempt_key TEXT NOT NULL PRIMARY KEY CHECK (length(attempt_key) > 0),
    shift_id INTEGER NOT NULL,
    cashier_id INTEGER NOT NULL,
    request_hash BLOB NOT NULL CHECK (length(request_hash) = 32),
    prepared_at_ms INTEGER NOT NULL CHECK (prepared_at_ms >= 0),
    abandoned_at_ms INTEGER CHECK (abandoned_at_ms >= prepared_at_ms),
    FOREIGN KEY (shift_id, cashier_id) REFERENCES shifts(id, cashier_id)
) STRICT;
CREATE TABLE sales (
    id INTEGER PRIMARY KEY,
    sale_no TEXT NOT NULL UNIQUE CHECK (length(sale_no) > 0),
    attempt_key TEXT NOT NULL UNIQUE REFERENCES checkout_attempts(attempt_key),
    committed_at_ms INTEGER NOT NULL CHECK (committed_at_ms >= 0),
    total_rp INTEGER NOT NULL CHECK (total_rp >= 0)
) STRICT;
CREATE TABLE sale_items (
    id INTEGER PRIMARY KEY,
    sale_id INTEGER NOT NULL REFERENCES sales(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    sku_snapshot TEXT NOT NULL,
    name_snapshot TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_rp INTEGER NOT NULL CHECK (unit_price_rp >= 0),
    line_total_rp INTEGER NOT NULL CHECK (line_total_rp >= 0),
    CHECK (typeof(quantity * unit_price_rp) = 'integer'
           AND line_total_rp = quantity * unit_price_rp),
    UNIQUE (id, product_id)
) STRICT;
CREATE TABLE payments (
    id INTEGER PRIMARY KEY,
    sale_id INTEGER NOT NULL REFERENCES sales(id),
    method_code TEXT NOT NULL CHECK (method_code IN ('CASH', 'QRIS_MANUAL')),
    amount_rp INTEGER NOT NULL CHECK (amount_rp >= 0),
    evidence_ref TEXT,
    verified_by INTEGER REFERENCES users(id),
    verified_at_ms INTEGER CHECK (verified_at_ms >= 0),
    CHECK (
        (method_code = 'CASH' AND verified_by IS NULL AND verified_at_ms IS NULL)
        OR (method_code = 'QRIS_MANUAL' AND verified_by IS NOT NULL AND verified_at_ms IS NOT NULL)
    )
) STRICT;

CREATE TABLE goods_receipts (
    id INTEGER PRIMARY KEY,
    receipt_key TEXT NOT NULL UNIQUE CHECK (length(receipt_key) > 0),
    request_hash BLOB NOT NULL CHECK (length(request_hash) = 32),
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    received_by INTEGER NOT NULL REFERENCES users(id),
    committed_at_ms INTEGER NOT NULL CHECK (committed_at_ms >= 0),
    supplier_ref TEXT
) STRICT;
CREATE TABLE receipt_items (
    id INTEGER PRIMARY KEY,
    receipt_id INTEGER NOT NULL REFERENCES goods_receipts(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    UNIQUE (id, product_id)
) STRICT;

CREATE TABLE inventory_movements (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    kind TEXT NOT NULL CHECK (kind IN ('OPENING', 'SALE', 'RECEIPT', 'ADJUSTMENT')),
    delta INTEGER NOT NULL,
    sale_item_id INTEGER UNIQUE,
    receipt_item_id INTEGER UNIQUE,
    opening_batch_ref TEXT,
    adjustment_reason TEXT,
    actor_id INTEGER NOT NULL REFERENCES users(id),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    FOREIGN KEY (sale_item_id, product_id) REFERENCES sale_items(id, product_id),
    FOREIGN KEY (receipt_item_id, product_id) REFERENCES receipt_items(id, product_id),
    CHECK (
        (kind = 'OPENING' AND delta > 0 AND opening_batch_ref IS NOT NULL
         AND length(trim(opening_batch_ref)) > 0
         AND sale_item_id IS NULL AND receipt_item_id IS NULL AND adjustment_reason IS NULL)
        OR (kind = 'SALE' AND delta < 0 AND opening_batch_ref IS NULL
            AND sale_item_id IS NOT NULL AND receipt_item_id IS NULL AND adjustment_reason IS NULL)
        OR (kind = 'RECEIPT' AND delta > 0 AND opening_batch_ref IS NULL
            AND sale_item_id IS NULL AND receipt_item_id IS NOT NULL AND adjustment_reason IS NULL)
        OR (kind = 'ADJUSTMENT' AND delta != 0 AND opening_batch_ref IS NULL
            AND sale_item_id IS NULL AND receipt_item_id IS NULL
            AND adjustment_reason IS NOT NULL AND length(trim(adjustment_reason)) > 0)
    )
) STRICT;
CREATE UNIQUE INDEX ux_movements_opening_product ON inventory_movements (product_id)
    WHERE kind = 'OPENING';

CREATE VIEW stock_balances AS
SELECT p.id AS product_id, COALESCE(SUM(m.delta), 0) AS on_hand
FROM products p LEFT JOIN inventory_movements m ON m.product_id = p.id
GROUP BY p.id;

CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    actor_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    details TEXT,
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0)
) STRICT;

-- Indeks tambahan, docs/architecture/DATABASE.md §16.
CREATE INDEX ix_products_active_name ON products (active, name COLLATE NOCASE);
CREATE INDEX ix_barcodes_product ON product_barcodes (product_id);
CREATE INDEX ix_sessions_user ON sessions (user_id);
CREATE INDEX ix_attempts_shift ON checkout_attempts (shift_id, attempt_key);
CREATE INDEX ix_sales_committed ON sales (committed_at_ms, id);
CREATE INDEX ix_sale_items_sale ON sale_items (sale_id);
CREATE INDEX ix_payments_sale ON payments (sale_id);
CREATE INDEX ix_receipts_supplier_time ON goods_receipts (supplier_id, committed_at_ms, id);
CREATE INDEX ix_receipt_items_receipt ON receipt_items (receipt_id);
CREATE INDEX ix_movements_product ON inventory_movements (product_id, id);
CREATE INDEX ix_audit_entity ON audit_log (entity_type, entity_id, id);