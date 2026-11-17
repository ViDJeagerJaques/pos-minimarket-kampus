# Frontend — UI Kasir/Admin (DEMO)

> **Status: DEMO.** Autentikasi dan pengelolaan akun memakai backend lokal
> nyata (TASK-009/TASK-011). Katalog produk masih data sintetis dan belum ada
> checkout, pembayaran, atau stok tersimpan. Bukan izin transaksi uang sungguhan.

## 1. Prasyarat

| Hal | Nilai |
|---|---|
| Node.js | >= 24 (diuji Node 26.13.1) |
| Backend lokal | `../backend`, berjalan di `127.0.0.1:8787` |
| Database | SQLite development di luar repo (lihat `../backend/README.md`) |

## 2. Menjalankan

```powershell
# Terminal 1 — backend lokal (wajib untuk login/akun nyata)
cd backend
npm ci
npm run db:migrate
$env:POS_BOOTSTRAP_PASSWORD = "<sandi-kuat-min-8-karakter>"
npm run auth:bootstrap-admin -- --username admin
npm start -- --port 8787

# Terminal 2 — frontend
cd frontend
npm ci
npm run dev
```

Buka `http://127.0.0.1:5173`. Vite mem-proxy `/api` ke
`http://127.0.0.1:8787`, sehingga browser tetap same-origin dan backend tidak
perlu CORS.

## 3. Mode data

| Variabel | Default | Arti |
|---|---|---|
| `VITE_AUTH_MODE` | (kosong = API lokal) | `demo` memakai mock login di memori; **bukan** bukti autentikasi |
| `VITE_API_BASE_URL` | `/api/v1` | Base URL API; untuk build desktop dapat diarahkan ke `http://127.0.0.1:8787/api/v1` |

`VITE_AUTH_MODE=demo` memakai mock katalog sintetis di memori dan menolak operasi
tulis katalog/shift/checkout dengan `DEMO_UNSUPPORTED` (tidak ada sukses palsu).
Default tanpa variabel memakai backend lokal nyata: halaman **Barang/Stok**
memerlukan role ADMIN, sedangkan **Kasir** memakai shift dan checkout
`prepare`/`commit` TASK-016. Hanya respons `COMMITTED` dari backend yang
menampilkan "Transaksi tersimpan"; saat respons commit tidak jelas, UI menyuruh
kasir mengecek status upaya dan tidak membuat transaksi baru.

## 4. Keamanan yang sudah diterapkan di klien

- Token sesi hanya disimpan di memori modul; tidak ada `localStorage`/`sessionStorage`.
  Reload halaman berarti login ulang.
- Login baru dianggap sukses setelah `POST /auth/login` **dan** `GET /auth/me` berhasil.
- 401 memaksa kembali ke layar login dengan pesan sesi berakhir; 403 ditampilkan
  sebagai akses ditolak tanpa mengakhiri sesi.
- Menu admin disembunyikan untuk CASHIER, tetapi otorisasi sesungguhnya tetap di backend.
- Kata sandi tidak masuk ke dialog konfirmasi, log, atau pesan error.

## 5. Perintah verifikasi

```powershell
npm run typecheck
npm test
npm run build
# dari root repo, E2E terhadap backend + SQLite sementara:
node scripts/task-011_auth_e2e.mjs
```

## 6. Batasan yang belum dikerjakan

- Belum ada router URL; akses langsung ke "URL admin" diuji di level API (403)
  dan state UI, bukan deep link browser.
- Build Electron dan mode API langsung tanpa proxy belum diuji; backend belum
  memiliki CORS. Lihat laporan `docs/laporan/TASK-011_login_akun_ui.md`.
- Belum ada uji perangkat fisik, printer, scanner, atau pengelola.

## Penutupan shift (TASK-023, DEMO)

Halaman Shift memakai pratinjau dari backend lokal dan meminta konfirmasi kasir
pemilik. Angka harapan memakai fixture TASK-022; SOP setoran belum disahkan.
Sebelum POST, identitas upaya dan uang dihitung disimpan di penyimpanan lokal
browser berdasarkan akun. Setelah timeout atau login ulang, cek hasil tersimpan;
404 belum membuktikan POST gagal. Retry memakai `closeKey` dan nominal yang sama.
Jika hasil milik upaya lain atau penyimpanan lokal tidak dapat dibaca, hentikan
dan lakukan rekonsiliasi. Mode mock berlabel DEMO tidak menutup shift.
