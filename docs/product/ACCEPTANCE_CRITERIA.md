# ACCEPTANCE CRITERIA — Sistem Kasir dan Inventaris Minimarket Kampus

| Atribut | Nilai |
|---|---|
| Lokasi | `docs/product/ACCEPTANCE_CRITERIA.md` |
| Versi / tanggal | 0.1.1 / 11 November 2026 |
| Status | DRAFT spesifikasi pengujian — **belum ada hasil uji** |
| Owner | Naazmi (QA), review David, Rahmat, Syafroni |
| Dasar | `PRD.md` v0.3.1, `DECISIONS.md` v0.2.3, `SCOPE.md` v0.1.1 |

## 1. Aturan pengujian

Gunakan database uji terpisah dan data sintetis. Untuk tiap AC catat: ID, tanggal, commit/versi, perangkat/OS, langkah, data awal, hasil yang diharapkan, hasil aktual, bukti (screenshot/log/cek database), status PASS/FAIL/BLOCKED, bug dan penguji. **Semua baris di bawah adalah kriteria yang harus diuji, bukan klaim lulus.** Uji operasional harus memakai SOP yang telah disetujui, bukan hanya fixture buatan tim.

## 2. Skenario Given–When–Then P0

| ID | Given — kondisi awal | When — aksi | Then — hasil yang harus terbukti |
|---|---|---|---|
| AC-01.01 | PC siap pakai dan jaringan terputus | ADMIN dan CASHIER login dengan kredensial valid | Masing-masing masuk dengan role yang tersimpan |
| AC-01.02 | Tersedia akun aktif dan akun nonaktif | Login memakai sandi salah atau akun nonaktif | Sesi tidak dibuat dan respons tidak membocorkan status akun |
| AC-01.03 | Tersedia dua akun kasir dan satu admin | Setiap operasi matriks dicoba langsung lewat backend dengan role atau kepemilikan yang salah | Aksi terlarang ditolak tanpa perubahan data. Aksi yang diizinkan mengikuti prasyarat modul |
| AC-01.04 | Satu admin dan akun kasir yang dapat dikelola | Admin membuat lalu menonaktifkan akun kasir uji | Akun dapat dipakai setelah dibuat dan akses ditolak setelah dinonaktifkan. Pelaku serta waktu perubahan tercatat |
| AC-02.01 | Admin dan data kategori serta supplier uji | Admin menyimpan produk aktif dengan nama, harga valid dan relasi yang tersedia | Kasir dapat mencari produk tersebut. Relasi yang tidak ada ditolak |
| AC-02.02 | Satu produk aktif sudah memakai barcode X | Admin mencoba mengaktifkan produk lain dengan X | Perubahan ditolak. Scan X tetap mengarah ke produk pertama |
| AC-02.03 | Produk telah terjual dengan harga lama | Admin menyimpan harga baru dan kasir membuka keranjang baru | Keranjang baru memakai harga baru. Penjualan dan struk lama memakai harga tersimpan. Perubahan harga tercatat |
| AC-03.01 | Produk aktif tersedia, shift sendiri aktif, dan jaringan terputus | Kasir scan produk valid, scan kode tak dikenal, lalu mencari manual | Produk valid masuk keranjang. Kode tak dikenal tidak menambah item. Pencarian manual tetap tersedia |
| AC-03.02 | Kasir login | Kasir mencoba keranjang kosong, jumlah nol/negatif, produk nonaktif, atau checkout tanpa shift sendiri yang aktif | Setiap permintaan tidak valid ditolak tanpa penjualan, pencatatan bayar, atau perubahan stok |
| AC-03.03 | Harga yang dimuat keranjang telah berubah | Kasir mengirim checkout dengan harga lama | Tidak ada commit. Kasir melihat harga dan total baru. Checkout dapat dilanjutkan setelah kasir menyetujui ringkasan baru |
| AC-03.04 | Shift aktif, keranjang valid, metode yang disahkan dan satu metode yang belum disahkan | Kasir mencoba masing-masing metode dengan data wajib yang lengkap, lalu mencoba metode sah dengan data wajib kosong | Hanya pembayaran sah dengan data lengkap dapat dicatat. Jenis dan nilai tercantum dalam transaksi serta rekap |
| AC-03.05 | Shift aktif, data valid dan jaringan terputus | Checkout berhasil, lalu uji lain memicu gagal di tengah commit | Keberhasilan menghasilkan satu nomor penjualan beserta seluruh data terkait. Kegagalan tidak meninggalkan data parsial |
| AC-03.06 | Fixture blokir stok negatif dan saldo satu unit | Kasir mencoba menjual dua unit, lalu mengoreksi jumlah menjadi satu | Upaya pertama ditolak dengan informasi item bermasalah dan stok tetap satu. Checkout yang dikoreksi berhasil dan stok menjadi nol |
| AC-03.07 | Keranjang belum diajukan dan kasir belum menerima pembayaran fisik | Kasir membatalkan keranjang | Draft dibuang tanpa penjualan, pencatatan pembayaran atau mutasi |
| AC-03.08 | Penjualan sudah tersimpan dan fitur koreksi belum disahkan | ADMIN atau CASHIER mencoba membatalkan langsung melalui UI atau backend | Transaksi, pembayaran, stok dan rekap tetap utuh. UI menjelaskan bahwa koreksi memerlukan prosedur pengelola |
| AC-04.01 | Permintaan yang sama dikirim ulang atau bersamaan karena timeout | Backend memproses kunci dan isi yang sama, lalu menerima kunci sama dengan isi berbeda | Isi sama merujuk transaksi yang sama dengan satu mutasi per item. Isi berbeda ditolak tanpa perubahan |
| AC-04.02 | Aplikasi berhenti sebelum commit atau setelah commit sebelum hasil tampil | Kasir login kembali dan membuka status upaya tersebut | Jika tersimpan, tampilkan transaksi dan akses struk. Jika dipastikan belum tersimpan, kasir dapat melanjutkan setelah mengecek pembayaran fisik. Jika hasil belum pasti, jangan buka pembayaran baru untuk upaya yang sama |
| AC-04.03 | Penjualan tersimpan, printer mati | Kasir mencoba cetak, lalu mengulang dari riwayat setelah printer siap | Status transaksi tetap tersimpan. Struk memakai nomor dan data transaksi yang sama tanpa mutasi atau pembayaran tambahan |
| AC-05.01 | Tidak ada shift aktif dan data pembukaan sesuai konfigurasi pilot | Dua permintaan buka shift diajukan bersamaan | Tepat satu shift aktif tercatat dengan kasir dan waktu buka. Permintaan lain ditolak |
| AC-05.02 | Ada shift aktif | Aplikasi ditutup atau dihentikan, lalu kasir pemilik dan kasir lain mencoba melanjutkan | Shift tetap aktif dengan ID dan waktu awal yang sama. Pemilik dapat lanjut setelah login. Kasir lain tidak dapat melanjutkan atau membuka shift kedua |
| AC-06.01 | Shift berisi transaksi sah dan fixture setoran telah disahkan | Kasir membuka pratinjau penutupan dan memasukkan nilai yang diminta | Total per metode cocok dengan transaksi. Nilai setoran dan selisih cocok dengan fixture bila berlaku |
| AC-06.02 | Shift aktif dan data tutup valid | Kasir menutup shift, termasuk saat checkout berbarengan | Jika checkout commit lebih dulu, penjualan masuk rekap akhir. Jika penutupan commit lebih dulu, checkout baru ditolak. Shift tertutup dapat dibaca kembali dan shift berikutnya dapat dibuka |
| AC-06.03 | Satu shift aktif dan koneksi UI ke backend dapat terganggu | Kasir mengirim data tutup tidak valid, lalu uji terpisah mengulang permintaan tutup sah setelah respons hilang | Data tidak valid atau gagal sebelum commit mempertahankan shift aktif. Retry identik setelah commit mengembalikan hasil asli dan tidak membuat penutupan tambahan |
| AC-07.01 | Admin, supplier dan produk valid | Admin mengonfirmasi penerimaan, atau membuang draft sebelum konfirmasi | Konfirmasi menambah stok sesuai jumlah yang diterima dan membuat rujukan mutasi. Draft yang dibuang tidak mengubah stok |
| AC-07.02 | Draft penerimaan ada | Admin mengirim jumlah tidak valid, simulasi gagal simpan, lalu mengirim ulang upaya valid yang responsnya hilang | Input invalid dan gagal commit tidak menambah stok. Retry identik yang sudah tersimpan merujuk satu penerimaan dan satu set mutasi |
| AC-08.01 | Data dua shift termasuk penjualan di sekitar pergantian tanggal | Admin memilih tanggal dan kemudian ID shift | Setiap filter memilih penjualan yang sesuai kriteria dan total per metode dapat ditelusuri ke transaksi. Keranjang dan checkout gagal tidak masuk laporan |
| AC-08.02 | Saldo awal uji, penerimaan dan penjualan tersimpan | Admin melihat laporan produk | Saldo sesuai saldo awal ditambah penerimaan dikurangi penjualan. Setiap mutasi dapat ditelusuri ke sumber |
| AC-09.01 | Admin dan tujuan cadangan yang dapat ditulis, lalu tujuan kedua yang gagal ditulis | Admin mencoba backup ke masing-masing tujuan | Hasil berhasil memiliki titik cadangan yang dapat dipulihkan. Hasil gagal jelas dan cadangan baik sebelumnya tetap tersedia |
| AC-09.02 | Satu cadangan valid dan satu cadangan rusak | Admin menjalankan restore untuk keduanya | Data produk, transaksi, stok dan shift dari cadangan valid cocok dengan titik cadangan. Cadangan rusak ditolak dan database operasional tidak tertimpa |
| AC-10.01 | PC tujuan, scanner, printer dan installer kandidat | Operator memasang, membuka aplikasi tanpa internet, lalu scan, checkout dan cetak | Alur berhasil dan versi Windows serta model perangkat tercatat. Kegagalan menjadi penghalang penerimaan paket |
| AC-10.02 | Instalasi uji dengan data, konfigurasi dan cadangan yang dapat dipulihkan | Operator memperbarui versi dan membuka aplikasi kembali | Data dan konfigurasi dapat digunakan. Jika pembaruan gagal, prosedur pemulihan yang diuji mengembalikan kondisi operasional |
| AC-03.09 | QRIS merchant aktif; kasir punya shift aktif dan nominal Rp5.000 | Kasir mencoba mengonfirmasi tanpa bukti, kemudian memeriksa pembayaran berhasil senilai tepat Rp5.000 pada kanal merchant dan mengonfirmasi dengan identitas kasir | Sebelum verifikasi tidak ada transaksi POS lunas. Setelah verifikasi dan commit sukses, hanya satu transaksi QRIS dicatat dengan petugas/waktu dan masuk rekap QRIS, bukan kas laci. Bukti gagal/beda nominal tidak boleh dilunaskan |
| AC-07.03 | ADMIN login; stok produk 5 | Admin mengoreksi ke 3 dengan alasan; CASHIER mencoba koreksi; ADMIN mencoba saldo negatif | Koreksi sah menghasilkan mutasi -2 dengan pelaku/alasan; kasir dan saldo negatif ditolak tanpa perubahan |
| AC-08.03 | Ada transaksi tunai dan QRIS terverifikasi di dua shift, dan produk dengan stok 0 serta di bawah ambang | ADMIN membuka dashboard | Total omzet cocok dengan transaksi tersimpan, tunai/QRIS terpisah, dan barang habis/menipis benar; transaksi gagal tidak dihitung |
| AC-10.03 | Data awal dan data sistem lama tersedia dalam sampel representatif | Operator memetakan/impor data, membandingkan jumlah SKU, barcode, harga dan stok; kemudian uji rollback | Selisih dicatat dan diselesaikan sebelum GO. Migrasi dapat diulang tanpa menduplikasi produk; rollback didemonstrasikan pada salinan |

