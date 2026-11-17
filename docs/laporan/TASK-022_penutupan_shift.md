# TASK-022 — Penutupan Shift dan Ringkasan

| Atribut | Isi |
|---|---|
| Tugas | TASK-022 · Coding DEMO · Owner Rahmat · Reviewer David, Naazmi |
| Referensi | POS-06.01/AC-06.01, POS-06.02/AC-06.02, POS-06.03/AC-06.03 · DEC-006, DEC-012, DEC-016 |
| Branch | `task/p18-022` (lokal; belum commit/PR) |
| Basis | `origin/master` @ `810c9c0` (memuat TASK-016/017/020) |
| Tanggal | 17 November 2026 |
| Status | **REVIEW** — penutupan + rekap lulus 8 tes baru dan seluruh 108 tes; SOP setoran belum sah dan uji PC tujuan belum ada |
| Lingkup | `POST /shifts/:id/close`, ringkasan CASH/QRIS, selisih fixture, idempotensi, urutan checkout/close |

> Angka setoran adalah **simulasi DEMO** TASK-002 §7, bukan SOP pengelola.

## 1. Yang dibuat

| Path | Isi |
|---|---|
| `backend/src/shift/closeHash.ts` | Kanonisasi `shift-close-v1` + SHA-256 untuk `closeKey`/`declaredCashRp` |
| `backend/src/shift/errors.ts` | `SHIFT_NOT_FOUND`, `SHIFT_CLOSED`, `IDEMPOTENCY_CONFLICT` (409/404) |
| `backend/src/shift/service.ts` | `closeShift`: owner dari sesi, transaksi tunggal, rekap dari sale COMMITTED, `shift_closing_totals`, audit `SHIFT_CLOSED` |
| `backend/src/http/app.ts` | Route `POST /shifts/:id/close` (CASHIER) |
| `backend/src/shift/closing.test.ts` | 6 tes service (rekap, idempotensi, otorisasi, paralel, rollback, shift tertutup) |
| `backend/src/http/shiftClosing.test.ts` | 2 tes HTTP (tutup/idempotensi/restart, 403 lintas kasir & ADMIN) |
| `docs/architecture/API_CONTRACT.md` | Baris close: CASHIER pemilik; ADMIN belum diizinkan (DEC-019 PENDING) |
| `backend/package.json`, `backend/README.md` | Daftar tes + §13 |

Aturan:

- **Owner**: hanya CASHIER pemilik shift; ADMIN ditolak 403 (AUTHORIZATION.md §3,
  DEC-019 `PENDING`).
- **Idempotensi**: `closeKey` unik; `request_hash` dari payload kanonis. Retry
  payload sama mengembalikan penutupan tersimpan; payload beda → 409.
- **Rekap**: jumlah per metode dari `payments` yang terhubung ke `sales` pada
  `checkout_attempts.shift_id` itu (hanya sale COMMITTED). CASH dan
  QRIS_MANUAL selalu ditulis keduanya, termasuk 0.
- **Laci (DEMO)**: `expectedCashRp = (openingCashRp ?? 0) + total CASH`;
  `varianceRp = declaredCashRp - expectedCashRp` bila diisi. QRIS **tidak**
  ditambahkan ke laci (DEC-016). Pengembalian, pengeluaran, dan setoran tengah
  shift tidak tersedia di POS, jadi tidak dikurangkan.
- **Urutan**: `BEGIN IMMEDIATE` di `commit` dan `close`. Checkout yang commit
  lebih dulu masuk rekap; close yang commit lebih dulu membuat checkout
  berikutnya ditolak `SHIFT_NOT_ACTIVE`.
- Audit `SHIFT_CLOSED` (AUD-05) ditulis dalam transaksi yang sama; nominal kas
  tidak diduplikasi ke `details`.

## 2. Verifikasi yang dijalankan

Lingkungan: Windows, PowerShell, Node 26.13.1 portable, SQLite 3.54.1, DB
sementara di luar source tree.

| # | Perintah (dari `backend/`) | Hasil |
|---|---|---|
| V1 | `npm run typecheck` | **PASS**, exit 0 |
| V2 | `npm test` (seluruh proyek) | **PASS 108/108**, 0 fail, ±29,7 s |
| V3 | `node --test src/shift/closing.test.ts src/http/shiftClosing.test.ts` | **PASS 8/8**, 0 fail |

### 2.1 Bukti tes wajib

| Wajib | Terbukti |
|---|---|
| Checkout vs close paralel | Dua urutan diuji: commit lebih dulu → `saleCount=1`, 1 sale; close lebih dulu → `saleCount=0`, checkout setelahnya 409 `SHIFT_NOT_ACTIVE`, 0 sale |
| closeKey sama + payload beda | 409 `IDEMPOTENCY_CONFLICT`; `shift_closings`/`shift_closing_totals`/audit tidak bertambah |
| closeKey sama + payload sama | DTO identik, jumlah baris tetap 1 penutupan/2 baris total; juga setelah restart + login ulang |
| QRIS tidak menambah laci; selisih fixture | modal 100.000 + CASH 500.000 = 600.000; QRIS 300.000 terpisah; uang fisik 600.000 → variance 0 |
| Gagal sebelum commit | `now=-1` → CHECK/rollback; `shift_closings` 0, totals 0, `closed_at_ms` null |
| Hak akses | Kasir lain/ADMIN → 403; shift tetap aktif; input invalid → 422 |
| Rekap | `shift_closing_totals`: CASH 500000, QRIS_MANUAL 300000; `shift_closings.variance_rp=0`; `GET /shifts/current` → null setelah tutup |

## 3. Risiko / keputusan tertunda

- **SOP setoran belum disahkan** (DEC-016 `PENDING`, TASK-002 gate): selisih
  hanyalah aritmetika DEMO. Toleransi, penanggung jawab, dan tindakan kurang/
  lebih belum ada; tidak boleh dipakai untuk uang sungguhan.
- `openingCashRp` opsional; bila kosong, modal dihitung 0 dalam DEMO.
- Tidak ada endpoint GET penutupan; `GET /shifts/current` hanya shift aktif.
  Pembacaan tertutup untuk UI/laporan menyusul (TASK-023/026).
- Belum diuji crash nyata, printer, dan PC tujuan.

## 4. Git

- Branch `task/p18-022` dari `origin/master` @ `810c9c0`; working tree bersih
  sebelum perubahan.
- Perubahan **belum di-commit**; tidak ada push/PR/merge.

## 5. Langkah berikutnya

1. Validasi SOP setoran/selisih dan otorisasi penutupan oleh pengelola + David.
2. TASK-023 menampilkan pratinjau dan retry close di UI.
3. TASK-024 menguji checkout vs close dan restart pada PC tujuan.
