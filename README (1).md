# Sistem Kasir dan Inventaris Minimarket Kampus

> **Status proyek:** tahap dokumentasi dan persiapan implementasi; **bukan** pernyataan siap produksi.  
> **Target tim:** menggantikan sistem berlangganan dalam 14 hari sejak 11 November 2026, **dengan syarat lulus uji dan disetujui pengelola**. Jadwal merupakan target agresif, bukan jaminan.

Satu sistem kasir dan inventaris untuk minimarket kampus, dirancang bagi **satu PC kasir** dan **dua shift** dengan peran `ADMIN` serta `CASHIER`. Transaksi dan data operasional disimpan di **SQLite lokal** agar pekerjaan kasir tidak bergantung pada internet. Target distribusi adalah aplikasi desktop Windows (`.exe`).

## 1. Lingkup rilis pertama

Arah MVP yang disepakati tim:

- Login lokal dengan pembatasan akses `ADMIN` dan `CASHIER`.
- Data produk/barcode, harga, dan persediaan; pembelian atau penerimaan barang mengikuti batas P0 pada dokumen Product.
- Penjualan tunai dan **QRIS manual**. Kasir memeriksa keberhasilan dan nominal pembayaran pada aplikasi merchant yang sah sebelum menyelesaikan transaksi di POS. Aplikasi **tidak** terhubung otomatis dengan bank.
- Pengurangan stok atomik bersama penyimpanan penjualan; koreksi stok oleh admin disertai alasan dan jejak audit.
- Buka/tutup shift secara eksplisit, rekap pembayaran, dan perhitungan kas berdasarkan aturan yang perlu dikonfirmasi dengan pengelola.
- Laporan dasar untuk admin, pencetakan serta cetak ulang struk, backup/restore SQLite, dan operasi offline.

Member/kredit pelanggan, refund/retur otomatis, sinkronisasi cloud, dan QRIS otomatis **bukan janji fitur rilis pertama**. Detail dan status resmi tiap keputusan harus mengikuti `docs/product/DECISIONS.md` serta `docs/product/SCOPE.md` yang aktif.

## 2. Struktur repository

Struktur berikut adalah **rancangan direktori yang harus diikuti** saat menyiapkan repository. Direktori kode dapat belum terisi sampai implementasi dimulai.

```text
pos-minimarket/
├── CONTEXT.md
├── AGENTS.md
├── README.md
├── .env.example
├── .gitignore
├── frontend/
├── backend/
├── shared/
├── scripts/
├── .github/
└── docs/
    ├── product/
    │   ├── PRD.md
    │   ├── USER_STORIES.md
    │   ├── ACCEPTANCE_CRITERIA.md
    │   ├── SCOPE.md
    │   ├── TASKS.md
    │   └── DECISIONS.md
    ├── architecture/
    │   ├── ARCHITECTURE.md
    │   ├── TECH_STACK.md
    │   ├── DATABASE.md
    │   ├── API_CONTRACT.md
    │   ├── SYNC_STRATEGY.md
    │   ├── DESIGN_SYSTEM.md
    │   ├── CODING_STANDARDS.md
    │   └── ERROR_HANDLING.md
    ├── security/
    │   ├── SECURITY.md
    │   ├── THREAT_MODEL.md
    │   ├── AUTHORIZATION.md
    │   ├── DATA_PROTECTION.md
    │   ├── BACKUP_RECOVERY.md
    │   ├── AUDIT_LOG.md
    │   └── SECURITY_CHECKLIST.md
    └── operations/
        ├── TEST_PLAN.md
        ├── TEST_CASES.md
        ├── DEPLOYMENT.md
        ├── OPERATIONS.md
        ├── TROUBLESHOOTING.md
        ├── CONTRIBUTING.md
        ├── GIT_WORKFLOW.md
        ├── DEFINITION_OF_DONE.md
        └── PERFORMANCE.md
```

Ada **33 dokumen Markdown** dalam struktur ini: 3 di root, 6 Product, 8 Architecture, 7 Security, dan 9 Operations. `.env.example` dan `.gitignore` tidak termasuk hitungan MD.

### Tanggung jawab direktori

| Lokasi | Peran |
| --- | --- |
| `frontend/` | Antarmuka kasir dan admin. |
| `backend/` | Logika bisnis, API lokal, autentikasi, transaksi dan akses SQLite. |
| `shared/` | Tipe/kontrak atau utilitas yang benar-benar dipakai bersama; jangan menduplikasi logika bisnis. |
| `scripts/` | Alat bantu lokal untuk development, migrasi atau pengujian yang disetujui. |
| `.github/` | Konfigurasi kerja sama GitHub bila diperlukan. |
| `docs/product/` | Apa yang harus dibangun, cakupan, keputusan, dan kriteria terima. |
| `docs/architecture/` | Cara sistem dirancang, skema, kontrak API, dan aturan coding. |
| `docs/security/` | Hak akses, perlindungan data, backup, audit, dan pemeriksaan keamanan. |
| `docs/operations/` | Pengujian, instalasi, operasi, troubleshooting, dan alur kolaborasi. |

