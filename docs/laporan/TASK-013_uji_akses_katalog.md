# Laporan TASK-013 — Uji Akses dan Katalog Terintegrasi

| Atribut | Nilai |
|---|---|
| Tugas | TASK-013 (P10) — QA akses/autentikasi & katalog |
| Tanggal eksekusi | 2026-11-15 (±08:35–08:55 UTC / 15:35–15:55 WIB) |
| Branch | `task/p10-013` (belum di-commit) |
| Commit diuji | `26ed97350a331a6b274463c83a3e0f4e36c4e6eb` |
| Lingkungan | Windows `win32 10.0.26200 (x64)`; Node `v24.22.3` portable (temp); npm `11.19.1` |
| Mode data | DEMO/QA sintetis — fixture TASK-006 `qa-synthetic-v1`, SQLite sementara |
| Penguji | AI agent QA (bukan penguji manusia; hasil perlu diverifikasi Naazmi) |
| Status keseluruhan | **PASS untuk cakupan API/DB yang dieksekusi; PARTIAL — uji browser nyata, jaringan terputus, dan perangkat fisik NOT RUN** |

> Dokumen ini mencatat hasil eksekusi nyata. Tidak ada klaim siap produksi/pilot. Semua data sintetis; database operasional tidak disentuh.

## 1. Ringkasan hasil

| Sesi | Perintah | Hasil |
|---|---|---|
| Backend unit/integration | `npm test` (backend) | **PASS 64/64**, 0 gagal |
| Backend typecheck | `npm run typecheck` (backend) | **PASS**, tanpa error |
| Frontend unit/komponen | `npm test` (frontend) | **PASS 67/67** di 7 file (50 lama + 17 baru TASK-013) |
| Frontend build | `npm run build` (frontend) | **PASS**, `dist` terbentuk (268,86 kB JS / 10,64 kB CSS) |
| E2E akses TASK-011 | `node scripts/task-011_auth_e2e.mjs` | **PASS 9/9** (regresi, tidak berubah) |
| E2E katalog TASK-012 | `node scripts/task-012_catalog_e2e.mjs` | **PASS 13/13** (regresi, tidak berubah) |
| **E2E integrasi TASK-013** | `node scripts/task-013_integration_e2e.mjs` | **PASS 15/15** |
| Integritas SQLite (sesi TASK-013) | `PRAGMA integrity_check` / `foreign_key_check` | **ok** / **0 pelanggaran** |

Tidak ada bug kritis/mayor yang ditemukan pada cakupan yang dieksekusi. Beberapa keterbatasan cakupan dicatat di §6–§7 (bukan bug, tetapi menghambat klaim penuh atas AC).

## 2. Lingkungan dan isolasi data

- Node.js tidak terpasang di sistem. Dipakai Node portable `v24.22.3` di `%LOCALAPPDATA%\Temp\opencode\node24\node-v24.22.3-win-x64` (di luar repo), `npm.cmd` karena PowerShell script execution disabled.
- Fixture TASK-006 di-reset dengan `POS_DB_PROFILE=test` ke folder temp berawalan `pos-qa-` (syarat `qa_fixtures.ts`), lalu diverifikasi `PASS: snapshot ... cocok dengan EXPECTED_QA_SNAPSHOT`.
- Fixture asli **tidak diubah**. Skrip menyalin fixture ke DB sesi terpisah, lalu menyetel kata sandi acak **hanya pada salinan sesi** untuk `demo.admin`, `demo.kasir.pagi`, `demo.kasir.sore`, `demo.kasir.nonaktif`. Hash asli fixture `DEMO_LOCKED_NO_LOGIN` tetap utuh.
- Server dijalankan nyata (`backend/src/http/cli.ts serve`) di `127.0.0.1` pada port acak; semua request lewat HTTP API nyata. Token/kata sandi hanya di memori proses, tidak dicetak, tidak masuk audit/log bukti.
- DB sementara dihapus setelah uji (kecuali `--keep-db`). Tidak ada akses ke DB development/operasional.

## 3. Matriks AC (eksekusi nyata)

Status per AC: **PASS** = perilaku terbukti lewat API/DB nyata; **NOT RUN** = tidak dieksekusi; batasan ditulis eksplisit.

