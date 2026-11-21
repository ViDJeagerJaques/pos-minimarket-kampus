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
| Rekonsiliasi | `counts`, saldo ledger, uang, `integrity_check`, `foreign_key_check` sebelum/sesudah tiap skenario; saldo produk juga dibandingkan dengan `OPENING 10 + Σ mutasi −4 = 6` |

## 4. Matriks AC (hasil nyata)

| AC | Aksi nyata | Ekspektasi | Hasil aktual | Bukti | Status |
|---|---|---|---|---|---|
| AC-04.01 | Prepare 1×Rp5.000; dua commit paralel attemptKey+hash sama; replay identik; replay nominal tunai diubah; hash salah | Satu saleId untuk semua upaya identik; replay mengembalikan uang asli; hash beda ditolak 409 | Dua klik & retry → `saleId` sama; replay tender Rp9.999 → 200 dengan `cashReceivedRp=5000`; hash 64 nol → 409 `IDEMPOTENCY_CONFLICT`; delta sale 1 | Tes #9 | **PASS** |
| AC-04.02 | Respons prepare selesai lalu SIGKILL, restart, cek status, lanjut commit; respons commit selesai lalu SIGKILL, restart, cek status | Nol parsial; PREPARED bisa dilanjut; COMMITTED & sale sama, tanpa dobel | Nol parsial; status `PREPARED` → commit sukses; status `COMMITTED` dengan `saleId=2`, `saleNo=S-000002`; tanpa sale tambahan | Tes #4–#5 | **PASS (terbatas, lihat §7)** |
| AC-04.03 | Baca struk; cetak saat adapter gagal; cetak ulang 2× dengan adapter virtual; kasir B & ADMIN coba cetak | Gagal cetak 503 tanpa mutasi; reprint sama nomor/isi; non-owner 403 | 503 `PRINTER_UNAVAILABLE`, sale/stok utuh; `saleNo=S-000002` identik di dua reprint & teks sama; kasir B 403 | Tes #6 | **PASS (printer virtual)** — printer fisik **PENDING LAPANGAN** |
| AC-05.01 | Tiga `POST /shifts/open` bersamaan (A, A, B); lalu dua open paralel kasir A; ADMIN coba buka | Satu shift aktif; ADMIN 403 | 3-way: satu 200 + dua 409, tepat satu baris shift aktif; A/A: 200 + 409 `SHIFT_ALREADY_OPEN`; kasir B `null`; ADMIN 403 | Tes #2 | **PASS** |
| AC-05.02 | Logout owner → token lama 401 → login ulang; ganti proses child; login ulang; cek shift A & B | Shift ID/waktu sama; owner lanjut, kasir B tidak | ID & `openedAtMs` identik setelah logout/login dan penggantian proses; token lama 401; kasir B `null`. Ini **bukan uji graceful shutdown** (Windows `kill()`) | Tes #3 | **PASS (penggantian proses backend)** — graceful shutdown, restart frontend & PC mati **NOT RUN** |
| AC-06.01 | Preview tutup shift 1 dengan `declaredCashRp = expectedCashRp`; close | Rekap CASH/QRIS & selisih sesuai fixture DEMO | `varianceRp=0`, `totals.totalSalesRp>0`, rekap tersimpan; `GET /shifts/current` → null | Tes #7 | **PASS** |
| AC-06.02 | (a) close & commit paralel; (b) urutan close lebih dulu; (c) urutan commit lebih dulu lalu close; (d) checkout shift tertutup | Kedua urutan: close 200 + tepat satu penutupan baru; commit dulu masuk rekap, close dulu menolak 409 | (a) close=200, +1 penutupan, commit=409; (b) commit=409 `SHIFT_NOT_ACTIVE`, tanpa sale; (c) commit=200, `saleCount=1`, `cashRp=5000`; (d) 409 `SHIFT_NOT_ACTIVE` | Tes #8, #10, final | **PASS** |
| AC-06.03 | close nominal invalid; close sah; restart; retry closeKey sama; closeKey isi beda | Invalid mempertahankan shift; retry mengembalikan totals & selisih asli; isi beda 409 | 422 & shift tetap aktif; retry setelah restart `closeKey`, `totals`, `varianceRp`, `declaredCashRp`, `expectedCashRp` identik & penutupan tidak bertambah; isi beda 409 | Tes #7, #11 | **PASS** |

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

