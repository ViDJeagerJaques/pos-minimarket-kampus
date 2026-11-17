# Laporan TASK-017 — Hubungkan Shift dan Checkout Kasir

| Atribut | Nilai |
|---|---|
| Tanggal | 2026-11-16 |
| Branch | `task/p14-017` (base `origin/master`, diverifikasi via `git rev-parse --abbrev-ref origin/HEAD` → `origin/master`) |
| Owner | Syafroni (frontend) / Rahmat (backend) — QA pendamping Naazmi |
| Status | **REVIEW** — kode, tes, build, dan E2E API nyata lulus; belum uji browser/perangkat/pengelola; belum di-commit/push |
| Lingkup | POS-03.02/AC-03.02, POS-03.03/AC-03.03, POS-03.04/AC-03.04, POS-03.05/AC-03.05, POS-03.06/AC-03.06, POS-05.01/AC-05.01, POS-05.02/AC-05.02 · DEC-006, DEC-012, DEC-016, DEC-018 |
| Dependensi | TASK-012 (katalog/keranjang), TASK-014 (shift service + route), TASK-016 (checkout prepare/commit + route) — **semuanya diverifikasi nyata di checkout** |

## 1. Status dan ringkasan

Layar kasir kini memakai backend lokal nyata untuk:

- **Shift milik sesi:** `GET /shifts/current` saat mount, `POST /shifts/open` bila
  belum ada shift, dan penampilan ID/waktu buka. Shift tetap aktif setelah logout
  dan restart backend karena dipersistenkan backend (TASK-014).
- **Checkout dua fase:** `POST /checkouts/prepare` menyimpan `attemptKey` + harga
  dari backend, lalu `POST /checkouts/commit` mengirim `requestHash` dan uang tunai.
  Tombol "Lanjut pembayaran" menghasilkan quote; dialog menampilkan total, uang
  diterima, dan kembalian **sebelum** commit.
- **Sukses hanya setelah commit:** status "Transaksi tersimpan" dan nomor penjualan
  ditampilkan hanya bila backend membalas `status: COMMITTED`. Draft dibersihkan
  tepat saat itu, bukan saat prepare atau saat tombol ditekan.
- **Retry aman:** `attemptKey` dan `requestHash` disimpan di state fase selama
  retry; klik Bayar dua kali dan respons lambat tidak membuat upaya baru.
- **Timeout:** bila commit gagal dengan `NETWORK_ERROR`, UI masuk fase "status
  belum diketahui", melarang pembayaran ulang, dan menyediakan tombol
  `Cek status upaya` (`GET /checkouts/:attemptKey`). Hasil `COMMITTED` menampilkan
  struk; `PREPARED` mengizinkan lanjut commit **upaya yang sama**; `ABANDONED`
  mengarahkan ke draft baru.
- **Harga berubah:** `PRICE_CHANGED` (409) tidak menghasilkan penjualan. UI
  menyiapkan quote baru dengan `attemptKey` baru, menampilkan total lama vs baru,
  dan hanya melanjutkan setelah kasir menekan "Setuju harga baru".
- **Stok kurang:** `INSUFFICIENT_STOCK` (409) ditampilkan dengan pesan server;
  draft dipertahankan agar kasir dapat mengoreksi qty.

Mode `VITE_AUTH_MODE=demo` tetap jujur: shift dan checkout mock menolak
`DEMO_UNSUPPORTED` dan tombol bayar sengaja dinonaktifkan.

**Bukan GO-LIVE.** Tidak ada uji browser nyata, uang tunai/struk fisik, scanner,
printer, PC 4 GB, Electron, atau CodeRabbit. QRIS manual, cetak struk, penutupan
shift, dan pemulihan lintas restart frontend masih di luar lingkup ini.

## 2. Perubahan per file

| Path | Alasan |
|---|---|
| `frontend/src/pages/CashierPage.tsx` | Panel shift, alur prepare→payment→commit, validasi uang tunai/kembalian, konfirmasi harga baru, fase timeout + lookup status, sukses hanya dari `COMMITTED`, lock double-click. |
| `frontend/src/api/types.ts` | DTO `ShiftSummary`, `CheckoutQuote`, `PrepareCheckoutResult`, `CommitCheckoutResult`, `CheckoutStatusResult`, dan metode `PosDataSource` untuk shift/checkout. |
| `frontend/src/api/errors.ts` | Kode error domain checkout/shift (`PRICE_CHANGED`, `INSUFFICIENT_STOCK`, `SHIFT_NOT_ACTIVE`, `IDEMPOTENCY_CONFLICT`, `SHIFT_ALREADY_OPEN`, dll.). |
| `frontend/src/api/httpDataSource.ts` | Klien `GET/POST /shifts/*`, `POST /checkouts/prepare`, `POST /checkouts/commit`, `GET /checkouts/:attemptKey`; validasi respons aman; `requestHash` dari backend dikirim balik apa adanya (tidak ada serialisasi hash ganda di UI). |
| `frontend/src/api/mockDataSource.ts` | Shift/checkout DEMO menolak `DEMO_UNSUPPORTED`; tidak ada sukses palsu. |
| `frontend/src/App.tsx` | `onSessionExpired` diteruskan ke `CashierPage`; teks placeholder Shift diperbarui (endpoint sudah nyata, penutupan menunggu TASK-022/023). |
| `frontend/src/styles/app.css` | Gaya panel shift kasir. |
| `frontend/README.md` | Dokumentasi mode data shift/checkout dan batas sukses `COMMITTED`. |