Jangan membuat aplikasi kedua untuk gudang, menambah direktori besar baru, atau mengganti struktur ini hanya berdasarkan asumsi AI agent. Jika ada kebutuhan teknis yang nyata, ajukan perubahan dan dokumentasikan alasannya.

## 3. Urutan membaca dokumen

Untuk anggota tim maupun OpenCode:

1. `README.md` — orientasi proyek dan struktur repository.
2. `CONTEXT.md` — sumber kebutuhan awal, asumsi, dan hal yang belum terverifikasi.
3. `AGENTS.md` — batasan dan prosedur kerja AI coding agent.
4. `docs/product/DECISIONS.md`, `PRD.md`, `SCOPE.md`, `ACCEPTANCE_CRITERIA.md`, `TASKS.md` — keputusan dan target kerja.
5. Dokumen Architecture, Security, dan Operations yang terkait dengan tugas.

**Penting:** utamakan versi file yang benar-benar ada dalam repository. Jika dua file bertentangan, **jangan memilih secara diam-diam**; laporkan file, bagian/ID, dampak, serta keputusan yang dibutuhkan kepada koordinator. `DECISIONS.md` mencatat status keputusan, bukan izin untuk menganggap `PENDING` sebagai `ACCEPTED`.

## 4. Anggota tim

| Anggota | Tanggung jawab utama |
| --- | --- |
| David | Koordinasi, analisis kebutuhan, database, dan review lintas modul. |
| Syafroni | Frontend dan pengalaman pengguna kasir/admin. |
| Rahmat | Backend, SQLite, transaksi, dan integrasi. |
| Naazmi | QA, dokumentasi, pengujian perangkat, dan integrasi. |

Gunakan satu repository GitHub. Perubahan kode dilakukan melalui branch dan pull request sesuai `docs/operations/GIT_WORKFLOW.md`. Jangan memasukkan database produksi, password, atau kredensial merchant ke repository.

## 5. Menjalankan proyek dan memasang aplikasi

**Belum ada perintah instalasi atau menjalankan program yang bisa dinyatakan teruji dari dokumen root ini.** Jangan mengarang `npm install`, `npm run dev`, nama executable, jalur database, atau variabel lingkungan sebelum struktur kode dan scripts dibuat dan diuji.

Ketika implementasi sudah tersedia:

- Perintah development, persyaratan Node.js, dan variabel `.env.example` harus didokumentasikan berdasarkan file konfigurasi yang nyata.
- Instalasi Windows, upgrade, backup sebelum migrasi, serta rollback mengikuti `docs/operations/DEPLOYMENT.md`.
- Langkah pengoperasian kasir/admin mengikuti `docs/operations/OPERATIONS.md`.
- Cara memulihkan cadangan mengikuti `docs/security/BACKUP_RECOVERY.md` dan harus diuji di lingkungan terpisah.

## 6. Syarat sebelum mengganti sistem lama

Jangan melakukan cutover hanya karena kode berhasil dijalankan atau 33 MD telah dibuat. Minimal perlu bukti:

- Data barang, barcode, harga dan stok dari sistem lama dapat dipindahkan atau diinput dengan hasil rekonsiliasi yang disetujui.
- Transaksi tunai, QRIS manual, stok, shift, laporan, dan struk lulus pengujian pada **PC, scanner, dan printer tujuan**.
- Pembayaran QRIS diverifikasi melalui kanal resmi merchant; kegagalan/ketidakpastian pembayaran memiliki prosedur.
- Uji retry, transaksi ganda, kegagalan printer, restart/listrik mati, dan backup serta **restore** dilakukan dan dicatat.
- Aturan modal awal, setoran, selisih kas, shift, dan kewenangan petugas divalidasi pengelola.
- Pengelola menyetujui cutover dan tersedia cara kembali ke sistem sebelumnya atau prosedur darurat bila terjadi kegagalan.

Rujukan bukti dan syarat lulus: `docs/operations/TEST_PLAN.md`, `TEST_CASES.md`, `DEFINITION_OF_DONE.md`, dan `DEPLOYMENT.md`.

## 7. Status dan perubahan dokumen

README ini menjelaskan tujuan dan lokasi file, **bukan menggantikan spesifikasi rinci**. Dokumentasi awal memiliki perbedaan versi dan beberapa pertanyaan operasional yang belum terjawab; perbedaan tersebut harus direkonsiliasi sebelum OpenCode mengimplementasikan bagian yang terkait.

Jangan mengubah keputusan bisnis, schema, API, atau izin tanpa review. Catat alasan perubahan di `docs/product/DECISIONS.md` dan perbarui dokumen terkait secara terkontrol.
