# TASK-010 — Master Produk, Kategori, Supplier, Barcode, dan Lookup

| Atribut | Isi |
|---|---|
| Tugas | TASK-010 · Coding DEMO · Owner Rahmat · Reviewer David, Naazmi |
| Referensi | POS-02.01–03, POS-03.01 · AC-02.01, AC-02.02, AC-02.03, AC-03.01 · DEC-014 |
| Branch | `task/p08-010` (lokal, belum di-commit/push/PR) |
| Basis | `origin/master` @ `544ad10` (memuat TASK-008 dan TASK-006) |
| Tanggal | 14 November 2026 |
| Status | **REVIEW** — service katalog lulus tes development; endpoint HTTP, UI, dan integrasi checkout **BLOCKED** karena TASK-009 belum ada |
| Lingkup | Service layer katalog + lookup + otorisasi + audit atomik pada SQLite |

> Dokumen ini mencatat bukti yang benar-benar dijalankan. Tidak ada klaim
> persetujuan pengelola, uji perangkat, atau CodeRabbit review.

## 1. Yang dibuat

| Path | Isi |
|---|---|
| `backend/src/catalog/service.ts` | Service kategori, supplier, produk, barcode, relasi supplier, lookup scan/cari, perubahan harga + audit dalam satu transaksi |
| `backend/src/catalog/errors.ts` | Error domain dengan `code`/`httpStatus` (422, 403, 401, 404, 409) agar TASK-009 memetakan tanpa menebak |
| `backend/src/catalog/types.ts` | DTO dan input; `Actor` berasal dari sesi backend, bukan body request |
| `backend/src/catalog/authz.ts` | Guard bentuk actor, `requireAdmin`, larangan `includeInactive` untuk CASHIER |
| `backend/src/catalog/audit.ts` | Whitelist event audit, sanitasi `details`, panjang maksimum |
| `backend/src/catalog/service.test.ts` | 7 tes `node --test` untuk AC-02.01–03, AC-03.01, otorisasi, dan atomisitas audit |
| `backend/tsconfig.json` | `include` ditambah `src/**/*.ts` |
| `backend/package.json` | Script `test` ditambah `src/catalog/service.test.ts` |

Desain kunci:

- **Tidak ada autentikasi baru.** TASK-009 belum diimplementasikan di branch
  mana pun. Service menerima `Actor { userId, role }` yang nantinya diisi dari
  sesi terverifikasi. Service tetap mencocokkan `userId`+`role` dengan baris
  `users` yang aktif (defense-in-depth), jadi actor palsu, sesi basi, atau
  penulisan CASHIER ditolak sebelum data berubah.
- **Semua perubahan master + audit dalam satu transaksi** (`BEGIN IMMEDIATE`).
  Kegagalan audit/constraint membatalkan perubahan domain.
- **Barcode diperlakukan sebagai string**: input `number` ditolak, nol awal
  dipertahankan, dan keunikan ditegakkan constraint PK `product_barcodes`
  (global, termasuk produk nonaktif) sesuai `DATABASE.md` §7.
- **Lookup penjualan hanya produk aktif.** Barcode asing atau produk nonaktif
  menghasilkan `null` untuk CASHIER. Hanya ADMIN yang boleh `includeInactive`.
- **Snapshot historis tidak disentuh.** Perubahan harga hanya mengubah
  `products.price_rp` dan menulis audit `PRICE_CHANGED` berisi harga lama/baru.
- **Uang integer rupiah**: float, NaN, dan negatif ditolak. Nama/SKU/barcode
  divalidasi panjang, karakter kontrol, dan spasi.

## 2. Verifikasi yang dijalankan

Lingkungan: Windows, PowerShell, Node.js 26.13.1 (portable, di luar repo),
SQLite 3.54.1, database uji di direktori temp OS (di luar source tree). Tidak
ada Node/npm global di mesin ini. Dependensi dev dipasang dengan npm portable.

| # | Perintah (dijalankan dari `backend/`) | Hasil |
|---|---|---|
| V1 | `node --test src/catalog/service.test.ts` | **PASS 7/7**, 0 fail |
| V2 | `npm test` (migrasi + constraint + seed + failure + safety + QA + katalog) | **PASS 42/42**, 0 fail, ±2,9 s |
| V3 | `npm run typecheck` (`tsc --noEmit -p tsconfig.json`) | **PASS**, exit 0 tanpa diagnostik |

Bukti perilaku ada di output tes (assertion per skenario). Tidak ada file log
terpisah yang di-commit agar tidak memuat path/data lokal.

### 2.1 Cakupan AC