### Baru

| Path | Alasan |
|---|---|
| `frontend/src/pages/CashierPage.checkout.test.tsx` | 8 tes UI: quote backend, kembalian, sukses setelah commit, double-click 1 prepare, harga berubah perlu persetujuan, stok kurang, timeout→lookup tanpa upaya baru, shift kosong→buka, 401→sesi berakhir. |
| `frontend/src/api/httpDataSource.test.ts` (diperluas 5 tes) | Kontrak klien shift/checkout: mapping DTO, payload prepare/commit, lookup terenkode, pesan `PRICE_CHANGED` diteruskan. |
| `scripts/task-017_checkout_e2e.mjs` | 13 pemeriksaan E2E API nyata dengan SQLite sementara + server loopback + restart backend. |

Tidak ada perubahan backend, skema, migrasi, atau `docs/architecture/API_CONTRACT.md`
pada TASK-017. DTO frontend mengikuti `API_CONTRACT.md` §2A dan §3 yang sudah ada.

## 3. Perintah tes yang dijalankan dan hasil nyata

Semua dijalankan di checkout ini pada 2026-11-16 (win32, PowerShell).

| # | Perintah | Hasil | Bukti ringkas |
|---|---|---|---|
| 1 | `cd frontend; npm run typecheck` | **PASS** | `tsc --noEmit` tanpa error |
| 2 | `cd frontend; npm test` | **PASS** | 8 file tes, **86/86** tes lulus |
| 3 | `cd frontend; npm run build` | **PASS** | `vite build` 40 modul; JS 284,42 kB, CSS 10,82 kB |
| 4 | `cd backend; npm run typecheck` | **PASS** | `tsc --noEmit` tanpa error |
| 5 | `cd backend; npm test` | **PASS** | **97/97** tes lulus (termasuk shift & checkout HTTP) |
| 6 | `node scripts/task-017_checkout_e2e.mjs` | **PASS** | **13/13** pemeriksaan E2E API nyata |
| 7 | `git diff --check` | **PASS** | tidak ada whitespace error |

### 3.1 Rincian E2E (`scripts/task-017_checkout_e2e.mjs`)

Server loopback port acak, SQLite sementara di `%TEMP%/pos-task017-e2e-*`,
dihapus setelah selesai. Kata sandi dibuat acak di memori dan tidak dicetak.

```text
PASS 1. Migrasi SQLite sementara dan server loopback
PASS 2. Login ADMIN dan dua CASHIER melalui backend nyata
PASS 3. Fixture stok sintetis 5 unit; barcode 000123 tersimpan sebagai string
PASS 4. AC-05.01: satu shift aktif dari dua upaya paralel; kasir lain null; ADMIN 403
PASS 5. AC-03.02: keranjang kosong dan qty nol ditolak tanpa sale/payment/mutasi
PASS 6. AC-03.05: prepare=PRA (tanpa sale); commit menghasilkan satu sale + payment + mutasi atomik, stok 3
PASS 7. AC-04.01: retry identik dan dua commit paralel menghasilkan satu penjualan per upaya
PASS 8. AC-04.02: lookup status upaya mengembalikan COMMITTED tanpa transaksi baru
PASS 9. AC-03.03: PRICE_CHANGED 409 tanpa commit; quote baru disetujui lalu commit sukses
PASS 10. AC-03.06: stok 1 menolak qty 5 tanpa mutasi; qty 1 sukses dan stok 0
PASS 11. Otorisasi backend: kasir lain SHIFT_NOT_ACTIVE 409; ADMIN 403 pada checkout
PASS 12. AC-05.02: restart backend mempertahankan ID dan waktu buka shift milik kasir
PASS 13. Konsistensi SQLite akhir: sales=4, payments=4, saleItems=4, movements=5, stock=0; audit shift/checkout tercatat
```

Catatan: nol awal barcode (`000123`) tetap diuji sebagai string; harga yang dipakai
quote berasal dari backend (`unitPriceRp: 5000`), bukan dari UI. Timeout jaringan
**tidak** disimulasikan di E2E API; buktinya adalah tes UI dengan `ApiError`
`NETWORK_ERROR` yang memastikan tidak ada `prepare`/`commit` kedua dan mengarahkan
ke `getCheckoutStatus`.

### 3.2 Pemetaan kriteria terima

