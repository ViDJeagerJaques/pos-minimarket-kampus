# Laporan TASK-011 — Hubungkan Layar Login dan Akun

| Atribut | Nilai |
|---|---|
| Tanggal | 2026-11-15 |
| Branch | `task/p07-011` (base `origin/master`, diverifikasi via `git rev-parse --abbrev-ref origin/HEAD` → `origin/master`) |
| Owner | Syafroni (frontend) — QA pendamping Naazmi |
| Status | **REVIEW** — kode & tes lokal PASS; belum commit/push/PR, belum uji perangkat/pengelola |
| Lingkup | POS-01.01/AC-01.01, POS-01.02/AC-01.02, POS-01.03/AC-01.03, POS-01.04/AC-01.04; DEC-001, DEC-014 |
| Dependensi | TASK-007 (UI mock) dan TASK-009 (backend auth/akun) — keduanya tersedia nyata di checkout |
| Mesin uji | win32 10.0.19045 x64, Node v26.13.1, npm 11.20.0 |

## 1. Status dan ringkasan

Layar login, logout, profil (identitas di header), dan pengelolaan akun ADMIN
kini memakai **API lokal nyata** dari backend TASK-009. Autentikasi tidak lagi
berhasil hanya dari state UI: klien wajib menerima `token` dari
`POST /api/v1/auth/login` **dan** memverifikasi profil lewat `GET /api/v1/auth/me`
sebelum dianggap masuk.

Otorisasi utama tetap di backend. UI hanya menyembunyikan menu ADMIN untuk
CASHIER dan menangani `401`/`403` dengan aman. Respons `403` tidak mengakhiri
sesi; respons `401` membersihkan sesi klien dan kembali ke login.

**Bukan klaim GO-LIVE.** Belum ada uji perangkat fisik, printer, scanner,
pengelola, Electron, maupun transaksi uang sungguhan.

## 2. Perubahan per file

### Baru

| Path | Alasan |
|---|---|
| `frontend/src/api/httpDataSource.ts` | Klien API auth/akun: login → `/auth/me`, logout, list/create/PATCH user, pemetaan error 401/403/429/jaringan. Token hanya di memori. |
| `frontend/src/api/errors.ts` | `ApiError` bertipe untuk status/kode/retryable; pesan aman tanpa kredensial. |
| `frontend/src/api/httpDataSource.test.ts` | 8 tes kontrak klien: sukses hanya setelah `/auth/me`, kredensial generik, rate limit, logout membuang token, payload akun, 403, jaringan. |
| `frontend/src/pages/AccountsPage.tsx` | Layar ADMIN: daftar akun, buat kasir dengan konfirmasi, nonaktifkan dengan konfirmasi, validasi input, penanganan 401/403, kata sandi tidak ditampilkan ulang. |
| `frontend/src/pages/AccountsPage.test.tsx` | 7 tes UI: render daftar, konfirmasi sebelum mutasi, sandi tidak masuk dialog/log, double-click tidak menggandakan request create/disable, 403 vs 401. |
| `frontend/src/pages/ForbiddenPage.tsx` | Pesan akses ditolak untuk navigasi UI, menegaskan backend tetap menolak dengan 403. |
| `frontend/src/App.auth.test.tsx` | 5 tes alur App: Enter ganda → 1 request, login gagal tidak membuka menu, logout + Back tidak membuka halaman sensitif, 401 membersihkan sesi, 403 mempertahankan sesi. |
| `scripts/task-011_auth_e2e.mjs` | E2E API nyata: migrasi SQLite sementara di luar repo, bootstrap ADMIN dari env, server loopback acak, login/403/nonaktif/logout/audit. |
| `frontend/README.md` | Cara menjalankan backend 8787 + proxy, variabel `VITE_AUTH_MODE`/`VITE_API_BASE_URL`, batasan. |

### Diubah