| AC | Terbukti di level service + SQLite | Belum terbukti |
|---|---|---|
| AC-02.01 | ADMIN membuat kategori/supplier/produk valid; CASHIER dapat mencari produk; kategori/supplier tidak ada ditolak sebelum data tersimpan; SKU duplikat 409 | Endpoint HTTP, UI admin/kasir, sesi nyata |
| AC-02.02 | Barcode duplikat ditolak constraint DB **dan** service (409), termasuk produk baru yang harus rollback utuh; `00123` tetap string dan `123` tidak cocok; selama barcode dipakai produk nonaktif, barcode tidak bisa dipindah dan scan tidak menambah item | "Mengaktifkan produk lain dengan X" lewat UI; endpoint API |
| AC-02.03 | Harga master berubah, `sales`/`sale_items` fixture identik sebelum-sesudah; lookup baru memakai harga baru; audit `PRICE_CHANGED` mencatat pelaku, waktu, SKU, harga lama/baru | Keranjang/checkout nyata yang memverifikasi ulang harga di commit (TASK-011/checkout) |
| AC-03.01 | Scan barcode valid → produk; kode asing/nonaktif → `null`; pencarian manual (nama/SKU, case-insensitive) tetap tersedia; LIKE wildcard di-escape | Shift aktif, keranjang, UI scan, jaringan putus |

### 2.2 Bukti otorisasi

- CASHIER mencoba 9 operasi tulis (kategori, supplier, produk, harga, barcode,
  relasi supplier) → `ForbiddenError` dengan `code=FORBIDDEN` dan
  `httpStatus=403`, jumlah baris seluruh tabel tidak berubah.
- Actor dengan `role` palsu (mis. `userId` kasir + `role: ADMIN`) → sesi
  dianggap tidak valid (`SESSION_INVALID`, 401), termasuk pada lookup
  `includeInactive`; role diverifikasi ke tabel `users`.
- Actor `userId` tidak ada / akun `active=0` → `SESSION_INVALID` (401) untuk
  operasi baca maupun tulis.
- Actor cacat (userId 0, role asing) → `VALIDATION_ERROR` (422).
- ADMIN berhasil menulis sebagai kontrol positif.
- **Belum terbukti:** respons HTTP 403 nyata, karena belum ada server
  Express/sesi/route di repo (TASK-009). Pemetaan `httpStatus` hanya terbukti di
  objek error service.

## 3. Keputusan terbuka, asumsi DEMO, dan risiko

| ID / topik | Dampak |
|---|---|
| TASK-009 belum ada | Service belum dapat diakses lewat HTTP; 403/401 belum diuji end-to-end dan UI belum terhubung. Ini blocker integrasi, bukan blocker logika katalog. |
| K-12 / D-10 (`API_CONTRACT.md`) | Kontrak `GET/POST/PATCH /products` ada, tetapi endpoint kategori/supplier belum ditetapkan. Service menyediakan fungsi, route menunggu review. |
| AUD-02 (`AUDIT_LOG.md` §3) | Hanya `PRODUCT_CREATED`, `PRICE_CHANGED`, `BARCODE_CHANGED` yang resmi. `PRODUCT_UPDATED`, `CATEGORY_*`, `SUPPLIER_*` adalah **usulan** yang perlu review Naazmi/David. Whitelist service menolak event di luar daftar. |
| Normalisasi barcode | Service hanya menerima ASCII terlihat tanpa spasi dan melakukan `trim`. Profil scanner/normalisasi final belum disahkan; perubahan harus lewat review karena memengaruhi keunikan. |
| Pemindahan barcode | Constraint global membuat barcode produk nonaktif tetap terpakai; alur pemindahan belum disetujui (`DATABASE.md` §7). |
| Pencarian substring | `LIKE %...%` cukup untuk MVP; `DATABASE.md` §16 menyarankan awalan + exact match untuk performa. Indeks/`EXPLAIN` dengan volume nyata belum diuji. |
| Harga 0 | Diterima skema (`price_rp >= 0`) dan service. Apakah produk gratis diizinkan secara operasional belum diputuskan. |
| Retensi/akses audit | Belum disetujui; implementasi hanya menulis `audit_log` yang ada. |

## 4. Git

- Branch: `task/p08-010` dari `origin/master` @ `544ad10`.
- Belum ada commit, push, atau PR (menunggu instruksi eksplisit).
- Perubahan tercatat: `backend/package.json`, `backend/tsconfig.json`,
  `backend/src/catalog/*` (5 modul + 1 tes), dokumen ini.

## 5. Langkah berikutnya

1. Review David/Naazmi untuk nama event audit tambahan dan kontrak endpoint
   kategori/supplier (K-12/D-10).
2. Setelah TASK-009 tersedia: buat route Express yang mengambil `Actor` dari
   sesi, memetakan `CatalogError.httpStatus`, dan menguji 403 CASHIER lewat HTTP.
3. Hubungkan lookup `findByBarcode`/`listProducts` ke keranjang TASK-011 dan
   tambahkan verifikasi harga saat commit checkout (AC-02.03/AC-03.03).
4. Uji UI admin/kasir dan alur scan di perangkat tujuan; catat hasil sebagai
   bukti AC, bukan mengandalkan tes service ini.
