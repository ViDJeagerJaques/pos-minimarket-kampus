# Laporan TASK-012 — Katalog Admin dan Keranjang Draft

| Atribut | Nilai |
|---|---|
| Tanggal | 2026-11-15 |
| Branch | `task/p09-012` (base `origin/master`, diverifikasi via `git rev-parse --abbrev-ref origin/HEAD` → `origin/master`) |
| Owner | Syafroni (frontend) / Rahmat (backend) — QA pendamping Naazmi |
| Status | **REVIEW** — kode, tes, build, dan E2E API nyata lulus; belum uji browser/ perangkat/pengelola; belum di-commit/push |
| Lingkup | POS-02.01/AC-02.01, POS-02.02/AC-02.02, POS-02.03/AC-02.03, POS-03.01/AC-03.01, POS-03.07/AC-03.07 · DEC-009, DEC-010, DEC-014 |
| Dependensi | TASK-007 (UI DEMO) dan TASK-010 (service katalog + lookup) tersedia nyata |

## 1. Status dan ringkasan

Halaman **Barang/Stok** kini menjadi katalog ADMIN yang memakai API backend
lokal nyata: kategori, supplier, produk, barcode, harga, aktivasi/nonaktivasi,
dan pencarian. Barcode selalu diperlakukan sebagai **string** sehingga nol awal
dari scanner tidak berubah menjadi angka. Pencarian/scan CASHIER memakai
endpoint katalog yang sama dan hanya menerima produk aktif.

Keranjang kasir tetap **draft lokal** di `frontend/src/domain/cart.ts`. Tambah,
kurangi, hapus, dan batal draft hanya mengubah state UI; tidak ada sale,
payment, atau `inventory_movements` yang dibuat. Endpoint `POST prepare`
belum ada dan tetap menjadi lingkup TASK-017.

Otorisasi utama tetap di backend. Menu ADMIN disembunyikan untuk CASHIER, dan
CASHIER yang memanggil endpoint tulis menerima **403** tanpa perubahan data.
Respons 401 memanggil pembersihan sesi; 403 hanya ditampilkan sebagai penolakan.

**Bukan klaim GO-LIVE.** Tidak ada uji browser nyata, scanner/printer fisik,
Electron, persetujuan pengelola, atau CodeRabbit review di lingkungan ini.

## 2. Perubahan per file

### Baru

| Path | Alasan |
|---|---|
| `frontend/src/pages/ProductsPage.test.tsx` | 6 tes UI katalog: barcode `"000123"` tetap string, pesan server 409/422, konfirmasi sebelum nonaktif, 403 tidak mengakhiri sesi, 401 memanggil `onSessionExpired`. |
| `scripts/task-012_catalog_e2e.mjs` | E2E API nyata: SQLite sementara + server loopback, katalog ADMIN, duplikat, SKU invalid, scan nol awal, 403 CASHIER, audit harga, nonaktif, bukti tanpa sale/payment/mutasi. |

### Diubah

| Path | Alasan |
|---|---|
| `backend/src/http/app.ts` | Route katalog tipis di atas service TASK-010: `GET/POST /categories`, `GET/POST /suppliers`, `GET/POST /products`, `PATCH /products/:id`, `POST /products/:id/suppliers`, `POST /products/:id/barcodes`, `DELETE /products/:id/barcodes/:barcode`. `CatalogError` dipetakan ke status/kode, `searchParams` diteruskan ke handler. |
| `backend/src/http/cli.ts` | Membuat `createCatalogService(db)` dan meneruskannya ke server. |
| `backend/src/http/app.test.ts` | Tes HTTP AC-02.01/02/03 + AC-03.01: nol awal, duplikat 409, SKU 422, 403 CASHIER, audit harga, produk nonaktif, dan tabel transaksi tetap kosong. |
| `frontend/src/api/types.ts` | DTO katalog (`CatalogProduct`, `CategorySummary`, `SupplierSummary`, input create/update/query), `CatalogMode = DEMO \| LOCAL_API`, perluasan `PosDataSource`. |
| `frontend/src/api/errors.ts` | Kode error `SESSION_INVALID`, `DUPLICATE_SKU`, `DUPLICATE_BARCODE`, `DUPLICATE_CATEGORY`, `PRODUCT_INACTIVE`. |
| `frontend/src/api/httpDataSource.ts` | Klien katalog nyata (kategori/supplier/produk/barcode), dukungan `DELETE`, query param, validasi respons, `catalogMode: LOCAL_API`. Katalog tidak lagi didelegasikan ke mock. |
| `frontend/src/api/httpDataSource.test.ts` | Menghapus opsi `catalog`; menambah 6 tes kontrak katalog (payload barcode string, 409, 422, URL lookup, includeInactive, 403). |
| `frontend/src/api/mockDataSource.ts` | Mode DEMO membaca katalog sintetis; semua operasi tulis katalog menolak `DEMO_UNSUPPORTED` dan tidak menampilkan sukses palsu. |
| `frontend/src/demo/demoData.ts` | Kategori/supplier sintetis dan `categoryId`/`supplierIds` pada produk DEMO. |
| `frontend/src/pages/ProductsPage.tsx` | UI ADMIN: form produk (SKU, nama, harga, kategori, supplier, textarea barcode), pencarian, ubah nama/harga/kategori, tambah/hapus barcode, konfirmasi aktivasi/nonaktivasi. |
| `frontend/src/App.tsx` | Meneruskan `currentUser` dan `onSessionExpired` ke halaman katalog; guard navigasi role tetap ada. |
| `frontend/src/App.test.tsx` | Tes draft diperluas: tambah/kurangi/hapus/batal tidak menghasilkan `isMutation` pada `callLog`. |
| `frontend/src/main.tsx` | Default memakai API katalog nyata; `VITE_AUTH_MODE=demo` menjadi fallback terisolasi. |
| `frontend/src/styles/app.css` | Gaya grid katalog, form produk, daftar kategori/supplier, pencarian, dan aksi tabel. |
| `frontend/README.md` | Menjelaskan katalog default API lokal dan batas mode DEMO. |

