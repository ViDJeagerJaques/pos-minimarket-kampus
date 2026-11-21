# Laporan TASK-024 — Uji Restart, Printer, dan Dua Shift

| Atribut | Nilai |
|---|---|
| Tugas | TASK-024 (P29) — Uji restart, printer, dan dua shift |
| Tanggal eksekusi | 2026-11-21 |
| Branch / HEAD | `task/p29-024` · `b119c77587bb8f42cc2574064c430904b7ba6fc7` (master setelah PR #42 / TASK-029) |
| Owner / penguji | Naazmi (QA) — eksekusi oleh AI agent QA, perlu review Naazmi/Rahmat/David |
| Lingkungan | Windows `win32 10.0.26200 (x64)`; Node `v24.22.3` portable (di luar repo) |
| Mode data | DEMO/QA sintetis; SQLite sementara `%TEMP%/pos-task024-e2e-*`, dihapus setelah uji |
| Status | **REVIEW — 12/12 pemeriksaan E2E PASS untuk jalur API/DB/printer-virtual nyata; PENDING LAPANGAN untuk printer fisik, PC tujuan, dan uang sungguhan** |

> Tugas ini **testing + dokumen saja**. Tidak ada perubahan kode produksi, API, skema, atau aturan stok/uang.

## 1. Status dan ringkasan

Terbukti dengan backend nyata + SQLite + SIGKILL proses sungguhan + adapter printer yang disuntikkan lewat DI:

- Shift aktif **tidak tertutup** saat logout→login ulang owner maupun saat proses backend di-restart; ID/waktu buka identik; kasir lain tetap tidak melihat shift itu, token lama 401.
- Crash (`SIGKILL`) **sebelum commit** → nol data parsial, upaya tetap `PREPARED`, lanjut commit niat sama → 1 sale. Crash **sesudah commit** → status `COMMITTED` & `saleId` sama ditemukan, tanpa penagihan/penjualan ulang.
- Printer gagal → 503 `PRINTER_UNAVAILABLE`, sale/payment/stok tidak berubah; cetak ulang 2× menghasilkan `saleNo` dan teks identik tanpa baris baru.
- Dua shift: buka paralel → tepat satu aktif; tutup dengan rekap & selisih 0; retry `closeKey` identik satu hasil, isi beda 409, nominal invalid 422; `close` vs `checkout` paralel konsisten (close menang → commit ditolak; commit menang → sale masuk rekap).

**Tidak ada bug kritis yang ditemukan** dalam cakupan yang dieksekusi. Namun:

- Printer yang gagal dan yang dipakai cetak ulang adalah **adapter virtual** (`VIRTUAL_OFFLINE` / `VIRTUAL`), bukan ESC/POS nyata. Uji printer fisik **PENDING LAPANGAN** (VAL-04/TASK-005/TASK-035).
- Seluruh bukti berasal dari API + SQLite + log, bukan browser/Electron, bukan PC kasir tujuan, bukan uang sungguhan. **Bukan GO-LIVE.**

## 2. File yang dibuat / diubah

| Path | Alasan |
|---|---|
| `scripts/task-024_restart_printer_shifts_e2e.mjs` | Harness QA baru: child CLI nyata (SIGKILL/restart) + server in-process dengan adapter printer gagal/virtual + 12 pemeriksaan + snapshot rekonsiliasi + bukti JSON |
| `docs/laporan/TASK-024_uji_restart_printer_dua_shift.md` | Laporan ini |
| `docs/laporan/evidence/TASK-024/task024-evidence.json` | 66 requestId, 12 tes, snapshot sebelum/sesudah |
| `docs/laporan/evidence/TASK-024/task024-e2e.log`, `task024-backend-test.log`, `task024-frontend-test.log` | Log eksekusi nyata |

Dependensi coding dicek nyata di checkout: `backend/src/print/service.ts` + `printer.ts` (virtual & failing adapter), `backend/src/shift/service.ts` (buka/tutup + closeKey), `backend/src/checkout/service.ts` (prepare/commit/status), dan `scripts/task-018_offline_slice_e2e.mjs` semuanya ada dan lulus regresi.

## 3. Lingkungan dan metode

| Item | Nilai / bukti |
|---|---|
| Commit diuji | `b119c77587bb8f42cc2574064c430904b7ba6fc7` |
| OS / Node | `win32 10.0.26200 (x64)` / `v24.22.3` |
| DB uji | `%TEMP%\pos-task024-e2e-lnUNRW\task024.sqlite` (sementara, dihapus) |
| Server utama | child process `node src/http/cli.ts serve` di `127.0.0.1`, port acak; di-`SIGKILL` 2× lalu dimulai ulang |
| Printer gagal | server in-process dengan `createPrintService(db, { printer: createFailingPrinterAdapter(...) })` → kanal `VIRTUAL_OFFLINE` |
| Cetak ulang | server in-process dengan `createVirtualPrinterAdapter()` → kanal `VIRTUAL` |
| Akun | 1 ADMIN + 2 CASHIER sintetis (A pemilik shift, B bukan pemilik) |
| Produk | SKU `T24-PROD`, Rp5.000, stok awal +10 (`OPENING` sintetis) |
| Rekonsiliasi | `counts`, saldo ledger, uang, `integrity_check`, `foreign_key_check` sebelum/sesudah tiap skenario |

## 4. Matriks AC (hasil nyata)

| AC | Aksi nyata | Ekspektasi | Hasil aktual | Bukti | Status |
|---|---|---|---|---|---|
| AC-04.01 | Prepare 1×Rp5.000; dua commit paralel attemptKey+hash sama; replay identik; hash salah | Satu saleId untuk semua upaya identik; hash/kunci beda ditolak | Dua klik & retry → `saleId` sama; hash 64 nol ditolak; delta sale 1 | Tes #9 | **PASS** |
| AC-04.02 | SIGKILL sebelum commit, restart, cek status, lanjut commit; SIGKILL sesudah commit, restart, cek status | Sebelum commit: nol parsial; PREPARED bisa dilanjut. Sesudah commit: COMMITTED & sale sama, tanpa dobel | Nol parsial; status `PREPARED` → commit sukses; status `COMMITTED` dengan `saleId=2`, `saleNo=S-000002`; tanpa sale tambahan | Tes #4–#5 | **PASS** |
| AC-04.03 | Baca struk; cetak saat adapter gagal; cetak ulang 2× dengan adapter virtual; kasir B & ADMIN coba cetak | Gagal cetak 503 tanpa mutasi; reprint sama nomor/isi; non-owner 403 | 503 `PRINTER_UNAVAILABLE`, sale/stok utuh; `saleNo=S-000002` identik di dua reprint & teks sama; kasir B 403 | Tes #6 | **PASS (printer virtual)** — printer fisik **PENDING LAPANGAN** |
| AC-05.01 | Dua `POST /shifts/open` paralel oleh kasir A; ADMIN coba buka | Satu shift aktif; ADMIN 403 | 200 + 409 `SHIFT_ALREADY_OPEN`; kasir B `null`; ADMIN 403 | Tes #2 | **PASS** |
| AC-05.02 | Logout owner → token lama 401 → login ulang; restart child; login ulang; cek shift A & B | Shift ID/waktu sama; owner lanjut, kasir B tidak | ID & `openedAtMs` identik setelah logout/login dan restart; token lama 401; kasir B `null` | Tes #3 | **PASS (restart backend)** — restart frontend/PC mati **NOT RUN** |
| AC-06.01 | Preview tutup shift 1 dengan `declaredCashRp = expectedCashRp`; close | Rekap CASH/QRIS & selisih sesuai fixture DEMO | `varianceRp=0`, `totals.totalSalesRp>0`, rekap tersimpan; `GET /shifts/current` → null | Tes #7 | **PASS** |
| AC-06.02 | (a) close & commit paralel; (b) commit lebih dulu lalu close; (c) checkout shift tertutup | Serial & konsisten: commit dulu masuk rekap, close dulu menolak checkout | (a) close=200, commit=409, sales delta 0; (b) commit=200, `saleCount=1`, `cashRp=5000`; (c) 409 `SHIFT_NOT_ACTIVE` | Tes #8, #10, final | **PASS** |
| AC-06.03 | close nominal invalid; close sah; restart; retry closeKey sama; closeKey isi beda | Invalid mempertahankan shift; retry identik satu hasil; isi beda 409 | 422 & shift tetap aktif; retry setelah restart `closeKey` sama & jumlah penutupan tidak bertambah; isi beda 409 | Tes #7, #11 | **PASS** |

Status **FAIL: tidak ada**; **BLOCKED: tidak ada** dalam cakupan yang dijalankan.

## 5. Rekonsiliasi akhir

| Metrik | Nilai |
|---|---|
| `sales` / `sale_items` / `payments` | 4 / 4 / 4 |
| `saleNos` | `S-000001` … `S-000004` |
| `saleTotalRp` = `paymentTotalRp` | Rp20.000 |
| `inventory_movements` | 5 (OPENING +10, SALE −4) |
| Stok akhir | 6 (= 10 − 4) |
| `shifts` / `shift_closings` | 5 / 5 (activeShifts 0) |
| `audit_log` | 20 entri |
| `integrity_check` / `foreign_key_check` | `ok` / 0 |

Semua `reconciled === true` pada setiap titik before/after.

## 6. Perintah yang benar-benar dijalankan

Node portable `v24.22.3` dengan `PATH` diset; `npm.cmd` (PowerShell script execution disabled).

```powershell
# Dari folder backend/ (branch task/p29-024, HEAD b119c77):
npm.cmd test                       # 157/158 PASS, 1 FAIL (BUG-097 symlink EPERM — environment Windows)

# Dari folder frontend/:
npm.cmd test                       # 199/199 PASS
npm.cmd test -- --testTimeout=30000 # 199/199 PASS (ulang, timeout lingkungan)

# Dari root repo:
node scripts/task-024_restart_printer_shifts_e2e.mjs --json-out <path>  # 12/12 PASS
```

Catatan baseline: `frontend` juga diulang dengan `npm test -- --testTimeout=30000` → **199/199 PASS** (timeout bawaan sempat membuat 2 tes jsdom timeout lingkungan, bukan kegagalan logika). Backend **157/158**: satu-satunya gagal adalah `BUG-097: symlink di root ...` karena `symlinkSync` menghasilkan `EPERM` pada Windows tanpa Developer Mode; ini keterbatasan environment, bukan functional bug produk, dan tidak menyinggung AC TASK-024.

Log mentah: `docs/laporan/evidence/TASK-024/`.

## 7. Temuan, risiko, dan yang belum terbukti

- **Tidak ada bug kehilangan/dobel uang atau stok** pada cakupan yang dieksekusi. Tidak ada temuan kritis yang perlu ditriase.
- Printer fisik (ESC/POS, driver, port), uang tunai/QRIS nyata, scanner, resolusi 1366×768, PC 4 GB, Electron, dan installer **belum diuji**. Adapter virtual bukan pengganti perangkat (VAL-04).
- `SIGKILL` adalah simulasi mati listrik/CRASH pada proses backend di DB uji; bukan pemadaman daya sungguhan (TASK-035).
- Token sesi berada di memori proses; setelah restart/login ulang kasir harus login lagi — sesuai desain, bukan bug.
- Konflik izin cetak ADMIN (K-03/AUTH-07) masih terbuka; harness menguji CASHIER own + ADMIN ditolak sesuai implementasi saat ini.
- SOP setoran/selisih masih `PENDING` (DEC-016); `varianceRp=0` di sini murni aritmetika DEMO.
- CI dan CodeRabbit tidak dijalankan/diperiksa dalam sesi ini; tidak ada klaim review otomatis.

## 8. Langkah berikutnya paling kecil

1. Naazmi/Rahmat/David review laporan; setelah disetujui, commit `task/p29-024` dan buka PR ke `master` dengan rujukan TASK-024 / AC-04.* / AC-05.* / AC-06.* (jangan merge sendiri).
2. TASK-005/TASK-035: ulangi RC-09 (cetak ulang) dan skenario restart pada printer fisik & PC tujuan; catat driver/port & nomor struk.
3. TASK-030/TASK-034/TASK-041: kunci runbook pemulihan, SOP setoran, dan keputusan GO/NO-GO dengan pengelola sebelum transaksi sungguhan.

## 9. Status Git

- Branch aktif `task/p29-024` (base `origin/master` @ `b119c77`, base diperbarui via `git fetch` + `git pull --ff-only` sebelum branch dibuat).
- HEAD `b119c77587bb8f42cc2574064c430904b7ba6fc7`.
- Perubahan baru belum di-commit saat laporan dibuat. Commit/push/PR menyusul sesuai PERINTAH.
