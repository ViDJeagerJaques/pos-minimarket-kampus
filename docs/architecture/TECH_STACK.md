# TECH STACK — POS Minimarket Kampus

| Atribut | Keterangan |
|---|---|
| Lokasi | `docs/architecture/TECH_STACK.md` |
| Versi | 0.1.0 — 11 November 2026 |
| Status | **BASELINE DESAIN UNTUK REVIEW TEKNIS** — bukan hasil uji/perizinan produksi |
| Acuan utama | `docs/product/PRD.md` v0.3.1, `SCOPE.md` v0.1.1, `DECISIONS.md` v0.2.3, `ACCEPTANCE_CRITERIA.md` v0.1.1 |
| Pemeriksa | David (model data), Rahmat (backend & integrasi), Syafroni (UI), Naazmi (QA) |

## 1. Keputusan yang telah disetujui vs kandidat

| Lapisan | Pilihan | Status | Alasan & batas |
|---|---|---|---|
| Perangkat | Satu PC Windows | ACCEPTED DEC-002/005 | Target pengujian & installer |
| Penyimpanan | SQLite lokal persisten | ACCEPTED DEC-003/004 | Transaksi tanpa internet |
| UI | React + Vite + TypeScript | PROPOSED DEC-010 | Cepat dibuat tim; butuh cek kompatibilitas |
| Backend | Node.js LTS + Express + TypeScript | PROPOSED DEC-010 | API dan validasi di satu proses lokal |
| Desktop | Electron | PROPOSED DEC-011 | Kemasan Windows; ada biaya RAM/ukuran |
| SQLite driver | `better-sqlite3` kandidat | BELUM DISETUJUI | Native module ABI Electron, rebuild, backup API harus diuji |
| Pengujian | Vitest, Supertest, Playwright kandidat | PROPOSED | Unit, API, end-to-end; versi dikunci di lockfile |
| Cloud & QRIS API | Tidak termasuk P0 | OUT | QRIS diverifikasi manusia di aplikasi merchant |

Larangan mengunci nomor versi sembarang: catat versi yang benar-benar berhasil diinstal, lulus build, dan dites pada PC kasir ke lockfile serta catatan rilis. Tidak ada klaim kompatibilitas sebelum percobaan.

## 2. Rekomendasi susunan eksekusi

`frontend/` React renderer; `backend/` Node business service dan SQLite; `shared/` DTO/schema dan kode error. Electron main hanya bootstrap, proses, window, print, dan antarmuka preload terbatas. Lokasi wrapper dapat ditentukan di dalam struktur repository saat coding, tanpa menambah file MD di luar 33 kanonik.

```text
Kasir (React renderer) → API lokal (Express, 127.0.0.1) → SQLite (userData)
                                    ↘ printer melalui adapter desktop aman
QRIS merchant HP ↔ manusia/kasir (bukan terhubung otomatis ke POS)
```

## 3. Guardrail Electron dan backend

- `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`; jangan izinkan navigasi tak dikenal, `webview`, konten remote atau izin OS tanpa review.
- API lokal tidak boleh bind 0.0.0.0. Semua endpoint tetap butuh sesi dan otorisasi, meskipun di localhost. Gunakan token lokal acak per sesi dan kontrol origin.
- Password hash adaptif (Argon2id kandidat atau scrypt/bcrypt sesuai kompatibilitas); jangan simpan plaintext. Kredensial merchant tidak disimpan.
- Dependency lockfile, pembatasan permission, audit library pihak ketiga sebelum installer. `npm audit` saja bukan bukti aman.
- Database, backup dan log di direktori data persisten, bukan folder aplikasi. Uji penghapusan installer tidak menghapus data.

## 4. Uji kelayakan wajib sebelum penguncian stack

1. Catat spesifikasi PC: OS/arsitektur, RAM, ruang disk, hak install, AV, scanner, printer, driver.
2. Buat spike installer Electron + SQLite STRICT dan operasi baca/tulis setelah restart.
3. Uji native SQLite driver saat packaged, bukan hanya `npm run dev`.
4. Uji scanner keyboard-wedge saat fokus input berubah; uji printer asli dan cetak ulang.
5. Cabut internet, buka aplikasi, login, penjualan, rekap dan backup.
6. Catat dampak startup/memori dan lakukan keputusan GO/alternatif bila PC tidak kuat.

## 5. Trade-off / keputusan tertunda

Express dalam Electron mempermudah berbagi API tetapi menambah lifetime proses/port. Alternatif IPC tanpa Express dapat dipertimbangkan **hanya lewat revisi DEC-010** karena akan mengubah API kontrak dan beban tim. Jangan memasukkan Supabase atau payment gateway untuk P0. Referensi: DEC-003–005, DEC-010–011, DEC-020, SCOPE S-01–S-12.
