# BACKUP & RECOVERY — SQLite POS Minimarket Kampus

| Atribut | Nilai |
|---|---|
| Lokasi | `docs/security/BACKUP_RECOVERY.md` |
| Versi / status | 0.1.0 — runbook usulan untuk uji; **belum terbukti di PC tujuan** |
| Acuan | SCOPE S-10/S-12, AC-09.01–02, AC-10.02, DEC-015, `../architecture/DATABASE.md` §18, `../architecture/ARCHITECTURE.md` §14 |

## 1. Tujuan dan kesalahan yang harus dihindari

Backup harus bisa memulihkan **database lengkap** (akun, transaksi final, upaya checkout, shift, pembayaran, mutasi stok, master barang, audit), bukan hanya laporan Excel. File CSV/Excel boleh untuk laporan, **bukan** pengganti SQLite. Satu PC dapat rusak/dicuri sehingga salinan harus ada di media yang berbeda.

Tidak ada backup yang menjamin pemulihan transaksi setelah waktu backup terakhir. Untuk cutover, pengelola harus menerima batas kehilangan data yang mungkin terjadi (RPO) dan waktu pemulihan (RTO); **angka final belum disetujui**.

## 2. Strategi yang diusulkan

| Saat | Pemicu | Hasil yang diharapkan | Tanggung jawab |
|---|---|---|---|
| Setiap penutupan shift | Setelah commit penutupan sukses | Snapshot SQLite terverifikasi + salinan di media lain | Backend/ADMIN sesuai SOP |
| Harian | Sebelum pergantian/penutupan operasional | Cadangan kedua jika shift tidak ditutup tepat waktu | ADMIN/Operator |
| Sebelum migrasi/update/restore | Sebelum perubahan destruktif | Snapshot pra-perubahan yang dapat dipulihkan | Rahmat/Naazmi |
| Berkala | Latihan restore di lokasi terpisah | Laporan checksum, `quick_check`/`integrity_check`, FK dan sampling bisnis | Naazmi |

Tentukan jadwal dan retensi bersama pengelola (contoh pilot 7 harian + 4 mingguan sebagai **PROPOSED**), jangan membuat pencadangan berjalan tanpa diketahui operator.

## 3. Format dan penyimpanan

- Nama snapshot contoh: `pos_20261111T093000Z_<backupId>.sqlite`, dengan metadata `schemaVersion`, `appVersion`, `createdAt`, `size`, `SHA-256`, `operatorId`, `sourceDbId` bila tersedia, dan hasil verifikasi. Jangan masukkan password/token mentah dalam manifest.
- Lokasi hasil **di luar direktori instalasi dan di luar repo**; tujuan cadangan tambahan berupa drive/USB atau storage lain yang dikelola, bukan folder yang sama di satu disk.
- Gunakan **SQLite online backup API** lewat driver yang kompatibel atau mekanisme snapshot resmi yang teruji; alternatif salin ketika database **ditutup terkendali dan diverifikasi**. Jangan raw-copy file `.sqlite` yang sedang aktif tanpa menangani WAL/SHM.
- File tulis sementara di direktori aman, verifikasi snapshot lalu rename atomik pada volume yang sama; backup gagal tidak menimpa cadangan baik. Jika media tujuan berbeda, copy lalu verifikasi checksum di tujuan.

## 4. Prosedur membuat backup

1. Backend memastikan ADMIN terautentikasi dan tujuan backup sudah ditetapkan dalam whitelist konfigurasi; catat actor dan correlation ID.
2. Pastikan tidak sedang memproses restore/update. Gunakan mekanisme backup SQLite yang memberi snapshot konsisten; hindari lock berkepanjangan yang mengganggu checkout.
3. Tulis ke file sementara; tutup handle; buka salinannya dalam mode aman untuk pemeriksaan `PRAGMA integrity_check` (atau `quick_check` untuk cek cepat) dan `PRAGMA foreign_key_check`.
4. Verifikasi tabel penting ada serta `sales`, `payments`, `inventory_movements`, `checkout_attempts`, `shifts` dapat dibaca; cek versi schema didukung.
5. Catat metadata & hash; promosikan menjadi backup berhasil. Copy ke media kedua, baca ulang hash; bila gagal, tandai **cadangan kedua belum ada** (jangan melaporkan sukses penuh).
6. Audit hasil sukses/gagal tanpa menyertakan lokasi rahasia berlebihan. UI menampilkan waktu backup terakhir, lokasi kategori media, dan status pemulihan terakhir yang **benar-benar diuji**.

## 5. Runbook restore — WAJIB dalam maintenance mode

