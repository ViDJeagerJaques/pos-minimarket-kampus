# Laporan TASK-037 — QRIS Manual: Verifikasi, Catatan Kasir/Waktu, UI Konfirmasi, Laporan Terpisah

| Atribut | Nilai |
|---|---|
| Tanggal | 2026-11-18 |
| Branch | `task/p20-037` (dibuat dari `master` `3759e34`, base `origin/master`) |
| Owner | Syafroni (backend + layar, sesuai keputusan David 18 Nov 2026) |
| Status | **REVIEW** — kode, tes, build, dan E2E API nyata lulus; DEMO sampai SOP merchant disetujui; belum di-commit/push saat laporan ini ditulis |
| Lingkup | QRIS manual `CASH` vs `QRIS_MANUAL`, status `pending`/`verified`/`failed`, audit kasir+waktu, retry idempotent, laporan QRIS terpisah |
| Dependensi | TASK-016 (checkout prepare/commit + QRIS commit), TASK-022 (rekap shift CASH/QRIS) — keduanya diverifikasi nyata di checkout |

> Tidak ada klaim notifikasi bank, callback gateway, kredensial merchant, uang sungguhan,
> persetujuan pengelola, perangkat fisik, atau CodeRabbit.

## 1. Yang dikerjakan

**Backend**
- `backend/src/checkout/audit.ts` — event audit baru `QRIS_MANUAL_CONFIRMED` (AUD-08) masuk whitelist.
- `backend/src/checkout/types.ts` — `qrisVerification` (`pending`/`verified`), `evidenceRef`, dan `PaymentConfirmation` QRIS di kontrak internal.
- `backend/src/checkout/service.ts` — saat commit QRIS tulis audit verifikasi **dalam transaksi SQLite yang sama** dengan sale/payment/mutasi; `verified_by` dari sesi dan `verified_at_ms` dari jam backend; `getStatus` mengembalikan `pending` untuk QRIS yang belum commit. Perilaku lama CASH tidak diubah.
- `backend/src/reports/service.ts` (baru) — `GET /reports/payments` ADMIN: total CASH dan QRIS dipisah, daftar QRIS terverifikasi memuat kasir/waktu/referensi; hanya baris `sales` yang dihitung.
- `backend/src/http/app.ts`, `backend/src/http/cli.ts` — route ADMIN `GET /reports/payments` dan wiring service.
- `backend/src/http/qris.test.ts` (baru) — 1 tes HTTP/E2E API: tanpa konfirmasi dan nominal salah ditolak 422 tanpa sale/mutasi; konfirmasi tepat → 1 sale/payment/mutasi, audit `QRIS_MANUAL_CONFIRMED` sekali, retry identik, laporan terpisah, kasir 403.
- `backend/package.json` — memasukkan tes QRIS ke `npm test`.

**Layar**
- `frontend/src/pages/CashierPage.tsx` — pilihan metode `CASH`/`QRIS_MANUAL` sebelum prepare; dialog QRIS menampilkan status **PENDING — belum ada penjualan**, checkbox konfirmasi merchant, nominal merchant yang harus sama persis dengan quote, referensi bukti opsional; commit button hanya aktif setelah syarat terpenuhi; status **GAGAL** bila backend menolak validasi; status **TERVERIFIKASI** + kasir/waktu hanya setelah `COMMITTED`; timeout QRIS mengarahkan ke lookup status dan retry memakai `attemptKey` + konfirmasi yang sama.
- `frontend/src/pages/ReportsPage.tsx` (baru) — laporan ADMIN: kartu CASH vs QRIS terpisah, tabel rincian QRIS terverifikasi, label DEMO, penanganan 401/403.
- `frontend/src/App.tsx` — halaman Laporan sekarang memakai `ReportsPage`.
- `frontend/src/api/types.ts`, `httpDataSource.ts`, `mockDataSource.ts` — DTO/klien untuk metode QRIS, `qrisVerification`, `evidenceRef`, dan `getPaymentReport`; mock DEMO tidak pernah mengaku menyimpan transaksi.
- `frontend/src/styles/app.css`, `frontend/README.md` — gaya pilihan metode/konfirmasi QRIS dan dokumentasi mode DEMO.
- Tes baru: `frontend/src/pages/CashierPage.qris.test.tsx` (4), `frontend/src/pages/ReportsPage.test.tsx` (4), `frontend/src/api/httpDataSource.test.ts` (+4).

