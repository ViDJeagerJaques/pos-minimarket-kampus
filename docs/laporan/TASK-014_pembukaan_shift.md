# TASK-014 — Persistensikan Pembukaan Shift

| Atribut | Isi |
|---|---|
| Tugas | TASK-014 · Coding DEMO · Owner Rahmat · Reviewer David, Naazmi |
| Referensi | POS-05.01/AC-05.01, POS-05.02/AC-05.02 · DEC-002, DEC-006, DEC-012 (PROPOSED) · AUTHORIZATION.md §3, SECURITY.md §4 |
| Branch | `task/p12-014` (lokal; belum commit/PR) |
| Basis | `origin/master` @ `0089402` (memuat TASK-008 + TASK-009 + TASK-015) |
| Tanggal | 15 November 2026 |
| Status | **REVIEW** — pembukaan/persistensi/otorisasi shift lulus tes service + HTTP development; penutupan shift, SOP serah terima, dan uji PC tujuan belum ada |
| Lingkup | Pembukaan shift eksplisit, satu shift aktif, pemilik dari sesi, persistensi, guard HTTP |

> Tidak ada klaim GO-LIVE, uji perangkat, atau persetujuan pengelola.

## 1. Yang dibuat

| Path | Isi |
|---|---|
| `backend/src/shift/service.ts` | `openShift` (CASHIER, transaksional, satu shift aktif) dan `getCurrentShift` (kasir own, ADMIN ringkasan) |
| `backend/src/shift/errors.ts` | `SHIFT_ALREADY_OPEN` 409 (ERROR_HANDLING.md §2) |
| `backend/src/shift/audit.ts` | Whitelist AUD-05 `SHIFT_OPENED`/`SHIFT_CLOSED`; nominal kas tidak diduplikasi |
| `backend/src/shift/shift.test.ts` | 7 tes service: buka, baseline ADMIN, validasi nominal, persistensi/takeover, paralel, audit/rollback, constraint DB |
| `backend/src/http/shift.test.ts` | 4 tes HTTP: alur buka/current, ADMIN 403, paralel, logout+restart |
| `backend/src/http/app.ts` | Route `POST /shifts/open` (CASHIER) + `GET /shifts/current`; mapping `ShiftError` |
| `backend/src/http/cli.ts` | Memasang `ShiftService` ke server |
| `backend/package.json`, `backend/README.md` | Daftar tes + §11 pembukaan shift |

Aturan:

- Pemilik shift hanya dari sesi (`shifts.cashier_id` = `actor.userId`).
- `BEGIN IMMEDIATE` + pemeriksaan aktif + partial unique index
  `ux_shifts_single_open` (migrasi 0001, tidak diubah) menolak shift aktif
  kedua, termasuk dua request bersamaan.
- Shift tetap di SQLite setelah logout/restart; tidak ada endpoint takeover.
- **ADMIN ditolak 403** pada `POST /shifts/open`: baseline konservatif
  AUTHORIZATION.md §3 dan SECURITY.md §4. Keputusan ADMIN boleh membuka shift
  menunggu review David/DEC-019, tidak diputuskan di sini.
- Audit `SHIFT_OPENED` dalam transaksi yang sama; kegagalan audit rollback.

## 2. Verifikasi yang dijalankan

Lingkungan: Windows, PowerShell, Node 26.13.1 portable, SQLite 3.54.1, DB uji
di temp OS.

| # | Perintah (dari `backend/`) | Hasil |
|---|---|---|
| V1 | `npm run typecheck` | **PASS**, exit 0 |
| V2 | `npm test` (seluruh proyek) | **PASS 86/86**, 0 fail, ±11,2 s |
| V3 | `node --test src/shift/shift.test.ts src/http/shift.test.ts` | **PASS 11/11** |

### 2.1 Bukti tes wajib

| Wajib | Terbukti |
|---|---|
| Dua request buka paralel → satu shift aktif | service `Promise.allSettled` dan HTTP paralel: satu 200, satu 409; `shifts` aktif = 1 |
| Logout/restart, pemilik login ulang | ID dan `openedAtMs` sama; kasir lain `GET /shifts/current` = `null`; kasir lain buka → 409 |
| Upaya buka kedua ditolak tanpa perubahan DB | 409 `SHIFT_ALREADY_OPEN`; jumlah shift aktif tetap 1 |
| Nominal awal invalid ditolak | -1, 1.5, string, NaN, > 1e9 → 422; nol dan null diterima; tidak ada shift dibuat |
| ADMIN | `POST /shifts/open` → 403 `FORBIDDEN`; tidak ada shift/audit |
| Constraint DB | insert shift aktif kedua langsung → `UNIQUE constraint failed` |
| Audit | `SHIFT_OPENED` actor/entity/waktu tercatat; audit gagal (`now=-1`) → rollback, shift tidak dibuat |

## 3. Risiko / keputusan tertunda

- **API_CONTRACT.md §3** sudah diselaraskan (15 November 2026): `POST
  /shifts/open` khusus CASHIER, ADMIN belum diizinkan selama DEC-019
  `PENDING`. Keputusan untuk mengizinkan ADMIN tetap menunggu review David dan
  pembaruan DEC-019.
- Penutupan shift (TASK-024), SOP serah terima, dan pengambilalihan belum ada;
  `SHIFT_CLOSED` hanya disiapkan di whitelist audit.
- Belum diuji: perpindahan tanggal/dua shift berurutan, crash saat pembukaan,
  dan PC tujuan.
- `openingCashRp` opsional; apakah modal wajib sesuai SOP masih `PENDING`.

## 4. Git

- Branch `task/p12-014` dari `origin/master` @ `0089402`; working tree bersih
  sebelum perubahan.
- Perubahan **belum di-commit**; tidak ada push/PR/merge.

## 5. Langkah berikutnya

1. Review David untuk peran ADMIN pada pembukaan shift dan sinkronisasi
   API_CONTRACT.md §3.
2. TASK-016 memakai `getCurrentShift` + kepemilikan saat checkout.
3. TASK-024 mengisi `SHIFT_CLOSED` dan aturan penutupan; TASK-017 memakai
   `GET /shifts/current` di UI.