## 3. Uji lintas modul yang wajib

| ID | Given | When | Then / bukti |
|---|---|---|---|
| AC-GO-01 | PC tujuan, data awal cocok, SOP disetujui, dan semua AC P0 tercatat | Pengelola dan tim meninjau checklist GO/NO-GO | Semua blocker nol, tidak ada bug kritis, backup+rollback terbukti, kasir/pengelola menyetujui secara tercatat; jika tidak, NO-GO |
| AC-X-01 | Shift aktif, QRIS belum diverifikasi dan jaringan internet merchant bermasalah | Kasir mencoba menyelesaikan pembayaran | Tidak ada penjualan berstatus lunas; kasir diminta memeriksa status melalui kanal merchant dan tidak meminta bayar ulang sembarangan |
| AC-X-02 | Shift aktif, checkout sudah commit namun respons UI hilang | Kasir mengulang dengan kunci yang sama dan mencetak ulang | Tepat satu penjualan, satu pengurangan stok dan satu rekap; cetak ulang tidak memengaruhi saldo |
| AC-X-03 | Dua shift berurutan dan transaksi tunai serta QRIS | Kasir menghitung uang laci dan admin melihat laporan | Total tunai + QRIS cocok dengan penjualan; QRIS tidak masuk kas fisik; selisih dihitung sesuai SOP |
| AC-X-04 | Ada file backup dan versi installer kandidat | Simulasikan kegagalan aplikasi/upgrade pada salinan dan pulihkan | Produk, harga, transaksi, stok, shift dan akun pulih konsisten; hasil serta durasi dicatat |
| AC-X-05 | Data sistem lama tersedia dan beberapa produk tidak memiliki barcode/berkode ganda | Lakukan impor percobaan dua kali | Konflik ditampilkan, tidak ada duplikasi diam-diam, dan daftar selisih untuk diselesaikan sebelum cutover |

