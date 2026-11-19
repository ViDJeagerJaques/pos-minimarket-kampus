# TASK-027 — Buat layar penerimaan dan laporan (laporan)

| Atribut | Isi |
| --- | --- |
| Tanggal | 19 November 2026 |
| Owner | Syafroni |
| Branch | `task/p24-027` dari `origin/master` @ `845173d` (TASK-021/025/026 sudah masuk) |
| ID | POS-07.01/AC-07.01, POS-07.02/AC-07.02, POS-08.01/AC-08.01, POS-08.02/AC-08.02 · DEC-009, DEC-018 |
| Status | **REVIEW** — UI dan klien API diuji lokal; perangkat, SOP dan uang sungguhan belum diuji |

## 1. Status dan lingkup

Selesai: layar penerimaan ADMIN (draft lokal, konfirmasi via dialog, status hasil, riwayat dari mutasi RECEIPT), panel laporan penjualan harian/per shift dan laporan stok pada halaman Laporan, klien API baru untuk `POST /goods-receipts`, `GET /reports/daily`, `GET /reports/stock`, serta pengamanan peran di navigasi (CASHIER tidak melihat menu ADMIN).

Tidak diubah: backend (TASK-025/026 sudah menyediakan endpoint), skema, dan aturan otorisasi/stok. Tidak ada angka yang dihitung ulang di browser — semua total diambil dari respons backend.

## 2. File yang diubah

- `frontend/src/api/types.ts` — DTO `ReceiveGoodsInput`, `ReceiptResult`, `DailyReportFilter`, `DailyReport`, `StockReport` + method `PosDataSource`.
- `frontend/src/api/httpDataSource.ts` — validasi respons, method, dan query `start`/`end`/`shiftId`/`lowStockThreshold`.
- `frontend/src/api/mockDataSource.ts` — `receiveGoods` menolak DEMO_UNSUPPORTED (tidak mengubah stok); laporan memakai angka sintetis berlabel DEMO.
- `frontend/src/pages/ReceivingPage.tsx` — draft, batal tanpa API, konfirmasi, hasil, riwayat.
- `frontend/src/components/DailyReportPanel.tsx`, `StockReportPanel.tsx` — filter dan tampilan laporan.
- `frontend/src/pages/ReportsPage.tsx` — memuat kedua panel di bawah laporan pembayaran yang sudah ada.
- `frontend/src/App.tsx` — halaman `receiving` aktif menggantikan placeholder; `app.css` — gaya baru.
- Tes: `ReceivingPage.test.tsx`, `DailyReportPanel.test.tsx`, `StockReportPanel.test.tsx`, penambahan pada `httpDataSource.test.ts` dan `App.test.tsx`.

Keputusan implementasi:
- Draft penerimaan **hanya state browser**. Tombol "Batal draft" tidak memanggil API sama sekali, sehingga stok tidak berubah. `receiptKey` dibuat klien sekali per draft dan dipertahankan saat error agar retry identik; setelah sukses dibuat kunci baru.
- Riwayat penerimaan memakai mutasi `RECEIPT` dari `GET /reports/stock`, karena backend **belum memiliki endpoint daftar penerimaan** (TASK-025 §3). Tidak ada daftar penerimaan yang direkayasa.
- Filter tanggal dikirim sebagai epoch ms `[start,end)`; UI memakai tanggal lokal PC dan memberi label bahwa zona operasional belum disahkan. Ambang "stok menipis" diberi label fixture.

## 3. Perintah tes yang benar-benar dijalankan

Lingkungan: Windows/PowerShell, Node 24, npm, data uji sintetis/mock.

| Perintah | Hasil |
| --- | --- |
| `npm run typecheck` (frontend) | PASS |
| `npm test` (frontend) | PASS 171/171 (sebelum perubahan 149) |
| `npm run build` (frontend) | PASS — 48 modul |
| `npm test` (backend, regresi) | PASS 132/132 |

