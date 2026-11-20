# TASK-040 — Dashboard minimum ADMIN

## Status

**REVIEW**. Branch `task/p26-040` dari `origin/master` `93c030d` (origin/HEAD
terverifikasi master). Dependensi nyata TASK-022 dan TASK-026 tersedia; TASK-039
juga telah merge. Lingkup hanya frontend dan dokumentasi, tanpa perubahan backend,
skema, dependency, ataupun aturan transaksi. Prompt menempatkan prioritas P1,
sementara TASKS.md/PRD masih P0; prioritas dokumen tidak diubah.

Ketertelusuran: POS-08.03 / AC-08.03, DEC-014/016/018, DESIGN_SYSTEM bagian 5.5.

## File berubah

- `frontend/src/pages/DashboardPage.tsx`: dashboard ADMIN, kartu omzet/transaksi,
  CASH vs QRIS_MANUAL, ringkasan penjualan per shift, stok habis/menipis,
  tanggal lokal, ambang, timestamp, loader/error/empty state, guard role dan unmount.
- `frontend/src/pages/DashboardPage.test.tsx`: 11 tes baru, fixture dua shift,
  dua metode, saldo 0/2/8, izin, filter, retry, truncation, response terlambat dan DEMO.
- `frontend/src/App.tsx`: ganti placeholder dashboard dengan halaman aktual.
- `frontend/src/App.receivingAttempt.test.tsx`: fixture query stok disesuaikan
  karena dashboard otomatis meminta laporan saat ADMIN login; skenario recovery tetap diuji.
- `frontend/src/components/DailyReportPanel.tsx`: ekspor helper tanggal yang sudah
  tersedia untuk dipakai dashboard, termasuk batas hari berikutnya aman DST.
- `frontend/src/api/mockDataSource.ts`: fixture sintetis laporan harian mengikuti
  rentang/shift, dua metode dan total konsisten; ambang stok diteruskan mock.
- `frontend/src/styles/app.css`: kartu hijau/oranye dari token, grid responsif.
- `frontend/README.md`: sumber angka, filter, retry, batas ringkasan shift.
- Laporan ini: bukti dan handoff.

## Verifikasi aktual

Lingkungan Windows, Node v24.18.0, Vitest/jsdom, backend SQLite sementara sintetis.
Perintah dijalankan dari root memakai --prefix (ekuivalen cd frontend/backend).

| Perintah | Hasil | Log lokal |
| --- | --- | --- |
| `npm --prefix frontend run typecheck` | PASS | `.git/task040-logs/frontend-typecheck.log` |
| `npm --prefix frontend test` | PASS 195/195, 19 file | `.git/task040-logs/frontend-test.log` |
| `npm --prefix frontend run build` | PASS | `.git/task040-logs/frontend-build.log` |
| `npm --prefix backend test` | PASS 152/152 | `.git/task040-logs/backend-test.log` |
| `git diff --check` | PASS | pemeriksaan diff lokal |

Log mentah lokal tidak di-commit. Tes terarah dashboard + recovery awal 16/16;
regresi frontend awal 194/194, final 195/195 setelah tes konsistensi mock ditambah.
Percobaan dev awal mendeteksi encoding non-UTF-8 pada file baru; sudah dikoreksi,
dan build final lulus. Tidak ada tes gagal yang ditinggalkan.

Bukti perilaku:

- UI fixture: omzet 10000, 3 transaksi, CASH 7500 dan QRIS 2500; shift 10 omzet
  7500 dan shift 11 omzet 2500. Satu produk habis dan satu menipis; angka kartu
  memakai laporan, bukan saldo keranjang. Fixture mock terpisah selalu berlabel DEMO.
- Backend regresi `src/reports/reportQueries.test.ts`: dua shift, CASH/QRIS,
  draft/ABANDONED tidak menambah omzet, rentang [start,end), saldo dari ledger.
  `src/http/reportQueries.test.ts` membuktikan API laporan menolak CASHIER 403.
- Backend yang tidak diubah tetap membuktikan atomicity, idempotensi, rollback,
  dan konsistensi SQLite melalui suite checkout/penerimaan/koreksi stok.
- Browser nyata in-app pada server Vite DEMO `127.0.0.1:5174`: login admin.demo,
  loader dan dashboard terlihat; kartu hijau/oranye, tanggal, jumlah transaksi,
  nominal CASH terpisah dari QRIS ditinjau melalui screenshot. Ini inspeksi visual
  DEMO, bukan browser end-to-end dengan database nyata atau bukti PC kasir tujuan.

## Batas dan risiko

- Tidak ada endpoint daftar/status shift untuk ADMIN yang diperlukan UI ini.
  Ringkasan adalah penjualan per shift dari rincian committed, bukan rekap kas
  penutupan atau status shift aktif/tutup. Shift tanpa sale tidak tercantum.
- Rincian harian dibatasi backend; bila salesTruncated, ringkasan shift tidak
  dijumlahkan dari data parsial. UI menyatakan batas ini dan mengarahkan ke menu
  Laporan dengan filter ID shift. Kartu omzet tetap total lengkap backend.
- Zona PC dan ambang awal 5 unit eksplisit sebagai asumsi DEMO; SOP zona/ambang
  belum disahkan. Stok adalah snapshot terkini, bukan historis tanggal filter.
- Penjualan dan stok diambil dari dua endpoint; waktu pembaruan terpisah,
  tidak mengklaim snapshot lintas endpoint atomik.
- CodeRabbit CLI tidak terpasang; review lokal tidak dijalankan. CI/review remote
  belum diklaim lulus. Uji perangkat, printer/scanner, offline sebelum start,
  responsif di PC tujuan dan GO-LIVE belum dibuktikan.
- File lokal `.ua/` dan `set-sandi-qa.mjs` dipertahankan, tidak masuk commit.

## Langkah berikutnya

Badouka memeriksa CI, CodeRabbit dan diff PR. Tidak merge oleh agent.
Dashboard siap uji integrasi pada backend berisi fixture dua shift dan dua metode;
Naazmi melanjutkan AC-08.03 di lingkungan lokal/PC tujuan untuk TASK-035/041.
GO-LIVE tetap menunggu SOP, rekonsiliasi dan izin pengelola.
