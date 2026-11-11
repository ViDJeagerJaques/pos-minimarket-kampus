# GIT WORKFLOW — Branch, PR, Integrasi dan Rilis

| Atribut | Nilai |
|---|---|
| Lokasi | `docs/operations/GIT_WORKFLOW.md` |
| Versi / tanggal | 0.1.0 / 11 November 2026 |
| Status | BASELINE PROSEDUR DAN RENCANA — belum dilaksanakan atau disetujui pengelola |
| Dasar | `docs/product/SCOPE.md` v0.1.1; `docs/product/ACCEPTANCE_CRITERIA.md` v0.1.1; `docs/product/TASKS.md` v0.2.1; `docs/security/SECURITY_CHECKLIST.md` v0.1.0 |

## 1. Strategi satu repo
Satu repository GitHub dengan `main` yang stabil. Gunakan **branch fitur pendek** (trunk-based ringan) untuk empat anggota tim pemula. Hindari branch `develop` permanen atau skema merge rumit tanpa kebutuhan. Semua merge ke main lewat PR dan review; bila waktu mendesak, tetap tidak boleh melewatkan test minimum untuk uang/stok/izin.

## 2. Nama branch dan commit
Contoh `feat/TASK-016-atomic-checkout`, `fix/TASK-019-retry-status`, `docs/TASK-001-contract-review`, `test/TASK-018-offline-regression`. Commit seperti `feat(checkout): enforce attemptKey idempotency (TASK-016)` atau `test(shift): cover concurrent close (AC-06.02)`. Hindari `final-final`, `update`, dan commit campuran banyak isu.

## 3. Langkah kerja
```bash
# Contoh, hanya setelah repo dan remote siap
# Mulai dari main terbaru (jangan membuang perubahan lokal milik anggota lain)
git switch main
git pull --ff-only
git switch -c feat/TASK-016-atomic-checkout
# edit, jalankan test aktual, lihat diff dan status
git status
git diff --check
git add <file-yang-sengaja-diubah>
git commit -m "feat(checkout): atomic sale with retry (TASK-016)"
git push -u origin feat/TASK-016-atomic-checkout
```
Buka PR yang menjelaskan issue, AC/TC yang dijalankan, command+hasil, dampak migrasi, bukti screenshot tersanitasi dan risiko. Perintah di atas adalah contoh; jangan `git add .` tanpa memastikan tidak ada rahasia.

## 4. Aturan review dan merge
- Minimal satu reviewer bukan penulis; Rahmat wajib review perubahan transaksi, API, migrasi, akses atau backup; Naazmi menilai bukti test dan bug; Syafroni review UI; David perubahan keputusan bisnis.
- Check otomatis jika tersedia: lint, typecheck, unit/API test, `git diff --check`, secret scan sederhana, build candidate. Tidak ada klaim CI sukses jika belum disiapkan.
- Migrasi DB harus disertai test fresh-create + upgrade pada salinan, rencana restore dan kompatibilitas aplikasi lama. Perubahan API/DTO harus punya test kontrak dan persetujuan frontend/backend.
- Konflik merge diselesaikan dengan memahami *kedua* perubahan; jangan menimpa file MD final atau struktur DB demi merge hijau.

## 5. Aturan khusus AI coding agent
OpenCode bekerja di branch/working tree yang jelas, membaca `AGENTS.md`, dan menunjukkan diff. Agent **tidak** boleh menghapus DB, menjalankan restore destruktif, force push main, mengubah hak akses/decisions, atau memasukkan kunci tanpa izin eksplisit. Reviewer manusia mengecek perubahan yang kelihatan sederhana tetapi berdampak saldo/keamanan.

## 6. Rilis dan rollback source
Buat tag dari commit yang lulus test, catat checksum build/installer dan schema version dalam catatan `DEPLOYMENT.md`. Simpan tag kandidat dan tag terakhir yang bekerja. `git revert` dapat membatalkan commit kode; **tidak otomatis mengembalikan schema/data yang dimigrasikan**. Pemulihan data mengikuti `../security/BACKUP_RECOVERY.md` dan persetujuan operator.

## 7. Aturan penyimpanan
`.gitignore` harus mencakup `.env`, DB operasional, `*.sqlite-wal`, `*.sqlite-shm`, backup, data import asli, log sensitif, folder build node_modules. File `.env.example` hanya placeholder yang aman. Jangan mengunggah data minimarket ke AI agent eksternal tanpa izin pengelola.
