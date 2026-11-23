# BACKUP & RECOVERY — SQLite POS Minimarket Kampus

| Atribut | Nilai |
|---|---|
| Lokasi | `docs/security/BACKUP_RECOVERY.md` |
| Versi / status | 0.2.0 / 23 November 2026 — runbook DEMO untuk latihan; **belum disetujui pengelola untuk produksi** |
| Acuan | SCOPE S-10/S-12, AC-09.01–02, AC-10.02, DEC-015, `../architecture/DATABASE.md` §18, `docs/laporan/TASK-028_backup_restore_lokal.md` |

## 1. Tujuan dan batas

Backup harus memulihkan **database lengkap** (akun, transaksi final, upaya checkout, shift, pembayaran, mutasi stok, master barang, audit), bukan CSV/Excel. Setelah backup terakhir tidak ada jaminan pemulihan transaksi; RPO/RTO dan media luar perangkat **belum disetujui**.

> **Penting:** perintah `restore-test` yang tersedia di repo **hanya menyalin ke direktori uji**. Tidak ada perintah/endpoint yang menimpa database operasional. Pemulihan produksi tetap prosedur manual dengan maintenance mode dan persetujuan pengelola (Bagian 6).

## 2. Siapa melakukan apa

| Peran | Boleh | Tidak boleh |
|---|---|---|
| Operator Windows (non-developer) | Menjalankan perintah backup dan `restore-test` pada DB uji, mencatat hasil | Mengubah file DB dengan tangan, menghapus WAL/SHM, menjalankan restore produksi tanpa persetujuan |
| ADMIN aplikasi | Mengelola akun/katalog setelah login; meminta backup sebelum perubahan | Menjadi kasir pengganti pemilik shift (DEC-019 belum diputuskan) |
| Rahmat | Menyiapkan kandidat rilis, menjalankan backup pra-upgrade, mendampingi migrasi | Menjadi satu-satunya penentu GO-LIVE |
| Naazmi | Menjalankan latihan restore di DB uji dan mencatat langkah gagal | Menyatakan uji perangkat/GO tanpa bukti |
| Pengelola / David | Menyetujui jadwal, media, RPO/RTO, restore produksi, dan cutover | — |

## 3. Persiapan sekali (oleh Rahmat, dicatat di tiket)

1. Pastikan `POS_DB_PATH` atau `POS_DATA_DIR` menunjuk ke direktori data persisten **di luar repo/installer**. Cek dengan:
   ```powershell
   cd backend
   node db/src/cli.ts path
   ```
2. Tentukan root cadangan. Default: `<direktori DB>/backups`; bisa diganti dengan `POS_BACKUP_DIR` yang harus berada di luar source tree.
3. Tentukan root uji restore. Default: `<data dir>/restore-test`; bisa diganti dengan `POS_RESTORE_TEST_DIR`.
4. Siapkan media kedua (USB/drive lain) **setelah disetujui pengelola**. Belum ada persetujuan → tandai "salinan off-device belum ada".
5. Jangan pernah simpan kata sandi/bootstrap di perintah, repo, atau log. Sandi ADMIN pertama hanya lewat `POS_BOOTSTRAP_PASSWORD`.

## 4. Membuat backup

Backup memakai `VACUUM INTO` ke file sementara, diverifikasi, lalu di-rename atomik. Aman dilakukan saat aplikasi berjalan; untuk snapshot pra-upgrade/pra-restore **tutup aplikasi lebih dulu**.

```powershell
cd backend
# Backup dengan root default / env POS_BACKUP_DIR
node db/src/cli.ts backup --json

# Atau DB dan root tertentu
node db/src/cli.ts backup --db "C:\Data\pos-dev.sqlite" --dir "C:\Data\backups" --json

# Periksa isi cadangan tanpa menyentuh DB aktif
node db/src/cli.ts inspect-backup --db "<file-backup>.sqlite" --json
```

Periksa hasil: `integrity = ok`, `foreignKeyViolations = 0`, `schemaVersion` sesuai, `fileName` diawali `pos_` dan sama dengan file yang dibuat, `sha256` 64 hex, `sizeBytes > 0`, dan manifest `.json` berisi metadata yang sama. Gagal → jangan hapus backup lama; perbaiki penyebab (ruang/media/path) lalu ulang.