**Bukti E2E**
- `scripts/task-037_qris_e2e.mjs` (baru) — 9 pemeriksaan API nyata dengan SQLite sementara.

Tidak ada perubahan skema/migrasi, tidak ada endpoint bank, tidak ada split payment/refund/void,
dan tidak ada perubahan pada `docs/architecture/API_CONTRACT.md`.

## 2. Perintah tes yang dijalankan

| Perintah | Hasil | Angka |
|---|---|---|
| `cd frontend; npm run typecheck` | **PASS** | tanpa error |
| `cd frontend; npm test -- --run --testTimeout=15000` | **PASS** | 11 file, **132/132** tes |
| `cd frontend; npm run build` | **PASS** | 43 modul; JS 307,86 kB, CSS 11,69 kB |
| `cd backend; npm run typecheck` | **PASS** | tanpa error |
| `cd backend; npm test` | **PASS** | **111/111** tes |
| `node scripts/task-037_qris_e2e.mjs` | **PASS** | **9/9** pemeriksaan E2E |

Baseline sebelum tugas: frontend 120 tes, backend 110 tes.

Catatan jujur: `cd frontend; npm test` dengan timeout default 5 detik mengalami
beberapa tes yang **timed out** karena environment jsdom sangat lambat saat dijalankan
(durasi satu file bisa >20 detik). Tes yang sama lolos 132/132 ketika dijalankan
per-file maupun dengan `--testTimeout=15000`. Tidak ada tes yang gagal secara logika.

### 2.1 Bukti E2E QRIS (`scripts/task-037_qris_e2e.mjs`)

```text
PASS 1. Migrasi SQLite sementara dan server loopback
PASS 2. Login ADMIN dan CASHIER melalui backend nyata
PASS 3. Produk sintetis dan stok awal 5 unit tersedia
PASS 4. QRIS PREPARED: status pending dan belum ada penjualan
PASS 5. Tanpa konfirmasi dan nominal salah ditolak tanpa sale/mutasi
PASS 6. Konfirmasi tepat: satu sale QRIS, satu mutasi, audit kasir/waktu dari sesi backend
PASS 7. Retry identik dan lookup status mengembalikan hasil asli (idempotent)
PASS 8. Laporan QRIS terpisah dari kas; CASHIER ditolak 403
PASS 9. Audit QRIS_MANUAL_CONFIRMED tercatat sekali tanpa menyimpan referensi mentah/kredensial
```

DB akhir pada E2E: `sales=1`, `payments=1`, `inventory_movements=2` (1 OPENING + 1 SALE);
`verified_by` sama dengan ID kasir dari sesi; `verified_at_ms` berasal dari jam backend.

## 3. Status verifikasi dan batasnya

- `pending` — QRIS sudah `PREPARED`; UI menandai PENDING, belum ada sale/payment/mutasi,
  dan `GET /checkouts/:attemptKey` mengembalikan `qrisVerification.status = "pending"`.
- `verified` — hanya ada setelah commit `COMMITTED`; `payments.verified_by/verified_at_ms`
  dan audit `QRIS_MANUAL_CONFIRMED` mengikat kasir dan waktu dari backend.
- `failed` — beda makna dengan **PENDING**: konfirmasi belum dicentang atau
  nominal merchant belum sama dengan quote membuat dialog tetap PENDING dan
  tombol commit dinonaktifkan, bukan GAGAL. Teks "GAGAL" hanya dipakai bila
  backend menolak validasi saat commit (misalnya `VALIDATION_ERROR`) dan tidak
  ada penjualan. Status gagal tidak dipersistenkan karena SOP/rekaman kegagalan
  belum disetujui; ini batas DEMO.

## 4. Risiko, celah kontrak, dan GO-LIVE