| AC | Bukti | Batas |
|---|---|---|
| AC-03.02 | E2E #5; tes backend checkout `AC-03.02 & AC-03.06`; qty 0/negatif sudah di `domain/cart.test.ts` | Checkout tanpa shift diuji di service/HTTP, bukan lewat klik UI |
| AC-03.03 | E2E #9; tes UI harga berubah (quote baru + persetujuan eksplisit) | Tidak diuji dengan browser nyata |
| AC-03.04 | Hanya `CASH` yang diekspos; `cashReceivedRp` wajib dan kembalian dihitung backend (E2E #6); QRIS menunggu TASK-002/TASK-037 | Metode QRIS_MANUAL sengaja tidak ditampilkan |
| AC-03.05 | E2E #6/#7/#13: 1 sale + payment + 1 mutasi per commit, rollback diuji backend | Uji jaringan terputus sebelum aplikasi dibuka masih TASK-018 |
| AC-03.06 | E2E #10; pesan stok kurang ditampilkan UI; stok tidak berubah saat ditolak | Tidak ada pengujian dengan timbangan/scanner fisik |
| AC-05.01 | E2E #4 (paralel → 1 shift), ADMIN 403, kasir lain null | Dua klik UI cepat belum diuji dengan perangkat nyata |
| AC-05.02 | E2E #12 (restart backend, ID/waktu sama) | Restart **frontend** belum dipertahankan (token di memori → login ulang) |

### 3.3 Yang belum dijalankan / BLOCKED

| Hal | Status | Alasan |
|---|---|---|
| Uji browser nyata / DOM 4 GB resolusi PC | **BLOCKED** | Tes UI memakai jsdom; tidak ada browser otomasi atau PC tujuan di environment ini |
| Timeout jaringan sungguhan | **TIDAK DIJALANKAN** | Disimulasikan lewat `ApiError NETWORK_ERROR` di tes UI, bukan putus kabel/Wi-Fi |
| Uang tunai, scanner, printer fisik | **PENDING LAPANGAN** | Di luar environment; simulasi API bukan pengganti perangkat |
| Electron / direct API | **BLOCKED** | Backend belum punya CORS; dev memakai proxy Vite |
| CodeRabbit review | **TIDAK DIJALANKAN** | Tidak ada bukti alat terpasang |
| Validasi pengelola | **BELUM ADA** | Tidak diklaim |

## 4. Git / PR

- Branch nyata: `task/p14-017`; base `origin/master`.
- Belum ada commit, push, atau PR untuk TASK-017 — menunggu instruksi eksplisit user.
- Checkout sebelum tugas ini bersih; perubahan di atas semuanya milik TASK-017.

## 5. Risiko, asumsi DEMO, dan celah GO-LIVE

1. **`attemptKey` hanya di state komponen.** Jika halaman di-refresh/reload saat
   commit pending, referensi upaya hilang (token juga hilang karena disimpan di
   memori). Pemulihan lintas restart frontend adalah TASK-019/TASK-020.
2. **Lock UI bukan jaminan satu-satunya.** Backend sudah membuktikan idempotensi
   untuk commit paralel (E2E #7), sehingga aman meski dua permintaan lolos dari lock.
3. **Status `PREPARED` bukan penjualan.** UI tidak menampilkan struk untuk
   `PREPARED`, dan tidak menghapus draft sebelum `COMMITTED`.
4. **QRIS manual tidak diimplementasikan** di TASK-017 karena menunggu keputusan
   TASK-002/DEC; hanya `CASH` yang tersedia. Ini sesuai baseline kontrak yang
   menyatakan metode belum disahkan tidak boleh dicatat.
5. **Belum ada cetak struk, penutupan shift, atau setoran** (TASK-021, TASK-022/023).
   Nomor penjualan tampil di UI, tetapi belum ada struk fisik/rekap akhir shift.
6. **Tidak ada bukti hardware/fixture lapangan.** Simulasi API dan jsdom tidak
   menggantikan uang sungguhan, scanner, printer, PC 4 GB, atau persetujuan pengelola.
7. **Mode DEMO tetap terisolasi dan berlabel jujur**; mock checkout tidak pernah
   mengaku menyimpan transaksi.

## 6. Langkah berikutnya (terkecil)

1. Review kode Syafroni/Rahmat/David; bila disetujui, commit + push
   `task/p14-017` dan buka PR ke `master` dengan rujukan TASK-017/AC-03.*/AC-05.*.
2. TASK-018: jalankan irisan scan→checkout→baca saldo dalam kondisi jaringan
   terputus sejak awal, termasuk gagal commit, harga berubah, stok kurang, dan
   retry paralel di PC tujuan.
3. TASK-019/TASK-020: persistenkan identitas upaya dan tampilkan pemulihan status
   setelah restart frontend/shift ditutup; pastikan tidak meminta bayar ulang.
4. TASK-021: cetak struk dari transaksi `COMMITTED` dengan nomor yang sama.
5. TASK-022/TASK-023: penutupan shift dan layar rekap; TASK-037 bila QRIS disahkan.
