# CODING STANDARDS — Frontend, Backend, Database

| Atribut | Keterangan |
|---|---|
| Lokasi | `docs/architecture/CODING_STANDARDS.md` |
| Versi | 0.1.1 — 11 November 2026 |
| Status | **BASELINE DESAIN UNTUK REVIEW TEKNIS** — bukan hasil uji/perizinan produksi |
| Acuan utama | `docs/product/PRD.md` v0.3.1, `SCOPE.md` v0.1.1, `DECISIONS.md` v0.2.3, `ACCEPTANCE_CRITERIA.md` v0.1.1 |
| Pemeriksa | David (model data), Rahmat (backend & integrasi), Syafroni (UI), Naazmi (QA) |

## 1. Ketentuan umum

Standar ini berlaku bagi anggota dan AI coding agent. Read first: `AGENTS.md`, dokumen Product baseline, `ARCHITECTURE.md`, `DATABASE.md`, `API_CONTRACT.md`, `AUTHORIZATION.md`. Setiap task punya `TASK-*`, requirement `POS-*`, acceptance case `AC-*`; perubahan aturan bisnis wajib update dokumen sebelum merge.

## 2. TypeScript dan struktur

- TypeScript `strict: true`, lint/formatter satu konfigurasi repository, lockfile committed.
- Bagi kode UI (`frontend/`), logika dan penyimpanan (`backend/`), DTO/validation shared (`shared/`). UI tidak mengakses SQLite langsung; server tidak percaya data dari renderer.
- Nama fungsi/variabel konsisten bahasa Inggris, label UI Indonesia. Boolean berawalan is/has/can; uang `*Rp` INTEGER, waktu `*AtMs` bila epoch ms, idempotency `attemptKey`.
- Jangan menulis `any` tanpa alasan dan review; validasi input boundary dengan schema runtime. Hindari `Number` untuk pecahan uang, pembulatan tak eksplisit dan `parseFloat` uang.
- Pisahkan handler HTTP, authorization, service domain, repository SQL, perangkat dan log. Tidak ada SQL mutable di komponen React.

## 3. Standar transaksi SQLite

- `PRAGMA foreign_keys=ON` di setiap koneksi; uji SQLite STRICT runtime.
- Transaksi uang/stok memakai `BEGIN IMMEDIATE` bila strategi koneksi memerlukan serialisasi penulis; periksa versi driver. Semua insert sale/item/payment/ledger berhasil atau rollback semua.
- Check stok dari view/ledger di dalam transaksi dan larang saldo akhir negatif. Hindari read-then-write di luar transaksi.
- Parameterized queries saja; prepared statements dan index teruji. Hindari DELETE/update langsung pada histori committed.
- Attempt key tersimpan sebelum pembayaran, hasil retry harus identik; jangan memakai timestamp sebagai satu-satunya kunci.
- Migration numerik, satu arah atau down-script terkontrol dengan backup dan restore. Tidak mengedit database produksi secara manual.

## 4. Keamanan dan rahasia

- Password hashing adaptif; jangan print secret, token sesi, data sensitif, atau PIN bank ke log. `.env.example` tidak memuat secret sungguhan.
- RBAC di backend; route ADMIN diuji 403 untuk CASHIER. IPC Electron dibatasi allowlist.
- Konfirmasi QRIS adalah tindakan manusia; jangan klaim integrasi dengan bank. Sanitasi output error untuk UI.

## 5. Pengujian dan code review

Sebelum PR: `typecheck`, lint, unit tests, API integration tests, test transaksi atomik, test role, test retry, test printer adapter mocked, dan manual QA sesuai scope tugas. Sertakan file, langkah uji, screenshot/log aman, dan risiko. Dilarang klaim "done" hanya karena AI menghasilkan kode. Reviewer harus dapat menjalankan test pada mesin lain.

## 6. Git dan kolaborasi

Branch fitur per TASK, PR kecil, tanpa commit langsung ke main. Reviewer minimal satu orang selain penulis; perubahan uang/stok/akses ditinjau Rahmat dan David, uji Naazmi. Gabungkan hanya jika acceptance case PASS atau status/blocker dinyatakan eksplisit. Jaga compatibility versi dokumen.

## 7. Anti-pattern yang dilarang

Menduplikasi stok dalam state UI tanpa validasi DB; menghapus sale saat cetak gagal; meminta QRIS dibayar ulang akibat timeout POS; menyimpan SQLite dalam ASAR; menaruh semua logic di Electron renderer; membypass auth karena server `localhost`; backup dengan meng-copy file WAL aktif tanpa snapshot konsisten; memodifikasi schema tanpa migrasi.

## Panduan serah-terima khusus OpenCode (baseline 11 November 2026)

- Baca `CONTEXT.md`, `AGENTS.md`, keenam dokumen Product, lalu kedelapan dokumen Architecture **sebelum** mengubah kode. `DECISIONS.md` menentukan status keputusan; jangan mengubah PROPOSED/PENDING menjadi fakta.
- Implementasi pekerjaan P0 per irisan kecil dengan satu commit dan pengujian tiap irisan: auth + roles; katalog + barcode; shift; prepare/commit + stock ledger; QRIS manual; struk; laporan; backup+restore; installer+migrasi.
- Ikuti `API_CONTRACT.md` §2A untuk kontrak `attemptKey`/`requestHash`; buat satu implementasi kanonisasi di `shared` beserta golden-vector test.
- Jangan melakukan operasi uang/stok dari renderer; cegah endpoint loopback dapat diakses proses lain tanpa sesi, autentikasi origin / CSRF yang sesuai, dan proteksi Electron (`contextIsolation`, `sandbox`, tanpa Node integration di renderer).
- Penutupan shift normal hanya pemilik yang sedang login. Bila terjadi keadaan kasir tidak bisa login, tandai `BLOCKED: SOP shift recovery`—jangan membuat bypass ADMIN diam-diam.
- Semua penjualan harus dibuktikan dengan tes transaction rollback, restart, double-submit, retry dengan payload beda, stok habis, serta QRIS yang belum diverifikasi.
- Perubahan DDL harus berupa migrasi yang teruji. Jangan memodifikasi database produksi manual; uji `foreign_key_check`, `integrity_check`, dan restore sebelum pilot.
- Siapkan dan lampirkan hasil spike nyata di PC kasir (versi Windows, Electron dan driver SQLite, scanner, printer, installer, backup ke media eksternal). Tanpa bukti itu jangan klaim aplikasi production-ready.
