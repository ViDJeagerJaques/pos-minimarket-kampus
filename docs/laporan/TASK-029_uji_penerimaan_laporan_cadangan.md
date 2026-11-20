# TASK-029 - Uji penerimaan, laporan, dan cadangan

- Status: REVIEW
- Branch: task/p28-029 (dari master 79957e2, sudah termasuk PR #41 TASK-028)
- Owner: David
- Tanggal pengujian: 2026-11-20 malam sampai 2026-11-21 dini hari, zona PC Asia/Seoul (UTC+9)
- DB uji: C:\Users\USER\AppData\Local\Temp\pos-qa-task029-new.sqlite (terpisah, bukan DB asli pos-dev.sqlite)
- Tugas ini testing dan dokumen saja, tidak ada kode yang diubah.

## 1. Status

REVIEW. Regresi lulus semua, pengecekan terminal lulus semua, skenario layar 1 dan 3 PASS, skenario 2 PASS lewat API tetapi layarnya BLOCKED, checkout kasir manual PASS, tutup shift PASS, tetapi dashboard FAIL (BUG-100) dan cari struk FAIL (BUG-101). Transaksi dekat tengah malam, media fisik, dan uji tujuan backup gagal belum terbukti.

## 2. Apa yang selesai

- Regresi backend dan frontend dijalankan dan lulus.
- Skenario manual penerimaan, koreksi stok, laporan, backup/restore, checkout kasir, dan tutup shift dijalankan.
- Temuan dicatat sebagai BUG-100 dan BUG-101 di tabel TESTING & BUG.
- File yang diubah: docs/laporan/TASK-029_uji_penerimaan_laporan_cadangan.md (hanya laporan ini).

## 3. Perintah tes yang benar-benar dijalankan

- npm --prefix backend test: 158/158 PASS, typecheck backend PASS. Dijalankan David di terminal VS Code.
- npm test -- --testTimeout=15000 (di folder frontend): 199/199 PASS, 19 file, 16,79 detik, build frontend PASS. Dijalankan David di terminal VS Code.
- Catatan: run frontend pertama timeout saat menghentikan worker ReceivingPage.test.tsx. File itu sendirian lulus 10/10 dalam 5,95 detik, dan run ulang penuh lulus semua. Jadi flaky, bukan tes rusak.
- Backup dan restore lewat CLI (dari folder backend): node db/src/cli.ts backup, restore-test, dan inspect-backup.
- Koreksi stok lewat API: ADMIN alasan valid, alasan kosong, saldo negatif, dan CASHIER 403.
- Login dites lewat API dan proxy frontend (HTTP 200), lalu lewat layar browser.

## 4. Hasil skenario manual

1. Penerimaan: PASS. Terima dua produk, retry setelah respons hilang menghasilkan satu set mutasi, tidak dobel. Buang draft, jumlah invalid, dan gagal commit tidak mengubah saldo.
2. Koreksi stok: PASS lewat API. Produk 1 bertambah dari 22 menjadi 23, tercatat di ledger dan audit. Alasan kosong ditolak, koreksi yang membuat saldo negatif ditolak, CASHIER mendapat 403. Bagian layar BLOCKED: layarnya tidak ada, hanya tulisan "Belum tersedia di DEMO. Menunggu TASK-039 dan kunci idempotensi (TASK-001 K-11)." TASK-039 hanya backend, layarnya belum pernah dibikin.
3. Laporan: PASS. ID penjualan dan total cocok dengan SQLite (angka akhir di bawah). Checkout gagal tidak ikut. Transaksi dekat tengah malam belum terbukti.
4. Dashboard: FAIL (BUG-100, lihat bagian 5).
5. Backup dan restore: PASS. Backup valid dapat dipulihkan ke salinan terpisah, backup rusak ditolak dan DB aktif tetap utuh.
6. Checkout kasir manual: PASS (pertama kalinya kebukti ujung ke ujung). demo.kasir.sore, shift 102: 10x DEMO Teh Kemasan 350 ml @ Rp4.000 = Rp40.000, tunai Rp50.000, kembalian Rp10.000. Nomor penjualan S-000208, attempt co_bf1d2ce0-02ed-48b5-a7a5-182c925fd2a4, waktu 2026-11-20T14:59:28.674Z.
7. Cari struk: FAIL (BUG-101, lihat bagian 5).
8. Login: PASS. Awalnya gagal, saat observasi backend jalan di port 57438 padahal frontend mengarah ke 8787. Setelah backend dijalankan di 8787, login demo.kasir.sore dan demo.admin HTTP 200 lewat API, proxy, dan layar. Tidak ada HTTP 429. Penyebab semua kegagalan login sebelumnya belum terbukti, yang terbukti hanya beda port saat observasi itu.
9. Layar kasir: observasi, stok hanya label (Stok aman, Stok menipis), tidak ada angkanya. Angka stok ada di layar Penerimaan dan Laporan (menu admin).
10. Tutup shift: PASS. Pratinjau shift #102 cocok dengan SQLite (modal Rp100.000 + CASH Rp120.000 = uang tunai harapan Rp220.000, QRIS Rp33.000 tidak masuk kas tunai). Shift 102 ditutup 21 November 2026 pukul 00:17:50 Asia/Seoul.

## 5. Rekonsiliasi akhir (angka final)

Total 8 penjualan (ID 201-208): CASH 4 transaksi Rp126.000, QRIS_MANUAL 4 transaksi Rp43.000, total Rp169.000.

- Shift 101: CASH 1 transaksi Rp6.000, QRIS 2 transaksi Rp10.000.
- Shift 102: CASH 3 transaksi Rp120.000 (S-000205 Rp15.000, S-000206 Rp65.000, S-000208 Rp40.000), QRIS 2 transaksi Rp33.000 (S-000204 Rp3.000, S-000207 Rp30.000).

Catatan waktu: laporan versi awal mencatat snapshot saat baru 3 penjualan (201-203, total Rp16.000). Backup dibuat 20 November pukul 23:22:38 Asia/Seoul; penjualan pertama shift 102, S-000204, baru tersimpan pukul 23:26:27, dan S-000208 pukul 23:59:28. Jadi angka lama itu benar saat diperiksa, tetapi sudah tidak menggambarkan keadaan terbaru. Backend port 8787 memakai DB baru ini (POS_DB_PATH dibaca dari proses pemilik port, PID 25528). File QA lama pos-qa-029.sqlite masih berisi 3 penjualan (ID maksimum 203) dan tidak punya pembayaran shift 102.

## 6. Temuan

### BUG-100 (Major, Terbuka, owner Rahmat)

Dashboard admin menampilkan "Produk pada laporan stok tidak valid" dan tidak menampilkan angka sama sekali saat tombol Perbarui dashboard ditekan (tanggal 20/11/2026, zona Asia/Seoul, ambang 5).

Penyebab: backend menjumlahkan mutasi SALE sebagai delta negatif, tetapi validasi frontend mensyaratkan sale bilangan bulat nonnegatif. Nilai dari API: DEMO-001 sale -3 (mutasi -2 dan -1), DEMO-003 sale -2 (-1 dan -1), DEMO-004 sale -7 (-1, -4 dan -2), QA-HARGA-UBAH sale -1 (-1). Nilai ini cocok dengan jumlah delta di tabel inventory_movements, jadi data produk tidak rusak. Yang tidak cocok adalah kontrak nilai antara backend dan validasi frontend.

Kode: validasi di frontend/src/api/httpDataSource.ts:705-714 (isNonNegativeInt(raw.sale)), agregasi di backend/src/inventory/ledger.ts:169 (sumByKind SALE), laporan stok dibangun dari reconcileAll di backend/src/reports/service.ts. Keluarga BUG-082 (dulu field adjustment, sudah dibetulin di TASK-027).

Perbaikan yang disarankan: backend mengirim sale sebagai hitungan plus (jumlah terjual), karena receipt dan opening juga hitungan plus, dan delta bertanda sudah ada di movements. Perhitungan onHand di dalam tetap memakai nilai bertanda. PR lanjutan terpisah, jangan dicampur ke TASK-029.

### BUG-101 (Minor, Terbuka, owner Syafroni)

Cari struk pakai nomor penjualan S-000208 gagal, hanya angka polos yang diterima. Ketik S-000208 lalu Muat struk muncul "Masukkan ID transaksi berupa bilangan bulat positif." Ketik 000208 baru struk muncul.

Penyebab: ReceiptPage mengubah input dengan Number(), dan endpoint GET /sales/:id/receipt hanya menerima ID numerik. Padahal struk menampilkan "No. Penjualan: S-000208". Trik sementara: ketik angkanya saja tanpa S-, jadi 208.

Perbaikan yang disarankan: kotak cari menerima S-000208 juga, atau sekalian dibikin daftar riwayat (lihat bagian 7).

## 7. Saran perbaikan (ditampung, bukan bug)

- Format angka langsung di kotak uang diterima (ketik 50000 tampil 50.000) supaya kelebihan nol langsung kelihatan.
- Tombol uang pas dan tombol pecahan (10rb, 20rb, 50rb, 100rb) di layar bayar tunai.
- Riwayat/Struk sebaiknya daftar transaksi memanjang ke bawah, dipencet muncul struk aslinya (sekarang hanya kotak cari ID).

Yang sudah ada sebagai pengaman: dialog konfirmasi menampilkan total, uang diterima, dan kembalian sebelum commit, dan backend menolak tunai kurang dari total.

## 8. Yang belum diuji

- Transaksi dekat tengah malam dan batas tanggal (belum terbukti).
- Uji tujuan backup gagal ditulis (belum dilakukan).
- Media fisik kedua (PENDING LAPANGAN).
- Koreksi stok dan backup lewat layar (tidak ada UI, hanya API/CLI).
- Perangkat fisik (printer, scanner, PC tujuan) - di luar TASK-029.

## 9. Risiko dan syarat GO-LIVE

- Dashboard admin tidak bisa tampil selama BUG-100 belum diperbaiki.
- Admin tidak bisa koreksi stok atau backup dari layar.
- SOP pengelola (setoran, selisih, modal) belum disahkan (TASK-002).
- Status REVIEW ini bukan GO-LIVE.

## 10. PR, commit, branch

- Branch: task/p28-029. Commit dan PR belum dibuat saat laporan ini ditulis.
- Laporan ini diajukan untuk review. Laporan FAIL tetap diajukan, hasil gagal tidak disembunyikan.

## 11. Langkah berikutnya

- Perbaiki BUG-100 dan BUG-101 lewat PR lanjutan terpisah.
- Lanjut TASK-024 (Naazmi): uji restart, printer, dua shift.