Verifikasi di atas dijalankan pada HEAD `b119c77` dengan perbaikan CodeRabbit belum ter-commit; harness **12/12 PASS**, backend **157/158** (BUG-097 EPERM), frontend **199/199**.

### 6.1 Perbaikan temuan CodeRabbit PR #43 (BUG-102–BUG-116)

Semua 15 temuan diverifikasi terhadap kode saat ini dan ditangani di harness/laporan (kode produk 0 perubahan):

| Bug | Tindakan |
|---|---|
| BUG-102 | Hash salah sekarang wajib 409 `IDEMPOTENCY_CONFLICT` (500 tidak diterima) |
| BUG-103 | Sebelum PASS `REKONSILIASI`, assert `finalSnap.reconciled === true` dan `stock === expectedStock` |
| BUG-104 | Assert kedua teks struk bertipe string & non-empty sebelum dibandingkan |
| BUG-105 | Klaim "graceful" dihapus; ini penggantian proses child, bukan shutdown rapi |
| BUG-106 | Retry close membandingkan `closeKey`, `shiftId`, `totals`, `varianceRp`, `declaredCashRp`, `expectedCashRp` |
| BUG-107 | Race: close wajib 200 + tepat satu penutupan baru; kedua urutan (close-first & commit-first) diuji eksplisit |
| BUG-108 | Commit setelah close wajib 409 `SHIFT_NOT_ACTIVE`; 500 tidak diterima |
| BUG-109 | `startInProcess` menutup DB bila server gagal start; `inProcess` diisi hanya setelah sukses |
| BUG-110 | `reconciled` membandingkan stok dengan saldo ledger (OPENING 10 + Σ mutasi −4 = 6) |
| BUG-111 | Cakupan AC-04.02 dipersempit jujur: crash setelah respons prepare/commit diterima; tidak ada injeksi kegagalan saat tulis DB (lihat §7) |
| BUG-112 | Replay tender Rp9.999 → 200 dengan `saleId` & `cashReceivedRp=5000` asli; label diubah jadi replay |
| BUG-113 | `stopChild` mengenali `exitCode` atau `signalCode`, tidak menyinyal proses yang sudah mati, menunggu konfirmasi exit setelah SIGKILL (maks 3 detik, gagal → error) |
| BUG-114 | Cleanup temp berada di `finally` bersarang agar tetap jalan bila `writeEvidence` melempar; error tetap propagate |
| BUG-115 | Laporan menyatakan keterbatasan crash-saat-prepare (§7) |
| BUG-116 | Tes #2 juga menjalankan buka bersamaan A/A/B → satu 200, dua 409, satu baris shift aktif; identitas pemilik dipakai untuk reset fixture |

## 7. Temuan, risiko, dan yang belum terbukti

- **Tidak ada bug kehilangan/dobel uang atau stok** pada cakupan yang dieksekusi. Tidak ada temuan kritis yang perlu ditriase.
- **Batas AC-04.02 (BUG-115):** harness tidak menyuntik kegagalan *di tengah tulis DB* maupun *antara commit tersimpan dan pengiriman respons*. Yang dibuktikan adalah crash setelah respons `prepare` diterima penuh (sebelum commit) dan crash setelah respons `commit` diterima penuh. Skenario "crash saat prepare aktif" dan "commit tersimpan tapi respons hilang" **tidak tercakup** dan tetap menjadi utang uji (TASK-019/TASK-024 lanjutan).
- **Penggantian proses bukan graceful shutdown (BUG-105):** pada Windows `child.kill()` tidak dapat dianggap sebagai shutdown terkendali; tes #3 hanya membuktikan shift persisten setelah proses diganti, bukan penutupan aplikasi yang rapi.
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
