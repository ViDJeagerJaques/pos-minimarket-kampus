# DEPLOYMENT — Instalasi Windows, Upgrade, dan Cutover

| Atribut | Nilai |
|---|---|
| Lokasi | `docs/operations and qa/DEPLOYMENT.md` |
| Versi / tanggal | 0.2.0 / 23 November 2026 |
| Status | Runbook DEMO untuk latihan; **belum disetujui pengelola untuk produksi** |
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

## 2A. Perintah yang benar-benar tersedia (cek sebelum latihan)

Jalankan dari `backend/`. Semua perintah lokal/offline; tidak ada endpoint restore produksi.

```powershell
node db/src/cli.ts path
node db/src/cli.ts migrate [--db <file>] [--no-backup] [--json]
node db/src/cli.ts verify [--db <file>] [--json]
node db/src/cli.ts seed --demo [--db <file>]
node db/src/cli.ts backup [--db <file>] [--dir <root>] [--json]
node db/src/cli.ts inspect-backup --db <file> [--json]
node db/src/cli.ts restore-test --backup <file> [--dir <root>] [--json]
node src/auth/cli.ts bootstrap-admin --username <nama>   # sandi dari POS_BOOTSTRAP_PASSWORD
node src/http/cli.ts serve [--db <file>] [--port <n>]     # untuk smoke test manual
node maintenance.mjs snapshot "<direktori-data-absolut>" # paket desktop, mode DEMO
```

`restore-test` hanya membuat salinan di root uji (`POS_RESTORE_TEST_DIR`). Penggantian DB operasional tidak diotomatisasi; lihat `../security/BACKUP_RECOVERY.md` §6.

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

## 5. Upgrade yang aman (operator non-developer)

**Siapa:** Rahmat menyiapkan paket; operator Windows menjalankan; Naazmi mencatat hasil; pengelola menyetujui jadwal dan GO/NO-GO.

1. Jadwalkan setelah shift ditutup dan tidak ada checkout menunggu. Catat versi lama/baru, commit, dan status QRIS ambigu bila ada.
2. **Tutup aplikasi kasir/backend.** Cek tidak ada proses yang menulis DB. Jangan lanjut jika kasir masih melayani pelanggan.
3. Buat snapshot pra-upgrade terverifikasi:
   ```powershell
   cd backend
   node db/src/cli.ts backup --json
   node db/src/cli.ts inspect-backup --db "<file-backup>.sqlite" --json
   ```
   Untuk paket desktop: `node maintenance.mjs snapshot "<direktori-data-absolut>"` dengan `resources/runtime/node.exe` (mode DEMO).
4. Latih restore ke salinan uji sebelum menyentuh data operasional:
   ```powershell
   node db/src/cli.ts restore-test --backup "<file-backup>.sqlite" --json
   node db/src/cli.ts verify --db "<file-hasil-restore>.sqlite" --json
   ```
5. Uji migrasi pada salinan dulu, lalu pasang versi baru dan jalankan migrasi pada data operasional. Jangan memilih opsi uninstall yang menghapus data.
6. Titik verifikasi: login offline, akun ADMIN/CASHIER, sale historis, stok/ledger, shift tertutup, cetak ulang struk, dan backup baru berhasil.
7. **Rollback bila gagal:** tutup aplikasi, kembalikan executable **dan** database dari snapshot pra-upgrade (penggantian file DB manual dengan WAL/SHM konsisten; bukan `restore-test`), lalu jalankan `verify` dan smoke test. Simpan salinan versi gagal untuk investigasi. Hentikan cutover bila verifikasi rollback gagal.
8. Bukti latihan pada salinan ada di `docs/laporan/evidence/TASK-030/` (`upgrade-migrate.log`, `rollback-restore.json`, `rollback-snapshot.json`). Upgrade dengan migrasi skema baru **belum diuji**.

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
