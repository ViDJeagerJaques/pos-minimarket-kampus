# CONTRIBUTING — Cara Kerja Tim Empat Orang dan OpenCode

| Atribut | Nilai |
|---|---|
| Lokasi | `docs/operations/CONTRIBUTING.md` |
| Versi / tanggal | 0.1.0 / 11 November 2026 |
| Status | BASELINE PROSEDUR DAN RENCANA — belum dilaksanakan atau disetujui pengelola |
| Dasar | `docs/product/SCOPE.md` v0.1.1; `docs/product/ACCEPTANCE_CRITERIA.md` v0.1.1; `docs/product/TASKS.md` v0.2.1; `docs/security/SECURITY_CHECKLIST.md` v0.1.0 |

## 1. Tujuan dan aturan awal
Repositori berisi `CONTEXT.md`, `AGENTS.md`, `docs/product/`, `docs/architecture/`, `docs/security/`, dan `docs/operations/`. **Baca `AGENTS.md` terlebih dahulu**; instruksi AI tidak mengalahkan keputusan bisnis yang `PENDING`. Tugas dipilih dari `../product/TASKS.md` (`TASK-001`–`TASK-041`) dan ditautkan ke `AC-*` atau syarat keamanan terkait. Karena target 14 hari, hindari refactor tanpa hasil P0.

## 2. Pembagian kerja
| Orang | Fokus | Review yang perlu dilakukan |
|---|---|---|
| David | Prioritas, perubahan requirement, skema, komunikasi minimarket | Setujui keputusan produk dan perubahan data sebelum merge |
| Rahmat | Service lokal, DB, auth, atomic checkout, backup, installer | Review keamanan/backend dan DB migrations |
| Syafroni | React/renderer, alur kasir dan admin, printer UI | Review UX, kontrak DTO, error state, offline |
| Naazmi | QA fixture/test, perangkat, dokumentasi, bukti UAT | Validasi independen AC dan regresi |

## 3. Mulai satu issue
1. Ambil satu task dengan definisi selesai yang bisa dibuktikan. Catat tujuan, prasyarat, AC, kemungkinan perubahan DB/API, owner dan reviewer.
2. Baca referensi lokal yang relevan: `DECISIONS.md` untuk status, `SCOPE.md` untuk P0/P1/OUT, `API_CONTRACT.md`, `DATABASE.md`, `AUTHORIZATION.md`, `ERROR_HANDLING.md`.
3. Jika ditemukan konflik seperti siapa boleh membuka shift atau cetak ulang ADMIN, hentikan implementasi bagian itu dan ajukan keputusan. **Tidak boleh menyelesaikan konflik hanya dengan tebakan OpenCode**.
4. Kerjakan di branch tersendiri (lihat `GIT_WORKFLOW.md`), jangan langsung ke `main`.

## 4. Prompt kecil untuk OpenCode
```text
Baca AGENTS.md dan dokumen terkait TASK-XXX serta AC-YY.YY.
Tujuan: [satu perilaku P0 terukur].
Lingkup file yang boleh diubah: [daftar].
Jangan ubah skema, hak akses, atau dependency tanpa melaporkan alasannya.
Sebelum coding, tulis rencana <= 6 langkah dan keputusan yang masih PENDING.
Implementasikan dengan test negatif dan positif; jalankan perintah aktual.
Laporkan diff, hasil test benar-benar dijalankan, risiko, dan bukti AC.
Jangan klaim PASS jika belum diuji di runtime yang diminta.
```

## 5. Aturan coding dan privasi
- TypeScript strict mengikuti `../architecture/CODING_STANDARDS.md`; uang disimpan integer rupiah, input disanitasi/validasi dan SQL parameterized.
- Operasi uang/stok/shift atomik dan idempotent. Otorisasi ditegakkan di backend; renderer tidak menerima akses filesystem arbitrer/credential.
- Jangan commit `.env`, token, database operasional, backup, screenshot rekening, hasil ekspor data pelanggan, file binary installer kecuali kebijakan repository memang menyetujuinya.
- Tidak mengubah transaksi final atau skema historis tanpa migration + recovery plan; jangan melakukan destructive command pada PC kasir.

## 6. Definition of Ready dan Done
**Ready:** sumber/AC jelas, data uji tersedia, keputusan yang memengaruhi tindakan jelas, dependensi terpenuhi, ruang lingkup sempit. Jika izin/POS lama/merchant belum jelas, tandai BLOCKED dan pindah ke pekerjaan yang tidak bergantung padanya.

**Done untuk satu task:** kode dan test diperiksa reviewer, lulus pada commit yang dicatat, bukti QA sesuai `DEFINITION_OF_DONE.md`, dokumentasi/kontrak diperbarui bersama, regresi terkait berhasil; perubahan disetujui melalui PR. **Done untuk rilis** terpisah dan jauh lebih ketat (AC-GO-01).

## 7. Perubahan requirement
Jika pengelola menyatakan fitur yang tadinya OUT ternyata wajib, catat sumber, dampak jadwal, keputusan dan update `PRD.md`, `SCOPE.md`, `DECISIONS.md`, `TASKS.md`, `ACCEPTANCE_CRITERIA.md`, API/DB, Security bila relevan sebelum implementasi. Jangan memperluas target dalam PR coding diam-diam.
