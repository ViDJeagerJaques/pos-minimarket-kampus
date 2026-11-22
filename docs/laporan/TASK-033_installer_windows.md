# TASK-033 — Kandidat installer Windows dan pembaruan

Status: **REVIEW / PENDING LAPANGAN**. Data sintetis, bukan izin GO-LIVE.
Basis: `e41f135`, branch `task/p32-033`. Acuan POS-10.01/AC-10.01,
POS-10.02/AC-10.02, DEC-004/005 (ACCEPTED), DEC-011 (PROPOSED), DEC-015.

## Strategi dan batas

Instruksi David TASK-033 mengizinkan eksperimen packaging Electron. TASK-032
tersedia di master tetapi hanya merekomendasikan kandidat; tidak mengubah
DEC-011 menjadi ACCEPTED. TASK-028 tersedia: snapshot konsisten, verifikasi
dan restore salinan uji. TASKS masih memuat dependensi TASK-030/runbook;
persetujuan pemulihan operasional tetap belum terbukti. Dokumen deployment
ada di `docs/operations and qa/DEPLOYMENT.md`, bukan lokasi dalam prompt.

Installer NSIS x64 membawa Electron 45.4.1, Node **24.18.0 win-x64**, backend
TypeScript beserta migrasi, dan frontend hasil Vite. Backend tidak bergantung
pada Node di PATH, POS_NODE_BIN, npm, CDN atau cloud saat runtime. Node resmi
diunduh saat build, SHA-256 dibandingkan dengan SHASUMS256 resmi, lisensinya
disertakan, lalu diuji dengan `node:sqlite`. Node bawaan Electron tidak dipakai
untuk backend. Dependensi build dipin dalam lockfile desktop; build pertama
memerlukan jaringan untuk tooling. Auto-update ditunda.

NSIS dipasang per-user tanpa elevasi. Aplikasi hanya membuka file frontend
lokal, renderer sandbox/context isolation, backend loopback port pilihan OS,
satu instance per direktori data. Paket tidak membawa DB, akun default atau
sandi. Aplikasi dan backend tidak memuat NODE_OPTIONS/NODE_PATH ke proses Node
anak. Installer DEMO unsigned; penerimaan SmartScreen/AV belum diuji di PC tujuan.