**Prasyarat:** operator berwenang, persetujuan pengelola, seluruh checkout selesai, aplikasi kasir tidak melayani pelanggan, file sumber terverifikasi, ada snapshot pra-restore dan catatan transaksi setelah titik backup.

1. Catat alasan restore, persetujuan, versi aplikasi/schema, waktu backup dan rentang transaksi yang mungkin hilang.
2. Hentikan penulis DB/backend secara terkendali; pastikan tidak ada operasi checkout/shift aktif yang masih menulis. Jika pelanggan menunggu, pakai SOP operasional cadangan, bukan restore sembarangan.
3. Salin backup ke **direktori uji terisolasi**; validasi hash (jika manifest tersedia), `integrity_check`, `foreign_key_check`, kompatibilitas versi schema, akun/admin, data sales/shift, dan saldo ledger.
4. Buat backup lengkap DB aktif *sebelum penggantian*. Pastikan lokasi DB aktif persisten dan file WAL/SHM diperlakukan secara konsisten oleh adapter; jangan hanya menimpa file utama saat koneksi terbuka.
5. Dengan penulis mati, ganti dataset menggunakan prosedur driver yang teruji (atomic replace pada volume sama jika sesuai, atau pemulihan transaksi di direktori baru); simpan salinan lama untuk rollback.
6. Jalankan smoke test login offline, katalog, contoh sale historis, stok, shift tertutup/terbuka dan invoice/struk; **jangan** membuat transaksi uji permanen di DB produksi tanpa pembatalan prosedural.
7. Jika verifikasi gagal, matikan versi hasil restore dan kembalikan database pra-restore; hentikan cutover sampai investigasi dan rekonsiliasi selesai.
8. Dokumentasikan `restoredBy`, `approvedBy`, versi, sumber backup, hasil, selisih transaksi setelah backup, dan penerimaan pengelola.

## 6. Kasus gagal dan respons

| Insiden | Tindakan aman | Yang tidak boleh dilakukan |
|---|---|---|
| Ruang disk penuh saat backup | Gagal jelas, pertahankan snapshot baik, bebaskan ruang secara terkontrol | Hapus backup baik otomatis tanpa retensi disetujui |
| USB dicabut | Tandai copy off-device gagal, minta operator ulang | Klaim backup aman hanya karena ada salinan lokal |
| Backup korup/versi tak cocok | Tolak restore tanpa mengubah produksi | Memaksa impor tabel parsial lalu membuang sale |
| Listrik mati saat checkout | Restart, cek status `attemptKey`, saldo dan integritas | Minta pembeli bayar lagi tanpa rekonsiliasi |
| QRIS sudah terbayar, sale belum pasti | Cek merchant + status upaya; eskalasi ke pengelola | Membuat sale kedua atau membalik pembayaran tanpa SOP |
| PC mati total | Gunakan media cadangan ke PC pengganti setelah perangkat/installer diuji | Asumsikan data setelah backup telah kembali |
| Restore saat shift terbuka | Hentikan operasi, evaluasi titik backup dan shift bersama pengelola | Menutup/mengubah shift manual di DB |

## 7. Uji penerimaan sebelum GO

| ID | Fixture / tindakan | Lulus jika |
|---|---|---|
| BAK-01 | Seed produk, dua shift, sale CASH/QRIS, adjustment dan penerimaan; buat backup saat DB aktif | Snapshot konsisten, semua tabel/relasi cocok titik backup |
| BAK-02 | Putus media saat menyalin | Backup lama utuh, status error jujur |
| BAK-03 | Restore backup valid ke folder/PC uji terpisah | `integrity_check=ok`, `foreign_key_check` kosong; saldo, transaksi, shift sesuai |
| BAK-04 | Restore file rusak atau path salah | Gagal tanpa mengubah DB produksi |
| BAK-05 | Listrik mati/restart setelah checkout commit | Satu sale, satu payment, status upaya dapat dibaca |
| BAK-06 | Update aplikasi dengan schema dan data nyata uji | Backup pra-update ada, migrasi/rollback dapat dipulihkan |
| BAK-07 | Simulasi hilangnya disk PC | Media off-device cukup untuk restore; gap pasca-backup tercatat |

## 8. Keputusan terbuka dan batas implementasi

Belum ada persetujuan lokasi USB/drive, jadwal/retensi, RPO/RTO, pihak pemegang media, prosedur restore saat layanan buka, dan kompatibilitas SQLite driver pada Windows aktual. `POST /backups` ada dalam API_CONTRACT.md tetapi **endpoint restore belum dispesifikasikan**; jangan mengarang route restore berbahaya. Bisa disediakan sebagai prosedur operator lokal terisolasi terlebih dulu. Integrasi cloud backup tidak termasuk P0.