| AC | Langkah nyata | Ekspektasi | Hasil aktual | Bukti | Status | Severity temuan |
|---|---|---|---|---|---|---|
| AC-01.01 | Login `demo.admin` & `demo.kasir.pagi` (kata sandi acak sesi), `GET /auth/me`; periksa tabel `sessions` | Role dari backend; sesi tersimpan aman | 200; role `ADMIN`/`CASHIER` benar; `token_digest` 32 byte, token mentah tidak tersimpan | E2E PASS #3; `task013-evidence.json` | **PASS (API)** | — |
| AC-01.01 | Logout CASHIER → `GET /auth/me` token lama; login ulang CASHIER | Sesi lama dicabut; role tetap benar | Token lama 401; sesi ADMIN tetap 200; login ulang 200 role `CASHIER` | E2E PASS #4 | **PASS (API)** | — |
| AC-01.02 | Sandi salah (ADMIN), username tak dikenal, akun nonaktif dengan sandi benar | 401 generik identik, tanpa sesi, tidak bocor status akun | Ketiganya 401 `INVALID_CREDENTIALS`, pesan identik; jumlah `sessions` tidak bertambah | E2E PASS #5 | **PASS (API)** | — |
| AC-01.02 | Brute force username unik 7x | Dibatasi setelah batas 5/menit | Urutan status `401,401,401,401,401,429`; 429 `LOGIN_RATE_LIMITED` generik, tanpa sesi | E2E PASS #5; field `loginRateLimit` | **PASS (API)** | — |
| AC-01.03 | CASHIER memanggil `GET/POST /users`, `POST /categories`, `POST /products`, `PATCH /products/1`, `GET /products?includeInactive=true` | 403 backend, tanpa perubahan data | Semua 403 `FORBIDDEN`; tabel users/produk/kategori/supplier/audit/sesi tidak berubah; tanpa token 401 | E2E PASS #6 | **PASS (API)** | — |
| AC-01.04 | ADMIN buat akun `kasir.t13.uji`; login; ADMIN nonaktifkan; coba sesi lama + login ulang | Akun baru bisa dipakai; setelah nonaktif ditolak; pelaku+waktu tercatat | Create 201, login 200; setelah nonaktif sesi lama 401, login 401 generik; audit `ACCOUNT_CREATED` & `ACCOUNT_DISABLED` entity id 5, actor id 1, timestamp > 0; audit bebas sandi/token/hash | E2E PASS #7; `audit` di JSON | **PASS (API)** | — |
| AC-02.01 | ADMIN buat kategori/supplier/produk `T13-001` (harga 8000, barcode `000777`, relasi supplier); CASHIER cari & scan | Produk ditemukan; relasi tidak ada ditolak | Create 201; cari "Produk T13" → 1 hasil; scan `000777` → 1 hasil; stok awal 0 | E2E PASS #8 | **PASS (API)** | — |
| AC-02.01 | Buat produk dengan `categoryId=999999` dan `supplierIds=[999999]` | Ditolak tanpa baris produk | Keduanya 422 `VALIDATION_ERROR`; jumlah `products` tidak berubah | E2E PASS #9 | **PASS (API)** | — |
| AC-02.02 | Buat produk baru dengan barcode fixture `0000000000017`; barcode ganda dalam satu request; scan barcode tersebut | Ditolak; scan tetap ke produk pertama | 409 `DUPLICATE_BARCODE` dan 422; jumlah `products`/`product_barcodes` tidak berubah; scan → `DEMO-001` | E2E PASS #10 | **PASS (API)** — jalur "aktivasi produk lain dengan barcode X" belum diuji (NOT RUN) | — |
| AC-02.03 | ADMIN ubah harga produk 8 `6000→6500`; CASHIER buka katalog baru; periksa `sale_items` 303 & audit | Katalog baru pakai harga baru; snapshot penjualan lama tetap; audit mencatat | `priceRp=6500` untuk pencarian baru; `sale_items` id 303 tetap 5000/5000; audit `PRICE_CHANGED` memuat SKU, old=6000, new=6500 | E2E PASS #11; `priceSnapshot` | **PASS (API)** | — |
| AC-02.03 | `PATCH` harga `-100`, `1.5`, `"7000"` | Ditolak, harga tidak berubah | Ketiganya 422 `VALIDATION_ERROR`; respons katalog identik sebelum/sesudah | E2E PASS #12 | **PASS (API)** | — |
| AC-03.01 | Login `demo.kasir.sore` (pemilik shift 102 aktif); scan `0000000000017`, scan tak dikenal, scan parsial, cari manual, scan barcode berspasi | Produk valid masuk hasil; kode asing tidak menambah item; cari manual tersedia | Shift aktif tepat 1 (id 102, cashier 3) milik akun login; scan valid → `DEMO-001` harga 3000 stok 22; kode asing/parsial → `[]`; cari "Air Mineral" menemukan `DEMO-001`; barcode `"000 123"` → 422; tidak ada mutasi sale/payment/stok | E2E PASS #13–#14; `activeShift` | **PASS (API)** | — |
| AC-03.07 | CASHIER pemilik shift aktif kirim `POST /sales`, `/checkout/prepare`, `/checkout/commit`; bandingkan saldo & tabel | Tidak ada penjualan/pembayaran/mutasi dari draft | Ketiga endpoint 404 (belum ada di baseline, TASK-016); saldo 8 produk fixture sama; `sales=3, sale_items=3, payments=3, inventory_movements=10` sama dengan fixture | E2E PASS #15 | **PASS (DB/API)** — pembatalan draft nyata di UI = NOT RUN | — |
| AC-01.01/AC-03.01 (UI) | Komponen jsdom: mount ulang (simulasi refresh), ganti role, akun nonaktif, barcode tak dikenal | Kembali ke login setelah refresh; menu sesuai role; pesan generik; keranjang kosong | Semua 17 tes baru PASS; storage kosong setelah mount ulang | `frontend/src/App.session.test.tsx`, `frontend/src/domain/cart.test.ts` | **PASS (jsdom, bukan browser)** | — |

