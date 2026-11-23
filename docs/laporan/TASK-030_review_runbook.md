# TASK-030 — Review Runbook Pemulihan dan Cutover

| Atribut | Isi |
|---|---|
| Tugas | TASK-030 · QA/verifikasi · Owner Rahmat · Reviewer David, Naazmi |
| Referensi | AC-09.01, AC-09.02, AC-10.02 · DEC-015 · BACKUP_RECOVERY.md, DEPLOYMENT.md, TROUBLESHOOTING.md |
| Branch | `task/p33-030` |
| Basis | `origin/master` @ `8048bca` (memuat TASK-028 dan TASK-032) |
| Tanggal | 23 November 2026 |
| Status | **REVIEW** — runbook diperbarui sesuai kode dan dilatih pada DB uji; persetujuan pengelola dan uji Naazmi mandiri masih PENDING |

## 1. Yang dikerjakan

| Path | Perubahan |
|---|---|
| `docs/security/BACKUP_RECOVERY.md` | Runbook operator: peran, perintah nyata, backup, latihan restore, restore produksi manual, upgrade/rollback, kasus gagal, gate bukti |
| `docs/operations and qa/DEPLOYMENT.md` | Perbaikan path dokumen, daftar perintah nyata, langkah upgrade/rollback yang bisa diikuti operator non-developer |
| `docs/operations and qa/TROUBLESHOOTING.md` | Perbaikan path dokumen, perintah diagnostik nyata, rujukan ke runbook pemulihan |
| `docs/laporan/evidence/TASK-030/*` | 17 file bukti latihan (JSON/log/hash), hasil perintah benar-benar dijalankan |
| laporan ini | Ringkasan bukti per kriteria dan keputusan terbuka |

Tidak ada perubahan kode, skema, API, atau aturan uang/stok. Semua perintah di runbook dicek terhadap `backend/db/src/cli.ts`, `backend/src/auth/cli.ts`, `backend/src/backup/service.ts`, dan `desktop/maintenance.mjs`. Tidak ada perintah fiktif.

## 2. Bukti per kriteria

| Kriteria / ID | Latihan yang dijalankan | Hasil nyata | Keputusan |
|---|---|---|---|
| AC-09.01 / BAK-01 | QA fixture TASK-006 di DB uji `pos-qa-task030` → `qa_runner.ts reset --confirm-dev-reset` → `db/src/cli.ts backup --json` | `qa-reset.json`: seeded=true; `qa-backup.json`: `integrity=ok`, FK=0, schema=3, SHA-256 `30f700ee…`, manifest valid | **PASS (DEMO/DB uji)** |
| AC-09.02 / BAK-03 | `db/src/cli.ts restore-test --backup "pos_2026-11-23T11-14-19-210Z-77ddba26.sqlite" --json` + `verify --json` pada salinan | `qa-source-snapshot.json` = `qa-restored-snapshot.json`: 4 user, 8 produk, 3 sale, 3 item, 3 payment, 2 shift, 10 mutasi, saldo per SKU identik, sale terakhir `S-QA-000203` @ `1762995781000` | **PASS (DB uji terpisah)** |
| AC-09.02 / BAK-04 | File cadangan rusak (bukan SQLite) → `restore-test` | `restore-rusak.log`: `GAGAL: Cadangan gagal integrity_check: file is not a database`, exit 1; hash DB aktif sebelum = sesudah; jumlah salinan uji tetap 1 | **PASS (simulasi)** |
| AC-10.02 / BAK-06 | Salinan QA → `migrate` → anggap "upgrade" → `restore-test` dari snapshot pra-upgrade | `upgrade-migrate.log`: tidak ada migrasi baru, schema 3; `rollback-restore.json` sukses; `rollback-snapshot.json` = sumber | **PASS Partial** — rollback tersimulasi tanpa migrasi skema baru |
| AC-09.01 (operator Naazmi) | Naazmi mengikuti runbook tanpa bantuan penulis | **Belum dilakukan.** Saya melakukan self-rehearsal dari runbook; penandatanganan independen Naazmi belum ada | **PENDING / BLOCKED** |
| BAK-02, BAK-05, BAK-07 | Media dicabut, listrik mati, hilangnya disk | Tidak dijalankan | **PENDING LAPANGAN** |

