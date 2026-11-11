# DEFINITION OF DONE — Task, Modul, dan Rilis

| Atribut | Nilai |
|---|---|
| Lokasi | `docs/operations/DEFINITION_OF_DONE.md` |
| Versi / tanggal | 0.1.0 / 11 November 2026 |
| Status | BASELINE PROSEDUR DAN RENCANA — belum dilaksanakan atau disetujui pengelola |
| Dasar | `docs/product/SCOPE.md` v0.1.1; `docs/product/ACCEPTANCE_CRITERIA.md` v0.1.1; `docs/product/TASKS.md` v0.2.1; `docs/security/SECURITY_CHECKLIST.md` v0.1.0 |

## 1. Prinsip
**Dokumen selesai ≠ kode selesai ≠ fitur lulus uji ≠ rilis siap produksi.** Setiap level harus memiliki bukti sendiri. Klaim dari AI atau screenshot UI bukan pengganti bukti database/perangkat/operasional.

## 2. Definition of Done per task
- [ ] Scope dan acceptance `AC-*` untuk task jelas; tidak menambahkan P1/OUT tanpa keputusan.
- [ ] PR kecil memuat daftar file, alasan perubahan, dampak keamanan/DB/API/UI.
- [ ] Validasi input dan otorisasi dilakukan di backend, termasuk negatif/unauthorized tests bila relevan.
- [ ] Unit/integrasi/API/UI tests untuk perilaku berubah **benar-benar dijalankan**; command, commit, environment dan hasil dilampirkan. Jika tidak bisa dijalankan, task `BLOCKED`, bukan DONE.
- [ ] Reviewer memeriksa diff dan tidak menemukan secret, debug bypass, dependency liar, atau data asli.
- [ ] Migrasi/DB diuji fresh-create dan upgrade pada salinan bila ada perubahan schema.
- [ ] Dokumen kontrak/AC/TASK terkait disesuaikan tanpa membuat keputusan `PENDING` menjadi `ACCEPTED` diam-diam.
- [ ] QA melakukan verifikasi independen atas skenario risiko utama dan masalah `FAIL` diperbaiki serta diuji ulang.

## 3. Gate per modul
| Modul | Bukti minimum |
|---|---|
| Auth/role | AC-01.01–04, direct API 401/403, logout/nonaktif, offline login |
| Master | AC-02.01–03, barcode ganda dan harga historis tetap |
| Checkout CASH | AC-03.01–08, AC-04.01–03, retry/concurrency dan stok aman |
| QRIS manual | AC-03.09, AC-X-01, merchant verified/manual, kasus ambigu dan salah nominal |
| Shift | AC-05.01–02, AC-06.01–03, dua shift berurutan dan penutupan paralel |
| Stok/penerimaan | AC-07.01–03, adjustment ADMIN, ledger konsisten |
| Laporan | AC-08.01–03, hitung ulang dari transaksi committed |
| Backup | AC-09.01–02, media kedua, restore terisolasi dan hash/integrity |
| Installer/migrasi | AC-10.01–03, scanner/printer PC tujuan, rollback dan rekonsiliasi katalog |

## 4. Rilis GO/NO-GO
| Gate | Status awal | Wajib sebelum GO |
|---|---|---|
| Semua P0 dalam `SCOPE.md` | NOT RUN | Terimplementasi dan AC terkait PASS |
| Seluruh `SEC-G01`–`SEC-G20` | NOT RUN / BLOCKED | Bukti aman tersedia, tidak ada blocker |
| VAL-01 s.d. VAL-08 pengelola/perangkat | BLOCKED | Disetujui dan tercatat termasuk aturan setoran, QRIS, data lama |
| Data lama, saldo awal, impor dan dua shift | BLOCKED | Rekonsiliasi dan UAT dengan pengelola |
| Backup dan restore media kedua | NOT RUN | Terbukti dapat dipulihkan dan diuji terpisah |
| Installer, scanner, printer, offline | NOT RUN | Berjalan di PC tujuan pada build yang akan dirilis |
| Rollback ke proses lama | BLOCKED | Diuji dan disetujui sebelum cutover |
| `AC-GO-01` | BLOCKED | Ditandatangani pengelola, David, dan QA |

**Tidak ada fitur bypass gate.** Jika ada risiko yang belum dapat dikendalikan, keputusan **NO-GO** dan lakukan perpanjangan sistem lama atau prosedur sementara yang disetujui minimarket. Target 14 hari bukan alasan untuk menandai PASS tanpa eksekusi.

## 5. Bukti dan sign-off
```text
Scope dan build/commit; versi schema & installer:
Daftar AC yang PASS (tautan evidence):
Daftar AC BLOCKED/FAIL dan issue:
SEC-G status, VAL status dan bukti persetujuan:
Perangkat, migrasi, backup/restore, rollback:
Bug kritis tersisa:
GO/NO-GO + alasan:
QA (Naazmi):
Koordinator (David):
Pengelola minimarket (nama/tanggal/tanda tangan nyata):
```
