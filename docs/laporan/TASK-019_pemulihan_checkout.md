# TASK-019 — Pulihkan Hasil Checkout

| Atribut | Isi |
|---|---|
| Tugas | TASK-019 · Coding/QA DEMO · Owner Rahmat · Reviewer David, Naazmi |
| Referensi | POS-04.01/AC-04.01, POS-04.02/AC-04.02 · DEC-007, DEC-013 |
| Branch | `task/p16-019` (lokal; belum commit/PR) |
| Basis | `origin/master` @ `92b0303` (memuat TASK-016, TASK-017, TASK-018) |
| Tanggal | 17 November 2026 |
| Status | **REVIEW** — endpoint dan persistensi sudah ada di TASK-016; bukti pemulihan TASK-019 lulus tes HTTP development. UI pemulihan (TASK-020) dan uji PC tujuan belum ada |
| Lingkup | Verifikasi GET status attempt, respons hilang, restart, otorisasi owner/ADMIN |

## 1. Yang ditemukan dan dikerjakan

Pemeriksaan implementasi menunjukkan TASK-016 sudah menyediakan:

- `POST /checkouts/prepare` menyimpan `checkout_attempts` + `request_hash` +
  `checkout_attempt_quotes` **sebelum** commit.
- `POST /checkouts/commit` idempoten: retry memakai attemptKey/hash yang sama
  mengembalikan `sales`/`payments`/mutasi yang sama, termasuk setelah shift
  ditutup.
- `CheckoutService.getStatus()` + route `GET /api/v1/checkouts/:attemptKey`
  dengan `owner/ADMIN`, status `PREPARED`/`COMMITTED`/`ABANDONED`, dan 404
  generik untuk kunci tak dikenal.
- CLI server memasang `checkout` service.

Tidak ada perubahan perilaku yang diperlukan; saya tidak menimpa kode TASK-016.
Yang ditambahkan:

| Path | Isi |
|---|---|
| `backend/src/http/checkoutRecovery.test.ts` | 3 tes HTTP TASK-019: respons commit dibuang → GET COMMITTED; restart setelah prepare → status/hash sama; kasir lain/unknown/anonymous → aman |
| `backend/package.json` | Test entry baru |
| `backend/README.md` | §12 pemulihan checkout |
| laporan ini | Ringkasan bukti |

## 2. Verifikasi yang dijalankan

Lingkungan: Windows, PowerShell, Node 26.13.1 portable, SQLite 3.54.1, DB
sementara di luar source tree.

| # | Perintah (dari `backend/`) | Hasil |
|---|---|---|
| V1 | `npm run typecheck` | **PASS**, exit 0 |
| V2 | `npm test` (seluruh proyek) | **PASS 100/100**, 0 fail, ±15,3 s |
| V3 | `node --test src/http/checkoutRecovery.test.ts` | **PASS 3/3** |

### 2.1 Bukti tes wajib

| Wajib | Terbukti |
|---|---|
| Commit selesai, respons disabotase | Klien membuang body respons (`cancel`) setelah server commit; GET → `COMMITTED`, `saleNo` sama dengan `sales.sale_no`, `requestHash` sama; juga setelah shift ditutup |
| Restart setelah prepare sebelum commit | Server baru dengan secret sesi baru; owner login ulang → `PREPARED`, `requestHash` dan `quote.totalRp` sama; commit lama berhasil → `COMMITTED`, hash tetap sama |
| Kasir lain GET attempt | 403 `FORBIDDEN`; body tidak memuat `saleNo`, `quote`, atau `requestHash`; ADMIN 200 |
| Kunci tak dikenal | 404 `NOT_FOUND` generik; tanpa sesi 401 |
| GET tidak mengulang checkout | Jumlah `checkout_attempts`, `sales`, `payments`, `inventory_movements`, `audit_log` tidak berubah sebelum/sesudah GET |

## 3. Risiko / batas

- Simulasi "respons hilang" membuang body respons di klien HTTP; bukan uji
  power failure/CRASH nyata pada PC tujuan.
- `ABANDONED` diuji di TASK-016 (service test); TASK-019 tidak menambah jalur
  pembatalan baru.
- UI yang menunjukkan status pemulihan adalah TASK-020; belum ada di sini.
- Prosedur rekonsiliasi pembayaran fisik saat status meragukan masih
  `PENDING` (DEC-013); backend tidak menebak status bank/merchant.

## 4. Git

- Branch `task/p16-019` dari `origin/master` @ `92b0303`; working tree bersih
  sebelum perubahan.
- Perubahan **belum di-commit**; tidak ada push/PR/merge.

## 5. Langkah berikutnya

1. TASK-020 menampilkan status PREPARED/COMMITTED/ABANDONED/unknown di UI kasir.
2. TASK-024 menguji interupsi sebelum/sesudah commit dan respons hilang di PC
   tujuan.
3. Validasi prosedur pembayaran fisik/DEC-013 oleh pengelola sebelum GO-LIVE.
