# Review ERD Sistem Kasir dan Inventaris Minimarket Kampus

**Status · PROPOSED DESIGN**  
**Basis skema · DATABASE.md v0.1.0 §6**

DDL SQLite menjadi acuan tabel, kolom, tipe, kunci, dan kardinalitas fisik. PRD v0.2.0 (`PRD(2).md`), DECISIONS v0.1.0, dan ARCHITECTURE v0.1.0 digunakan untuk memeriksa kebutuhan dan status keputusan. ARCHITECTURE berstatus draft review.

## Inventaris objek

| Domain | Objek SQLite |
|---|---|
| Akses | `users`, `sessions` |
| Master | `categories`, `suppliers`, `products`, `product_barcodes`, `product_suppliers` |
| Shift | `shifts`, `shift_closings`, `shift_closing_totals` |
| Penjualan | `checkout_attempts`, `sales`, `sale_items`, `payments` |
| Inventaris | `goods_receipts`, `receipt_items`, `inventory_movements` |
| Audit | `audit_log` |
| VIEW | `stock_balances` dengan `product_id` dan `on_hand` dari agregasi delta. Produk tanpa mutasi mendapat saldo nol melalui LEFT JOIN dan COALESCE. |

## Relasi fisik

22 FK, termasuk empat FK komposit. Kardinalitas pada ujung induk menunjukkan jumlah induk per anak. Ujung anak menunjukkan jumlah anak per induk. Seluruh FK menggunakan aksi default `NO ACTION` dan memerlukan `PRAGMA foreign_keys = ON` pada setiap koneksi.

| Anak dan kolom FK | Induk dan kolom referensi | Induk per anak | Anak per induk |
|---|---|---|---|
| `sessions (user_id)` | `users (id)` | 1 | 0..N |
| `products (category_id)` | `categories (id)` | 1 | 0..N |
| `product_barcodes (product_id)` | `products (id)` | 1 | 0..N |
| `product_suppliers (supplier_id)` | `suppliers (id)` | 1 | 0..N |
| `product_suppliers (product_id)` | `products (id)` | 1 | 0..N |
| `shifts (cashier_id)` | `users (id)` | 1 | 0..N |
| `shift_closings (shift_id, closed_by)` | `shifts (id, cashier_id)` | 1 | 0..1 |
| `shift_closing_totals (shift_id)` | `shift_closings (shift_id)` | 1 | 0..N |
| `checkout_attempts (shift_id, cashier_id)` | `shifts (id, cashier_id)` | 1 | 0..N |
| `sales (attempt_key)` | `checkout_attempts (attempt_key)` | 1 | 0..1 |
| `sale_items (product_id)` | `products (id)` | 1 | 0..N |
| `sale_items (sale_id)` | `sales (id)` | 1 | 0..N |
| `payments (sale_id)` | `sales (id)` | 1 | 0..N |
| `goods_receipts (received_by)` | `users (id)` | 1 | 0..N |
| `goods_receipts (supplier_id)` | `suppliers (id)` | 1 | 0..N |
| `receipt_items (product_id)` | `products (id)` | 1 | 0..N |
| `receipt_items (receipt_id)` | `goods_receipts (id)` | 1 | 0..N |
| `inventory_movements (receipt_item_id, product_id)` | `receipt_items (id, product_id)` | 0..1 | 0..1 |
| `inventory_movements (sale_item_id, product_id)` | `sale_items (id, product_id)` | 0..1 | 0..1 |
| `inventory_movements (actor_id)` | `users (id)` | 1 | 0..N |
| `inventory_movements (product_id)` | `products (id)` | 1 | 0..N |
| `audit_log (actor_id)` | `users (id)` | 1 | 0..N |

`sales` menemukan shift dan kasir melalui `checkout_attempts`. `shift_closings.closed_by` dan `checkout_attempts.cashier_id` terikat pada pemilik shift oleh FK komposit. Untuk mutasi, pasangan ID item dan produk menjamin bahwa produk pada ledger sama dengan produk pada item sumber. Kedua FK komposit mutasi bersifat opsional secara individual karena masing-masing ID item dapat NULL. CHECK mewajibkan ID sumber yang sesuai untuk SALE atau RECEIPT. OPENING memakai `opening_batch_ref`. ID objek audit dan referensi batch adalah nilai logis. Dependensi VIEW dicatat sebagai catatan, tanpa garis FK.

## Kunci dan constraint