Salinan ke media kedua (manual, setelah ada persetujuan):
```powershell
$destinationDir = "E:\POS-Backup"
$destination = "$destinationDir\<nama>.sqlite"
New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
Copy-Item "<file-backup>.sqlite" $destination
Copy-Item "<file-backup>.sqlite.json" "$destination.json"
$manifest = Get-Content "$destination.json" | ConvertFrom-Json
$copiedHash = (Get-FileHash $destination -Algorithm SHA256).Hash
Write-Output "manifest.sha256 = $($manifest.sha256)"
Write-Output "copied.sha256   = $copiedHash"
if ($copiedHash -ne $manifest.sha256) { throw "Hash cadangan kedua tidak cocok dengan manifest." }
```
Hash file yang benar-benar disalin (`$destination`) ditampilkan berdampingan dengan `$manifest.sha256` dan dibandingkan; bila beda, perintah melempar error. Jangan mengambil nama file dari manifest untuk mencari file di media kedua. Bila manifest hilang, media gagal, atau hash beda, laporkan "cadangan kedua belum ada".

## 5. Latihan restore di DB uji (boleh dijalankan operator)

```powershell
cd backend
$env:POS_RESTORE_TEST_DIR = "C:\Data\restore-test"
node db/src/cli.ts restore-test --backup "<file-backup>.sqlite" --json
node db/src/cli.ts verify --db "<file-hasil-restore>.sqlite" --json
```

Perintah hanya membuat salinan baru dengan prefix `restored_`. Tidak menimpa DB aktif maupun backup. Periksa: `integrity=ok`, FK 0, `sha256` sama dengan sumber, jumlah baris **hanya untuk 11 tabel yang dihitung backend** (`users`, `products`, `sales`, `sale_items`, `payments`, `shifts`, `checkout_attempts`, `inventory_movements`, `goods_receipts`, `receipt_items`, `audit_log` — `REQUIRED_BACKUP_TABLES` di `backend/src/backup/service.ts`), dan contoh transaksi/stok sesuai titik backup. Tabel lain di skema (mis. `sessions`, `categories`, `shift_closings`, `checkout_attempt_quotes`, `inventory_adjustments`) tidak dibandingkan per baris, tetapi **tercakup oleh kesamaan SHA-256 seluruh file cadangan**.

Bukti latihan nyata ada di `docs/laporan/evidence/TASK-030/`: `qa-source-snapshot.json` dan `qa-restored-snapshot.json` identik (3 sale, 3 item, 3 payment, 2 shift, 10 mutasi, saldo per SKU sama, sale terakhir `S-QA-000203` pada `1762995781000`).

## 6. Restore produksi (MANUAL, butuh persetujuan)

1. Pastikan ada persetujuan tertulis pengelola, alasan, versi aplikasi/schema, waktu backup, dan catatan transaksi setelah titik backup.
2. Tutup aplikasi kasir dan backend. Pastikan tidak ada checkout/shift yang masih menulis. Jika ada transaksi ambigu → cek status `attemptKey` dulu; jangan tagih ulang.
3. Buat snapshot DB aktif **sebelum** penggantian memakai perintah `backup` di Bagian 4. Simpan salinan lama untuk rollback.
4. Lakukan `restore-test` dulu (Bagian 5) dan verifikasi hasilnya. Jika gagal, berhenti; DB produksi belum tersentuh.
5. Penggantian file DB operasional **tidak diotomatisasi** oleh repo. Operator berwenang melakukan atomic replace di direktori data yang sama setelah penulis mati, dengan WAL/SHM diperlakukan sebagai satu set. Simpan file lama, jangan hapus.
6. Jalankan smoke test offline: login ADMIN/kasir, katalog, sale historis, stok, shift tertutup/terbuka, struk cetak ulang, dan backup baru. Jangan buat transaksi uji permanen.
7. Jika verifikasi gagal: matikan hasil restore, kembalikan file pra-restore, dan hentikan cutover sampai investigasi selesai.
8. Catat `restoredBy`, `approvedBy`, sumber backup, hasil, selisih transaksi pasca-backup, dan penerimaan pengelola.

