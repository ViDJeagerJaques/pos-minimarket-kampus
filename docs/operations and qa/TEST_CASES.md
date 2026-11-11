# TEST CASES — Matriks Eksekusi dan Bukti

| Atribut | Nilai |
|---|---|
| Lokasi | `docs/operations/TEST_CASES.md` |
| Versi / tanggal | 0.1.0 / 11 November 2026 |
| Status | BASELINE PROSEDUR DAN RENCANA — belum dilaksanakan atau disetujui pengelola |
| Dasar | `docs/product/SCOPE.md` v0.1.1; `docs/product/ACCEPTANCE_CRITERIA.md` v0.1.1; `docs/product/TASKS.md` v0.2.1; `docs/security/SECURITY_CHECKLIST.md` v0.1.0 |

## 1. Aturan
Setiap TC adalah spesifikasi **belum dijalankan**. ID `TC-*` di bawah hanya indeks praktis; sumber kebenaran acceptance adalah ID `AC-*` di `../product/ACCEPTANCE_CRITERIA.md`. Jika AC direvisi, perbarui matriks dan fixture, jangan otomatis mengganti hasil tes lama. Semua fixture sintetis. Isi `Actual`, `Evidence`, `Tester`, `Build`, dan `Status` saat eksekusi, bukan sekarang.

## 2. Matriks kasus utama (P0)
| TC | AC yang diuji | Langkah inti pada fixture terisolasi | Ekspektasi / oracle | Status awal |
|---|---|---|---|---|
| TC-01 | AC-01.01–04 | Login offline ADMIN/CASHIER, sandi salah, nonaktif, CRUD akun, paksa akses API lintas role | Sesi dan izin benar; tak ada data berubah pada 403; perubahan akun diaudit | NOT RUN |
| TC-02 | AC-02.01–03 | Simpan barang, barcode duplikat, ubah harga setelah sale | Barcode unik; historis sale memakai harga snapshot | NOT RUN |
| TC-03 | AC-03.01–02, AC-03.07 | Scan barcode nol awal, kode tak dikenal, pencarian, batal draft; shift tiada/keranjang invalid | Draft terkontrol, input invalid tidak memutasi DB | NOT RUN |
| TC-04 | AC-03.03–06 | Harga berubah, tunai/kembalian, rollback gagal checkout, stok 1 jual 2 | Respon konflik tepat, 1 sale komplit atau 0, stok tidak negatif | NOT RUN |
| TC-05 | AC-03.08, AC-04.03 | Coba hapus sale final lalu printer offline dan cetak ulang | Sale immutable, cetak ulang tidak mengubah payment/stok | NOT RUN |
| TC-06 | AC-04.01–02, AC-X-02 | Retry key sama payload sama dan berbeda, respons hilang, restart | Satu sale/mutasi; hash berbeda ditolak; status tersimpan bisa dicari | NOT RUN |
| TC-07 | AC-05.01–02 | Dua open bersamaan, kasir B ambil alih, restart/logout | Satu shift aktif, owner terjaga dan persisten | NOT RUN |
| TC-08 | AC-06.01–03, AC-X-03 | Modal awal, CASH/QRIS, tutup shift, retry close, close vs checkout | Rekap konsisten; QRIS bukan kas laci; close idempotent | BLOCKED: SOP setoran belum disahkan |
| TC-09 | AC-07.01–03 | Penerimaan, retry, koreksi stok ADMIN alasan, kasir/negatif ditolak | Mutasi tepat sekali, ledger/audit lengkap dan saldo benar | NOT RUN |
| TC-10 | AC-08.01–03 | Filter harian/shift, per metode, stok menipis/habis | Jumlah cocok query sumber, sale gagal tidak dihitung | NOT RUN |
| TC-11 | AC-03.09, AC-X-01 | QRIS kosong/gagal/salah nominal/benar; simulasi pembayaran sukses + commit gagal | Tidak auto lunas; bukti manusia/actor/time; tidak tagih ulang dalam status ambigu | BLOCKED: SOP merchant belum disahkan |
| TC-12 | AC-09.01–02, AC-X-04 | Snapshot saat operasi, media kedua gagal, restore valid/korup di folder lain | Backup valid dapat dipulihkan; korup tidak menimpa DB | BLOCKED: media dan prosedur belum diverifikasi |
| TC-13 | AC-10.01–02 | Install Windows target, offline + scanner/printer, update lalu rollback terisolasi | Data bertahan, driver berfungsi, versi dan bukti tercatat | BLOCKED: perangkat target belum diuji |
| TC-14 | AC-10.03, AC-X-05 | Impor daftar barang lama dua kali dengan duplikat/tanpa barcode; reconciliation | Tidak ada duplikasi diam-diam; seluruh selisih diselesaikan | BLOCKED: ekspor sistem lama belum diperoleh |
| TC-15 | AC-GO-01 | Review semua AC P0 + SEC-G01..20 + VAL-01..08 dengan pengelola | GO hanya jika bukti/approval lengkap dan tiada blocker | BLOCKED |