Perintah yang benar-benar dijalankan: `node backend/qa/qa_runner.ts reset --db <pos-qa-…> --confirm-dev-reset` dengan `POS_DB_PROFILE=development`; `node backend/db/src/cli.ts migrate --no-backup`; `backup --json`; `restore-test --backup "pos_2026-11-23T11-14-19-210Z-77ddba26.sqlite" --json`; `verify --json`; `Get-FileHash` sebelum/sesudah restore-rusak. Output lengkap ada di `docs/laporan/evidence/TASK-030/`.

## 3. Hal yang belum disetujui / belum dibuktikan

- Media cadangan kedua (USB/drive lain), jadwal, retensi, RPO/RTO, dan penjaga media: **belum ada persetujuan pengelola**.
- Restore ke database operasional sengaja tidak diotomatisasi; prosedur manual di runbook belum diuji di PC tujuan.
- Upgrade dengan migrasi skema baru belum diuji; latihan hanya membuktikan migrasi tanpa perubahan skema.
- Uji perangkat fisik, internet terputus secara fisik, listrik mati, dan tanda tangan GO/NO-GO: **belum ada**.
- `coderabbit review --agent` tidak tersedia di mesin ini; CI/CodeRabbit dan dokumen dari PR akan dicek Badouka.

## 3A. Perbaikan temuan CodeRabbit PR #53

| Bug | Perubahan | File | Verifikasi |
|---|---|---|---|
| BUG-191 | Perintah latihan restore memakai `--backup "<file>"` sesuai CLI | `docs/laporan/TASK-030_review_runbook.md` | `backend/db/src/cli.ts` baris 208–211 wajib `--backup`; help baris 91 |
| BUG-192 | Bentuk paket desktop untuk `restore-test` + `verify`: working dir `resources/backend`, runtime `resources/runtime/node.exe`, env data dir | `docs/operations and qa/DEPLOYMENT.md` | `desktop/package.json` extraResources; `prepare-runtime.mjs` v24.18.0; simulasi paket di TEMP: migration/backup/restore/verify exit 0. Bukti: `packaged-node-version.txt`, `packaged-restore.json`, `packaged-verify.json` |
| BUG-193 | Penulis tetap mati sampai verifikasi lulus; jika ada sale pasca-snapshot, rekonsiliasi dulu sebelum rollback DB | `docs/operations and qa/DEPLOYMENT.md` | Review alur langkah 5–7 |
| BUG-194 | Manifest `.json` ikut disalin ke media kedua; hash diverifikasi dari manifest di media tersebut | `docs/security/BACKUP_RECOVERY.md` | `backup --json` menghasilkan `.sqlite.json` |
| BUG-195 | Perbandingan jumlah baris hanya 11 `REQUIRED_BACKUP_TABLES`; SHA-256 mencakup seluruh file | `docs/security/BACKUP_RECOVERY.md` | `backend/src/backup/service.ts` daftar tabel + `sha256File` |
| BUG-196 | Versi kandidat dipasang/dipathkan dulu; migrasi dijalankan dari kandidat pada salinan uji sebelum data operasional | `docs/security/BACKUP_RECOVERY.md` | Review urutan langkah 1–4 |
| BUG-197 | Rollback merujuk Bagian 6: matikan aplikasi & penulis, WAL/SHM satu set, lalu verify + smoke test | `docs/security/BACKUP_RECOVERY.md` | Review langkah 5 |

## 4. Git

Branch `task/p33-030` dari `origin/master` @ `8048bca`. Commit/PR akan dicantumkan setelah perintah Git dijalankan.

## 5. Langkah berikutnya

1. Naazmi menjalankan runbook sendiri pada DB uji dan menandatangani hasilnya (mandiri).
2. David/pengelola menyetujui media, jadwal, retensi, RPO/RTO, dan prosedur restore produksi.
3. TASK-041 menguji rollback dengan migrasi skema nyata dan menyiapkan berita acara GO/NO-GO.
