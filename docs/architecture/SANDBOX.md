# Isolasi Lingkungan SANDBOX

Dokumen ini menggambarkan konfigurasi khusus branch `sandbox/production-redesign`.
Status: **PROPOSED — menunggu review David, Rahmat, Naazmi, dan Syafroni**
(`AGENTS.md` §14: menyentuh arsitektur, distribusi, dan keselamatan data).
Jangan menggabungkan file/file konfigurasi ini ke konfigurasi produksi tanpa
review terpisah.

## 1. Identitas aplikasi

| Atribut | Nilai sandbox | Nilai existing |
|---|---|---|
| App ID | `id.kampus.pos.sandbox` | `id.kampus.pos.demo` |
| Product name | `POS Minimarket Kampus SANDBOX` | `POS Minimarket Kampus DEMO` |
| Artifact | `POS-Minimarket-SANDBOX-*` | `POS-Minimarket-DEMO-*` |
| Output build | `dist-electron-sandbox/` | `dist-electron/` |

Konfigurasi sandbox berada di `desktop/builder-sandbox.json` dan tidak
mengubah `desktop/package.json` bagian `build` kecuali penambahan file
`desktop/sandbox-env.cjs` ke `files` agar aplikasi existing tetap dapat
memuat modul tersebut.

## 2. Akar data

Semua data sandbox berada di satu akar:

```
%LOCALAPPDATA%\PosMinimarketKampus-SANDBOX\
├── userData\                 # Electron userData, cache, Preferences, config.json
│   ├── config.json           # mode: DEMO (REAL ditolak)
│   └── pos-dev.sqlite        # database sintetis utama (+ WAL/SHM saat berjalan)
├── data\                     # POS_DATA_DIR default untuk backend langsung
├── backups\                  # POS_BACKUP_DIR
├── restore-test\             # POS_RESTORE_TEST_DIR
├── config\
│   └── sheets-sync.json      # TIDAK dibuat secara default => sinkronisasi mati
└── artifacts\
    └── backend.log           # log backend sandbox
```

Antrean sinkronisasi (`sheets-sync-queue.json` dan `.ack.ndjson`) diturunkan
dari direktori database sandbox. Karena tidak ada file konfigurasi Sheets,
`loadSheetsSyncConfig` mengembalikan `null` dan service sinkronisasi nonaktif.

Direktori aplikasi existing yang ditolak sebagai target sandbox:

- `%APPDATA%\PosMinimarketKampus-DEMO`
- `%LOCALAPPDATA%\PosMinimarketKampus`
- `%APPDATA%\pos-minimarket-kampus-desktop`
- `%LOCALAPPDATA%\Programs\POS Minimarket Kampus DEMO`
- seluruh path di dalam source tree repository

## 3. Mekanisme

- Flag aktif: `POS_SANDBOX=1`. Tanpa flag, perilaku aplikasi tidak berubah.
- `backend/src/sandbox/env.ts`: menetapkan default DB/backup/restore/ Sheets/log,
  menolak `POS_DB_PROFILE=operasional`, dan memvalidasi path sebelum
  `migrate`, `seed`, `serve`, `bootstrap-admin`, serta perintah QA.
- `desktop/sandbox-env.cjs`: versi CommonJS untuk Electron main. Child backend
  menerima **allowlist** variabel sistem saja; variabel DB, backup, restore,
  dan Sheets induk tidak diwariskan.
- `desktop/main.cjs`: mode REAL ditolak saat sandbox; port development memakai
  port acak agar tidak bertabrakan dengan backend existing di 8787;
  `--user-data-dir` hanya diterima bila masih di dalam akar sandbox.
- Mode DEMO memakai `pos-dev.sqlite` dan seed sintetis yang sudah ada
  (penanda `demo_seed_runs`). Tidak ada skema atau migrasi baru.

## 4. Cara menjalankan

Dari root repository:

```powershell
# Electron sandbox ( development )
cd desktop; npm run start:sandbox

# Backend sandbox langsung
cd backend; npm run sandbox:db:path
cd backend; npm run sandbox:db:migrate
cd backend; npm run sandbox:db:verify
cd backend; npm run sandbox:db:seed:demo
cd backend; npm run sandbox:start

# Tes dengan profil sandbox
cd backend; npm run sandbox:test
cd desktop; npm run test:sandbox-env

# Installer sandbox (hanya di akun/VM disposable)
cd desktop; npm run build:sandbox
```

Pemasangan installer sandbox **dilarang** pada lingkungan yang memuat instalasi
DEMO existing sampai isolasi divalidasi. Guard `assertNoExistingDemoInstall()`
pada `scripts/task-033_installer_check.mjs` tetap dipertahankan.

## 5. Bukti yang diharapkan

- `npm run sandbox:db:path` menampilkan path di bawah
  `PosMinimarketKampus-SANDBOX`, bukan `PosMinimarketKampus`.
- Log startup Electron sandbox mencetak baris `POS_SANDBOX root=... db=...`.
- Hash seluruh file di direktori aplikasi existing tidak berubah sebelum dan
  sesudah menjalankan sandbox, dengan proses existing dalam keadaan berhenti
  normal.
- `backend/config/sheets-sync.json` tidak disalin ke paket sandbox; file
  konfigurasi Sheets sandbox tidak dibuat oleh startup.

## 6. Batas

Tidak menyentuh UI/UX, aturan bisnis, skema/migrasi, kontrak API, dan tidak
menambahkan Local Excel Sync. Perubahan yang perlu ikut saat redesign
digabungkan hanyalah penambahan `sandbox-env.cjs` ke `build.files`; seluruh
konfigurasi sandbox lain berada di file khusus sandbox.

## 7. Catatan audit pasca-redesign

Persetujuan koordinator mencakup tampilan visual redesign; bukan persetujuan arsitektur, pengujian perangkat, pilot, atau go-live. Isolasi sandbox tetap PROPOSED dan memerlukan review lintas pemilik. Launcher development kini mensyaratkan flag sandbox, dan paket sandbox menggunakan penanda build untuk mengaktifkan isolasi tanpa nama branch Git. Hasil pengujian harus dicatat terpisah dari persetujuan. Perubahan hash yang pernah dilaporkan tidak membuktikan kehilangan data atau penyebabnya.
