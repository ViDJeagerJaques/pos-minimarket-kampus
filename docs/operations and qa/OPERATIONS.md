# OPERATIONS — SOP Harian Kasir dan Admin

| Atribut | Nilai |
|---|---|
| Lokasi | `docs/operations/OPERATIONS.md` |
| Versi / tanggal | 0.1.0 / 11 November 2026 |
| Status | BASELINE PROSEDUR DAN RENCANA — belum dilaksanakan atau disetujui pengelola |
| Dasar | `docs/product/SCOPE.md` v0.1.1; `docs/product/ACCEPTANCE_CRITERIA.md` v0.1.1; `docs/product/TASKS.md` v0.2.1; `docs/security/SECURITY_CHECKLIST.md` v0.1.0 |

## 1. Batas penggunaan
Dokumen ini adalah **SOP usulan** untuk direview pengelola, bukan SOP yang telah berlaku. Hanya tindakan yang sesuai Product P0: tanpa member wajib, tanpa retur/refund otomatis, tanpa cloud atau QRIS API. Kegiatan kasir dapat berlanjut offline untuk transaksi tunai; verifikasi QRIS tetap dilakukan **di kanal merchant eksternal**, yang mungkin membutuhkan internet.

## 2. Sebelum toko buka
**Kasir** login pada akun sendiri → lihat ada/tidaknya shift aktif → hanya pembuka yang berwenang membuka shift baru jika tidak ada shift aktif → masukkan modal awal sesuai SOP pengelola (belum disetujui) → cek scanner/printer → cek harga dan stok item sampel. Jika ada shift aktif milik orang lain, **jangan membuka shift kedua atau memakai akun orang itu**; panggil admin dan lakukan prosedur takeover yang disetujui (belum ditentukan). Logout/restart **tidak menutup shift**.

**ADMIN** mengecek produk aktif, harga/barcode, stok hampir habis, kebutuhan penerimaan dan cadangan terakhir. Jangan memperbaiki stok dengan mengedit transaksi final secara langsung.

## 3. Penjualan tunai
1. Scan barcode atau cari produk manual; cek nama, jumlah, harga, total, dan status shift sendiri. Jika barcode tak dikenal, jangan menebak SKU.
2. Pilih CASH, masukkan uang diterima; sistem menghitung kembaliannya. Periksa nominal sebelum menyerahkan uang.
3. Konfirmasi checkout satu kali. Setelah aplikasi menunjukkan transaksi **COMMITTED**, serahkan kembalian dan cetak struk. Jika respons hilang, **cek status attemptKey dahulu**, jangan langsung membuat transaksi baru.
4. Jika printer mati, transaksi yang telah commit **tetap sah**; gunakan cetak ulang dari sale yang sama setelah printer siap.

## 4. Penjualan QRIS manual
1. Pilih `QRIS_MANUAL` setelah total disepakati; tunjukkan QRIS **resmi milik merchant minimarket**, bukan QR rekening pribadi tak terverifikasi.
2. Pembeli memindai dan membayar. Kasir membuka aplikasi/riwayat **merchant** yang sah dan memeriksa status **berhasil** serta nominal sama dengan tagihan.
3. Baru kasir menekan konfirmasi di POS. POS menyimpan attestasi kasir (ID/waktu) dan **tidak** membaca bank secara otomatis.
4. Jika status belum jelas, jaringan merchant mati, nominal salah, atau pelanggan menunjukkan screenshot saja tanpa konfirmasi merchant: **jangan tandai lunas**, jangan meminta pembayaran ulang otomatis; eskalasi menurut SOP pengelola (VAL-01 masih BLOCKED).
5. Jika merchant sudah menunjukkan pembayaran sukses tetapi POS gagal commit: **jangan minta pelanggan bayar ulang**. Cari `GET /checkouts/:attemptKey`/riwayat, dokumentasikan dan hubungi ADMIN/pengelola untuk rekonsiliasi. Jangan menghapus sale atau mengubah DB manual.

## 5. Penerimaan barang dan koreksi stok (ADMIN)
- Cocokkan barang masuk, jumlah dan supplier terhadap bukti fisik. Konfirmasi penerimaan hanya sekali; retry memakai identitas penerimaan sama. Riwayat inventory movement harus dapat ditelusuri.
- Jika hitungan fisik berbeda, lakukan **koreksi ADMIN** melalui fitur adjustment dengan alasan, petugas dan waktu. Koreksi tidak boleh menghasilkan stok negatif, tidak boleh mengubah sale historis, dan tidak boleh dibuat CASHIER.
- Hentikan checkout SKU jika data harga/stok salah sampai diverifikasi. Jangan langsung mengedit file `.sqlite`.

## 6. Akhir shift dan setoran
Kasir menyelesaikan transaksi tertunda → pratinjau total per metode → hitung uang kas fisik, bedakan modal awal, penjualan tunai, uang kembalian, pengeluaran kas **yang diizinkan**, dan setoran → catat uang hitungan serta selisih sesuai format pengelola → tutup shift eksplisit → simpan hasil dan jalankan backup terverifikasi sesuai jadwal. **Formula dan pihak yang menyetujui selisih belum disahkan (VAL-05); angka dari AI tidak boleh menggantikannya.** Penutupan yang tidak jelas statusnya harus diperiksa sebelum diulang. Kasir shift berikutnya membuka setelah shift sebelumnya tertutup.

## 7. Pemeriksaan harian ADMIN
Buka dashboard dan cocokkan omzet dari sale tersimpan, CASH vs QRIS, jumlah sale, shift tutup, stok rendah/habis; bandingkan dengan laci dan kanal merchant, bukan hanya total di UI. Tinjau aktivitas koreksi stok, perubahan harga dan backup off-device. Laporan supplier/departemen lanjutan adalah P1 kecuali terbukti wajib.

## 8. Ketika bermasalah
| Kejadian | Tindakan aman |
|---|---|
| Internet hilang | CASH dapat terus diproses lokal setelah perangkat siap; QRIS jangan dikonfirmasi tanpa status merchant |
| Printer mati | Jangan ulang checkout; cetak lagi dari sale tersimpan setelah perbaikan |
| Aplikasi hang/restart | Buka lagi, login, cek shift dan status attemptKey sebelum menerima pembayaran baru |
| Stok tidak cocok | ADMIN verifikasi fisik dan adjustment beralasan, bukan edit DB |
| Pembayaran QRIS ambigu | Hentikan transaksi terkait dan eskalasi pengelola; jangan tagih dua kali |
| File DB/drive gagal | Hentikan operasi; isolasi masalah; restore hanya mengikuti runbook maintenance dan persetujuan |
| Ada permintaan retur/refund/kredit | Tidak tersedia sebagai aksi otomatis MVP; ikuti prosedur manual pengelola atau nyatakan sistem belum memenuhi kebutuhan dan eskalasi |

## 9. Serah terima
Setelah tutup, catat shift, ringkasan tunai/QRIS, selisih, item bermasalah, nomor sale ambigu, hasil backup dan petugas penerima. Catat hasil secara aman tanpa screenshot berisi kredensial bank. Jika aturan lapangan berbeda, hentikan asumsi, ajukan perubahan `DECISIONS.md` dan acceptance tests.
