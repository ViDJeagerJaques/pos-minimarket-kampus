# Backend — Fondasi SQLite dan Migrasi Inti (TASK-008)

> **Status: DEMO / FONDASI.** Kode ini menyiapkan database development dan
> runner migrasi. Belum ada API, autentikasi, atau checkout. Bukan pernyataan
> siap produksi dan bukan izin transaksi dengan uang sungguhan.

Lingkup: `POS-03.05` / `AC-03.05`, `POS-07.02` / `AC-07.02`, `POS-10.02` /
`AC-10.02` (lihat `docs/product/TASKS.md` dan `docs/architecture/DATABASE.md`).

## 1. Prasyarat dan dependensi

| Hal | Nilai |
|---|---|
| Runtime | Node.js **>= 24** (diuji dengan Node 26.13.1, SQLite 3.54.1) |
| Paket npm | **Tidak ada** dependensi runtime. `npm install` tidak diperlukan. |
| Driver SQLite | `node:sqlite` bawaan Node (lihat §8 untuk status keputusan) |
| Test runner | `node --test` bawaan Node |
| TypeScript | Dijalankan langsung lewat type stripping bawaan Node (tanpa build step) |

Tidak ada unduhan CDN, cloud, atau layanan jaringan saat migrasi/seed berjalan.

## 2. Lokasi database

Database development **tidak boleh** berada di dalam repository.

| Urutan | Sumber | Contoh |
|---|---|---|
| 1 | `POS_DB_PATH` (file eksplisit) | `D:\pos-data\pos-dev.sqlite` |
| 2 | `POS_DATA_DIR` + `pos-dev.sqlite` | `%LOCALAPPDATA%\PosMinimarketKampus\data\pos-dev.sqlite` |
| 3 | Default | `%LOCALAPPDATA%\PosMinimarketKampus\data\pos-dev.sqlite` |

Runner menolak path yang berada di dalam source tree (mis. `backend/db/dev.sqlite`)
dengan pesan `Menolak database di dalam source tree`. File database, WAL/SHM,
cadangan, dan `node_modules` sudah dikecualikan oleh `.gitignore` di root.

## 3. Perintah

Jalankan dari direktori `backend/`:

```bash
npm run db:path          # tampilkan path database yang akan dipakai
npm run db:migrate       # terapkan migrasi yang belum ada (idempoten)
npm run db:verify        # PRAGMA, versi skema, integrity_check, foreign_key_check
npm run db:seed:demo     # seed sintetis DEMO (hanya DB kosong, bukan produksi)
npm run db:check         # migrate + verify
npm test                 # seluruh tes DB (node --test)
```

Opsi CLI (tanpa npm):

```bash
node db/src/cli.ts migrate [--db <file>] [--migrations <dir>] [--no-backup] [--json]
node db/src/cli.ts verify  [--db <file>] [--json]
node db/src/cli.ts seed --demo [--db <file>]
node db/src/cli.ts inspect-backup --db <file-cadangan>
```

Contoh untuk anggota tim setelah `git pull`:

```powershell
cd backend
npm run db:migrate
npm run db:seed:demo   # opsional, data sintetis
npm run db:verify
npm test
```

## 4. Versi skema dan immutability

- Setiap file di `db/migrations/` bernama `NNNN_nama.sql`.
- Satu file = **satu transaksi** (`BEGIN IMMEDIATE ... COMMIT`). Runner menolak
  file yang memuat `BEGIN/COMMIT/ROLLBACK/SAVEPOINT/VACUUM/PRAGMA` agar
  atomisitas tidak bisa diakali.
- Versi tercatat di `PRAGMA user_version` **dan** tabel `schema_migrations`
  (`version`, `name`, `checksum`, `applied_at_ms`).
- Checksum SHA-256 dihitung dari isi yang dinormalisasi CRLF/LF. File yang sudah
  diterapkan bersifat **immutable**: perubahan isi, penghapusan file, atau
  penyisipan versi lama ditolak. Perubahan skema harus berupa file baru
  (`0002_...`).
- Database dengan `user_version` lebih baru daripada tool ditolak (jangan
  menurunkan skema dengan aplikasi lama).
- `schema_migrations` adalah metadata infrastruktur migrasi, bukan tabel bisnis.
  Semua tabel bisnis mengikuti `docs/architecture/DATABASE.md` §6/§16.

## 5. Backup sebelum migrasi dan rollback

### 5.1 Otomatis (development)

Jika ada migrasi baru dan database **sudah berisi skema**, runner membuat
snapshot dengan `VACUUM INTO` sebelum perubahan pertama:

```text
<folder database>/backups/<nama>-pre-v<versi>-<UTC>.sqlite
```

Snapshot diverifikasi (`integrity_check = ok`, `foreign_key_check` kosong,
`user_version` sama) sebelum migrasi dilanjutkan. Jika verifikasi gagal, migrasi
dibatalkan. Untuk tujuan development, snapshot dapat dimatikan dengan
`--no-backup`, tetapi jangan dilakukan pada salinan data yang ingin dipertahankan.

### 5.2 Sebelum migrasi pada data yang penting (manual)

1. Hentikan aplikasi/proses yang memakai database (tidak ada penulis aktif).
2. Buat snapshot dan periksa:
   ```bash
   node db/src/cli.ts inspect-backup --db <file-cadangan-lama>
   ```
   Untuk snapshot baru pada database yang sudah ditutup, gunakan SQLite
   `VACUUM INTO` atau salinan file setelah koneksi ditutup, lalu verifikasi
   dengan perintah di atas.
