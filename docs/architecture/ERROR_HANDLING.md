# ERROR HANDLING — POS Minimarket Kampus

| Atribut | Keterangan |
|---|---|
| Lokasi | `docs/architecture/ERROR_HANDLING.md` |
| Versi | 0.1.0 — 11 November 2026 |
| Status | **BASELINE DESAIN UNTUK REVIEW TEKNIS** — bukan hasil uji/perizinan produksi |
| Acuan utama | `docs/product/PRD.md` v0.3.1, `SCOPE.md` v0.1.1, `DECISIONS.md` v0.2.3, `ACCEPTANCE_CRITERIA.md` v0.1.1 |
| Pemeriksa | David (model data), Rahmat (backend & integrasi), Syafroni (UI), Naazmi (QA) |

## 1. Tujuan dan struktur error

Semua error harus mudah dimengerti kasir, aman, dan menentukan apakah operasi boleh diulang. Error response: `{ "error": { "code": "...", "message": "...", "requestId": "...", "retryable": false } }`. Catat debug detail di backend lokal secara terbatas, **bukan** pada UI. Tidak pernah menyertakan stack trace, hash password, PIN atau token merchant.

## 2. Tabel kode domain

| Kode | HTTP | Makna untuk pengguna | Aksi UI |
|---|---:|---|---|
| `VALIDATION_ERROR` | 422 | Data yang diisi belum sesuai | Fokus kolom bermasalah |
| `AUTH_REQUIRED` | 401 | Sesi habis, masuk kembali | Pertahankan draft aman |
| `FORBIDDEN` | 403 | Akses hanya untuk petugas berwenang | Tanpa perubahan data |
| `SHIFT_NOT_OPEN` | 409 | Buka atau lanjutkan shift dahulu | Arahkan halaman shift |
| `SHIFT_ALREADY_OPEN` | 409 | Sudah ada shift aktif | Tampilkan shift aktif |
| `INSUFFICIENT_STOCK` | 409 | Stok kurang | Tampilkan item dan stok |
| `PRICE_CHANGED` | 409 | Harga berubah | Minta kasir konfirmasi ulang |
| `IDEMPOTENCY_CONFLICT` | 409 | Upaya sama dengan isi berbeda | Jangan buat sale baru |
| `PAYMENT_UNVERIFIED` | 422 | QRIS belum terverifikasi | Periksa merchant, jangan commit |
| `PAYMENT_AMOUNT_MISMATCH` | 422 | Nominal QRIS tidak cocok | Hentikan checkout |
| `PAYMENT_RECONCILIATION_REQUIRED` | 409 | Status bank/POS belum pasti | Jangan minta bayar ulang; cek status + SOP |
| `TRANSACTION_STATUS_UNKNOWN` | 503 | Hasil penyimpanan belum jelas | Query attemptKey, jangan submit baru |
| `PRINTER_UNAVAILABLE` | 503 | Struk belum dapat dicetak | Cetak ulang sale committed |
| `BACKUP_FAILED` | 500 | Backup gagal, perlu tindakan admin | Laporkan, jangan klaim aman |
| `STORAGE_UNAVAILABLE` | 503 | Media simpan bermasalah | Hentikan transaksi; lindungi DB |
| `INTERNAL_ERROR` | 500 | Ada gangguan sistem | requestId untuk investigasi |

HTTP status adalah kontrak rancangan; disesuaikan konsisten dengan API saat coding.

## 3. Aturan retry berdasar tahap

**Sebelum pembayaran fisik:** boleh membatalkan draft atau mengulang validasi setelah masalah input diselesaikan. **Setelah QRIS berhasil di bank:** jangan meminta pelanggan membayar lagi saat error POS; query `attemptKey`, telusuri merchant dan log lokal, jalankan prosedur rekonsiliasi yang disetujui. **Setelah commit sale:** retry cetak saja, bukan checkout baru. **Saat hasil commit belum pasti:** status `UNKNOWN`, tombol UI `Periksa transaksi`, bukan `Bayar lagi`.

## 4. Kontrol saat crash dan disk penuh

SQLite error sebelum commit => rollback, tidak ada sale/item/payment/stock movement parsial. Bila backend tidak dapat memastikan commit atau integritas DB => blok checkout baru sampai diperiksa admin/teknis. Restart aplikasi tidak menutup shift. Printer macet tidak membatalkan sale. SQLite corruption/disk penuh adalah blocker GO/NO-GO sampai restore dan rekonsiliasi terbukti.

## 5. Logging dan observabilitas

Log `requestId`, timestamp, actorId, shiftId, operation, result, error code, attemptKey (non-secret), tanpa merekam password atau PIN. Rate-limit error login dan hindari pesan "username tidak ada". Audit harga/koreksi/shift di tabel audit, bukan hanya console log. Naazmi wajib menguji skenario tiap kode domain kritis.

## 6. Skenario test wajib

Simulasikan double click, hilang koneksi frontend/backend saat commit, power failure mendekati commit, printer offline, barcode tak dikenal, stok habis, salah nominal QRIS, login tidak berizin, close shift berulang, backup gagal, dan data lama tidak cocok. Tetapkan `PASS` hanya jika hasil database dan tindakan UI sama-sama benar.
