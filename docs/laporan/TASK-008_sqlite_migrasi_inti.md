# TASK-008 — SQLite dan Migrasi Inti

| Atribut | Isi |
|---|---|
| Tugas | TASK-008 · Coding · Owner Rahmat · Reviewer David |
| Referensi | POS-03.05/AC-03.05, POS-07.02/AC-07.02, POS-10.02/AC-10.02 · DEC-004, DEC-007 |
| Branch | `task/p04-008` (lokal, belum di-push/PR) |
| Basis | `origin/master` @ `f45d396` |
| Tanggal | 13 November 2026 |
| Status | **REVIEW** — fondasi DB lulus tes development; review migrasi David/Rahmat dan uji produksi belum ada |
| Lingkup | Database development, runner migrasi, constraint, seed sintetis, runbook |

> Dokumen ini mencatat bukti yang benar-benar dijalankan. Tidak ada klaim
> persetujuan pengelola, uji perangkat, cutover, atau CodeRabbit review.

## 1. Yang dibuat

| Path | Isi |
|---|---|
| `backend/db/migrations/0001_core_schema.sql` | DDL `DATABASE.md` v0.2.1 §6 + indeks §16, tanpa tabel bisnis tambahan |
| `backend/db/src/paths.ts` | Lokasi data persisten di luar repo, guard source tree |
| `backend/db/src/db.ts` | Koneksi penulis (`foreign_keys=ON`, WAL, `synchronous=FULL`, `busy_timeout`), pemeriksaan integritas |
| `backend/db/src/migrate.ts` | Runner transaksional, versi skema, checksum immutable, rollback |
| `backend/db/src/backup.ts` | Snapshot `VACUUM INTO` + verifikasi sebelum migrasi |
| `backend/db/src/seed.ts` | Seed sintetis DEMO berlapis pengaman |
| `backend/db/src/cli.ts` | Perintah `migrate`, `verify`, `seed`, `path`, `inspect-backup` |
| `backend/db/test/*.test.ts` | 21 tes `node --test` (migrasi, constraint, seed, kegagalan, keamanan path) |
| `backend/package.json` | Script DB, `engines: node >= 24`, tanpa dependensi |
| `backend/README.md` | Cara menjalankan, backup, rollback, batasan |
| `.gitignore` | Database, WAL/SHM, cadangan, dependensi, rahasia |

Desain kunci:

- Satu file migrasi = satu transaksi. DDL SQLite transaksional, jadi kegagalan
  di tengah tidak menyisakan tabel parsial.
- Versi ganda: `PRAGMA user_version` + `schema_migrations` (checksum SHA-256
  ternormalisasi CRLF) untuk mendeteksi file yang berubah/hilang.
- Runner menolak `BEGIN/COMMIT/ROLLBACK/SAVEPOINT/VACUUM/PRAGMA` di file migrasi.
- Snapshot pramigrasi otomatis pada DB berskema sebelum migrasi baru, dan
  diverifikasi sebelum dipakai.
- Seed hanya `--demo`, menolak `NODE_ENV=production`, `POS_DB_PROFILE=operational`,
  DB berisi data, dan tidak dapat dijalankan dua kali.
- `users.password_hash` seed berisi `DEMO_LOCKED_NO_LOGIN`; TASK-009 wajib
  menolaknya sehingga akun demo tidak bisa login.

## 2. Verifikasi yang dijalankan

Lingkungan: Windows, PowerShell, Node.js 26.13.1 (portable, di luar repo),
SQLite 3.54.1, database di direktori temp OS (di luar source tree). Mesin ini
tidak memiliki Node/npm/sqlite3 global.