3. Catat `user_version`, jumlah baris tabel kunci, dan lokasi cadangan.

### 5.3 Rollback

Migrasi bersifat **forward-only**. Rollback = pulihkan cadangan pramigrasi;
tidak ada file `down.sql`.

1. Hentikan aplikasi (dan pastikan tidak ada proses lain memegang file).
2. Simpan kondisi saat ini di tempat terpisah untuk investigasi:
   `pos-dev.sqlite`, `pos-dev.sqlite-wal`, `pos-dev.sqlite-shm`.
3. Salin cadangan pramigrasi menjadi file database aktif (jangan menimpa
   cadangan lain; jangan menghapus database operasional yang berisi data).
4. Hapus `-wal`/`-shm` lama agar tidak tercampur dengan snapshot.
5. Verifikasi sebelum dipakai:
   ```bash
   node db/src/cli.ts verify
   ```
   Harus `integrity: ok`, `foreign_key_ch: 0`, dan `user_version` sesuai titik
   cadangan.
6. Jika rollback dilakukan setelah ada transaksi nyata pada skema baru,
   transaksi tersebut hilang dan harus direkonsiliasi manual. Untuk operasi
   produksi, prosedur lengkap mengikuti `docs/security/BACKUP_RECOVERY.md`
   (masih `PROPOSED`, belum diuji di PC tujuan).

> Jangan menjalankan `VACUUM INTO` di dalam transaksi dan jangan menyalin file
> database yang sedang ditulis (terutama saat WAL aktif).

## 6. Seed DEMO

Seed `demo-synthetic-v1` membuat 3 akun demo, 3 kategori, 2 supplier, 4 produk
(termasuk barcode dengan nol di depan), relasi produk-supplier, dan 4 mutasi
`OPENING`. Semua nilai berlabel `DEMO`.

Pengaman berlapis:

1. flag `--demo` wajib;
2. `NODE_ENV=production` ditolak;
3. `POS_DB_PROFILE=operational` ditolak;
4. hanya berjalan pada database kosong (tidak ada data bisnis);
5. idempotent — dijalankan ulang akan dilewati karena penanda
   `demo_seed_runs`;
6. `users.password_hash` berisi `DEMO_LOCKED_NO_LOGIN`, bukan kata sandi.
   **TASK-009 wajib menolak hash ini** dan membuat akun lewat prosedur
   bootstrap; akun demo tidak boleh bisa login.

Seed demo tidak membuat shift, penjualan, atau pembayaran, sehingga tidak
menentukan aturan operasional yang masih `PENDING`.

## 7. Yang diuji (bukan klaim produksi)

`npm test` menjalankan 21 tes:

| Area | Bukti |
|---|---|
| Migrasi DB kosong | skema versi 1, 19 tabel + view `stock_balances`, integrity `ok` |
| Rerun migrasi | tidak ada objek/baris baru (signature `sqlite_master` sama) |
| Immutability | checksum berubah, file hilang, versi lebih baru → ditolak |
| FK | insert FK tidak ada dan FK komposit lintas produk → gagal |
| Barcode | kosong/spasi ditolak, duplikat ditolak, nol depan dipertahankan |
| Shift | dua shift aktif ditolak, penutupan bukan pemilik ditolak |
| Pembayaran | CASH/QRIS_MANUAL/`QRIS` divalidasi CHECK |
| Ledger | mutasi tanpa sumber, produk salah, ADJUSTMENT tanpa alasan ditolak |
| Gagal di tengah | rollback penuh, `user_version` tetap, cadangan valid, perbaikan berhasil |
| Seed | idempotent, ditolak di produksi/profil operasional/DB berisi data |
| Path | database di dalam repo ditolak tanpa membuat file |

## 8. Keputusan dan risiko yang belum selesai

- **Driver.** `TECH_STACK.md` mencantumkan `better-sqlite3` sebagai kandidat dan
  **belum disetujui**. Implementasi ini memakai `node:sqlite` bawaan Node agar
  tidak ada native module, tidak ada build toolchain Windows, dan biaya Rp0.
  Modul akses DB dipusatkan di `db/src/db.ts` supaya penggantian driver tidak
  merambat ke seluruh backend. Keputusan akhir menunggu spike Electron/paket.
- **D-04 / K-05** snapshot niat checkout, **D-05 / K-06** isi `requestHash`,
  **D-07 / K-10** uang diterima/kembalian, **D-09 / K-11** kunci idempotensi
  koreksi stok: **belum diputuskan**. Migrasi `0001` memakai DDL
  `DATABASE.md` apa adanya (tanpa menambah kolom keputusan). Penyelesaiannya
  harus berupa migrasi aditif `0002+` setelah review. Endpoint checkout tetap
  **BLOCKED** sampai keputusan diambil.
- **Review migrasi** oleh David (model data) dan Rahmat (transaksi) masih perlu
  dicatat sebelum skema dianggap stabil.
- **Belum diuji:** WAL/durability saat listrik mati, ACL Windows, paket
  Electron, backup/restore produksi, dan perangkat PC tujuan. `npm test` hanya
  membuktikan perilaku SQLite pada mesin development ini.
- **Belum ada** API/otorisasi; `AC-03.05`, `AC-07.02`, dan `AC-10.02` baru
  terbukti pada level DDL/constraint, bukan alur pengguna.