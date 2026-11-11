# TEST PLAN — Rencana Verifikasi POS Offline-First

| Atribut | Nilai |
|---|---|
| Lokasi | `docs/operations/TEST_PLAN.md` |
| Versi / tanggal | 0.1.0 / 11 November 2026 |
| Status | BASELINE PROSEDUR DAN RENCANA — belum dilaksanakan atau disetujui pengelola |
| Dasar | `docs/product/SCOPE.md` v0.1.1; `docs/product/ACCEPTANCE_CRITERIA.md` v0.1.1; `docs/product/TASKS.md` v0.2.1; `docs/security/SECURITY_CHECKLIST.md` v0.1.0 |

## 1. Tujuan dan batas
Menguji **perilaku nyata** sistem untuk target satu PC Windows, dua role (ADMIN/CASHIER), dua shift berurutan, transaksi CASH dan QRIS_MANUAL. Rencana ini tidak menyatakan satu pun fitur sudah lulus. Dasar penerimaan adalah `../product/ACCEPTANCE_CRITERIA.md`, bukan jumlah test yang dibuat agent.

**Tiga lingkungan:** (1) unit/integrasi pada DB sintetis; (2) installer Windows pada mesin uji terpisah; (3) PC kasir sebenarnya dengan dataset yang sudah direkonsiliasi, dengan prosedur uji tanpa membuat penjualan sungguhan yang keliru. Tidak menggunakan DB produksi untuk fault injection. Pengujian QRIS nyata hanya dengan izin pengelola dan prosedur pembatalan/rekonsiliasi resmi; selain itu gunakan simulasi dan pengamatan tanpa uang riil.

## 2. Pelaksana dan tanggung jawab
| Peran | Tanggung jawab | Tidak boleh menggantikan |
|---|---|---|
| Naazmi (QA) | Fixture, eksekusi test, catat kegagalan dan bukti, retest independen | Tidak menandai PASS hanya berdasar laporan AI |
| Rahmat (backend/integrasi) | Unit/API/DB test; analisis transaksi, printer adapter, backup/restore | Tidak menyetujui sendirian cutover |
| Syafroni (frontend) | Uji alur kasir/admin, validasi input, offline renderer, scanner | Tidak mengandalkan guard UI untuk keamanan |
| David (koordinator) | Rekonsiliasi barang, SOP pengelola, triase blocker dan matriks coverage | Tidak menganggap asumsi sebagai persetujuan minimarket |
| Kasir/pengelola | UAT berdasarkan proses kerja sebenarnya dan persetujuan GO/NO-GO | Tidak diminta memverifikasi SQL atau rahasia akses |

## 3. Entry dan exit criteria
**Masuk uji:** kode ada pada commit yang diketahui; migrasi bersih berhasil; fixture dan akun uji tersedia; environment terisolasi; AC yang diuji dan hasil yang diharapkan jelas. Jika fitur belum diimplementasikan, status `BLOCKED/NOT RUN`, bukan `PASS`.

**Keluar uji:** seluruh AC P0 serta `SEC-G01`–`SEC-G20` memiliki bukti; bug P0/P1 kritis tertutup dan diuji ulang; migrasi seluruh SKU, dua shift, backup dari media kedua, scanner/printer, offline, restart, rollback installer dan SOP QRIS/setoran telah diuji; pengelola menandatangani keputusan. Satu blocker penting berarti **NO-GO**, terlepas dari tenggat.

## 4. Lapisan dan prioritas pengujian
| Lapisan | Skenario wajib | Alat (kandidat, bukan kewajiban) |
|---|---|---|
| Unit | uang dalam integer rupiah, validasi barcode/harga, hash checkout, selisih shift, stok negatif | Vitest |
| DB/integrasi | FK, unique idempotency, atomic checkout, concurrency checkout vs close, mutasi stok, rollback | SQLite pada driver runtime final |
| API | auth/403, prepare/commit/status, retried payload berbeda, QRIS manual, closed shift, koreksi stok | Supertest/HTTP client |
| UI/E2E | scan/manual, checkout tunai, QRIS terverifikasi, error yang jelas, print ulang, role navigation | Playwright/manual |
| Perangkat | keyboard-wedge scanner, printer + driver, offline total, restart, installer Windows | pengujian manual di PC target |
| Operasional | rekonsiliasi impor, backup off-device dan restore, pergantian dua shift, UAT/rollback | checklist bertanda tangan |

## 5. Dataset dan kondisi tepi minimum
- Akun: 1 ADMIN, 2 CASHIER aktif, 1 kasir nonaktif, sandi benar/salah; akun tidak menggunakan data personal asli.
- Barang: barcode dengan nol awal, barcode ganda, tanpa barcode, aktif/nonaktif, harga berubah setelah draft, stok 0/1/5, dua kategori, supplier; nominal Rp5.000 dan uang kembalian.
- Shift: satu aktif, dua permintaan open bersamaan, restart ketika masih aktif, dua shift berurutan, modal awal, tunai/QRIS terpisah, close dan checkout bertabrakan.
- Kerusakan: kehilangan respons setelah commit, listrik simulasi dengan kill proses pada DB uji, disk penuh simulasi, printer offline, USB cadangan dicabut, backup rusak dan file versi tak cocok.
- QRIS: belum dibayar, bukti gagal, nominal berbeda, konfirmasi valid oleh kasir, sudah terbayar tetapi POS/merchant status belum pasti. Jangan ulang permintaan bayar fisik otomatis.

## 6. Pelaksanaan dan bukti
Urutan: siapkan fixture → catat hash commit/versi aplikasi dan perangkat → jalankan langkah AC → baca hasil di UI dan DB (tidak hanya UI) → simpan bukti yang disamarkan → tandai `PASS`, `FAIL`, `BLOCKED`, atau `NOT RUN` → buat issue untuk FAIL → retest pada commit perbaikan. Gunakan template `TEST_CASES.md` dan `../product/ACCEPTANCE_CRITERIA.md` §6.

**Triase:** `BLOCKER` = salah hitung/hilang/ganda uang atau stok, bypass izin, restore gagal, tidak bisa beroperasi; `HIGH` = fungsi P0 atau perangkat utama gagal; `MEDIUM/LOW` = tak menghambat transaksi dengan solusi disetujui. Severity tidak otomatis membuat GO; pengelola tetap menilai risikonya.

## 7. Jadwal uji terhadap target 14 hari (usulan)
- Hari 1–3: fixture, test hardware, data lama, validasi SOP. Coding API bukan syarat untuk melakukan inventarisasi.
- Hari 4–7: login, barang, stok, shift, tunai dan atomic checkout; jalankan test setiap PR.
- Hari 8–10: QRIS manual, laporan, printer, backup, installer, negative cases.
- Hari 11–12: restore, impor dan uji paralel terkontrol, UAT; blocker segera ditriase.
- Hari 13–14: regression penuh, cutover rehearsal, keputusan GO/NO-GO. Jika belum lulus, perpanjang sistem lama / gunakan alternatif yang disetujui.
Jadwal ini tidak membuktikan bahwa tanggal 25 November pasti tercapai.

## 8. Traceability dan keputusan terbuka
Peta lengkap ID tes ke AC ada pada `TEST_CASES.md`; checklist keamanan mengacu pada `../security/SECURITY_CHECKLIST.md`. VAL-01 s.d. VAL-08 di `../product/SCOPE.md` tetap **BLOCKED** sampai bukti pengelola/alat ada. Konflik izin `POST /shifts/open` dan hak cetak ulang ADMIN antara API/Security harus ditutup secara resmi sebelum test final yang bersangkutan.