Tidak ada perubahan skema, migrasi, maupun `docs/architecture/API_CONTRACT.md`.
Endpoint kategori/supplier/barcode di atas **belum tercantum** di kontrak dan
dicatat sebagai usulan pada §5.

## 3. Perintah tes yang dijalankan dan hasil nyata

Semua dijalankan di checkout ini pada 2026-11-15 (win32, PowerShell).

| # | Perintah | Hasil | Bukti ringkas |
|---|---|---|---|
| 1 | `cd frontend; npm run typecheck` | **PASS** | `tsc --noEmit` tanpa error |
| 2 | `cd frontend; npm test` | **PASS** | 5 file tes, **50/50** tes lulus |
| 3 | `cd frontend; npm run build` | **PASS** | `vite build` 40 modul; JS 268,86 kB, CSS 10,64 kB |
| 4 | `cd backend; npm run typecheck` | **PASS** | `tsc --noEmit` tanpa error |
| 5 | `cd backend; npm test` | **PASS** | **64/64** tes lulus (termasuk 9 tes HTTP) |
| 6 | `node scripts/task-012_catalog_e2e.mjs` | **PASS** | **13/13** pemeriksaan E2E API nyata |

### 3.1 Rincian E2E (`scripts/task-012_catalog_e2e.mjs`)

Server dijalankan pada port loopback acak dengan SQLite sementara di
`%TEMP%/pos-task012-e2e-*` dan dihapus setelah selesai. Kata sandi dibuat acak
di memori dan tidak dicetak.

```text
PASS 1. Migrasi SQLite sementara dan bootstrap ADMIN (kata sandi dari env, bukan repo)
PASS 2. Server lokal berjalan di http://127.0.0.1:<port> (127.0.0.1)
PASS 3. Login ADMIN dan CASHIER nyata melalui backend loopback
PASS 4. AC-02.01 ADMIN membuat kategori, supplier, produk, dan relasi supplier
PASS 5. AC-02.02 barcode "000123" tersimpan sebagai string dengan nol awal
PASS 6. AC-02.02 barcode duplikat ditolak 409 DUPLICATE_BARCODE tanpa baris produk baru
PASS 7. SKU invalid ditolak server 422 VALIDATION_ERROR dengan pesan yang dapat ditampilkan UI
PASS 8. AC-03.01 CASHIER scan barcode 000123 menemukan produk; 123 tidak cocok (nol awal akurat)
PASS 9. Pemeliharaan barcode ADMIN (tambah/hapus) mempertahankan teks nol awal
PASS 10. AC-02.03/otorisasi: CASHIER menerima 403 pada tulis katalog dan includeInactive tanpa perubahan data
PASS 11. AC-02.03 perubahan harga tersimpan dan audit mencatat SKU, harga lama, dan harga baru
PASS 12. Produk nonaktif tidak muncul untuk CASHIER; ADMIN masih dapat melihatnya
PASS 13. AC-03.07 katalog dan draft tidak membuat sale, payment, atau inventory_movement; stok tetap 0
```

Pemeriksaan tambahan: kolom `product_barcodes.barcode` bertipe `TEXT` dan
bernilai tepat `000123`; `stock_balances.on_hand` tetap 0; `sales`, `payments`,
dan `inventory_movements` berjumlah 0.

### 3.2 Pemetaan kriteria terima

