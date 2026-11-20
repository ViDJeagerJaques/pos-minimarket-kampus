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

## 9. Autentikasi, akun lokal, dan server loopback (TASK-009)

Status: **DEMO**, lulus tes `node --test` pada mesin development. Belum diuji di
PC tujuan, belum ada rate-limit login, dan timeout/idle sesi belum disahkan.

### 9.1 Bootstrap ADMIN pertama

Akun ADMIN dibuat terpisah dari alur kasir dan dari seed DEMO. Sandi hanya
dibaca dari environment, tidak pernah dari argv/repo/log:

```powershell
npm run db:migrate
$env:POS_BOOTSTRAP_PASSWORD = "<sandi-kuat>"
npm run auth:bootstrap-admin -- --username admin
```

Perintah hanya berlaku bila tabel `users` masih kosong; diulang akan ditolak.
Database DEMO yang sudah di-seed (berisi akun demo) tidak dapat langsung
digunakan untuk `bootstrap-admin` karena tabel `users` sudah terisi; gunakan
database baru hasil `npm run db:migrate` tanpa `db:seed:demo`.
Seed DEMO memakai hash `DEMO_LOCKED_NO_LOGIN` yang ditolak login.

### 9.2 Server

```powershell
npm start                      # bind 127.0.0.1, port acak (atau POS_HTTP_PORT)
node src/http/cli.ts serve --port 8787 --session-ttl-ms 43200000
```

Endpoint (base `/api/v1`): `POST /auth/login`, `POST /auth/logout`,
`GET /auth/me`, `GET /users`, `POST /users`, `PATCH /users/:id`.
Hanya `POST /users`/`PATCH` yang mengubah data; keduanya khusus ADMIN.

### 9.3 Aturan implementasi

- Sandi di-hash `scrypt$N$r$p$salt$hash` (salt unik, `timingSafeEqual`);
  hash seed DEMO ditolak. Hash lama dengan parameter lain dianggap tidak cocok.
- Token sesi acak 32 byte; yang disimpan hanya digest HMAC-SHA256 dengan secret
  proses (32 byte acak per start). Secret tidak masuk SQLite/repo, sehingga
  restart backend membatalkan semua token lama dan bocornya DB tidak cukup
  untuk memalsukan sesi.
- Sesi diverifikasi ulang per request (kedaluwarsa, revoke, `users.active`);
  penonaktifan/perpindahan role mencabut sesi target dalam transaksi yang sama.
- Login gagal selalu memakai pesan/status yang sama (401
  `INVALID_CREDENTIALS`), termasuk biaya komputasi untuk username tak dikenal.
- Server hanya menerima `Host`/`Origin` loopback, `Authorization: Bearer`,
  body JSON maksimum 64 KiB, dan `Cache-Control: no-store`.
- Audit akun (`ACCOUNT_CREATED`, `ACCOUNT_DISABLED`, `ACCOUNT_ENABLED`,
  `ROLE_CHANGED`) ditulis dalam transaksi; `LOGIN_FAILED`/`ACCESS_DENIED` ke
  log keamanan. Tidak ada sandi/token/hash di audit atau log.

### 9.4 Batas TASK-009

- Matriks penuh (shift, checkout, penerimaan, stok, laporan) belum ada
  endpointnya; TASK-010/014/016/025/026 akan memakai pola guard yang sama.
- Rate-limit/lockout login, timeout/idle sesi, penyimpanan token di Electron,
  dan kebijakan sandi akhir masih menunggu review (AUTHORIZATION.md §8).
- Server HTTP loopback adalah adapter tipis; Express tetap kandidat DEC-010.

## 10. Ledger stok dan saldo awal uji (TASK-015)

Status: **DEMO**, lulus `node --test` pada database sementara. Belum ada
endpoint HTTP untuk ledger (TASK-026/025 akan memakainya).

- Saldo hanya dibaca/agregasi dari `inventory_movements` (`stock_balances` /
  `inventory/ledger.ts`). Tidak ada kolom saldo yang dapat diubah langsung.
- `applyOpeningFixture()` menulis mutasi `OPENING` + audit
  `STOCK_OPENING_IMPORTED` dalam satu transaksi. Idempoten per
  `batchRef`; batch berbeda untuk produk yang sama ditolak 409. Partial unique
  index `ux_movements_opening_product` menjamin maksimal satu OPENING per
  produk.
- `reconcileProduct()` menghitung `opening + receipt + sale + adjustment`
  lalu membandingkan dengan total ledger; `assertSufficientStock()` menolak
  permintaan di atas saldo (DEC-018, PROPOSED) tanpa mengubah ledger/audit.
- `STOCK_OPENING_IMPORTED` adalah **usulan kontrak** (AUDIT_LOG.md AUD-04 belum
  mencantumkan impor stok); perlu review David/Naazmi.
