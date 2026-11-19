# TASK-039 — Koreksi stok ADMIN dengan ledger dan audit

## Status dan lingkup

**REVIEW**, implementasi backend DEMO. Base `origin/master` terverifikasi `9473e52`,
branch `task/p25-039`. Dependensi nyata tersedia: TASK-009 (auth/session dan gate
HTTP), TASK-010 (catalog/products), TASK-015 (ledger, stock_balances dan rekonsiliasi).
TASKS.md masih memakai beberapa status lama; kesiapan coding diperiksa dari kode.
Tidak membuat UI, tidak mengubah stack atau menambah dependency.

Ketertelusuran: POS-07.03 / AC-07.03, POS-08.02, DEC-004/007, DEC-014/018,
AUD-04. K-11 dari audit TASK-001 ditangani teknis dengan adjustmentKey/request_hash
pada migrasi aditif 0003. Kontrak dan migrasi dijelaskan sebelum implementasi;
persetujuan operasional/SOP tidak diasumsikan. Review tim atas kontrak tetap diperlukan.

## File dan perubahan

- `backend/src/inventory/adjustments.ts`: validasi, ADMIN aktif, hash niat,
  cek expectedOnHand, mutasi bertanda, retry snapshot asli, transaksi penulis.
- `backend/src/inventory/audit.ts`, `errors.ts`: event INVENTORY_ADJUSTED dan
  pemetaan IDEMPOTENCY_CONFLICT.
- `backend/src/http/app.ts`, `cli.ts`: POST /api/v1/inventory/adjustments,
  gate ADMIN, registrasi service dan error HTTP.
- `backend/db/migrations/0003_inventory_adjustments.sql`: key/hash, FK unik
  movement dan snapshot saldo; migrasi 0001/0002 tetap utuh.
- `backend/src/inventory/adjustments.test.ts`, `backend/src/http/adjustments.test.ts`:
  20 tes baru dengan data sintetis, SQLite sementara dan HTTP loopback nyata.
- `backend/db/test/migrate.test.ts`, `failure.test.ts`, `backend/qa/qa_fixtures.ts`:
  ekspektasi versi skema 3 dan nomor migrasi kegagalan uji 4+.
- `backend/package.json`: daftar suite baru pada npm test.
- `backend/README.md`, `docs/architecture/API_CONTRACT.md`, `DATABASE.md`:
  kontrak DEMO, migrasi, retry dan batasnya.
- Laporan ini: hasil aktual dan handoff review.

## Verifikasi aktual

Lingkungan: Windows, Node v24.18.0; database sintetis di temp OS di luar repository.
Dari root dijalankan `npm --prefix backend run typecheck` dan
`npm --prefix backend test` (ekuivalen cd backend lalu npm run typecheck/npm test).

| Pemeriksaan | Hasil | Bukti |
| --- | --- | --- |
| Typecheck backend | PASS, exit 0 | `.git/task039-logs/backend-typecheck.log` |
| Seluruh tes backend | PASS 152/152, fail 0, skipped 0 | `.git/task039-logs/backend-test.log` |
| `git diff --check` | PASS | Pemeriksaan diff lokal |

Log mentah lokal tidak di-commit. Hasil akhir npm test: tests 152, pass 152,
fail 0, cancelled 0, skipped 0, todo 0. Suite awal sebelum tes tambahan saldo nol
juga lulus 151/151; angka final adalah 152.

Bukti API/DB yang diperiksa oleh tes:

1. 5 -> 3: delta -2, reason/pelaku/waktu tersimpan; actor dan waktu dari body
   palsu tidak dipakai. Saldo view, agregasi ledger dan rekonsiliasi cocok;
   integrity_check ok, foreign_key_check kosong.
2. CASHIER 403, tanpa sesi/nonaktif 401; negatif/alasan kosong/input invalid 422,
   saldo awal stale 409, produk tidak ada 404; tidak ada mutasi/audit baru.
3. Dua request HTTP identik yang dikirim bersamaan menghasilkan satu movement,
   satu key dan satu audit. Isi atau actor berbeda pada key sama ditolak 409.
4. Reopen koneksi SQLite dan buat ulang service: retry memberi hasil pertama
   meskipun koreksi selanjutnya sudah mengubah saldo (simulasi restart service).
5. Trigger uji menggagalkan insert identitas retry atau audit: seluruh transaksi
   rollback, key tetap dapat digunakan setelah penyebab gagal dihilangkan.
6. Migrasi v2 dengan ledger lama -> v3 menjaga saldo/riwayat, backup v2 valid,
   lalu koreksi dapat dilakukan. Suite migrasi lama tetap menguji rollback
   migrasi parsial dan pemulihannya pada database development.
7. Saldo nol, penambahan dan produk nonaktif tetap melalui ledger bertanda.

## Risiko, batas dan langkah berikutnya

- Backend saja: tidak ada tes UI/browser baru, tes hardware atau PC kasir tujuan.
  Tidak mengklaim gangguan listrik/kill proses riil atau GO-LIVE. HTTP memakai server
  lokal nyata; simulasi restart membuka ulang koneksi/service, bukan reboot Windows.
- DEC-018 tetap PROPOSED. Fixture konservatif menolak stok negatif/delta nol dan
  memakai expectedOnHand untuk mencegah koreksi berdasarkan saldo usang.
- Snapshot onHand pada retry bukan saldo terkini. Klien harus memakai key dan payload
  identik ketika hasil belum jelas; koreksi baru memerlukan cek saldo ulang.
- CodeRabbit CLI tidak ditemukan saat pengecekan, sehingga review CLI tidak dijalankan.
  Tidak ada klaim hasil CodeRabbit/CI remote. Badouka memeriksa dari PR.
- `.ua/` dan `set-sandi-qa.mjs` sudah ada sebelum tugas; tidak diubah atau di-commit.
- Selanjutnya: review kontrak K-11, migrasi dan CI PR oleh tim; jangan merge oleh agent.
  Backend koreksi kini tersedia untuk integrasi UI terpisah dan dependensi coding
  TASK-040. Validasi SOP opname/otorisasi, data awal dan izin pengelola tetap syarat GO-LIVE.