### 3.1 Nilai tepi kuantitas (domain UI)

`frontend/src/domain/cart.test.ts` membuktikan `addProduct`/`setQuantity` menolak qty `0`, negatif, pecahan, `NaN`, `Infinity`, qty melebihi stok, produk bersaldo 0, dan produk yang tidak ada di keranjang — baris tidak berubah. Ini **lapisan domain/UI**, bukan validasi backend checkout (endpoint belum ada; lihat §7).

## 4. Snapshot SQLite akhir sesi uji

| Tabel | Fixture TASK-006 | Setelah TASK-013 | Selisih wajar |
|---|---|---|---|
| users | 4 | 5 | +1 akun uji ADMIN |
| sessions | tidak dihitung di `EXPECTED_QA_SNAPSHOT` (fixture tanpa login) | 5 | sesi login uji, bukan data bisnis |
| categories | 3 | 4 | +1 kategori uji |
| suppliers | 2 | 3 | +1 supplier uji |
| products | 8 | 9 | +1 produk uji |
| product_barcodes | 8 | 9 | +1 barcode uji |
| sales / sale_items / payments | 3 / 3 / 3 | 3 / 3 / 3 | **tidak berubah** |
| inventory_movements | 10 | 10 | **tidak berubah** |
| audit_log | 2 | 9 | operasi ADMIN yang diuji (akun, kategori, supplier, produk, barcode, harga) |

`PRAGMA integrity_check` = `ok`; `PRAGMA foreign_key_check` = 0 pelanggaran.

## 5. Temuan dan observasi

Tidak ada bug S1/S2/S3 pada cakupan yang dieksekusi. Observasi (bukan blocker, perlu keputusan pemilik):

| ID | Severity | Temuan | Dampak | Pemilik |
|---|---|---|---|---|
| O-1 | S4 | Nama aksi audit tidak konsisten: fixture memakai `PRICE_CHANGE`/`entity_type=product`, API TASK-012 memakai `PRICE_CHANGED`/`entities=products` | Query/rekap audit lintas sumber bisa melewatkan entri | Rahmat (backend/catalog), review David |
| O-2 | S4 | `demo.kasir.pagi` memiliki shift 101 yang sudah ditutup; hanya `demo.kasir.sore` punya shift aktif (102) | Dokumen/uji lain yang memakai `kasir.pagi` untuk AC berprasyarat shift aktif akan salah premis | Naazmi (QA), David (fixture) |
| O-3 | S4 | Endpoint `/sales`, `/checkout/prepare`, `/checkout/commit` belum ada (404) | AC-03.02–03.06, AC-04.* belum dapat diuji end-to-end; bukti AC-03.07 terbatas pada "tidak ada mutasi" | Rahmat (TASK-016) |
| O-4 | S4 | Token sesi hanya di memori; refresh = login ulang | Perilaku aman saat ini, tetapi alur "restart/refresh saat shift aktif" (AC-05.02) belum bisa diuji | Rahmat/Syafroni (keputusan penyimpanan token Electron) |
| O-5 | S4 | Belum ada uji browser nyata (Playwright/manual) dan perangkat scanner/printer | Klaim UI end-to-end dan AC-10.01 belum terbukti | Naazmi (QA), Syafroni (frontend) |

## 6. Perintah yang benar-benar dijalankan

Semua dari root repo, dengan `PATH` Node portable di depan:

