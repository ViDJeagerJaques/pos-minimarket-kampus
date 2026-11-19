# TASK-025 — Simpan Penerimaan dan Mutasinya

| Atribut | Isi |
|---|---|
| Tugas | TASK-025 · Coding DEMO · Owner Rahmat · Reviewer David, Naazmi |
| Referensi | POS-07.01/AC-07.01, POS-07.02/AC-07.02 · DEC-004, DEC-007, DEC-018 (PROPOSED) · AUDIT_LOG.md AUD-03 |
| Branch | `task/p22-025` (lokal; belum commit/PR saat laporan dibuat) |
| Basis | `origin/master` @ `2682268` (memuat TASK-010, TASK-015, TASK-021) |
| Tanggal | 19 November 2026 |
| Status | **REVIEW** — penerimaan + mutasi + idempotensi lulus 7 tes backend; UI/perangkat dan SOP supplier belum ada |
| Lingkup | Penerimaan ADMIN, draft klien, validasi item/qty, mutasi ledger, audit, HTTP endpoint |

## 1. Yang dibuat

| Path | Isi |
|---|---|
| `backend/src/receiving/service.ts` | `receiveGoods`: validasi, hash kanonis, transaksi dokumen+item+mutasi+audit, idempotensi `receiptKey` |
| `backend/src/receiving/errors.ts` | Error domain (422/404/409 `IDEMPOTENCY_CONFLICT`) |
| `backend/src/receiving/audit.ts` | Whitelist AUD-03 `GOODS_RECEIPT_COMMITTED` |
| `backend/src/receiving/service.test.ts` | 6 tes service |
| `backend/src/http/receiving.test.ts` | 1 tes HTTP (ADMIN/CASHIER/idempotensi/invalid) |
| `backend/src/http/app.ts` | Route `POST /goods-receipts` (ADMIN) + mapping error |
| `backend/src/http/cli.ts` | Memasang `ReceivingService` |
| `backend/package.json`, `backend/README.md` | Daftar tes + §14 |

Keputusan implementasi:

- **Draft bukan baris DB.** Tidak ada tabel draft di skema; draft adalah niat di
  klien. Membatalkan draft = membuang niat, tanpa panggilan API, sehingga stok
  tidak berubah. Tidak ada migrasi baru.
- **Actor dari sesi**: `goods_receipts.received_by` dan
  `inventory_movements.actor_id` diambil dari `SessionUser`, bukan body.
- **Idempotensi**: backend menghitung SHA-256 kanonis (`goods-receipt-v1`)
  dari `receiptKey`, `supplierId`, actor, `supplierRef`, dan item yang diurutkan.
  Kunci sama + isi sama mengembalikan dokumen lama (`duplicate: true`); isi
  berbeda ditolak 409 `IDEMPOTENCY_CONFLICT`.
- **Ledger**: satu mutasi `RECEIPT` per item dengan `receipt_item_id`, sehingga
  saldo selalu agregasi `inventory_movements` (tidak ada kolom saldo cache).
- **Audit**: `GOODS_RECEIPT_COMMITTED` ditulis dalam transaksi yang sama;
  rincian item tidak diduplikasi ke `details`.
- **Batas DEMO**: penerimaan hanya menambah stok. Tidak ada pembayaran, utang,
  atau asumsi pembelian berbayar tanpa SOP pengelola.

## 2. Verifikasi yang dijalankan

Lingkungan: Windows, PowerShell, Node 26.13.1 portable, SQLite 3.54.1, DB uji
di direktori temp OS.

| Perintah | Hasil |
|---|---|
| `npm run typecheck` | **PASS**, exit 0 |
| `npm test` | **PASS 126/126**, 0 fail, ±16,9 s |
| `node --test src/receiving/service.test.ts src/http/receiving.test.ts` | **PASS 7/7** |

Bukti wajib: ADMIN +5 → 1 dokumen, 1 item, 1 mutasi RECEIPT delta +5, saldo
2→7; CASHIER → 403 tanpa perubahan; `receiptKey` sama 2× → 1 dokumen dan
`duplicate: true`; isi berbeda → 409; input invalid → 422/404 tanpa perubahan;
trigger gagal pada item kedua → rollback (0 dokumen/item/mutasi/audit baru);
draft dibatalkan → saldo tetap 2.

## 3. Risiko / belum diuji

- Tidak ada endpoint baca daftar penerimaan/format ekspor supplier; TASK-026
  akan memakai tabel yang sama untuk laporan stok.
- SOP supplier, nomor surat jalan, dan perlakuan penerimaan sebagai pembelian
  berbayar masih `PENDING` (DEC-016/DEC-018).
- Validasi DEMO menolak produk nonaktif; perlu konfirmasi bila pengelola ingin
  menerima barang untuk produk yang dinonaktifkan sementara.
- Belum diuji: browser/UI penerimaan, perangkat, uang sungguhan, dan PC tujuan.

## 4. Git

Branch `task/p22-025` dibuat dari `origin/master` @ `2682268`. Commit/PR akan
dicantumkan setelah perintah Git dijalankan.

## 5. Langkah berikutnya

1. Review David/Naazmi untuk asumsi draft klien dan validasi produk nonaktif.
2. TASK-026 menampilkan saldo dan riwayat mutasi penerimaan.
3. Validasi SOP supplier/setoran sebelum penerimaan dipakai operasional.