- `catalog/service.ts` memakai agregasi ledger yang sama untuk `stockOnHand`;
  tes membuktikan keduanya sama.

## 13. Penutupan shift (TASK-022)

Status: **DEMO**; angka setoran memakai simulasi TASK-002 §7, bukan SOP sah.

- `POST /api/v1/shifts/:id/close` hanya CASHIER pemilik; ADMIN ditolak 403.
- `GET /api/v1/shifts/:id/close/preview` membaca rekap shift aktif tanpa mutasi:
  `openingCashRp`, `cashTotalRp`, `qrisTotalRp`, `expectedCashRp`, `saleCount`.
  Hasil adalah snapshot, dapat berubah jika penjualan commit sebelum tutup.
- `GET /api/v1/shifts/:id/close` membaca DTO hasil tutup yang sama seperti POST;
  hasil belum tersimpan atau shift tidak ada → 404. Kedua GET hanya CASHIER
  aktif pemilik; kasir lain dan ADMIN ditolak 403. Preview shift tertutup → 409.
- Setelah timeout, 404 dari GET tidak membuktikan POST gagal jika masih berjalan;
  periksa kembali atau retry POST identik dengan `closeKey` dan payload yang sama.
- `closeKey` idempoten: payload sama → hasil lama; payload beda → 409.
- Rekap `shift_closing_totals` berasal dari `payments` pada `sales` COMMITTED
  di shift itu. QRIS dilaporkan terpisah, tidak masuk laci.
- `expectedCashRp = openingCashRp + total CASH`; `varianceRp =
  declaredCashRp - expectedCashRp` bila uang fisik diisi.
- Tutup dan checkout memakai `BEGIN IMMEDIATE`: yang commit lebih dulu
  menentukan apakah penjualan masuk rekap; checkout setelah tutup ditolak.
- Audit `SHIFT_CLOSED` dalam transaksi yang sama; gagal sebelum commit
  mempertahankan shift aktif.


## 11. Pembukaan shift (TASK-014)

Status: **DEMO**, lulus tes service + HTTP pada database sementara.

- `POST /api/v1/shifts/open` (khusus CASHIER) dan `GET /api/v1/shifts/current`.
- Pemilik shift diambil dari sesi; `BEGIN IMMEDIATE` + partial unique index
  `ux_shifts_single_open` menjamin tepat satu shift aktif per PC. Dua request
  bersamaan: satu 200, satu 409 `SHIFT_ALREADY_OPEN`.
- Shift tersimpan di SQLite; logout/restart tidak mengubahnya. Pemilik login
  ulang mendapatkan shift yang sama; kasir lain mendapat `null` dan tidak bisa
  membuka shift kedua.
- ADMIN **ditolak 403** pada pembukaan: baseline konservatif AUTHORIZATION.md
  §3 dan SECURITY.md §4 (ADMIN bukan otomatis kasir). API_CONTRACT.md §3 sudah
  diselaraskan: `POST /shifts/open` khusus CASHIER; ADMIN belum diizinkan
  selama DEC-019 `PENDING`. Perubahan status menunggu review David.
- Audit `SHIFT_OPENED` (AUD-05) ditulis dalam transaksi pembukaan; nominal kas
  tidak diduplikasi ke audit.

## 12. Pemulihan hasil checkout (TASK-019)

Status: **DEMO**. Endpoint `GET /api/v1/checkouts/:attemptKey` dan `getStatus`
sudah disediakan TASK-016; TASK-019 membuktikan skenario pemulihannya tanpa
mengubah kode yang sudah lulus tes.

- Respons commit dibuang setelah server selesai commit → GET mengembalikan
  `COMMITTED`, `saleNo`, dan `requestHash` yang sama; tetap tersedia setelah
  shift ditutup.
- Restart setelah `PREPARED` → status dan `requestHash` tidak berubah; commit
  memakai hash lama tetap diterima.
- GET bersifat read-only (jumlah `sales`/`payments`/mutasi/audit tidak berubah).
- Kasir lain → 403 tanpa `saleNo`/`quote`/hash; ADMIN → ringkasan; kunci tak
  dikenal → 404 generik; tanpa sesi → 401.

## 14. Penerimaan barang (TASK-025)

Status: **DEMO**, backend saja; SOP pembelian/setoran belum disahkan.

- `POST /api/v1/goods-receipts` hanya ADMIN, dengan `receiptKey`, `supplierId`,
  `items[{productId, quantity}]`, dan `supplierRef` opsional.
- Tidak ada tabel draft; draft adalah niat di klien. Membatalkan draft tidak
  memanggil API sehingga stok tidak berubah.
- Backend menghitung `request_hash` kanonis dari isi penerimaan; actor
  (`received_by`) berasal dari sesi. `receiptKey` yang sama + isi sama → hasil
  lama; isi berbeda → 409 `IDEMPOTENCY_CONFLICT`.
