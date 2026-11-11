# TROUBLESHOOTING — Diagnosa Tanpa Merusak Transaksi

| Atribut | Nilai |
|---|---|
| Lokasi | `docs/operations/TROUBLESHOOTING.md` |
| Versi / tanggal | 0.1.0 / 11 November 2026 |
| Status | BASELINE PROSEDUR DAN RENCANA — belum dilaksanakan atau disetujui pengelola |
| Dasar | `docs/product/SCOPE.md` v0.1.1; `docs/product/ACCEPTANCE_CRITERIA.md` v0.1.1; `docs/product/TASKS.md` v0.2.1; `docs/security/SECURITY_CHECKLIST.md` v0.1.0 |

## 1. Aturan sebelum mengubah apa pun
Catat waktu, commit/build, versi Windows, shift, sale/attemptKey (bukan password), langkah terakhir, gejala, dan status bank bila QRIS. Pertama **baca status**, baru putuskan tindakan. Jangan `DELETE` sale, edit SQLite dengan tangan, menghapus WAL/SHM, restore saat backend masih menulis, atau menagih QRIS untuk kedua kalinya.

## 2. Masalah umum
| Gejala | Pemeriksaan pertama | Tindakan aman | Eskalasi |
|---|---|---|---|
| Gagal login | Offline boleh, cek akun aktif, keyboard layout, waktu PC | Gunakan prosedur ADMIN untuk reset jika disetujui; jangan bagikan akun | Rahmat/ADMIN |
| Scan tidak menemukan barang | Cek fokus input, barcode nol awal, input manual, produk aktif | Cari manual, laporkan barcode salah; jangan tulis SKU baru asal | Syafroni/ADMIN |
| Harga/total berubah | Bandingkan item dan harga baru dengan draft | Minta konfirmasi pelanggan; buat prepare baru, jangan reuse hash | Kasir/ADMIN |
| Checkout timeout | Cari status berdasarkan attemptKey | Bila COMMITTED tampilkan sale lama; bila ambigu tahan penagihan dan rekonsiliasi | Rahmat/ADMIN |
| Stok kurang | Cocokkan ledger dan hitung fisik | Tolak penjualan melebihi stok; adjustment ADMIN dengan alasan | ADMIN |
| QRIS sudah dibayar tapi belum ada sale | Periksa merchant resmi + status checkout dan riwayat | Jangan meminta bayar ulang; catat kejadian, lakukan rekonsiliasi | Pengelola |
| QRIS beda nominal | Periksa nominal dan status merchant | Jangan tandai lunas; ikuti SOP penanganan selisih merchant | Pengelola |
| Printer offline/kertas habis | Windows printer, driver, koneksi, spooler | Cetak ulang dari sale committed, bukan ulang checkout | Naazmi |
| Shift tak bisa ditutup | Status shift, transaksi belum pasti, hak pemilik | Cek status sale, jangan tutup paksa lewat DB | ADMIN/Rahmat |
| Login kasir lain saat shift terbuka | Cek cashier_id pemilik | Jangan ambil alih tanpa keputusan SOP (GAP-01) | Pengelola |
| Database terkunci/disk penuh | Ruang disk, proses tunggal, log sanitasi, apakah commit berhasil | Hentikan retry massal, cek attemptKey, backup jika aman | Rahmat |
| Backup gagal | Ruang, media kedua, path whitelist, hash | Pertahankan backup baik, ulang setelah penyebab diatasi | Rahmat/Naazmi |
| Restore ditolak | Hash, schemaVersion, FK/integrity, permission | Jangan timpa DB aktif; evaluasi snapshot lain di lingkungan terpisah | Rahmat/pengelola |
| Update aplikasi gagal | Catat versi lama/baru dan backup pra-upgrade | Aktifkan maintenance; ikuti rollback executable **dan** DB sesuai runbook | Rahmat |
| Saldo berbeda dari POS lama | Bandingkan freeze time, SKU unik, harga/stock, transaksi antara snapshot | Jangan cutover sampai daftar selisih diselesaikan | David/pengelola |

## 3. Triase khusus status pembayaran/checkout
1. **COMMITTED:** sale ada; jangan buat sale/pembayaran kedua; struk boleh dicetak ulang.
2. **PREPARED:** belum ada sale final; sebelum mengulang commit, cek apakah uang tunai/QRIS sudah diterima dan apakah niat checkout sama. Untuk QRIS yang sudah masuk, lakukan rekonsiliasi dulu.
3. **ABANDONED:** jangan commit; tindakan lanjutan memerlukan upaya baru dan pemeriksaan pembayaran.
4. **Status tak bisa dipastikan karena DB rusak/layanan mati:** hentikan penagihan transaksi tersebut. Catat bukti merchant dan kas fisik secara aman lalu eskalasi.
Semua perlakuan mengikuti `../architecture/API_CONTRACT.md` dan `../architecture/ERROR_HANDLING.md`.

## 4. Diagnostik aman (oleh teknisi)
- Catat startup/port `127.0.0.1`, izin folder data, waktu sistem, versi skema, daftar migrasi, ruang disk, printer/spooler, serta status kesehatan DB.
- Untuk DB **salinan terisolasi**: gunakan `PRAGMA integrity_check;` (harus `ok`) dan `PRAGMA foreign_key_check;` (kosong); cocokkan daftar sale/item/payment/movement terhadap laporan. Jangan menjalankan SQL diagnostik berisiko pada produksi saat kasir bertransaksi.
- Korelasi laporan error dengan request ID dan attemptKey; hapus/redaksi token/password/bank account dari bukti.

## 5. Format tiket insiden
```text
ID, waktu, tingkat dampak:
Build, OS, perangkat, akun role tanpa identitas rahasia:
Shift ID, sale ID/attemptKey jika relevan:
Langkah reproduksi dan status awal:
Status pembayaran fisik/merchant (terverifikasi atau belum):
Bukti aman (log teredaksi, foto perangkat tanpa kredensial):
Tindakan yang SUDAH dilakukan:
Status: OPEN / INVESTIGATING / RESOLVED / BLOCKED:
PIC, kebutuhan persetujuan pengelola, jadwal retest:
```