1. **DEMO, bukan produksi.** Tidak ada SOP merchant yang disetujui pengelola; QRIS hanya
   boleh dipakai untuk uji dengan label DEMO. Tombol UI tidak pernah menganggap lunas.
2. **Celah kontrak (TASK-001).** `GET /reports/payments`, `qrisVerification`, dan
   `evidenceRef` belum tertulis di `API_CONTRACT.md`; statusnya usulan PROPOSED dan
   perlu review David/Rahmat. Dokumen kontrak tidak diubah diam-diam.
3. **Skema tidak diubah.** Tidak ada kolom status QRIS baru; status verified memakai
   `payments.verified_by`/`verified_at_ms` plus audit `details` JSON sesuai AUDIT_LOG.md.
   Ini menghindari migrasi yang belum disetujui, tetapi status `failed` tidak tersimpan.
4. **Bukti merchant bukan bukti bank.** `merchantConfirmed` adalah attestasi kasir; evidenceRef
   opsional bukan bukti bank otomatis dan tidak disimpan di audit.
5. **Belum diuji:** browser nyata, PC 4 GB/resolusi tujuan, printer, QRIS fisik/aplikasi
   merchant, uang sungguhan, CodeRabbit, validasi pengelola, serta jaringan merchant mati
   secara nyata (timeout hanya disimulasikan lewat `ApiError`).
6. QRIS tidak masuk kas fisik; rekonsiliasi laci dan selisih menunggu SOP/DEC-016.

## 5. Perbaikan temuan review PR #34

Seluruh 22 temuan CodeRabbit (BUG-033–BUG-054) diperiksa terhadap kode saat ini
dan masih valid. Perbaikan diterapkan di branch yang sama, tanpa PR baru:

- QRIS: nominal merchant tidak diisi otomatis; PRICE_CHANGED menyimpan transfer
  lama untuk rekonsiliasi; VALIDATION_ERROR memakai attempt baru; penolakan
  stok/shift tidak menghapus rekaman QRIS; fallback timeout hanya untuk CASH.
- Backend: cleanup tes QRIS bertahap; laporan memakai agregasi SQL + rincian
  dibatasi dalam satu snapshot.
- UI laporan: deskripsi DEMO vs API lokal dibedakan, tombol retry dinonaktifkan
  saat memuat, label kas diperbaiki.
- Data/teks: ringkasan QRIS DEMO cocok dengan rincian, komentar metode bayar
  tidak lagi menyebut "disahkan", banner/README membedakan mock dan API lokal.
- Skrip E2E: backend bind port 0, stop server menunggu exit sebelum hapus DB.
- Tes/DTO: verifikasi QRIS dibedakan per fase, tes retry memakai referensi +
  remount dan membandingkan seluruh isi request kedua.

## 6. Langkah berikutnya

1. Review PR ini; bila disetujui, merge oleh tim sesuai aturan branch (tidak oleh agen).
2. Naazmi: uji QRIS di browser setelah merge. Muat fixture QA TASK-006 ke DB
   uji terpisah, bukan DB E2E script:
   `node backend/qa/qa_runner.ts reset --db <path-qa.sqlite> --confirm-dev-reset`
   lalu arahkan backend ke file itu (`POS_DB_PATH=<path-qa.sqlite>`), setel
   sandi uji untuk akun CASHIER fixture seperti prosedur di
   `scripts/task-013_integration_e2e.mjs`, dan login di browser. Stok awal
   fixture yang diharapkan: product 1 `DEMO-001` 22 unit, product 6
   `QA-STOK-1` 1 unit, product 5 `QA-STOK-0` 0 unit (blokir stok). DB
   sementara milik `scripts/task-037_qris_e2e.mjs` **tidak** dipakai browser
   dan tidak di-seed untuk checkout UI. Status TESTING tetap "Perlu uji ulang";
   checkout manual di UI masih terblokir bila stok produk pilihan kosong
   sampai TASK-025/027.
3. David/Rahmat: tinjau dan tambahkan endpoint/laporan QRIS ke `API_CONTRACT.md` lewat review.
4. Validasi SOP merchant, nominal, bukti, dan cutover dengan pengelola sebelum GO-LIVE.
