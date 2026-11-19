# TASK-026 — Query Laporan Dasar

| Atribut | Isi |
|---|---|
| Tugas | TASK-026 · Coding DEMO · Owner Rahmat · Reviewer David, Naazmi |
| Referensi | POS-08.01/AC-08.01, POS-08.02/AC-08.02 · DEC-007, DEC-018 (PROPOSED) · API_CONTRACT.md §3/§5 |
| Branch | `task/p23-026` (lokal; belum commit/PR saat laporan dibuat) |
| Basis | `origin/master` @ `19123c1` (memuat TASK-010/015/021/022/025) |
| Tanggal | 19 November 2026 |
| Status | **REVIEW** — query laporan lulus 5 tes baru + 131 tes backend; zona waktu dan ambang stok belum disahkan |
| Lingkup | Laporan harian per tanggal/shift, laporan stok dari ledger, ADMIN only |

## 1. Yang dibuat

| Path | Isi |
|---|---|
| `backend/src/reports/service.ts` | `getDailyReport` dan `getStockReport` ditambahkan ke `ReportService` |
| `backend/src/http/app.ts` | Route `GET /reports/daily` dan `GET /reports/stock` (ADMIN) |
| `backend/src/reports/reportQueries.test.ts` | 4 tes service: filter tengah malam/shift, batas `[start,end)`, stok/ledger, otorisasi |
| `backend/src/http/reportQueries.test.ts` | 1 tes HTTP: 200 ADMIN, 403 CASHIER, 422 filter invalid |
| `backend/package.json`, `backend/README.md` | Daftar tes + §15 |

Aturan:

- **Hanya COMMITTED**: laporan harian membaca `sales` (baris hanya ada setelah
  commit). Checkout `PREPARED`, gagal, dan `ABANDONED` tidak masuk. Satu sale
  dihitung sekali lewat satu pembayaran utama (split tender bukan P0).
- **Filter `[start,end)`**: epoch ms UTC eksplisit; `shiftId` opsional. Zona
  operasional belum diputuskan, jadi backend tidak menebak timezone lokal.
- **CASH vs QRIS dipisah**: QRIS tidak ditambahkan ke kas laci.
- **Stok dari ledger**: `reconcileAll` + `listStockMovements`; menampilkan
  komponen OPENING/RECEIPT/SALE/ADJUSTMENT, saldo, dan rujukan sumber.
- **ADMIN only**: CASHIER ditolak 403 di service dan HTTP. Tidak ada hash
  password, token, atau detail pembayaran sensitif di response.

## 2. Verifikasi yang dijalankan

| Perintah | Hasil |
|---|---|
| `npm run typecheck` | **PASS**, exit 0 |
| `npm test` | **PASS 132/132**, 0 fail, ±11,5 s |
| `node --test src/reports/reportQueries.test.ts src/http/reportQueries.test.ts` | **PASS 6/6** |

Bukti: dua shift melintasi tengah malam; filter `[start,end)` memilih tiap
sale tepat satu kali; sale tepat di `start` masuk dan tepat di `end` tidak;
filter `shiftId` memisahkan shift 10/11; total harian sama dengan `SUM`
pembayaran sale committed (CASH 7500 + QRIS 2500 = 10000 dalam fixture);
draft/abandoned tidak dihitung; stok = OPENING 10 + RECEIPT 5 + SALE −5 = 10
dengan rincian sumber; CASHIER 403; filter invalid 422 tanpa perubahan data.

## 3. Risiko / belum diuji

- Filter `start`/`end` kosong atau spasi ditolak 422 di HTTP sebelum konversi
  angka; `start=0` tetap diterima. Rincian mutasi stok mengambil 21 entri
  terbaru, menampilkan maksimal 20, dan memakai entri ke-21 sebagai penanda
  `movementsTruncated`; rekonsiliasi tetap memakai seluruh mutasi.
- Zona operasional/batas hari belum disahkan; caller harus mengirim epoch ms
  yang sudah disesuaikan. Ambang "stok menipis" default 0 (belum final).
- Rincian dibatasi 100 sale dan 20 mutasi per produk dengan penanda
  `...Truncated`; total agregat tetap dari seluruh data.
- Tidak ada UI laporan/ekspor pada tugas ini (TASK-027).
- Belum diuji: browser/UI, perangkat, uang sungguhan, dan PC tujuan.

## 4. Git

Branch `task/p23-026` dari `origin/master` @ `19123c1`. Commit/PR akan
dicantumkan setelah perintah Git dijalankan.

## 5. Langkah berikutnya

1. Review David: zona operasional dan ambang stok menipis.
2. TASK-027 menampilkan laporan dan menautkan detail transaksi/mutasi.
3. Validasi ekspor/rekonsiliasi dengan pengelola sebelum GO-LIVE.