## 4. Matriks bukti minimum

| Area | Bukti minimum | Penanggung jawab |
|---|---|---|
| Login dan role | Uji login offline, akses API terlarang ditolak | Naazmi + Rahmat |
| Barang dan stok | Saldo awal, mutasi penjualan/penerimaan/koreksi, barcode unik | Naazmi + David |
| Tunai/QRIS | Transaksi tunai dan QRIS manual; bukti verifikasi merchant tanpa menyimpan data bank sensitif | Naazmi + kasir |
| Shift | Dua shift berurutan, ringkasan tunai/QRIS, modal, selisih | Naazmi + kasir |
| Keandalan | Retry, crash, restart, printer gagal, tidak ada transaksi ganda | Naazmi + Rahmat |
| Backup | File cadangan, restore pada salinan, cek integritas | Naazmi + Rahmat |
| Perangkat dan migrasi | Installer PC tujuan, scanner/printer, rekonsiliasi SKU/harga/stok | Naazmi + David |
| Keputusan produksi | Persetujuan pengelola, SOP, daftar bug, rencana rollback | David + pengelola |

## 5. Kriteria blocker otomatis

NO-GO jika: penjualan/stock dapat terduplikasi; pembayaran QRIS dianggap lunas tanpa verifikasi; angka setoran tidak dapat dijelaskan; data awal tidak cocok; scanner/printer wajib tidak bekerja; backup tidak bisa direstore; akses role dapat dilewati; sistem tidak berjalan offline untuk tunai; atau pengelola belum menyetujui SOP dan cutover. Tidak ada pengecualian hanya karena tenggat 14 hari.

## 6. Template pencatatan hasil (isi saat testing)

```text
AC ID:
Tanggal dan penguji:
Commit/versi:
PC/Windows/perangkat:
Fixture dan langkah:
Hasil yang diharapkan:
Hasil aktual:
Bukti:
Status: NOT RUN / PASS / FAIL / BLOCKED
Bug/keputusan terkait:
```

## 7. Konsistensi audit product

- `AC-07.03` menguji koreksi stok ADMIN yang diwajibkan P0, selaras dengan izin PRD.
- `AC-03.09` tidak mengklaim bahwa aplikasi POS menerima notifikasi bank; verifikasi manual harus dilakukan kasir melalui kanal merchant.
- Seluruh AC tetap berstatus **NOT RUN** sampai Naazmi atau penguji menjalankannya dan melampirkan bukti. Tidak ada hasil tes yang direkayasa untuk memenuhi tenggat.