## 3. Kasus regresi keselamatan — jalankan pada setiap perubahan checkout/shift/DB
| Kasus | Setup dan aksi | Oracle DB/operasional |
|---|---|---|
| RC-01 parallel commit | Dua client mengirim attemptKey dan niat identik bersamaan | Satu row sale, satu payment, satu set inventory movements |
| RC-02 hash collision secara semantik | Kunci sama dengan barang/jumlah/metode berbeda | 409, tanpa mutasi baru; gunakan golden vector di API_CONTRACT |
| RC-03 crash sebelum commit | Paksa kill pada titik sebelum DB commit (DB uji) | Tidak ada sale/stock parsial |
| RC-04 crash setelah commit | Matikan proses sebelum respons kembali | Status COMMITTED dan sale asli ditemukan, tanpa penagihan ulang |
| RC-05 checkout vs close | Kirim close dan commit pada shift sama bersamaan | Salah satu commit dulu secara serial; total shift tidak kehilangan sale |
| RC-06 QRIS sudah bayar, POS gagal | Simulasikan konfirmasi merchant valid lalu error tulis | Status dibekukan untuk rekonsiliasi; tidak otomatis meminta pembayaran lagi |
| RC-07 stock adjust vs sale | Adjustment dan penjualan pada SKU sama paralel | Satu serial order, saldo akhir konsisten dan >=0 |
| RC-08 restore backup rusak | Manifes/hash salah atau SQLite tidak lolos cek | Sistem menolak sebelum mengganti DB aktif |
| RC-09 print ulang | Cetak sale id yang sama tiga kali | Row sale/payment/stock tidak berubah |
| RC-10 direct unauthorized | Panggil endpoint ADMIN sebagai CASHIER tanpa UI | 403 dan tidak ada audit yang salah menyatakan berhasil |

## 4. Rekaman eksekusi per kasus
```text
Test case / AC IDs:
Tanggal, pelaksana, reviewer:
Commit/build & versi schema:
PC/OS/scanner/printer (jika relevan):
Fixture awal dan data yang dihapus setelah uji:
Langkah dan input:
Expected:
Actual:
DB checks / log dan path bukti yang telah disamarkan:
Status: NOT RUN | PASS | FAIL | BLOCKED
Issue / retest commit:
```

## 5. Pemetaan coverage dan kontrol perubahan
TC-01..15 mencakup seluruh kelompok AC P0 yang terdaftar pada baseline Product, termasuk AC-GO-01 dan AC-X-01..05. Detail variasi negatif wajib diturunkan dari masing-masing baris AC, bukan dianggap cukup oleh satu eksekusi TC. Jika test belum dijalankan, nilai coverage *eksekusi* = 0; jangan menyebut PASS karena TC tertulis. Referensi keamanan silang: `../security/SECURITY_CHECKLIST.md` `SEC-G01`–`SEC-G20`.
