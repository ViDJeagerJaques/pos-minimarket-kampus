# TASK-021 — Cetak dari transaksi tersimpan (laporan)

| Atribut | Isi |
| --- | --- |
| Tanggal | 19 November 2026 |
| Owner | Syafroni |
| Branch | `task/p21-021` (base `6722485` = origin/master, sudah termasuk PR #34 / TASK-037) |
| ID | POS-04.03 / AC-04.03 · DEC-005, DEC-013 · TASK-021 · TASK-001 K-03, AUTH-07 |
| Status | **REVIEW** — kode dan tes lokal diuji; printer fisik/PC tujuan belum diuji |

## 1. Status dan lingkup

Selesai (kode/artefak diuji): struk virtual dibangun dari `sales`/`sale_items`/`payments` yang sudah COMMITTED, adapter printer dipisahkan dari transaksi SQLite, reprint dari `saleId` lama, status gagal cetak `PRINTER_UNAVAILABLE`, dan fallback salin teks manual. Tidak ada sale/payment/stok baru saat cetak maupun saat gagal cetak.

Tidak selesai / tertunda: uji printer ESC/POS nyata, driver/port, PC tujuan, dan izin cetak ADMIN (konflik K-03/AUTH-07 masih terbuka).

## 2. File yang diubah

Backend:
- `backend/src/print/types.ts` — DTO struk, `PrinterAdapter`, `PrintAttempt`.
- `backend/src/print/receipt.ts` — formatter teks struk deterministik berlabel DEMO dengan nomor dan harga historis.
- `backend/src/print/printer.ts` — adapter virtual (pratinjau) dan adapter gagal (simulasi printer mati).
- `backend/src/print/errors.ts` — `PrintError`, `PrinterUnavailableError` (503, retryable), validasi, not found.
- `backend/src/print/service.ts` — pembacaan sale tersimpan + ownership `sales.attempt_key → checkout_attempts.cashier_id`; cetak tanpa write DB.
- `backend/src/http/app.ts` — `GET /sales/:id/receipt` (ADMIN read, CASHIER own) dan `POST /sales/:id/print` (CASHIER own), mapping error `PrintError`.
- `backend/src/http/cli.ts` — wiring adapter virtual DEMO.
- `backend/package.json` — 3 file tes baru masuk skrip `npm test`.
- Tes: `backend/src/print/receipt.test.ts`, `backend/src/print/service.test.ts`, `backend/src/http/print.test.ts`.

Frontend:
- `frontend/src/api/types.ts`, `errors.ts`, `httpDataSource.ts`, `mockDataSource.ts` — DTO, kode `PRINTER_UNAVAILABLE`, klien `getSaleReceipt`/`printSaleReceipt` dan stub DEMO.
- `frontend/src/components/ReceiptPanel.tsx` — pratinjau, status gagal, cetak ulang, fallback salin teks manual.
- `frontend/src/pages/ReceiptPage.tsx` — halaman Riwayat/Struk untuk reprint dari `saleId` lama.
- `frontend/src/pages/CashierPage.tsx` — panel struk menggantikan placeholder "Cetak ulang belum tersedia (TASK-021)".
- `frontend/src/App.tsx`, `frontend/src/styles/app.css` — halaman riwayat aktif dan gaya struk.
- Tes: `frontend/src/components/ReceiptPanel.test.tsx`, `frontend/src/pages/ReceiptPage.test.tsx`, tambahan `frontend/src/api/httpDataSource.test.ts`.

## 3. Perintah tes yang benar-benar dijalankan

Lingkungan: Node 24+, SQLite `node:sqlite`, npm di `backend/` dan `frontend/`, database uji sementara di luar source tree, data sintetis.

| Perintah | Hasil |
| --- | --- |
| `npm run typecheck` (backend) | PASS |
| `npm test` (backend) | PASS — 119 tes, 0 gagal (sebelum perubahan 111) |
| `npm run typecheck` (frontend) | PASS |
| `npm test` (frontend) | PASS — 149 tes, 0 gagal (sebelum perubahan 140) |
| `npm run build` (frontend) | PASS — 45 modul, dist dibangun |

Bukti perilaku:
- `src/http/print.test.ts`: setelah commit, printer dimatikan (simulasi adapter) → HTTP 503 `PRINTER_UNAVAILABLE`, `retryable=true`, jumlah baris `sales`/`sale_items`/`payments`/`inventory_movements` tidak berubah, sale tetap bisa dibaca; setelah printer siap, cetak ulang 2× menghasilkan `saleNo` dan `text` identik tanpa baris baru.
- `src/print/service.test.ts`: harga katalog diubah setelah commit → struk tetap memakai `unit_price_rp` snapshot; ADMIN ditolak 403 saat `print` tetapi boleh `getReceipt`; kasir lain ditolak 403; akun nonaktif 401.
- `frontend`: status gagal dan tombol "Cetak ulang" tampil tanpa memanggil checkout; `PRINTER_UNAVAILABLE` 503 dipetakan ke `ApiError` retryable; halaman riwayat memuat dan mencetak struk dari `saleId` lama.

## 4. Branch / commit / PR

Branch `task/p21-021` dari `6722485`. Commit dan PR dicantumkan setelah perintah git dijalankan (lihat riwayat branch ini). Tidak ada merge sendiri.

## 5. Risiko, ketergantungan, asumsi DEMO

- **Konflik kontrak belum ditutup (K-03/AUTH-07):** `API_CONTRACT.md` L50–51 menulis owner/ADMIN untuk `POST /sales/:id/print`; `AUTHORIZATION.md` L36/47/98 dan audit TASK-001 mensyaratkan CASHIER own, ADMIN hanya baca. Implementasi memakai baseline konservatif; izin cetak ADMIN **tidak** ditambahkan. Perlu keputusan David + Rahmat (dan pengelola bila admin memang perlu cetak).
- Endpoint yang dipakai: `GET /sales/:id/receipt` dan `POST /sales/:id/print` (turunan scoped dari `GET /sales/:id` di kontrak). Perlu sinkronisasi dokumentasi API saat kontrak dikunci.
- Belum ada tabel status cetak; status gagal hanya berupa respons API + state UI. Audit cetak sengaja tidak ditambahkan agar tidak menyentuh whitelist audit lintas tugas.
- Printer fisik, driver, port, ESC/POS, dan PC tujuan **belum diuji** (VAL-04/TASK-005). Adapter virtual bukan pengganti uji perangkat.
- Tidak ada uang sungguhan; semua transaksi pengujian bersifat sintetis/DEMO.

## 6. Langkah berikutnya paling kecil

1. David/Rahmat menutup K-03: putuskan apakah `API_CONTRACT.md` L50–51 direvisi menjadi CASHIER own atau izin ADMIN cetak disahkan. Jangan mengubah kode sebelum keputusan.
2. Naazmi menjalankan TASK-005/TASK-024 pada printer nyata di PC tujuan: catat driver, port, hasil cetak, dan ulangi RC-09 dengan perangkat fisik.
3. Setelah bukti perangkat tersedia, TASK-031 (evaluasi Electron) dan TASK-024 (uji restart/printer/dua shift) dapat dilanjutkan.