| # | Perintah | Hasil |
|---|---|---|
| V1 | `node --test db/test/migrate.test.ts db/test/constraints.test.ts db/test/seed.test.ts db/test/failure.test.ts db/test/safety.test.ts` | **PASS 21/21**, 0 fail (±1,2 s) |
| V2 | `node db/src/cli.ts migrate` pada DB kosong | **PASS** — `Menerapkan 0001_core_schema.sql`, versi 1, `integrity_check=ok`, `foreign_key_check=0` |
| V3 | `node db/src/cli.ts migrate` diulang | **PASS** — `Tidak ada migrasi baru`, diterapkan `[]` |
| V4 | `node db/src/cli.ts seed --demo` dua kali | **PASS** — pertama diterapkan, kedua `Seed dilewati ... sudah pernah dijalankan`; jumlah baris sama |
| V5 | `node db/src/cli.ts verify` | **PASS** — `user_version 1`, `foreign_keys ON`, `journal_mode wal`, `synchronous 2`, `integrity ok`, `foreign_key_ch 0`, 19 tabel + view `stock_balances` |
| V6 | `node db/src/cli.ts migrate --db <salinan DB>` | **PASS** — salinan versi uji dikenali versi 1, `appliedVersions []` |
| V7 | Tes kegagalan migrasi `0002` (tabel + insert + SQL invalid) | **PASS** — rollback penuh: `user_version` tetap 1, `schema_migrations` hanya 1 baris, tabel parsial tidak ada, data lama utuh, `foreign_key_check` kosong, cadangan pramigrasi valid (`userVersion 1`, `integrity ok`), lalu file diperbaiki → migrasi 2 berhasil |
| V8 | Tes kegagalan migrasi pertama pada DB kosong | **PASS** — `user_version 0`, hanya `schema_migrations`, tidak ada tabel bisnis; setelah file diperbaiki → versi 1 |
| V9 | Tes checksum/urutan/versi | **PASS** — file berubah, file hilang, dan `user_version` lebih baru ditolak |
| V10 | Tes constraint (FK, barcode, sesi, shift, pembayaran, ledger) | **PASS** — semua input invalid ditolak; barcode `0000000000017` tetap sebagai teks; saldo view sesuai ledger |
| V11 | Tes seed (produksi, non-empty, belum migrasi, idempotensi) | **PASS** |
| V12 | Tes guard path + `.gitignore` | **PASS** — DB di dalam repo ditolak tanpa membuat file |

Bukti perilaku detail ada di output tes; tidak ada file log terpisah yang
di-commit (agar tidak memuat path/data lokal).

### 2.1 Cakupan AC

| AC | Terbukti di level DB | Belum terbukti |
|---|---|---|
| AC-03.05 | Transaksi migrasi atomik; constraint penjualan (`sale_items` total, attempt unik) ada dan diuji | Checkout nyata, rollback penjualan, jaringan putus |
| AC-07.02 | FK/CHECK penerimaan dan mutasi `RECEIPT`; gagal tulis tidak parsial (pola migrasi) | Alur penerimaan/retry API |
| AC-10.02 | Migrasi dari DB kosong dan salinan; versi skema; backup pramigrasi | Update installer, ACL Windows, PC tujuan |

## 3. Keputusan terbuka dan risiko

| ID | Dampak pada TASK-008 |
|---|---|
| D-04/K-05, D-05/K-06 | `checkout_attempts` belum memuat snapshot niat/hash final. Migrasi `0001` memakai DDL apa adanya; penyelesaian **wajib migrasi aditif** setelah review. Endpoint checkout tetap BLOCKED. |
| D-07/K-10 | Kolom uang diterima/kembalian belum ada; struk dari data tersimpan belum bisa menampilkan Tunai/Kembali. |
| D-09/K-11 | Belum ada kunci idempotensi koreksi stok; jangan membuka endpoint koreksi. |
| Driver | `better-sqlite3` masih kandidat di `TECH_STACK.md`. Implementasi memakai `node:sqlite` (tanpa native module/build toolchain). Perlu spike Electron/paket sebelum dikunci. |
| Review migrasi | Skema belum dianggap stabil sampai David/Rahmat mencatat review. |
| Lingkungan | Tes dijalankan pada mesin development, bukan PC kasir; WAL/durability saat listrik mati, ACL, dan paket Windows belum diuji. |

## 4. Langkah berikutnya

1. Review migrasi `0001` (David untuk model data, Rahmat untuk transaksi),
   termasuk keputusan driver.
2. TASK-009 dapat mulai: login/sesi memakai `users`/`sessions`, menolak
   `DEMO_LOCKED_NO_LOGIN`, bootstrap admin di luar seed.
3. Putuskan D-04/D-05/D-07/D-09 sebelum menulis migrasi `0002` dan checkout.
4. Uji backup/restore pada salinan sesuai `BACKUP_RECOVERY.md` sebelum pilot.