- **PK komposit** · `product_suppliers(product_id, supplier_id)` dan `shift_closing_totals(shift_id, method_code)`. Penanda PK di kedua baris menunjukkan keanggotaan pada satu kunci gabungan.
- **UNIQUE satu kolom** · `users.username` dengan `COLLATE NOCASE`, `categories.name`, `products.sku`, `shift_closings.close_key`, `sales.sale_no`, `sales.attempt_key`, `goods_receipts.receipt_key`, dan kedua ID item sumber di `inventory_movements`. SQLite mengizinkan beberapa NULL pada kedua UNIQUE terakhir. Barcode dan identitas upaya sudah unik melalui PK. `suppliers.name` dapat berulang.
- **UNIQUE gabungan** · `shifts(id, cashier_id)`, `sale_items(id, product_id)`, dan `receipt_items(id, product_id)` menyediakan target FK komposit. Keunikan berlaku pada pasangan.
- **Indeks unik parsial** · `ux_shifts_single_open` membatasi satu shift dengan `closed_at_ms IS NULL` per database. `ux_movements_opening_product` membatasi satu mutasi OPENING per produk.
- **CHECK** · DDL membatasi role, flag aktif, panjang digest/hash, waktu, tanda nilai, kuantitas positif, dan pilihan sumber mutasi. Total per baris penjualan harus sama dengan hasil perkalian integer yang valid. Metode pembayaran hanya diperiksa panjang stringnya oleh DDL.
- **NULL dan tipe** · Diagram menandai kolom tabel yang menerima NULL. `INTEGER PRIMARY KEY` menunjuk ID baris yang terisi setelah insert. Tipe INTEGER pada VIEW menjelaskan hasil ekspresi, karena VIEW tidak mendeklarasikan constraint tipe seperti tabel STRICT.

## Perbedaan dan tindak lanjut review

| Temuan | Rekomendasi untuk review |
|---|---|
| Mermaid §4 memberi minimum satu untuk `sales → sale_items`, `sales → payments`, dan `goods_receipts → receipt_items`. SQLite menerima header dengan nol anak. | Terapkan pemeriksaan kelengkapan dalam transaksi backend dan uji rollback bila item atau pembayaran tidak lengkap. |
| Mermaid §4 tidak menampilkan FK pelaku penerimaan dan mutasi ke `users`. | Gunakan diagram fisik untuk review migrasi dan validasi kedua referensi itu. |
| PRD POS-02.02 dan AC-02.02 menguji keunikan barcode pada produk aktif. PK barcode berlaku global, termasuk produk nonaktif. | Sepakati kebijakan alih barcode sebelum migrasi data. |
| DDL bisa menerima jumlah pembayaran yang berbeda dari total penjualan, delta berbeda dari kuantitas item, item tanpa mutasi, dan penutupan yang tidak sejalan dengan `closed_at_ms`. | Uji invariant layanan untuk total dan saldo, kelengkapan mutasi, serta commit bersama antara detail tutup, snapshot per metode, audit, dan transisi shift. |
| CHECK role tidak memastikan pengguna yang direferensikan sebagai kasir mempunyai role CASHIER. FK juga tidak menguji sesi aktif, hak aksi, atau status upaya checkout. | Terapkan otorisasi, validasi status dan kepemilikan, pemeriksaan hash untuk retry, serta pagar upaya yang ditinggalkan pada backend. |
| DDL tidak menyertakan trigger append-only. Dokumen final, mutasi, dan audit bergantung pada jalur tulis layanan. | Uji proteksi update/delete dari jalur aplikasi. Bahas trigger bersama skenario koreksi, migrasi, dan restore. |
| PRD dan ARCHITECTURE menetapkan jalur inti offline dengan validasi melalui backend. DEC-004, DEC-006, dan DEC-007 berstatus ACCEPTED. Detail satu shift aktif dan pemulihan checkout berada pada DEC-012/013 yang berstatus PROPOSED. | Pertahankan status PROPOSED DESIGN untuk skema. Uji commit bersaing, retry, logout, dan restart di PC pilot. |
| Metode bayar, modal, setoran, koreksi stok, definisi departemen/filter supplier, dan pengambilalihan shift masih bergantung pada DEC-016/018/019. DEC-020 mengusulkan cloud fase lanjutan. | Konfirmasi SOP pilot sebelum memperluas skema. Asosiasi katalog produk–supplier tidak mengidentifikasi asal unit yang dijual. |

## Validasi

- DDL §6 dieksekusi pada SQLite in-memory. `integrity_check` mengembalikan `ok` dan `foreign_key_check` kosong pada skema baru.
- Nama, tipe, PK, nullability, UNIQUE, dan pasangan FK diambil dari metadata SQLite. Halaman Overview dan Physical memuat semua 22 FK. Halaman domain memuat FK yang kedua ujungnya ditampilkan pada halaman tersebut.
- XML diperiksa secara struktural dan ketujuh halaman diperiksa dari render SVG yang memakai koordinat, port dan titik belok yang sama. Sebagian konektor bersilangan pada area kosong. Uji pembukaan langsung di aplikasi diagrams.net belum terverifikasi.