## 7. Upgrade, rollback, dan migrasi

1. Jadwalkan setelah shift ditutup. Catat versi lama/baru dan commit. **Siapkan/pathkan versi kandidat lebih dulu** (source checkout atau paket uji) sebelum menjalankan langkah apa pun yang memakai perintah `migrate` kandidat; jangan menjalankan `migrate` dari versi lama sebagai "uji migrasi".
2. Tutup aplikasi. Buat snapshot pra-upgrade terverifikasi (Bagian 4) dan latih restore (Bagian 5). Untuk paket desktop, snapshot juga bisa dibuat dengan `node maintenance.mjs snapshot "<direktori-data-absolut>"` memakai `resources/runtime/node.exe` (khusus mode DEMO).
3. Dengan **versi kandidat yang sudah dipasang di lingkungan uji**, jalankan migrasi dan verifikasi pada salinan uji:
   ```powershell
   node db/src/cli.ts migrate --db "<salinan>.sqlite"
   node db/src/cli.ts verify --db "<salinan>.sqlite" --json
   ```
   Pastikan perintah berasal dari kandidat (cek commit/versi di lingkungan uji).
4. Pasang kandidat ke lingkungan operasional tanpa menghapus data. Jalankan `migrate` pada data operasional **hanya setelah langkah 3 lulus dengan kandidat yang sama**. Penulis tetap ditutup sampai verifikasi operasional selesai.
5. Rollback: **ikuti Bagian 6 langkah 2 dan 5** — matikan aplikasi beserta semua penulis, lalu kembalikan executable **dan** database dari snapshot pra-upgrade dengan WAL/SHM diperlakukan sebagai satu set (atomic replace setelah penulis mati, bukan `restore-test`). Mengembalikan executable saja tidak membalik migrasi skema. Simpan file versi gagal, lalu jalankan `verify` dan smoke test Bagian 6.
6. Bukti latihan: `upgrade-migrate.log`, `rollback-restore.json`, dan `rollback-snapshot.json` di `docs/laporan/evidence/TASK-030/` menunjukkan migrasi tanpa perubahan skema dan hasil rollback identik dengan sumber. **Upgrade dengan migrasi skema baru belum diuji.**

## 8. Kasus gagal

| Insiden | Tindakan aman |
|---|---|
| Ruang disk penuh / media gagal | Error jelas, backup baik lama tetap ada; jangan hapus otomatis |
| Backup korup / hash beda | Tolak restore; DB produksi tidak diubah; evaluasi backup lain |
| Restore uji gagal | Hentikan, jangan lanjut ke produksi; perbaiki sumber/path |
| Listrik mati saat checkout | Restart, cek status `attemptKey`, saldo, integritas; jangan minta bayar ulang |
| QRIS ambigu | Cek aplikasi merchant + status upaya; eskalasi rekonsiliasi |
| Shift terbuka saat restore | Hentikan operasi; evaluasi titik backup bersama pengelola |

## 9. Gate GO / bukti

| ID | Latihan yang tersedia | Hasil nyata | Status |
|---|---|---|---|
| BAK-01 | Backup DB QA dengan sale/shift/stok | Snapshot `integrity=ok`, hash/manifest cocok | **PASS (DEMO/u test)** |
| BAK-03 | Restore ke salinan uji | Snapshot sumber = salinan (lihat evidence TASK-030) | **PASS (DB uji)** |
| BAK-04 | Restore file rusak | Ditolak exit 1, hash DB aktif sama, tidak ada salinan baru | **PASS (simulasi)** |
| BAK-06 | Rollback upgrade pada salinan | Snapshot rollback = sumber | **PASS (tanpa migrasi skema baru)** |
| BAK-02/05/07 | Media dicabut, listrik mati, hilangnya disk | **BLOCKED / PENDING LAPANGAN** | belum diuji |
| Persetujuan pengelola | media, jadwal, retensi, RPO/RTO, restore produksi | **BELUM ADA** | PENDING |

## 10. Belum final

Lokasi USB/drive, jadwal/retensi, RPO/RTO, penjaga media, dan prosedur penggantian DB produksi belum disetujui. Jangan menaikkan status dokumen ini hanya karena latihan DEMO lulus.