Data default: `%APPDATA%\PosMinimarketKampus-DEMO\`: `pos-dev.sqlite`,
`config.json`, `backups`, `restore-test`. Folder ini terpisah dari instalasi,
data development, dan versi paket. Konfigurasi hanya dibuat bila belum ada;
konfigurasi rusak menolak startup, bukan diganti diam-diam. Migrasi lama tidak
diubah; runner yang ada menolak downgrade skema dan membuat snapshot sebelum
migrasi baru. Uninstall tidak diminta menghapus app data.

## Build dan bootstrap lokal

```powershell
npm --prefix desktop ci
npm --prefix frontend ci
npm --prefix desktop run build
```

Instal dan buka aplikasi. Saat pertama dibuka pada database tanpa akun sama
sekali, aplikasi menampilkan layar **Buat akun admin pertama** sebelum layar
login (`GET /api/v1/auth/bootstrap-status` → `POST /api/v1/auth/bootstrap-admin`),
sehingga admin pertama dibuat langsung dari UI tanpa sandi bawaan dan tanpa
terminal. Setelah ada minimal satu akun, layar setup tidak pernah tampil lagi
(backend menolak bootstrap kedua dengan `409 CONFLICT`). Akun DEMO tetap
terkunci (`DEMO_LOCKED_NO_LOGIN`).

Untuk setup headless/otomatis, CLI `bootstrap-admin` tetap tersedia memakai
`$installDir`:

```powershell
$runtime = Join-Path $installDir 'resources\runtime\node.exe'
$database = Join-Path $env:APPDATA 'PosMinimarketKampus-DEMO\pos-dev.sqlite'
& $runtime (Join-Path $installDir 'resources\backend\db\src\cli.ts') migrate --db $database
if ($LASTEXITCODE -ne 0) { throw 'Migrasi gagal; bootstrap dibatalkan' }
$secret = Read-Host 'Sandi ADMIN baru (tidak disimpan dalam skrip)' -AsSecureString
$credential = [System.Net.NetworkCredential]::new('', $secret)
try {
  $env:POS_BOOTSTRAP_PASSWORD = $credential.Password
  & $runtime (Join-Path $installDir 'resources\backend\src\auth\cli.ts') bootstrap-admin --username admin --db $database
  if ($LASTEXITCODE -ne 0) { throw 'Bootstrap gagal' }
} finally {
  Remove-Item Env:POS_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
  $credential = $null
  $secret = $null
}
```

Tidak ada sandi bawaan. Bootstrap hanya bisa pada DB tanpa akun. Login ADMIN,
buat CASHIER lewat alur akun yang sudah ada; isi katalog/stok sintetis untuk
uji. Jangan seed atau mengganti hash pada DB berisi akun.

## Upgrade dan pemulihan pada instalasi uji yang sama

1. Selesaikan upaya checkout ambigu; hentikan aplikasi/backend. Catat versi,
   konfigurasi, nomor/total sale, shift, saldo dan hash installer lama/baru.
2. Buat snapshot memakai runtime dari instalasi lama:
   `& $runtime (Join-Path $installDir 'resources\maintenance.mjs') snapshot (Join-Path $env:APPDATA 'PosMinimarketKampus-DEMO')`.
   Tool TASK-028 memverifikasi DB; tool maintenance menyimpan salinan config dan
   manifest `.upgrade.json` berisi SHA-256 keduanya. Salin paket, DB, config,
   manifest ke media kedua dan verifikasi ulang hash; jangan hanya mengandalkan
   disk yang sama. Jangan lanjut jika snapshot/verifikasi gagal.
3. Pasang versi baru ke direktori aplikasi yang sama. Buka kembali, periksa
   versi runtime, akun, sale/item/payment/ledger/shift/config serta
   `PRAGMA integrity_check=ok`, `foreign_key_check` kosong. Jangan reset DB.
4. Bila update gagal, hentikan seluruh proses instalasi/backend. Di instalasi
   **terisolasi yang sama**, pasang kembali installer lama. Verifikasi SHA-256
   snapshot DB dan config terhadap manifest pra-upgrade. Uji integritas dan
   kompatibilitas snapshot dengan runtime lama sebelum promosi.
5. Dengan penulis berhenti, pindahkan DB uji saat ini beserta WAL/SHM dan config
   ke folder karantina baru; jangan hapus bukti kegagalan. Salin snapshot DB
   dan config terverifikasi ke lokasi semula. Jangan menempelkan WAL lama ke DB
   hasil restore. Jika pemulihan terhenti, jangan buka kasir sampai kedua file
   pulih lengkap dan tervalidasi. DB operasional tidak disentuh oleh latihan ini.
6. Buka versi lama; login, baca transaksi tersimpan, saldo dan shift. Cocokkan
   dengan kondisi pra-upgrade. Transaksi setelah snapshot memerlukan
   rekonsiliasi; prosedur ini tidak menjamin pemulihannya. Restore operasional
   tetap memerlukan runbook/persetujuan pengelola (BACKUP_RECOVERY §5).

## Bukti yang dapat diulang

`scripts/task-033_installer_check.mjs` memasang ke direktori temp baru dan memakai
`--user-data-dir=<direktori-uji-absolut>` supaya tidak menyentuh profil normal.
Skrip menggunakan CLI dari paket dan Node bundel untuk smoke TASK-031. Upgrade
menggunakan versi fixture dengan kode/skema sama. Kegagalan disuntikkan oleh
`desktop/failure-fixture.nsh` sesudah ekstraksi, **hanya dalam build fixture**:

```powershell
# Dari desktop; baseline dibangun dengan npm run build.
npm exec electron-builder -- --win nsis --x64 --publish never --config.extraMetadata.version=0.1.1-demo
npm exec electron-builder -- --win nsis --x64 --publish never --config.extraMetadata.version=0.1.2-failure --config.nsis.include=failure-fixture.nsh
# Dari root:
node scripts/task-033_installer_check.mjs dist-electron/POS-Minimarket-DEMO-0.1.0-demo-x64-Setup.exe dist-electron/POS-Minimarket-DEMO-0.1.1-demo-x64-Setup.exe dist-electron/POS-Minimarket-DEMO-0.1.2-failure-x64-Setup.exe
```

Jangan mendistribusikan installer `failure` atau menjadikannya rilis normal.
Rehearsal menyimpan data/temp untuk inspeksi; kredensial acak hanya di folder
uji lokal, tidak boleh ikut Git. Bukti JSON tanpa kredensial disimpan di
`docs/laporan/evidence/TASK-033/installer-check.json`.

## Hasil aktual

- Backend `npm run typecheck`: PASS; `npm test`: **162/162 PASS**.
- Frontend `npm run typecheck` (lewat build): PASS;
  `npm test -- --testTimeout=15000`: **214/214 PASS**; `npm run build`: PASS.
- Runtime bundel `node:sqlite`: PASS. Build NSIS: PASS; hasil rehearsal dicatat
  dalam evidence setelah eksekusi, bukan diasumsikan dari build.
- Instalasi tanpa internet sejak sebelum start, UI login/scan/checkout,
  printer/scanner fisik dan PC tujuan: **BELUM DIUJI**. Smoke API + printer
  VIRTUAL tidak menggantikan AC-10.01. Tidak memutus jaringan Windows dari agent.
- Gagal build pertama: URL LICENSE Node mengembalikan 404; diperbaiki ke
  LICENSE tag Node resmi dan build ulang berhasil.
- Instalasi tooling melaporkan 6 kerentanan moderate pada dependensi build;
  tidak dipaketkan sebagai dependensi runtime backend. Belum audit keamanan
  independen atau review CodeRabbit. CLI CodeRabbit tidak dijalankan karena
  keterbatasan WSL yang sudah dilaporkan.

Syarat sebelum commit/push sesuai prompt: tes wajib termasuk bukti manual
David. Belum ada PR/commit TASK-033 yang diklaim dari laporan ini.