```powershell
# Backend (cwd: backend)
npm.cmd ci --no-audit --no-fund
npm.cmd test            # 64 pass / 0 fail
npm.cmd run typecheck   # tanpa error

# Frontend (cwd: frontend)
npm.cmd ci --no-audit --no-fund
npm.cmd test            # 7 file, 67 test pass
npm.cmd run build       # typecheck + vite build OK

# E2E nyata (cwd: root repo)
node scripts/task-011_auth_e2e.mjs        # PASS 9/9
node scripts/task-012_catalog_e2e.mjs     # PASS 13/13
node scripts/task-013_integration_e2e.mjs --json-out <path>  # PASS 15/15
```

Log mentah: `docs/laporan/evidence/TASK-013/` (`task013-integration-e2e.log`, `task013-evidence.json`, `task013-backend-test.log`, `task013-frontend-test.log`).

## 7. Cakupan NOT RUN / BLOCKED (jujur, tanpa klaim)

| Item | Status | Alasan |
|---|---|---|
| Uji browser nyata (Chromium/Firefox) untuk login, ganti role, scan, refresh | **NOT RUN** | Tidak ada Playwright/Selenium/browser harness di environment; hanya jsdom/vitest. Screenshot bukan bukti dan tidak dibuat. |
| Kondisi "jaringan terputus" (AC-01.01, AC-03.01) | **NOT RUN** | Jaringan mesin tidak dimatikan saat uji. Yang terbukti: seluruh trafik hanya loopback `127.0.0.1`, tanpa panggilan eksternal. |
| Scanner barcode fisik & printer struk (AC-10.01) | **NOT RUN** | Tidak ada perangkat terpasang/tervalidasi. |
| Checkout, keranjang backend, retry, cetak (AC-03.02–03.06, AC-04.*) | **BLOCKED** | Endpoint belum diimplementasikan (TASK-016 dan lanjutan); 404 terverifikasi. |
| "Aktivasi produk lain dengan barcode X" (AC-02.02) | **NOT RUN** | Fixture tidak punya skenario aktivasi produk nonaktif dengan barcode duplikat; jalur create + duplicate dalam satu request sudah diuji. |
| Keranjang baru di UI nyata memakai harga baru (AC-02.03) | **NOT RUN** | Keranjang UI berjalan di mock/jsdom; backend hanya menyediakan katalog. Bukti harga baru = respons API katalog. |
| Penolakan berbasis ownership shift/transaksi (AC-01.03) | **NOT RUN (belum ada modul)** | Endpoint shift/checkout belum ada, jadi matriks ownership belum dapat diuji. |
| Rate limit dengan `Retry-After` & cooldown setelah 60 detik | **NOT RUN** | Uji E2E memverifikasi 429 generik; header/cooldown sudah diuji unit test backend, tidak diulang di server nyata. |

## 8. Risiko dan asumsi DEMO

- Semua hasil memakai **fixture sintetis**, bukan SOP minimarket dan bukan data operasional. Lulus di sini ≠ siap pilot.
- Kata sandi fixture disetel acak **hanya pada salinan sesi**; fixture asli tetap `DEMO_LOCKED_NO_LOGIN`. Jangan pakai akun demo untuk operasi nyata.
- Uji dijalankan pada satu PC pengembangan; perilaku Windows target, installer, dan pembaruan paket belum diuji (TASK-031–033).
- Bukti AC-03.07 saat ini adalah "tidak ada endpoint transaksi + tidak ada mutasi DB", bukan uji pembatalan keranjang di aplikasi nyata.
- Perubahan role/akun mengandalkan backend; penyembunyian menu UI hanya kosmetik (sesuai DEC-014).

## 9. Langkah berikutnya paling kecil

1. Naazmi: review laporan ini dan putuskan apakah bukti API/DB cukup untuk menutup AC-01.01–04, AC-02.01–03, AC-03.01, AC-03.07 tahap DEMO, dengan sisa item NOT RUN dicatat sebagai utang uji.
2. Syafroni/Naazmi: tambahkan uji browser nyata minimal (Playwright headless) untuk login, ganti role, scan, refresh — tanpa itu AC UI tetap PARTIAL.
3. Rahmat: rapikan penamaan aksi audit (O-1) sebelum laporan/audit dipakai lintas modul.
4. Rahmat: lanjutkan TASK-016 (checkout/shift) agar AC-03.02–03.06 dan AC-04.* dapat diuji; setelah itu jalankan ulang skrip TASK-013.
5. Naazmi: jadwalkan uji perangkat fisik (scanner/printer) di PC target; status tetap NOT RUN sampai ada bukti.

## 10. Status Git

- Branch: `task/p10-013`, HEAD `26ed97350a331a6b274463c83a3e0f4e36c4e6eb`.
- Perubahan belum di-commit/di-push/merge (sesuai instruksi tugas). File baru: skrip E2E, dua file tes frontend, dan folder bukti/laporan ini.