| AC | Bukti yang ada | Batas |
|---|---|---|
| AC-02.01 | E2E #4 (kategori/supplier/produk/relasi); tes HTTP backend; tes UI form produk | Belum uji UI browser nyata |
| AC-02.02 | E2E #5–#7 dan #9; tes HTTP 409/422; tes UI pesan server 409/422; DB `typeof(barcode) = text` | Duplikat SKU tidak dibuat terpisah; duplikat barcode dan validasi SKU sudah terbukti |
| AC-02.03 | E2E #11 (audit `PRICE_CHANGED` lama 5000 → baru 6000); service test | Perubahan harga lewat UI belum diuji end-to-end browser |
| AC-03.01 | E2E #8; tes HTTP `barcode=000123` vs `123`; tes klien lookup | Scan perangkat fisik belum diuji |
| AC-03.07 | Tes App: tambah/kurangi/hapus/batal tanpa `isMutation`; E2E #13 tabel transaksi 0 dan stok 0 | `POST prepare` belum ada (TASK-017), jadi belum ada jalur checkout |

### 3.3 Yang belum dijalankan / BLOCKED

| Hal | Status | Alasan |
|---|---|---|
| Uji UI di browser nyata | **BLOCKED** | Tes DOM memakai jsdom; tidak ada browser otomasi terpasang |
| Uji scanner/printer fisik | **PENDING LAPANGAN** | Di luar lingkungan ini; nol awal hanya diuji lewat string/API/DB |
| Electron/direct API | **BLOCKED** | Backend belum punya CORS; dev/preview memakai proxy Vite |
| `POST prepare` / checkout | **BELUM ADA** | Lingkup TASK-017; keranjang sengaja masih draft |
| CodeRabbit review | **TIDAK DIJALANKAN** | Tidak ada bukti alat terpasang di environment ini |
| Validasi pengelola | **BELUM ADA** | Tidak boleh diklaim sebagai persetujuan |

## 4. Git / PR

- Branch nyata: `task/p09-012`; base `origin/master`.
- Belum ada commit, push, atau PR untuk TASK-012 — menunggu instruksi eksplisit user.
- TASK-011 sebelumnya sudah di-merge sebagai PR #12; bukan bagian perubahan ini.

## 5. Risiko, asumsi DEMO, dan celah GO-LIVE

1. **Celah kontrak (TASK-001 K-12).** `API_CONTRACT.md` baru memuat
   `GET/POST /products` dan `PATCH /products/:id`. Endpoint `/categories`,
   `/suppliers`, `/products/:id/barcodes`, dan `/products/:id/suppliers`
   diimplementasikan sebagai **usulan** dan belum diubah diam-diam ke dokumen
   kontrak. Perlu review David/Rahmat sebelum dianggap resmi.
2. **Mode DEMO hanya baca.** Fallback `VITE_AUTH_MODE=demo` menampilkan katalog
   sintetis dan menolak semua tulis katalog dengan `DEMO_UNSUPPORTED`. Tidak ada
   sukses palsu, tetapi juga tidak ada CRUD offline di mode mock.
3. **Keranjang belum tersimpan.** Draft hilang saat logout/refresh; belum ada
   `POST prepare`, idempotensi, atau commit penjualan. AC-03.07 hanya membuktikan
   draft tidak memutasi data, bukan checkout.
4. **Otorisasi.** UI menyembunyikan menu ADMIN, tetapi 403 backend dibuktikan
   lewat API. Pengambilalihan shift/peran supervisor dan akses perangkat lain
   tetap menunggu DEC-019.
5. **Harga kompetitif/uang.** Harga master dan audit sudah nyata, tetapi
   persetujuan harga saat checkout, pembulatan, dan pembayaran belum ada.
6. **Distribusi.** Build web lulus; paket Windows/Electron dan akses langsung
   `http://127.0.0.1:8787` belum diuji (butuh keputusan CORS/IPC).
7. **Label DEMO.** Banner tetap membedakan autentikasi/katalog API lokal dari
   transaksi dan perangkat nyata; status ini bukan GO-LIVE.

## 6. Langkah berikutnya (terkecil)

1. Review kode Syafroni/Rahmat/David; bila disetujui, commit + push
   `task/p09-012` dan buka PR ke `master` dengan rujukan TASK-012/AC-02.*/AC-03.*.
2. Tambahkan endpoint katalog baru ke `API_CONTRACT.md` lewat review (menutup
   K-12), atau catat resmi sebagai gap bila kontrak belum siap.
3. TASK-013: uji akses dan katalog terintegrasi lintas role melalui API langsung
   dan browser nyata, termasuk akun nonaktif, barcode ganda/tak dikenal, dan
   bukti DB.
4. TASK-017: hubungkan shift + `POST prepare`/checkout atomik; saat itu keranjang
   baru boleh menghasilkan sale/payment/mutasi dengan konfirmasi harga dan stok.
