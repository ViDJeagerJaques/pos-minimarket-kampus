# SECURITY CHECKLIST — Acceptance Gate Sebelum Cutover

| Atribut | Nilai |
|---|---|
| Lokasi | `docs/security/SECURITY_CHECKLIST.md` |
| Versi / status | 0.1.0 — **belum diuji**, daftar bukti yang harus dikumpulkan |
| Penanggung jawab | Rahmat (backend), Syafroni (renderer), Naazmi (QA), David + pengelola (GO/NO-GO) |
| Acuan | SCOPE §7, AC-01.*, AC-03.*, AC-04.*, AC-05.*, AC-06.*, AC-07.*, AC-09.*, AC-10.*, AC-GO-01; seluruh docs/security |

## 1. Cara menggunakan

Tidak ada kotak yang otomatis tercentang. Isi **PASS/FAIL/BLOCKED**, tanggal, versi commit, fixture, hasil aktual, bukti log/screenshot **tanpa rahasia**, dan pemeriksa. `BLOCKED` berarti belum lulus. Simpan bukti di test log/repo sesuai kebijakan, bukan di file data pelanggan.

## 2. Kriteria P0

| ID | Pemeriksaan nyata | Bukti minimal | Status awal | PIC |
|---|---|---|---|---|
| SEC-G01 | Login ADMIN/CASHIER berhasil tanpa internet; sandi salah/nonaktif ditolak | AC-01.01–02, uji PC | NOT RUN | Naazmi/Rahmat |
| SEC-G02 | Tidak ada sandi default/hardcode di installer/repo | Review source + setup akun | NOT RUN | Rahmat |
| SEC-G03 | Kasir tak dapat akses API admin, stok, laporan lintas shift, backup | AC-01.03, AUTH-02 | NOT RUN | Naazmi |
| SEC-G04 | Ownership: B tak dapat melihat, menutup atau cetak transaksi A | AUTH-03, AC-05.02 | NOT RUN | Naazmi |
| SEC-G05 | Logout revoke sesi, restart mempertahankan shift, nonaktif user memutus akses | AUTH-04–06 | NOT RUN | Rahmat/Naazmi |
| SEC-G06 | QRIS manual perlu sukses merchant dan nominal benar; ID verifikator dari sesi | AC-03.09, AUTH-08 | BLOCKED — VAL-01 | David/Naazmi |
| SEC-G07 | Checkout satu commit; retry paralel dan payload beda tidak mengganda | AC-03.05, AC-04.01–02 | NOT RUN | Rahmat |
| SEC-G08 | Stok tak negatif; koreksi ADMIN wajib alasan + ledger/audit | AC-03.06, AC-07.03 | NOT RUN | Rahmat/Naazmi |
| SEC-G09 | Shift concurrent: satu aktif, close versus checkout terurut, retry close aman | AC-05.01, AC-06.02–03 | BLOCKED — VAL-05 | Rahmat/Naazmi |
| SEC-G10 | Query parameter, barcode berbahaya tidak mengeksekusi SQL; renderer terisolasi | Security tests + konfigurasi Electron | NOT RUN | Rahmat/Syafroni |
| SEC-G11 | Backend loopback, auth terjaga, tidak ada arbitrary IPC/file path | Port scan lokal + negative tests | NOT RUN | Rahmat |
| SEC-G12 | DB tersimpan di lokasi persisten, FK ON, migrasi/update tidak menghapus data | Screenshot path aman + PRAGMA + AC-10.02 | NOT RUN | Rahmat/Naazmi |
| SEC-G13 | Backup konsisten, salinan media lain, restore valid dan file korup ditolak | AC-09.01–02, BAK-01–04 | BLOCKED — VAL-06 | Rahmat/Naazmi |
| SEC-G14 | Log/audit penting tidak bocorkan password, token, PIN/OTP | AUDT-01–06, review hasil log | NOT RUN | Naazmi |
| SEC-G15 | Scanner + printer di PC nyata, offline, dan crash test berhasil | AC-10.01, AC-04.03 | BLOCKED — VAL-04 | Naazmi |
| SEC-G16 | Migrasi seluruh SKU, harga, barcode, stok cocok sumber lama | AC-10.03 + persetujuan pengelola | BLOCKED — VAL-03 | David/Naazmi |
| SEC-G17 | Refund/retur/kredit member benar-benar tidak wajib untuk hari pertama | Konfirmasi pengelola, VAL-02 | BLOCKED | David |
| SEC-G18 | SOP setoran selisih, bukti QRIS, cutover/rollback disetujui | VAL-01/05/08 + AC-GO-01 | BLOCKED | David |
| SEC-G19 | Rebuild/install/update/rollback aplikasi di Windows nyata lulus | AC-10.02; smoke test | NOT RUN | Rahmat/Naazmi |
| SEC-G20 | Tidak ada bug kritis terbuka dan semua bukti di-review | Daftar issues + tanda tangan persetujuan | BLOCKED | Semua + pengelola |

## 3. Hentikan cutover (NO-GO) jika

1. Ada transaksi ganda, stok bertambah/berkurang tanpa sumber, bypass izin role atau kepemilikan, atau data transaksi hilang saat crash.
2. QRIS tidak dapat diverifikasi pada aplikasi merchant dengan nominal benar atau ada gap pembayaran sukses tetapi penjualan tak dapat direkonsiliasi.
3. Backup nyata tidak dapat dipulihkan ke lokasi lain; data impor tidak cocok; perangkat kasir/printer tidak dapat beroperasi.
4. SOP shift, pengelola QRIS atau fitur operasional yang dianggap wajib belum disetujui.
5. Hasil uji tidak tersedia: "AI agent bilang selesai" bukan bukti.

Jika NO-GO, mintalah perpanjangan sistem lama atau SOP operasi darurat disetujui; jangan memaksakan target 14 hari.

## 4. Template pencatatan bukti

```text
Check ID:
Tanggal, build/commit, Windows/PC:
Fixture / prasyarat:
Langkah yang dijalankan:
Expected:
Actual:
PASS / FAIL / BLOCKED:
Bukti (lokasi aman, redacted):
Issue ID jika FAIL:
Diuji oleh:
Direview oleh:
```

## 5. Pemilik persetujuan

David mengompilasi bukti dan perubahan requirement; Rahmat menjelaskan batas teknis; Syafroni memverifikasi UI/IPC; Naazmi menilai hasil uji independen. **Pengelola minimarket** memutuskan boleh/tidaknya digunakan untuk penjualan nyata. Checklist ini bukan tanda tangan pengelola dan bukan laporan hasil uji.