- Satu transaksi SQLite menulis `goods_receipts`, `receipt_items`, mutasi
  `RECEIPT` (satu per item, `receipt_item_id` mengikat sumber), dan audit
  `GOODS_RECEIPT_COMMITTED` (AUD-03).
- Penerimaan hanya menambah stok di ledger; tidak membuat pembayaran, utang,
  atau pembelian berbayar. SOP supplier/ekspor menunggu pengelola.

## 15. Query laporan dasar (TASK-026)

Status: **DEMO**, backend saja; zona operasional belum disahkan.

- `GET /api/v1/reports/daily?start=<ms>&end=<ms>[&shiftId=<id>]` — ADMIN.
  Filter epoch ms UTC setengah terbuka `[start, end)`; hanya baris `sales`
  (COMMITTED) yang dihitung. Satu penjualan dihitung sekali lewat satu
  pembayaran utama.
- `GET /api/v1/reports/stock[?lowStockThreshold=<n>]` — ADMIN. Saldo dan
  komponen (OPENING/RECEIPT/SALE/ADJUSTMENT) berasal dari ledger; rincian
  mutasi menyertakan sumber (`sale_no`/`receipt_key`/batch), jumlah, waktu,
  dan actor.
- Total CASH dan QRIS_MANUAL dipisah; QRIS tidak masuk kas laci.
- Response memakai envelope `{ data, requestId }` API_CONTRACT §5; tidak ada
  hash password/token maupun data pembayaran sensitif di laporan.
- Batas zona lokal dan ambang "stok menipis" menunggu keputusan pengelola;
  filter menerima epoch ms eksplisit, bukan menebak timezone PC.

## 16. Koreksi stok ADMIN (TASK-039)

Status **DEMO**, backend saja; SOP opname/koreksi menunggu pengelola (DEC-018).
Jalankan migrasi lokal melalui `npm run db:migrate` sebelum server: migrasi
`0003_inventory_adjustments.sql` menambahkan penyimpanan identitas retry.
Runner membuat backup pramigrasi untuk database berisi data; jangan edit 0001/0002.

`POST /api/v1/inventory/adjustments` memerlukan sesi ADMIN aktif dan body:

```json
{"adjustmentKey":"adj-demo-1","productId":1,"expectedOnHand":5,"targetOnHand":3,"reason":"DEMO hitung fisik"}
```

Hasil 201 memuat `movementId`, `delta: -2`, `previousOnHand: 5`, `onHand: 3`,
actor/waktu backend dan `duplicate`. Saldo tetap berasal dari ledger.
Saldo awal yang tidak cocok menghasilkan 409; saldo negatif, delta nol dan
alasan kosong menghasilkan 422. CASHIER ditolak 403 sebelum mutasi.
Retry setelah timeout harus memakai key/payload identik; hasil tersimpan
kembali tanpa audit/mutasi tambahan, meskipun saldo kemudian berubah.
Key sama dengan isi/actor berbeda ditolak 409 IDEMPOTENCY_CONFLICT.

Mutasi ADJUSTMENT + identitas retry + audit INVENTORY_ADJUSTED satu transaksi
SQLite `BEGIN IMMEDIATE`; tidak ada jalur edit saldo langsung. Lihat detail
validasi/DTO di API_CONTRACT.md bagian TASK-039. Tes service/API dan upgrade
v2 ada di `src/inventory/adjustments.test.ts` dan `src/http/adjustments.test.ts`.
Tidak menambah layar frontend.

## 16. Backup dan restore uji (TASK-028)

Status: **DEMO**, operator/backend; restore produksi masih runbook manual.

```powershell
node db/src/cli.ts backup --db <file.sqlite> [--dir <backup-root>] [--json]
node db/src/cli.ts restore-test --backup <file-cadangan> [--dir <restore-root>] [--json]
```

- Backup memakai `VACUUM INTO` ke file sementara, diverifikasi
  (`integrity_check`, `foreign_key_check`, `user_version`, tabel penting,
  jumlah baris, SHA-256, ukuran, waktu), lalu di-rename atomik. File yang sudah
  ada tidak ditimpa; kegagalan tidak menghapus backup baik.
- Direktori dibatasi backend: default `<direktori DB>/backups`, atau
  `POS_BACKUP_DIR` yang harus berada di luar source tree. Manifest JSON
  berisi metadata (tanpa password/token).
- `restore-test` memverifikasi sumber lalu menyalin hanya ke direktori uji
  terpisah (default `%LOCALAPPDATA%/PosMinimarketKampus/data/restore-test`
  atau `POS_RESTORE_TEST_DIR`), dengan `COPYFILE_EXCL`. Tidak ada restore ke DB
  operasional lewat perintah ini.
- File rusak ditolak sebelum penyalinan; database aktif dan backup baik tetap
  utuh. Salinan di media fisik lain, RPO/RTO, dan persetujuan pengelola belum
  ada.

