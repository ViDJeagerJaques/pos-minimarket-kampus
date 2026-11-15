# TASK-015 — Ledger dan Saldo Awal Uji

| Atribut | Isi |
|---|---|
| Tugas | TASK-015 · Coding DEMO · Owner Rahmat · Reviewer David, Naazmi |
| Referensi | POS-03.06/AC-03.06, POS-07.02/AC-07.02, POS-08.02/AC-08.02 · DEC-004, DEC-007, DEC-018 (PROPOSED) |
| Branch | `task/p11-015` (lokal; belum commit/PR) |
| Basis | `origin/master` @ `6ee358d` (memuat TASK-008 + TASK-010 + TASK-013) |
| Tanggal | 15 November 2026 |
| Status | **REVIEW** — ledger/fixture/rekonsiliasi lulus tes DB development; endpoint checkout/penerimaan/laporan dan uji PC tujuan belum ada |
| Lingkup | Pembacaan saldo dari ledger, fixture saldo awal sintetis, rekonsiliasi per SKU |

> Tidak ada klaim GO-LIVE, uji perangkat, atau persetujuan pengelola.

## 1. Yang dibuat

| Path | Isi |
|---|---|
| `backend/src/inventory/ledger.ts` | Agregasi saldo dari `inventory_movements`, riwayat mutasi beserta rujukan sumber, rekonsiliasi per SKU, penjaga stok negatif |
| `backend/src/inventory/openingFixture.ts` | Fixture OPENING transaksional + idempoten per `batchRef`, audit dalam commit yang sama |
| `backend/src/inventory/audit.ts` | Whitelist `STOCK_OPENING_IMPORTED` (usulan) + sanitasi details |
| `backend/src/inventory/errors.ts` | Error domain inventaris (`INSUFFICIENT_STOCK` 409, 422, 404, 409) |
| `backend/src/inventory/types.ts` | DTO ledger/riwayat/rekonsiliasi/fixture |
| `backend/src/inventory/ledger.test.ts` | 6 tes ledger, riwayat sumber, rekonsiliasi, penjaga stok, sinkron katalog, constraint DB |
| `backend/src/inventory/openingFixture.test.ts` | 5 tes fixture: idempotensi, konflik batch, rollback, input invalid, whitelist audit |
| `backend/package.json` | Daftar tes bertambah dua file inventaris |
| `backend/README.md` | §10 ledger dan saldo awal uji |

Aturan yang diikuti:

- **Ledger adalah sumber saldo tunggal** (DATABASE.md §9). Tidak ada kolom saldo
  yang dapat diubah langsung; `getStockBalance`/`listStockBalances` menjumlahkan
  `inventory_movements`. Produk tanpa mutasi menghasilkan 0.
- **Pencegahan duplikasi**: partial unique index `ux_movements_opening_product`
  (sudah ada di migrasi 0001, tidak diubah) +_fixture idempoten per `batchRef`;
  batch berbeda untuk produk yang sama ditolak 409.
- **Atomisitas**: mutasi + audit fixture dalam satu transaksi; kegagalan di
  tengah rollback. Kegagalan mutasi tidak mengubah saldo/riwayat/audit.
- **Rekonsiliasi**: `opening + receipt + sale + adjustment = ledgerOnHand`,
  plus deteksi OPENING ganda, mutasi tanpa sumber/alasan, dan saldo negatif.
- **Sinkron katalog**: `catalog/service.ts` memakai agregasi ledger yang sama
  untuk `stockOnHand`; tes membandingkan keduanya.
- Tidak ada perubahan skema/migrasi. Tidak ada checkout/pembayaran/penerimaan
  operasional.

## 2. Verifikasi yang dijalankan

Lingkungan: Windows, PowerShell, Node.js 26.13.1 portable, SQLite 3.54.1,
database uji di temp OS (di luar source tree).

| # | Perintah (dari `backend/`) | Hasil |
|---|---|---|
| V1 | `npm run typecheck` | **PASS**, exit 0 tanpa diagnostik |
| V2 | `npm test` (seluruh DB/QA/auth/catalog/inventaris) | **PASS 75/75**, 0 fail, ±11,9 s |
| V3 | `node --test src/inventory/ledger.test.ts src/inventory/openingFixture.test.ts` | **PASS 11/11** |

### 2.1 Bukti tes wajib

| Wajib | Terbukti |
|---|---|
| Produk baru tanpa mutasi bersaldo 0 | `getStockBalance` → 0, `hasMovements=false` |
| Fixture +10 opening, -3 sale → 7 | saldo 7; riwayat OPENING batch + SALE `SALE-INV-0001` qty 3 |
| Mutasi ilegal ditolak constraint | OPENING ganda (unique), OPENING negatif, SALE tanpa `sale_item_id`, ADJUSTMENT tanpa alasan (CHECK) |
| Saldo negatif/kurang ditolak | `assertSufficientStock` 409; saldo, riwayat, audit tidak berubah |
| Fixture dua kali tidak menggandakan stok | batch sama → `skipped`, saldo tetap 10/5, movements 2, audit 2 |
| Batch berbeda ditolak | 409; tidak ada perubahan |
| Kegagalan mutasi rollback | produk tidak ada di tengah entries → movements 0, audit 0; audit gagal (`now=-1`) → movements 0, audit 0 |
| Rekonsiliasi per SKU | opening 10 + receipt 4 − sale 3 − adjustment 1 = 10; `matched=true` |
| Sinkron katalog | `stockOnHand` catalog == ledger (10) |

## 3. Risiko / keputusan terbuka

- `STOCK_OPENING_IMPORTED` belum ada di AUDIT_LOG.md AUD-04; dicatat sebagai
  **usulan kontrak** (DATABASE.md §13 memang mewajibkan audit impor stok).
  Perlu review David/Naazmi sebelum dianggap final.
- Fixture membaca `actorId` dari pemanggil; hanya memeriksa akun aktif, belum
  memaksa role ADMIN. Impor awal produksi (TASK-038) harus memakai jalur ADMIN.
- Penjaga `assertSufficientStock` belum dipakai checkout (TASK-016); aturan
  DEC-018 masih `PROPOSED`.
- Belum ada endpoint HTTP laporan/penerimaan; modul siap dipakai TASK-025/026.
- Belum diuji volume besar/`EXPLAIN QUERY PLAN` (DATABASE.md §16) dan PC tujuan.

## 4. Git

- Branch `task/p11-015` dari `origin/master` @ `6ee358d`; working tree bersih
  sebelum perubahan.
- Perubahan TASK-015 **belum di-commit**; tidak ada push/PR/merge.
- TASK-009 review fix yang sebelumnya diminta sudah ada di master
  (`40c674c`, `beb7aad`, `5691d11`, `241423d`, merge PR #11) — tidak diduplikasi.

## 5. Langkah berikutnya

1. Review David/Naazmi untuk event audit `STOCK_OPENING_IMPORTED`.
2. TASK-016 memakai `assertSufficientStock` di transaksi commit checkout.
3. TASK-025 memakai ledger yang sama untuk penerimaan; TASK-026 memakai
   `reconcileProduct`/`listStockBalances` untuk laporan.
4. Uji performa agregasi dan fixture pada data representatif/PC tujuan.