| Path | Alasan |
|---|---|
| `frontend/src/api/types.ts` | Tambah `AuthMode`/`CatalogMode`, DTO `AccountSummary`/`CreateAccountInput`, metode `getProfile`/`listAccounts`/`createAccount`/`setAccountActive`. |
| `frontend/src/api/mockDataSource.ts` | Mode DEMO tetap tersedia untuk kerja UI; operasi akun mengembalikan `DEMO_UNSUPPORTED` (tidak ada sukses palsu); `getProfile` mengikuti state sesi. |
| `frontend/src/App.tsx` | Login/logout/sesi kedaluwarsa, guard role dengan halaman 403, render `AccountsPage`, pembersihan state keranjang antar sesi. |
| `frontend/src/pages/LoginPage.tsx` | Submit tahan ganda (ref), pesan generik AC-01.02, notifikasi sesi berakhir, tidak mengklaim sukses tanpa respons API. |
| `frontend/src/components/AppShell.tsx` | Banner/status membedakan `LOCAL_API` vs `DEMO`; menu tetap per role backend. |
| `frontend/src/components/DemoBanner.tsx` | Label DEMO jujur: autentikasi API lokal ≠ katalog/transaksi produksi. |
| `frontend/src/main.tsx` | Default memakai API lokal via proxy; `VITE_AUTH_MODE=demo` sebagai fallback terisolasi. |
| `frontend/vite.config.ts` | Proxy `/api` → `127.0.0.1:8787` untuk dev & preview; CSP `connect-src` hanya loopback. |
| `frontend/src/styles/app.css` | Gaya formulir akun dan pesan muat-gagal. |

Tidak ada perubahan pada backend, skema, migrasi, atau `API_CONTRACT.md`.

## 3. Perintah tes yang dijalankan dan hasil nyata

Semua dijalankan di checkout ini pada 2026-11-15.

| # | Perintah | Hasil | Bukti ringkas |
|---|---|---|---|
| 1 | `cd frontend; npm run typecheck` | **PASS** | `tsc --noEmit` tanpa error |
| 2 | `cd frontend; npm test` | **PASS** | 4 file tes, **31/31** tes lulus |
| 3 | `cd frontend; npm run build` | **PASS** | `vite build` 40 modul; `dist/` dihasilkan (JS 253,55 kB, CSS 9,54 kB) |
| 4 | `cd backend; npm run typecheck` | **PASS** | tanpa error (setelah `npm ci`, 4 paket dev) |
| 5 | `cd backend; npm test` | **PASS** | **55/55** tes lulus |
| 6 | `node scripts/task-011_auth_e2e.mjs` | **PASS** | 9 pemeriksaan E2E API nyata |

### 3.1 Rincian E2E (`scripts/task-011_auth_e2e.mjs`)

Server dijalankan pada port loopback acak dengan SQLite sementara di
`%TEMP%/pos-task011-e2e-*`, dihapus setelah selesai. Kata sandi dibuat acak di
memori dan tidak dicetak.

```text
PASS 1. Migrasi SQLite sementara dan bootstrap ADMIN (kata sandi dari env, bukan repo)
PASS 2. Server lokal berjalan di http://127.0.0.1:<port> (127.0.0.1)
PASS 3. AC-01.01 ADMIN login dan GET /auth/me mengembalikan role backend
PASS 4. AC-01.02 sandi salah ditolak generik (401 INVALID_CREDENTIALS)
PASS 5. AC-01.04 ADMIN membuat akun kasir; akun baru dapat login
PASS 6. AC-01.03 CASHIER menerima 403 dari backend dan tidak dapat membuat akun
PASS 7. AC-01.04 akun nonaktif: sesi lama dicabut dan login ditolak generik
PASS 8. Logout mencabut sesi; token lama tidak dapat dipakai
PASS 9. Audit akun tercatat (3 entri), tanpa sandi/token/hash
```

Pemeriksaan tambahan di skrip: hash tersimpan berawalan `scrypt$`, tidak memuat
kata sandi asli; `audit_log` memuat `ACCOUNT_CREATED`/`ACCOUNT_DISABLED` dengan
`actor_id` dan `created_at_ms` terisi.

### 3.2 Pemetaan kriteria terima

