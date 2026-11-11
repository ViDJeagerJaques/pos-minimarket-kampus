# DEPLOYMENT — Instalasi Windows, Upgrade, dan Cutover

| Atribut | Nilai |
|---|---|
| Lokasi | `docs/operations/DEPLOYMENT.md` |
| Versi / tanggal | 0.1.0 / 11 November 2026 |
| Status | BASELINE PROSEDUR DAN RENCANA — belum dilaksanakan atau disetujui pengelola |
| Dasar | `docs/product/SCOPE.md` v0.1.1; `docs/product/ACCEPTANCE_CRITERIA.md` v0.1.1; `docs/product/TASKS.md` v0.2.1; `docs/security/SECURITY_CHECKLIST.md` v0.1.0 |

## 1. Sasaran dan ketergantungan
Target rilis: satu PC Windows kasir, scanner barcode dan printer struk, transaksi lokal offline. React/Express/Electron adalah **kandidat** sesuai `../architecture/TECH_STACK.md` (DEC-010/011 masih PROPOSED), jadi langkah build berikut adalah **rancangan prosedur**, bukan perintah tervalidasi. Jangan menyatakan installer siap sebelum stack dan native SQLite driver diuji pada PC target.

## 2. Catatan inventaris wajib sebelum build
| Hal | Isi lapangan (belum tersedia) |
|---|---|
| PC Windows: versi, arsitektur, RAM, disk, hak install | BELUM DIUJI |
| Scanner barcode: model, mode USB keyboard-wedge, nol awal | BELUM DIUJI |
| Printer struk: model, kertas, koneksi, driver | BELUM DIUJI |
| Lokasi SQLite persisten dan permissions | BELUM DISETUJUI; jangan simpan di folder installer |
| Media backup berbeda disk dan penjaganya | BELUM DISETUJUI |
| Nama dan kanal QRIS merchant (HP) | BELUM DIVALIDASI |
| Format ekspor POS lama dan jumlah SKU | BELUM DIKETAHUI |
| Langganan lama habis tanggal | Hanya diketahui Desember 2026; tanggal pasti belum ada |

## 3. Pembuatan candidate release (oleh Rahmat, review Naazmi)
1. Tetapkan commit Git, tag kandidat dan lockfile dependensi yang teruji. Pastikan perubahan DEC yang masih PROPOSED sudah dikonfirmasi tim sebelum dikunci.
2. Instal dependensi dari lockfile (`npm ci` hanya jika repo memang menggunakan npm dan memiliki lockfile); jalankan typecheck, unit, integration/API tests. Catat perintah aktual dan hasilnya.
3. Build renderer, backend dan Electron main/preload; pastikan tidak memuat URL CDN runtime, auto-update/telemetry online tanpa persetujuan, secret, database uji atau file `.env` nyata di paket.
4. Bangun installer Windows sesuai packaging yang **telah dibuktikan bekerja** di perangkat target; cek arsitektur/ABI native SQLite termasuk operasi backup saat packaged.
5. Buat manifest rilis: commit, app version, schema version, nama file installer, SHA-256, target OS, dependensi perangkat, hasil pengujian. Untuk installer unsigned, risiko warning SmartScreen/AV dan prosedur penerimaan harus diketahui pengelola; jangan mematikan antivirus untuk mengakali masalah.

## 4. First install pada PC tujuan
1. Dapatkan persetujuan jadwal maintenance, catat data lama dan backup terlebih dahulu. Hindari mengganggu transaksi yang berjalan.
2. Pastikan disk cukup, akun Windows/permission cocok, waktu PC benar, scanner dan printer tersedia, serta rute local service bind ke 127.0.0.1 dan dilindungi sesi.
3. Pasang aplikasi; data SQLite harus di direktori data aplikasi persisten milik profil/mesin (path tepat mengikuti implementasi dan diuji), **bukan** di direktori instalasi atau repository.
4. Bootstrap ADMIN dengan prosedur aman tanpa password default; buat CASHIER setelah hak akses diverifikasi. Catat sesi saat logout dan restart.
5. Jalankan migrasi pada database **uji dulu**; untuk data operasional lakukan backup pra-migrasi yang valid, lalu migrasi terkontrol dan cek `PRAGMA integrity_check`, `foreign_key_check`, schema version, saldo serta histori.
6. Siapkan import katalog/stock awal dari ekspor POS lama. Rekonsiliasi seluruh SKU, barcode, harga, stok, duplikasi dan barang tanpa barcode dengan pengelola. **Jangan mulai operasional jika selisih belum diselesaikan.**
7. Jalankan smoke test tunai offline, QRIS manual sesuai SOP, dua shift berurutan, cetak/ulang, dashboard, backup dan restore terisolasi. Simpan hasil `AC-10.01/02/03`.

## 5. Upgrade yang aman
- Jadwalkan setelah shift ditutup dan tidak ada checkout menunggu. Identifikasi sale/QRIS berstatus ambigu sebelum maintenance.
- Catat manifest versi lama dan baru, buat snapshot pra-upgrade terverifikasi ke media kedua, **uji restore di lokasi terpisah**. Jangan uninstall dengan opsi hapus data.
- Pasang versi baru dan lakukan migrasi kompatibel; bila gagal, hentikan operasi, pulihkan paket dan DB sesuai runbook `../security/BACKUP_RECOVERY.md`. **Mengembalikan executable saja belum tentu membalik migrasi schema.**
- Periksa login, akun, transaksi historis, saldo, shift, printer dan backup setelah upgrade. Catat siapa yang menyetujui.

## 6. Migrasi dan cutover dari POS lama
1. Minta ekspor data dan daftar fitur yang benar-benar dipakai pengelola, termasuk retur/kredit atau debit lain bila ternyata ada.
2. Bekukan waktu snapshot katalog; cocokkan laporan SKU/harga/stok pada waktu yang disepakati; transaksi antara snapshot dan cutover harus dicatat agar stok tidak tertinggal.
3. Lakukan rehearsal import **di salinan**. Buktikan impor kedua tidak menggandakan SKU, cek barcode unik dan produk tanpa barcode.
4. Jalankan operasi paralel **yang diizinkan pengelola**: perbandingan penjualan/stock dengan prosedur yang tidak menggandakan pembayaran atau mengurangi stok dua kali. Rekam selisih.
5. Uji rollback melalui backup valid dan prosedur kembali ke POS lama yang masih tersedia. Minta tanda tangan kasir/pengelola untuk `AC-GO-01`.
6. **GO**: setelah semua gate lulus, lakukan cutover pada awal periode/shift yang disetujui, catat total awal dan nomor akhir transaksi sistem lama. **NO-GO**: tetap pada POS lama/perpanjangan atau SOP alternatif tertulis yang disetujui, jangan paksa tenggat.

## 7. Checklist eksekusi rilis
```text
Release tag/commit; versi schema; SHA-256 installer:
Perangkat dan versi Windows (bukti):
Versi dan lokasi backup off-device + hasil restore:
SKU, barcode, harga, saldo awal reconciliation + sign-off:
Hasil AC-10.01/02/03, SEC-G01..20, AC-GO-01:
Open risks / bug (blocker=0):
Tanggal dan jam cutover disetujui:
Rollback owner dan jalur POS lama:
GO atau NO-GO, alasan, tanda tangan pengelola:
```