Bukti perilaku:
- `ReceivingPage.test.tsx`: batal draft → `receiveGoods` tidak dipanggil dan tidak ada entri mutasi; konfirmasi → satu panggilan dengan `receiptKey`/`supplierId`/`items` yang benar dan hasil ditampilkan; 403 → pesan error, draft dan kunci dipertahankan; 401 → `onSessionExpired`; riwayat menampilkan `rcv_hist_1` dari laporan stok.
- `DailyReportPanel.test.tsx` / `StockReportPanel.test.tsx`: filter `shiftId=7` dan `lowStockThreshold=5` diteruskan; angka total/saldo ditampilkan apa adanya dari backend; rentang terbalik dan ambang invalid ditolak tanpa panggilan API; 403/401 ditangani.
- `httpDataSource.test.ts`: path/body `POST /goods-receipts` dan query `GET /reports/daily|stock` sesuai backend.
- `App.test.tsx`: CASHIER tidak melihat menu "Penerimaan" dan "Laporan".
- Backend TASK-025/026 (regresi): CASHIER 403 tanpa perubahan DB, `receiptKey` idempoten, draft batal tidak mengubah stok.

## 4. Branch / commit / PR

Branch `task/p24-027` dari `845173d`. Commit dan PR dicantumkan setelah perintah Git dijalankan. Tidak ada merge sendiri.

## 5. Risiko / belum diuji

- Belum ada endpoint GET daftar penerimaan; riwayat hanya mutasi RECEIPT dari laporan stok (perlu keputusan David/Rahmat bila ingin daftar lengkap dengan supplier/ref).
- Zona waktu laporan harian dan ambang stok menipis masih keputusan terbuka (DEC-018/TASK-003); keduanya diberi label fixture di UI.
- SOP supplier, surat jalan, dan perlakuan penerimaan sebagai pembelian berbayar masih `PENDING` (DEC-016).
- Belum diuji: browser pada PC tujuan, scanner, resolusi 1366×768, uang sungguhan, dan alur offline penuh. Mode DEMO tidak menyimpan penerimaan.

## 6. Langkah berikutnya paling kecil

1. David/Rahmat memutuskan apakah perlu endpoint daftar penerimaan dan zona/ambang laporan final.
2. Naazmi menjalankan AC-07.01/07.02/08.01/08.02 pada backend + UI di PC tujuan (TASK-035), termasuk uji offline dan 403 langsung.
3. TASK-024 (uji restart/printer/dua shift) dan TASK-029 (uji penerimaan/laporan/cadangan) dapat memakai layar ini sebagai jalur uji.

## 7. Perbaikan CodeRabbit ronde 1

Semua 9 temuan masih valid di kode dan diperbaiki: BUG-082 (decoder adjustment menerima safe integer negatif), BUG-083 (upaya penerimaan dipindah ke state App; pindah halaman/logout diblokir saat belum selesai), BUG-084 (`exclusiveEndMs` memakai kalender lokal, aman DST 23/25 jam), BUG-085 (kasir null → "Kasir tidak diketahui"), BUG-086 (pencarian produk aktif via `searchActiveProducts`, bukan daftar 100 pertama), BUG-087 (flag `movementsTruncated` mencegah pesan kosong definitif), BUG-088 (batal hanya API-free untuk draft belum dikirim), BUG-089 (retry memakai payload snapshot dan receiptKey asli), BUG-090 (saldo produk dan riwayat dimuat ulang setelah COMMITTED).

Tes setelah perbaikan: `npm run typecheck` PASS; `npm test -- --run --testTimeout=30000` PASS 177/177; `npm run build` PASS (49 modul). Timeout 30 s dipakai karena 17 worker jsdom membutuhkan waktu startup lebih lama di mesin ini; dengan timeout bawaan 5 s beberapa tes lama mengalami timeout lingkungan, bukan kegagalan logika.

## 8. Perbaikan CodeRabbit ronde 2

BUG-091: upaya UNKNOWN kini disimpan di ref sesi App sebelum sesi dibersihkan dan dipulihkan hanya bila user yang sama login lagi; user lain tidak melihatnya. Kegagalan 401 saat submit juga ditandai UNKNOWN sebelum sesi berakhir. Epoch check terhadap completion lama tetap dipertahankan. BUG-092: `DEMO_UNSUPPORTED` (tolakan tegas, tanpa commit) kini menghasilkan status `REJECTED` yang tidak mengunci halaman — draft bisa dikoreksi/dibatalkan; jaringan dan kegagalan lain tetap `UNKNOWN` dengan kunci/payload terkunci.

Tes setelah perbaikan: `npm run typecheck` PASS; `npm test -- --run --testTimeout=30000` PASS 181/181; `npm run build` PASS (49 modul).