| AC | Bukti yang ada | Batas |
|---|---|---|
| AC-01.01 | E2E #3 (login ADMIN + `/auth/me` role backend); tes klien #1; tes App login | Belum login CASHIER eksplisit di E2E UI; role CASHIER diuji lewat 403 dan seed/backend test |
| AC-01.02 | E2E #4 (sandi salah generik), #7 (nonaktif ditolak generik); tes klien #2 | Pesan nonaktif vs tidak ada akun diuji setara di backend test |
| AC-01.03 | E2E #6 (CASHIER 403 pada `GET/POST /users`); `AccountsPage.test` 403; `App.auth.test` 403 | "Setiap operasi matriks" penuh adalah lingkup TASK-013; di sini hanya endpoint akun |
| AC-01.04 | E2E #5, #7, #9 (buat → login → nonaktif → sesi dicabut → audit); tes UI konfirmasi | Belum ada uji perangkat/pengelola; audit diperiksa di DB sementara |

### 3.3 Yang belum dijalankan / BLOCKED

| Hal | Status | Alasan |
|---|---|---|
| Uji UI di browser nyata (bukan jsdom) | **BLOCKED** | Tidak ada browser otomasi terpasang; tes DOM memakai jsdom |
| Login CASHIER lewat UI ke backend nyata | **BLOCKED** | Belum ada fixture akun kasir otomatis di DB dev; E2E memakai API langsung |
| Deep link `/accounts` untuk CASHIER | **TIDAK BERLAKU** | Belum ada router URL. Menu disembunyikan; 403 dibuktikan di API dan state UI |
| Electron/desktop build langsung ke API | **BLOCKED** | Backend belum punya CORS; mode saat ini bergantung proxy same-origin Vite |
| Uji printer/scanner/PC tujuan | **PENDING LAPANGAN** | Di luar lingkup TASK-011 |
| CodeRabbit review | **TIDAK DIJALANKAN** | Tidak ada bukti alat terpasang di environment ini |

## 4. Git / PR

- Branch nyata: `task/p07-011`.
- Base: `origin/master` (bukan `main`; diverifikasi dari `origin/HEAD`).
- **Belum ada commit, push, atau PR** — menunggu instruksi eksplisit user.
- Tidak ada tautan PR yang bisa dilaporkan karena belum dibuat.

## 5. Risiko, asumsi DEMO, dan celah GO-LIVE

1. **Kontrak API belum lengkap (TASK-001 K-12).** Endpoint `/users` nyata di
   backend TASK-009 tetapi belum tercantum di `docs/architecture/API_CONTRACT.md`.
   Laporan ini mencatat celah; dokumen kontrak tidak diubah diam-diam. Perlu
   review David/Rahmat sebelum dianggap kontrak resmi.
2. **Token di memori.** Reload/restart frontend memaksa login ulang. Ini aman
   untuk demo, tetapi keputusan penyimpanan sesi Electron (cookie HttpOnly vs
   token aman) belum disahkan.
3. **CORS/packaging.** Mode dev/preview memakai proxy Vite. Build desktop yang
   memanggil `http://127.0.0.1:8787` langsung akan gagal tanpa keputusan
   same-origin/IPC/CORS. `VITE_API_BASE_URL` sudah tersedia, tetapi belum diuji.
4. **Katalog masih mock.** Harga/stok di UI bukan data backend; jangan dipakai
   untuk transaksi nyata. Login nyata ≠ katalog nyata.
5. **Peran ADMIN vs CASHIER.** UI hanya mengizinkan pembuatan akun `CASHIER`.
   Pembuatan ADMIN kedua, reset sandi, dan pengambilalihan shift menunggu
   keputusan (DEC-019) dan tidak diimplementasikan.
6. **Audit & rate limit.** Diuji di backend dengan DB sementara. Belum ada bukti
   retensi audit, rotasi log, atau perilaku rate-limit pada perangkat kasir.
7. **Label DEMO.** Banner selalu terlihat dan membedakan autentikasi API lokal
   dari katalog/transaksi sintetis.

## 6. Langkah berikutnya (terkecil)

1. Review kode oleh Syafroni/David; bila disetujui, commit + push branch
   `task/p07-011` dan buka PR ke `master` dengan rujukan TASK-011/AC-01.*.
2. Tambahkan baris endpoint `/users` ke `API_CONTRACT.md` lewat review
   (menutup K-12), atau catat resmi sebagai gap bila kontrak belum siap.
3. TASK-013: uji akses lintas role via API langsung + UI browser nyata, termasuk
   login CASHIER, akun nonaktif, dan bukti DB.
4. Putuskan mode API untuk Electron (proxy lokal, IPC, atau CORS terbatas
   loopback) sebelum klaim paket Windows siap.
