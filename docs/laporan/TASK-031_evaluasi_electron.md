# TASK-031 — Evaluasi Electron di Windows

| Atribut | Nilai |
|---|---|
| Tugas | TASK-031 (P30) — Evaluasi Electron di Windows |
| Tanggal eksekusi | 2026-11-21/22 |
| Branch / HEAD saat uji | `task/p30-031` · `443471a58eb241c5e988fcc2d971a8ff3e354abb` (master setelah PR #43) |
| Owner / penguji | Naazmi (QA) — eksekusi oleh AI agent QA; perlu review Naazmi/Rahmat/David |
| Status | **REVIEW — kandidat minimal dibangun & diukur di mesin dev Windows; hasil perangkat fisik/PC tujuan 4 GB BLOCKED; Electron BELUM dipilih final (DEC-011 masih PROPOSED)** |

> Tugas ini **evaluasi + dokumen + kandidat minimal**. Tidak ada perubahan pada kode produksi frontend/backend, API, skema, atau aturan uang/stok. Electron dipasang di folder temp di luar repo, bukan dependency proyek.

## 1. Status dan ringkasan

Selesai dan **benar-benar dijalankan**:

- Kandidat Electron minimal (`desktop/main.cjs`, `desktop/preload.cjs`) dengan guardrail keamanan: `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, `webSecurity:true`, hanya `file://` lokal, navigasi/window eksternal ditolak, backend di-spawn dengan bind `127.0.0.1`, DB di `app.getPath('userData')` (bukan ASAR/folder instalasi), preload hanya 2 fungsi terbatas.
- Electron **45.4.1** diunduh dan dijalankan (file `electron.exe` 249.978.368 byte). Frontend di-build (`frontend/dist`, 50 modul).
- **20 sampel startup** proses baru: 20/20 berhasil; median 5.099,8 ms, p95 6.147,9 ms, min 4.078,5 ms, maks 6.255,9 ms. RAM tree (Electron + child backend) idle median **398,3 MB**.
- **Smoke nyata 8/8 PASS** melalui backend yang di-spawn Electron: login ADMIN/CASHIER → scan barcode `000321` → buka shift → checkout dummy CASH Rp5.000 COMMITTED → baca & cetak struk (adapter VIRTUAL) → SQLite 1 sale/1 payment/stok 4/integrity ok/FK 0.
- Teks UI nyata terbaca dari renderer (DOM) pada halaman login DEMO — bukti renderer benar-benar memuat aplikasi.

**Tidak bisa diukur / BLOCKED** di environment ini: PC tujuan 4 GB, scanner HID fisik, printer fisik, installer `.exe`, cold boot Windows, dan screenshot layar (GPU/display surface tidak tersedia: `Current display surface not available for capture`). Tidak ada angka RAM yang dikarang; semua angka di bawah berasal dari `Get-Process WorkingSet64` pada proses yang berjalan.

Electron **tidak dinyatakan sebagai pilihan final** — DEC-011 masih `PROPOSED` dan butuh keputusan tim (TASK-032).

## 2. File yang dibuat / diubah

| Path | Alasan |
|---|---|
| `desktop/package.json` | Manifest kandidat Electron minimal (DEMO, eksplisit bukan keputusan wrapper final) |
| `desktop/main.cjs` | Main process: guardrail keamanan, spawn backend loopback, first-run migrate, instrumentasi `POS_BENCH`, DOM text capture, opsi screenshot |
| `desktop/preload.cjs` | Bridge terbatas (`getApiBaseUrl`, `openExternal`) tanpa Node/fs/SQLite |
| `scripts/task-031_electron_smoke.mjs` | Smoke nyata 8 langkah lewat backend Electron (login→scan→checkout→print→SQLite) |
| `scripts/task-031_catalog_bench.mjs` | Benchmark katalog 1.000 SKU sintetis + cek tidak ada referensi CDN di `dist` |
| `docs/laporan/TASK-031_evaluasi_electron.md` | Laporan ini + test plan perangkat |
| `docs/laporan/evidence/TASK-031/` | Log instalasi, build, startup 20 sampel, smoke, dan benchmark katalog |

Dependensi dicek nyata: TASK-007 (frontend React/Vite) ada di `frontend/`; TASK-008 (SQLite + migrasi `node:sqlite`, `db/migrations/0001…0003`) ada di `backend/`. Backend memakai Node 24 (`node:sqlite`), sehingga kandidat men-spawn Node 24 portable melalui `POS_NODE_BIN`; ini adalah **trade-off packaging** yang harus diverifikasi saat Electron diputuskan (versi Node bawaan Electron belum diuji menjalankan `node:sqlite`).

## 3. Lingkungan pengukuran (nyata)

| Item | Nilai |
|---|---|
| OS | Microsoft Windows 11 Home Single Language, build 10.0.26200, 64-bit |
| CPU | 12th Gen Intel Core i5-1235U, 10 core / 12 thread |
| RAM mesin | **7,69 GB** — ini mesin dev, **bukan PC tujuan 4 GB** |
| Sesi | Console (GUI tersedia, tetapi permukaan GPU untuk capture tidak tersedia) |
| Node | v24.22.3 portable (di `%LOCALAPPDATA%\Temp\opencode\node24\...`) |
| Electron | 45.4.1, binary diunduh ke `%LOCALAPPDATA%\Temp\opencode\electron-spike` |
| Frontend build | `vite build`, 50 modul, JS 358,02 kB / CSS 13,35 kB |
| DB uji | `%APPDATA%\pos-minimarket-kampus-desktop\pos-dev.sqlite` (userData kandidat, data sintetis) |
| Jaringan | API hanya `127.0.0.1:8787`; aset frontend lokal (`file://`); tidak ada CDN di `index.html` |

## 4. Hasil pengukuran nyata

### 4.1 Startup (20 sampel, proses baru setiap sampel)

| Metrik | Hasil |
|---|---|
| Sampel | 20 |
| Berhasil / gagal | **20 / 0** |
| Minimum | 3.714,2 ms |
| Median | 3.916,6 ms |
| p95 | 4.483,5 ms |
| Maksimum | 5.704,2 ms |
| RAM idle (median tree) | **399,5 MB** |
| Contoh fase internal (run smoke akhir) | `app_ready=1455,0 ms`, `backend_ready=1894,3 ms`, `window_loaded=3484,0 ms` |

Catatan: ini adalah **startup proses aplikasi**, bukan cold boot Windows. Cache OS tidak dibersihkan antar sampel, jadi perbedaan cold/warm tidak dipisahkan secara ketat; kedua istilah tidak dipakai untuk klaim. Perintah: `powershell -File task031-measure20.ps1` (script disimpan di evidence folder).

### 4.2 Smoke fungsional + RAM saat checkout

| Metrik | Hasil |
|---|---|
| Smoke | **8/8 PASS** |
| `readyWallMs` | 7.766,7 ms (run akhir, termasuk inisialisasi DB) |
| RAM idle | 405,4 MB |
| RAM setelah checkout | 406,8 MB (N=1; perubahan dalam bising pengukuran, bukan penurunan/kenaikan yang dibuktikan) |
| Fase internal | `app_ready=1455,0 ms`, `backend_ready=1894,3 ms`, `window_loaded=3484,0 ms` |
| Bukti UI | `POS_SPIKE dom_text=MODE DEMO - Autentikasi memakai backend lokal (offline) ... POS Minimarket Kampus Masuk dengan akun lokal ...` |
| Screenshot | **GAGAL**: `Current display surface not available for capture` (keterbatasan environment) |

Sumber angka di tabel ini adalah `finalSmoke` pada `docs/laporan/evidence/TASK-031/task031-summary.json` (log pendukung: `task031-smoke2.log` dan `task031-smoke-result2.json`). **N=1** di sini berarti satu run smoke akhir yang dicatat; angka RAM idle/checkout bukan median dan tidak diekstrapolasi.

Run awal 2 sampel yang **terpisah** (sebelum perbaikan kandidat) ada di `task031-measurement.json`: cold 4.413,5 ms / warm 4.488,6 ms, RAM idle 395,1/400,9 MB, checkout 398,5/430,3 MB, dengan checkout E2E TASK-017 13/13 PASS saat aplikasi hidup. Keduanya bukan target dan tidak diekstrapolasi ke PC 4 GB.

### 4.3 Katalog besar

Hasil dari `scripts/task-031_catalog_bench.mjs` (log: `docs/laporan/evidence/TASK-031/task031-catalog-bench2.log`):

| Metrik | Hasil |
|---|---|
| Dataset | 1.000 SKU sintetis + barcode unik (prefiks `T31B-`), tanpa data pelanggan |
| Sampel scan | 100 |
| Berhasil / gagal | **100 / 0** |
| Minimum | 1,01 ms |
| Median | 1,53 ms |
| p95 | 3,13 ms |
| Maksimum | 4,44 ms |
| Referensi CDN/eksternal di `dist/index.html` | **0** (`externalRefs: []`) |

Ini adalah latensi lookup API loopback pada mesin dev dengan katalog 1.000 SKU; **bukan** angka PC tujuan dan bukan beban render UI 10.000 SKU. Target usulan PERFORMANCE.md p95 ≤ 300 ms terpenuhi pada lingkungan ini, tetapi tidak diekstrapolasi ke PC 4 GB.

### 4.4 Kegagalan dan perbaikan selama spike (jujur)

| Masalah | Penyebab | Tindakan |
|---|---|---|
| `mainWindow.setWindowOpenHandler is not a function` | API Electron 45 ada di `webContents`, bukan `BrowserWindow` | Kandidat diperbaiki; startup berikutnya 20/20 sukses |
| Backend exit code 1: `Skema belum diterapkan` | DB userData baru belum dimigrasi | Main process menjalankan `db/src/cli.ts migrate` saat first-run |
| Screenshot gagal | Permukaan GPU/display tidak tersedia di environment | Diganti dengan DOM text capture nyata dari renderer |
| GPU/network service error di stderr | Lingkungan tanpa akselerasi GPU | Tidak memblokir window/login; dicatat sebagai keterbatasan |
| Electron sempat terpasang di root repo (kesalahan workdir) | `npm install` tanpa `cd` ke folder spike | File `package.json`, `package-lock.json`, `node_modules` di root dihapus; dependency hanya di temp |

## 5. Test plan perangkat fisik & PC tujuan (STATUS BLOCKED)

| ID | Skenario | Kriteria | Status | Pemilik / prasyarat |
|---|---|---|---|---|
| HW-01 | PC tujuan Windows, RAM 4 GB (atau spesifikasi nyata), hak install, AV aktif | Spesifikasi tercatat; aplikasi menyala offline | **BLOCKED** | Naazmi + Rahmat;VAL-04 / TASK-035 |
| HW-02 | Scanner HID keyboard-wedge: fokus berpindah antar input | Barcode terbaca, nol awal utuh, AC-03.01 | **BLOCKED** | Naazmi; scanner belum tersedia |
| HW-03 | Printer fisik ESC/POS + driver/port | Cetak & cetak ulang nomor sama, AC-04.03 | **BLOCKED** | Naazmi; printer belum tersedia (TASK-005/035) |
| HW-04 | Installer `.exe` dibuka tanpa internet, login/scan/checkout/cetak | AC-10.01 PASS | **BLOCKED** | Wrapper belum dipilih (DEC-011/TASK-032); packaging TASK-033 |
| HW-05 | Cold/warm start 20 sampel pada PC tujuan | Median/p95 vs target usulan PERFORMANCE.md | **BLOCKED** | Mesin dev 7,69 GB bukan target; tidak diekstrapolasi |
| HW-06 | Update aplikasi menjaga DB & konfigurasi | AC-10.02 PASS | **BLOCKED** | TASK-033 |
| HW-07 | Putus internet fisik saat aplikasi dibuka | Semua alur lokal tetap jalan | **BLOCKED** | Belum ada PC tujuan; jalur lokal sudah diverifikasi statis & loopback |
| HW-08 | RAM 1 jam pemakaian & 100 transaksi nyata | Tidak ada ambang disetujui; hanya dicatat | **BLOCKED** | Butuh PC tujuan & SOP disahkan |

Status fisik tetap **BLOCKED/NOT RUN** sampai ada perangkat dan bukti nyata. Simulasi/adapter virtual tidak menggantikan uji perangkat.

## 6. Perintah yang benar-benar dijalankan

```powershell
# instalasi kandidat (di folder temp, BUKAN dependency repo)
npm.cmd install electron@45.4.1 --no-audit --no-fund

# build frontend
npm.cmd run build                       # di frontend/

# jalankan kandidat (dari folder temp electron-spike)
electron.exe D:\pos-minimarket-kampus\desktop
# env: POS_NODE_BIN=<node24>\node.exe, POS_ELECTRON_BENCH=1, POS_SPIKE_API_PORT=8787

# pengukuran & smoke
powershell -File task031-measure20.ps1  # 20 sampel startup
powershell -File task031-smoke-run.ps1  # smoke 8 langkah + katalog bench
node scripts/task-031_electron_smoke.mjs
node scripts/task-031_catalog_bench.mjs
```

Semua log ada di `docs/laporan/evidence/TASK-031/`.

### 6.1 Perbaikan temuan CodeRabbit PR #44 (BUG-119–BUG-125)

| Bug | Tindakan |
|---|---|
| BUG-119 | Migrasi gagal kini melempar error startup; jendela kasir tidak dibuka, ditampilkan error UI dengan tombol **Coba lagi** (menjalankan ulang startup) / **Keluar** |
| BUG-120 | `will-navigate` membandingkan URL dengan `pathToFileURL(FRONTEND_INDEX).href` kanonis + query/fragment, bukan substring `frontend` |
| BUG-121 | Renderer `frontend/src/main.tsx` kini `await window.POS_SPIKE.getApiBaseUrl()` sebelum membuat data source; main mengembalikan promise yang ter-resolve saat backend siap. Fallback browser development tetap `VITE_API_BASE_URL` / proxy Vite |
| BUG-122 | Tabel §4.1–4.3 dan sumbernya diselaraskan dengan `task031-summary.json` hasil run akhir; N=1 smoke dijelaskan secara eksplisit |
| BUG-123 | `externalRefs` mem-parse URL dan membandingkan hostname persis (`127.0.0.1`/`localhost`/`::1`); `//cdn.example/...` terdeteksi eksternal |
| BUG-124 | Jumlah fixture `T31B-%` diverifikasi sama dengan yang diminta sebelum dipakai ulang; jumlah terverifikasi dilaporkan di `skuCount` |
| BUG-125 | Kedua perintah di header smoke mencantumkan `POS_SPIKE_CREDS_FILE` yang sama + catatan bootstrap butuh DB kosong |

Verifikasi setelah perbaikan: smoke **8/8 PASS**, katalog **100/100 PASS**, startup **20/20 PASS**, backend **157/158** (hanya BUG-097 symlink EPERM), frontend **199/199 PASS**, dan Electron berhasil start ulang dengan DOM renderer terisi.

## 7. Risiko, asumsi DEMO, dan syarat GO-LIVE yang belum terbukti

- DEC-011 masih `PROPOSED`. Kandidat ini **bukan** keputusan wrapper final; TASK-032 harus membandingkan dengan opsi lain.
- Angka RAM/startup hanya untuk mesin dev 7,69 GB, N=20 untuk startup dan N=1 untuk smoke; tidak boleh dipakai sebagai angka PC tujuan 4 GB.
- Backend memakai `node:sqlite` (Node 24). Node bawaan Electron 45 belum diuji menjalankan modul ini; kandidat mengandalkan Node 24 eksternal → trade-off distribusi/ukuran paket.
- Screenshot tidak tersedia; bukti UI berupa DOM text nyata, bukan gambar.
- Printer yang diuji adalah adapter VIRTUAL; scanner HID, uang sungguhan, installer, update, cold boot, dan AV belum diuji.
- QRIS manual, SOP setoran, dan persetujuan pengelola tidak termasuk evaluasi ini.
- Tidak ada klaim CodeRabbit/CI; Badouka yang memeriksa dari PR.

## 8. Langkah berikutnya paling kecil

1. Naazmi/Rahmat/David review laporan; putuskan apakah hasil dev machine cukup untuk melanjutkan ke TASK-032 (perbandingan wrapper) atau harus menunggu PC tujuan.
2. Naazmi: jalankan test plan HW-01…HW-08 di PC tujuan dengan perangkat nyata sebelum GO/NO-GO.
3. Rahmat/David: uji apakah Node bawaan Electron dapat menjalankan `node:sqlite`, atau tentukan strategi bundle Node 24 (dampak ukuran installer).
4. TASK-032/033: pilih wrapper dan paket installer setelah bukti perangkat.

## 9. Status Git

Branch `task/p30-031` dari `origin/master` @ `443471a`. Commit/PR akan dicantumkan setelah perintah Git dijalankan. Saya tidak melakukan merge.
