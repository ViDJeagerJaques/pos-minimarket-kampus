# TASK-028 — Buat Cadangan dan Validasi Restore Lokal

| Atribut | Isi |
|---|---|
| Tugas | TASK-028 · Coding DEMO · Owner Rahmat · Reviewer David, Naazmi |
| Referensi | POS-09.01/AC-09.01, POS-09.02/AC-09.02 · DEC-015 · BACKUP_RECOVERY.md, DATA_PROTECTION.md |
| Branch | `task/p27-028` (lokal; belum commit/PR saat laporan dibuat) |
| Basis | `origin/master` @ `7e012bf` (memuat TASK-008, TASK-025, TASK-039) |
| Tanggal | 20 November 2026 |
| Status | **REVIEW** — backup/restore uji lulus 4 tes backend; media fisik dan PC tujuan belum diuji |
| Lingkup | Backup SQLite konsisten, verifikasi metadata, restore hanya ke salinan uji |

## 1. Yang dibuat

| Path | Isi |
|---|---|
| `backend/src/backup/service.ts` | `createBackup`, `verifyBackup`, `restoreBackupToTestCopy`, pembatasan root |
| `backend/src/backup/service.test.ts` | 4 tes: backup→restore cocok, tujuan gagal, backup rusak, root dibatasi |
| `backend/db/src/cli.ts` | Perintah operator `backup` dan `restore-test` |
| `backend/package.json`, `backend/README.md` | Daftar tes + §16 |

Aturan:

- **Snapshot resmi**: `VACUUM INTO` ke file sementara pada koneksi baru (bukan
  raw-copy DB aktif yang sedang memakai WAL). Tidak boleh di dalam transaksi.
- **Verifikasi sebelum promosi**: `integrity_check`, `foreign_key_check`,
  `user_version > 0`, keberadaan 11 tabel penting, jumlah baris, ukuran, dan
  SHA-256. File sementara di-rename atomik ke nama unik; file lama tidak
  ditimpa.
- **Lokasi dibatasi backend**: default `<direktori DB>/backups` atau
  `POS_BACKUP_DIR`; keduanya harus di luar source tree. Manifest JSON menyimpan
  metadata tanpa kredensial.
- **Restore hanya ke salinan uji**: root terpisah
  (`POS_RESTORE_TEST_DIR` / data dir), `COPYFILE_EXCL`, verifikasi sumber dan
  salinan. Tidak ada endpoint/perintah yang menimpa database operasional.
- **Kegagalan aman**: tujuan tidak bisa ditulis → error jelas, backup lama
  utuh; file rusak → ditolak sebelum menyalin, DB aktif tidak berubah.

## 2. Verifikasi yang dijalankan

| Perintah | Hasil |
|---|---|
| `npm run typecheck` | **PASS**, exit 0 |
| `npm test` | **PASS 156/156**, 0 fail, ±30,3 s |
| `node db/src/cli.ts backup ...` + `restore-test ...` (manual, DB temp) | **PASS** — backup `integrity=ok`, restore salinan uji hash sama |

Bukti: backup dari DB dengan 1 sale/1 item/1 payment/1 shift/3 mutasi menghasilkan
laporan `integrity=ok`, FK 0, hash 64 hex, manifest ada; restore ke DB terpisah
menghasilkan `sale_no=S-BACKUP-1`, total 5000, stok 6 (= 5 + 3 − 2), dan
jumlah tabel sama. Tujuan backup berupa file → error, hash backup lama sama.
File bukan SQLite → `integrity_check` gagal, restore ditolak, hash DB aktif
sama, tidak ada salinan uji. Root di luar konfigurasi → ditolak.

## 3. Risiko / belum diuji

- Salinan di media fisik berbeda (USB/drive), jadwal/retensi, RPO/RTO, dan
  pemegang media **belum disetujui** (BACKUP_RECOVERY.md §8).
- Restore ke database operasional sengaja tidak diimplementasikan; masih
  memerlukan maintenance mode, snapshot pra-restore, persetujuan pengelola,
  dan uji PC tujuan.
- Belum diuji: Windows nyata, listrik mati saat backup, media penuh/dicabut,
  dan ukuran database representatif.

## 4. Git

Branch `task/p27-028` dari `origin/master` @ `7e012bf`. Commit/PR akan
dicantumkan setelah perintah Git dijalankan.

## 5. Langkah berikutnya

1. Review David/Naazmi untuk root cadangan, manifest, dan batas restore uji.
2. TASK-024/035 menguji backup-restore pada PC tujuan dan media kedua.
3. Tetapkan jadwal, retensi, RPO/RTO, dan prosedur restore operasional dengan
   pengelola sebelum GO-LIVE.
