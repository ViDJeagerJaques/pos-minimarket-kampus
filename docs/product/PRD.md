# PRD Sistem Kasir dan Inventaris Minimarket Kampus

| Informasi | Isi |
|---|---|
| Versi | 0.3.1 |
| Tanggal | 11 November 2026 |
| Status | Draft untuk review tim dan validasi minimarket |
| Pemilik | David, koordinator proyek |
| Lokasi dalam repositori | `docs/product/PRD.md` |
| Dasar penyusunan | `CONTEXT.md` v0.1.0, `DECISIONS.md` v0.2.3, PRD v0.2.0, masukan koordinator 11 November 2026 |

> **Catatan revisi 11 November 2026:** rilis pertama ditargetkan menggantikan sistem lama pada 25 November 2026 **hanya jika lulus GO/NO-GO**. Pembayaran P0 adalah tunai dan **QRIS manual terverifikasi**, bukan QRIS API. Member kredit, retur/refund otomatis, integrasi cloud, dan QRIS otomatis ditunda; kebutuhan operasional nyata tetap harus dikonfirmasi sebelum cutover. ID kebutuhan terdahulu dipertahankan agar jejak pekerjaan tidak putus; pembatasan rilis mengacu pada `SCOPE.md`.

## 1. Masalah dan tujuan produk

Minimarket kampus masih memakai sistem kasir berlangganan yang menurut konteks proyek akan berakhir pada Desember 2026. Tanggal berakhir dan jadwal uji coba perlu dikonfirmasi. Tim menyiapkan sistem mandiri untuk satu PC kasir yang dapat mencatat penjualan, mengelola persediaan, dan membantu serah terima dua shift kerja meski internet terputus.

Keberhasilan MVP diukur dari kemampuan kasir menyelesaikan transaksi dan menutup shift, serta kemampuan admin menelusuri perubahan stok dan memulihkan data. Target biaya perangkat lunak adalah Rp0. Biaya perangkat, UPS, media cadangan, dan operasional dicatat terpisah. Penggunaan di cabang atau stasiun tambahan dan komersialisasi berada di luar rilis pertama.

**Status kebutuhan.** `SOURCE` berarti berasal dari notulen atau laporan yang dirangkum di konteks. `TEAM_DECISION` berarti arah yang dipilih tim. `PROPOSED` berarti usulan untuk diuji. `PENDING` berarti masih perlu jawaban. `CONFLICT` menandai perubahan atau perbedaan antarsumber. PRD ini memakai konteks sebagai sumber langsung. Notulen dan PDF disebut melalui ringkasan dalam konteks.

## 2. Pengguna dan batas akses

| Pengguna | Kebutuhan | Akses rancangan awal |
|---|---|---|
| Kasir (`CASHIER`) | Melayani pembeli dan menyerahkan hasil shift | Buka atau lanjutkan shift sendiri, scan atau cari produk, bayar, cetak struk, tutup shift |
| Admin (`ADMIN`) | Menyiapkan data barang, mencatat persediaan, dan memeriksa hasil operasional | Kelola akun, produk, kategori, supplier, penerimaan barang, stok, dan laporan |
| Pengelola minimarket | Menyetujui prosedur dan menerima hasil uji | Pihak validasi operasional. Kebutuhan akun supervisor masih `PENDING` |

Satu aplikasi, dua peran, dan satu PC adalah `TEAM_DECISION`. Dua shift adalah kebutuhan dari notulen (`SOURCE`). Matriks izin per aksi, akses admin saat shift aktif, dan prosedur mengambil alih shift kasir lain masih perlu disepakati. Untuk rancangan awal, backend menolak pengambilalihan tanpa prosedur dan izin yang disahkan.

### 2.1 Matriks hak akses yang diusulkan

Izin diterapkan di backend. Seluruh aksi memerlukan sesi aktif, kecuali login. Hak ADMIN dan CASHIER ditetapkan per operasi. Jika satu petugas menjalankan dua fungsi, cara pemberian akun menunggu keputusan tim. Aksi yang belum diizinkan ditolak hingga kebijakan terkait disahkan.

| Operasi | ADMIN | CASHIER | Batas / referensi |
| --- | --- | --- | --- |
| Login lokal | Ya | Ya | Akun aktif · POS-01.01–02 |
| Kelola akun lokal | Ya | Tidak | Audit perubahan · POS-01.04 |
| Lihat produk aktif untuk penjualan | Ya | Ya | Kasir membaca katalog untuk transaksi · POS-03.01 |
| Kelola produk, kategori, supplier, barcode dan harga | Ya | Tidak | Audit harga · POS-02.01–03 |
| Buat atau lanjutkan shift | Tidak | Shift sendiri | Satu shift aktif per PC · POS-05.01–02 |
| Checkout, periksa retry, dan batalkan draft penjualan | Tidak | Shift sendiri | Checkout baru butuh shift aktif. Cek hasil transaksi sendiri tetap tersedia sesudah shift ditutup · POS-03 dan POS-04 |
| Baca transaksi tersimpan | Ya | Transaksi sendiri | Kasir melihat transaksi pada shift miliknya untuk ringkasan dan pemulihan · POS-04.02 dan POS-08.01 |
| Cetak ulang struk | Tidak | Transaksi sendiri | Gunakan hasil tersimpan dan nomor yang sama · POS-04.03 |
| Baca ringkasan shift | Ya | Shift sendiri | Termasuk shift yang sudah ditutup · POS-06.01–02 |
| Tutup shift | Tidak | Shift sendiri | Tutup eksplisit dengan data valid · POS-06.02–03 |
| Catat dan konfirmasi penerimaan barang | Ya | Tidak | Mutasi saat commit · POS-07.01–02 |
| Lihat saldo dan riwayat mutasi persediaan | Ya | Tidak | Kasir tetap menerima pesan ketersediaan saat checkout · POS-03.06 dan POS-08.02 |
| Lihat laporan lintas shift | Ya | Tidak | POS-08.01 |
| Buat cadangan dan mulai pemulihan lokal | Ya | Tidak | Prosedur pemulihan mengunci akses operasional sesuai runbook yang akan disahkan · POS-09.01–02 |
| Koreksi stok dengan alasan dan catatan mutasi | Ya | Tidak | P0, wajib audit; tolak stok negatif · POS-07.03 |
| Void, refund, retur transaksi tersimpan, atau ambil alih shift | Ditunda | Ditunda | Tunggu kebijakan dan izin yang disahkan · POS-PND-01 dan 05 |

Pemasangan dan pembaruan dilakukan operator Windows yang diberi kewenangan di PC tujuan. Izin Windows dikelola terpisah dari role aplikasi.

## 3. Prioritas rilis dan batas 14 hari

| Prioritas | Kebutuhan | Dasar/status |
|---|---|---|
| P0 — harus lulus | Login lokal dua role; master barang dan barcode/harga; impor atau input stok awal; scan/cari dan keranjang; checkout tunai; QRIS manual dengan pemeriksaan pembayaran oleh kasir; transaksi dan mutasi stok atomik; satu shift aktif dan dua shift berurutan; setoran tunai dan rekap QRIS terpisah; struk/cetak ulang; penerimaan dan koreksi stok oleh admin dengan audit; laporan penjualan harian/shift dan stok menipis/habis; backup SQLite dan restore; installer Windows; uji pada perangkat nyata | Keputusan tim dan baseline teknis, sebagian SOP **PENDING** |
| P0 — syarat cutover, bukan fitur UI | Ekspor/impor data lama atau input awal yang diverifikasi, pemeriksaan barcode/harga/stok, uji offline, retry/restart, perangkat, uji paralel, persetujuan pengelola, rollback | `DEC-021`, `SCOPE.md` |
| P1 — setelah cutover | Filter laporan supplier/departemen lanjutan, pemindaian opname massal, ekspor spreadsheet laporan, peningkatan pengalaman admin | Prioritas dapat berubah jika operasional membuktikan wajib |
| OUT — bukan rilis 14 hari | Member/kredit pelanggan, retur/refund/void otomatis, integrasi QRIS API atau notifikasi bank, cloud sync, multi-PC, akses admin jarak jauh, kiosk | `DEC-017`, `DEC-020`, `DEC-023` |

**Aturan pembayaran.** Tunai diproses di POS. Untuk QRIS, pelanggan membayar melalui QRIS merchant eksternal yang sudah digunakan minimarket. Kasir **harus memeriksa nominal dan status berhasil** pada kanal merchant sebelum memilih "Konfirmasi Pembayaran" di POS. POS tidak mengklaim menerima konfirmasi bank secara otomatis. Bila hasil QRIS belum jelas, jangan commit sebagai transaksi lunas dan jangan meminta pembayaran ulang sebelum status diperiksa. Pembayaran QRIS bukan operasi yang dijamin offline.

**Aturan setoran awal (PROPOSED).** `kas_seharusnya = modal_awal + penjualan_tunai - pengembalian_tunai - pengeluaran_kas_disetujui - setoran_tengah_shift`; `selisih = uang_fisik_dihitung - kas_seharusnya`. Selama belum ada SOP, larang pengeluaran kas, refund, dan setoran tengah shift melalui POS; QRIS direkap terpisah. Pengelola wajib menyetujui aturan operasional sebelum GO.

## 4. Alur kerja dan layar

| Alur | Langkah pengguna | Layar dan informasi utama |
|---|---|---|
| Mulai kerja | Login → buka shift → masukkan modal bila prosedur mengharuskan | Login dan Shift. Tampilkan identitas, shift aktif, serta waktu mulai |
| Penjualan | Scan barcode atau cari barang → cek keranjang → pilih pembayaran → simpan → cetak | Kasir. Tampilkan item, jumlah, harga, total, status transaksi dan status cetak |
| Pemulihan | Login setelah restart → temukan shift aktif → cek transaksi terakhir → lanjutkan | Shift dan riwayat transaksi shift. Tampilkan nomor transaksi tersimpan untuk cetak ulang |
| Penerimaan barang | Pilih supplier → isi produk dan jumlah yang diterima → simpan → periksa stok | Master Data dan Inventaris. Tampilkan penerimaan, stok saat ini dan riwayat perubahan |
| Serah terima | Buka ringkasan → masukkan nilai setoran sesuai SOP → periksa hasil → tutup shift → kasir berikutnya buka shift | Ringkasan Shift. Tampilkan transaksi dan total per jenis pembayaran yang berlaku, nilai setoran dan selisih sesuai SOP |
| Rekap dan pemulihan data | Filter tanggal/shift → periksa laporan → jalankan backup atau pulihkan dengan akun berwenang | Laporan dan Pemeliharaan Data. Tampilkan cakupan laporan dan hasil backup/restore |

### 4.1 Alur normal, alternatif, dan kegagalan

| Modul | Normal | Alternatif | Kegagalan dan hasil yang diharapkan |
| --- | --- | --- | --- |
| Penjualan | Kasir scan barang aktif dan memeriksa keranjang pada shift sendiri. | Cari produk manual, ubah jumlah atau batalkan draft sebelum pembayaran diterima. | Barcode tak dikenal tidak menambah item. Keranjang invalid atau shift tidak aktif ditolak. Perubahan harga meminta persetujuan total baru sebelum pembayaran dilanjutkan. |
| Pembayaran | Gunakan metode yang disahkan, validasi data, lalu commit lokal. Setelah hasil tersimpan, kasir dapat mencetak struk. | Jika respons hilang, cek status checkout menggunakan identitas upaya yang sama. Jika sudah tersimpan, tampilkan transaksi lama. | Gagal sebelum commit tidak meninggalkan data parsial. Jika uang sudah diterima atau instrumen bayar sudah diproses, periksa bukti fisik dan status transaksi sebelum kasir mengulang. Printer gagal hanya memengaruhi cetak. |
| Stok | Penjualan mengurangi stok dan penerimaan menambah stok dalam commit masing-masing. Mutasi menyimpan rujukan sumber. | Kasir dapat mengurangi jumlah di keranjang setelah validasi ketersediaan gagal. Admin dapat menelusuri riwayat barang. | Untuk fixture awal blokir stok negatif, checkout tidak cukup stok ditolak secara utuh. Selisih fisik ditangani sesuai prosedur yang masih perlu disahkan. |
| Penerimaan | Admin memilih supplier, memasukkan barang dan jumlah aktual, lalu mengonfirmasi penerimaan. | Admin mengubah atau membuang draft sebelum konfirmasi. Jika jumlah berbeda dari pesanan, catat jumlah aktual sesuai fixture alur dasar. | Input invalid ditolak. Gagal commit tidak menambah stok. Jika hasil kiriman tidak jelas, ulangi upaya yang sama agar penerimaan tidak tercatat dua kali. |
| Shift | Kasir membuka shift, bertransaksi, memeriksa ringkasan dan menutup secara eksplisit. Kasir berikutnya baru dapat membuka shift setelah penutupan tersimpan. | Kasir pemilik login kembali dan melanjutkan shift aktif setelah logout atau restart. | Buka shift kedua dan penutupan dengan data tidak valid ditolak. Bila pemilik shift tidak tersedia, eskalasi ke pengelola. Pengambilalihan menunggu SOP. |

### 4.2 Status dan transisi shift

`Tidak ada shift aktif` adalah kondisi stasiun. Status shift tersimpan adalah `AKTIF` atau `DITUTUP`. Pratinjau setoran adalah langkah antarmuka tanpa perubahan status shift.

| Asal | Peristiwa | Syarat | Hasil |
| --- | --- | --- | --- |
| Tidak ada shift aktif | Buka shift | CASHIER berwenang, data buka sesuai SOP yang berlaku | Shift baru AKTIF. Identitas dan waktu mulai tersimpan |
| AKTIF | Tutup jendela, logout, restart, listrik terputus, atau gagal menutup shift sebelum commit | Pembukaan sebelumnya telah tersimpan | Tetap AKTIF. Kasir pemilik login kembali untuk melanjutkan |
| AKTIF | Buka shift lain | Sudah ada shift aktif | Permintaan ditolak. Shift lama tetap AKTIF |
| AKTIF | Konfirmasi penutupan | Kasir pemilik, data tutup valid, dan commit berhasil | DITUTUP. Waktu, petugas dan ringkasan akhir tersimpan |
| DITUTUP | Retry penutupan identik | Permintaan merujuk penutupan yang sama | Tetap DITUTUP. Kembalikan hasil penutupan asli |
| DITUTUP | Coba lanjutkan checkout baru atau buka kembali shift | Shift sudah ditutup | Ditolak. Untuk mulai bekerja, buka shift baru dengan ID baru |

### 4.3 Aturan transaksi yang harus konsisten

- **Batal dan koreksi.** Batal keranjang berlaku sebelum checkout diajukan dan sebelum pembayaran fisik diterima. Upaya dengan hasil belum jelas masuk jalur pemulihan. Penjualan tersimpan dilindungi dari perubahan langsung. Jika koreksi disetujui, requirement baru harus menetapkan otorisasi, dampak pembayaran dan stok, serta jejak audit.
- **Retry dan restart.** Periksa hasil yang sudah tersimpan dengan identitas upaya sebelum memvalidasi checkout baru. Retry identik tetap dapat membaca hasil lama milik kasir setelah shift ditutup. Gunakan identitas dan isi yang sama saat hasil pengiriman belum diketahui. Setelah kegagalan definitif dan isi diubah, ajukan sebagai upaya baru. Bila aplikasi tidak dapat memastikan status pembayaran fisik, kasir memeriksa bukti pembayaran sebelum melanjutkan dan mengikuti prosedur yang disepakati.
- **Harga dan stok.** Gunakan nominal rupiah bulat dalam rancangan awal. Backend memvalidasi harga yang disetujui dan ketersediaan saat commit. Item tersimpan membawa harga saat transaksi. Aturan blokir stok negatif adalah usulan untuk fixture pengembangan. Kebijakan final harus diuji dengan fixture yang disahkan sebelum pilot.
- **Cetak.** Cetak dijalankan setelah commit. Jika printer gagal atau status cetak tidak jelas, tampilkan keadaan tersebut dan sediakan cetak ulang dari transaksi tersimpan. Jumlah penjualan dan saldo stok tetap mengikuti commit awal.
- **Setoran.** Modal awal, pembulatan, klasifikasi metode, cara hitung selisih dan kewenangan koreksi mengikuti SOP yang disahkan. Contoh angka dari pengembangan berstatus fixture.

## 5. Functional requirements dan kriteria penerimaan

### 5.1 Matriks ketertelusuran

ID `POS-01` sampai `POS-10` tetap menjadi kelompok asal. ID turunannya dipakai untuk tiket, implementasi, dan bukti uji. Kode C merujuk ke bagian dalam `CONTEXT(1).md` (misalnya C6.1 berarti §6.1). Huruf N = notulen sebagaimana dirangkum konteks, T = keputusan tim, U = usulan produk, R = rekomendasi teknis, P = aspek kebijakan atau perangkat yang masih perlu konfirmasi. Satu baris dapat memadukan beberapa jenis sumber. P0 adalah kebutuhan rilis yang diusulkan dalam draft ini. Untuk P0 dengan tanda P, fixture uji dapat dipakai dalam pengembangan dan hasil validasi lapangan tetap menjadi syarat uji terima.

| ID | Modul | Sumber | Dasar | Prioritas | Requirement | Uji |
| --- | --- | --- | --- | --- | --- | --- |
| POS-01.01 | Akses | C5 C8 C9 | T R | P0 | Autentikasi lokal untuk akun aktif tanpa koneksi internet. | AC-01.01 |
| POS-01.02 | Akses | C8 C9 | U R | P0 | Tolak kredensial salah dan akun nonaktif. | AC-01.02 |
| POS-01.03 | Akses | C4 C9 | U R | P0 | Terapkan matriks §2.1 di backend dan periksa kepemilikan shift. | AC-01.03 |
| POS-01.04 | Akses | C8 C9 | U R | P0 | Admin mengelola akun lokal dan perubahan status tercatat. | AC-01.04 |
| POS-02.01 | Master | C3 C8 | N U | P0 | Admin mengelola produk, kategori dan supplier yang dirujuk produk. | AC-02.01 |
| POS-02.02 | Master | C8 | U | P0 | Barcode yang dipakai untuk scan harus menunjuk satu produk aktif. | AC-02.02 |
| POS-02.03 | Master | C8 C9 | U R | P0 | Simpan perubahan harga untuk penjualan berikutnya serta jejak pelaku dan waktu. | AC-02.03 |
| POS-03.01 | Penjualan | C3 C8 | N U | P0 | Kasir dapat scan barcode atau mencari barang secara manual. | AC-03.01 |
| POS-03.02 | Penjualan | C8 C9 | U R | P0 | Checkout hanya untuk shift aktif milik kasir dengan keranjang valid. | AC-03.02 |
| POS-03.03 | Penjualan | C8 C9 | U R | P0 | Backend memeriksa ulang harga saat checkout. Jika harga berubah sejak ringkasan disetujui, minta konfirmasi total terbaru sebelum pembayaran dilanjutkan. | AC-03.03 |
| POS-03.04 | Pembayaran | C3 C8 C13 | N U | P0 | Catat hanya metode pembayaran yang disahkan untuk pilot dan informasi yang diwajibkan untuk tiap metode. | AC-03.04 |
| POS-03.05 | Penjualan | C5 C6.1 C9 | T R | P0 | Simpan penjualan, item, informasi pembayaran dan mutasi stok sebagai satu commit lokal. | AC-03.05 |
| POS-03.06 | Stok | C6.1 C8 C13 | U P | P0 | Periksa ketersediaan saat commit dan jalankan kebijakan stok yang disahkan untuk pilot. Fixture awal memakai usulan blokir stok negatif. | AC-03.06 |
| POS-03.07 | Penjualan | C7 C8 C13 | U R | P0 | Sediakan batal keranjang sebelum checkout diajukan. Aksi tersebut hanya membuang draft. | AC-03.07 |
| POS-03.08 | Penjualan | C9 C13 C14 | U P | P0 | Lindungi transaksi tersimpan dari hapus/ubah langsung. Void, refund, dan retur menunggu keputusan alur koreksi. | AC-03.08 |
| POS-04.01 | Pemulihan | C7 C9 | T R | P0 | Satu upaya checkout memakai identitas stabil lintas retry. Pencatatan hasil dan identitas dilakukan dalam commit penjualan. | AC-04.01 |
| POS-04.02 | Pemulihan | C7 C9 | T R | P0 | Pulihkan status checkout setelah restart melalui identitas upaya yang dicatat lokal sebelum pengajuan. Saat hasil belum diketahui, tampilkan status dan arahkan kasir mengecek sebelum mencoba lagi. | AC-04.02 |
| POS-04.03 | Struk | C5 C7 C8 | N U | P0 | Cetak hanya dari transaksi tersimpan. Kegagalan cetak memungkinkan cetak ulang dengan nomor transaksi yang sama. | AC-04.03 |
| POS-05.01 | Shift | C5 C7 | N U | P0 | Buka shift eksplisit dan batasi satu shift aktif per PC. | AC-05.01 |
| POS-05.02 | Shift | C7 | T | P0 | Pertahankan shift aktif melalui tutup jendela, logout, restart atau pemulihan setelah gangguan listrik. | AC-05.02 |
| POS-06.01 | Shift | C3 C7 C13 | N U P | P0 | Tampilkan ringkasan per metode dari transaksi tersimpan dan hitung setoran/selisih hanya sesuai SOP pilot. | AC-06.01 |
| POS-06.02 | Shift | C7 C13 | U R | P0 | Tutup shift secara eksplisit dan simpan ringkasannya. Penutupan dan checkout pada shift yang sama harus menghasilkan urutan konsisten. | AC-06.02 |
| POS-06.03 | Shift | C7 C13 | U R | P0 | Gagal tutup tidak mengakhiri shift. Pengulangan penutupan setelah commit merujuk hasil yang sama. | AC-06.03 |
| POS-07.01 | Penerimaan | C3 C8 | N U | P0 | Catat penerimaan barang dengan supplier, barang, jumlah aktual, waktu dan petugas. Draft dapat dibatalkan sebelum dikonfirmasi. | AC-07.01 |
| POS-07.02 | Penerimaan | C6.1 C8 C9 | U R | P0 | Simpan penerimaan dan mutasinya bersama. Tolak input invalid dan cegah commit ganda untuk upaya yang sama. | AC-07.02 |
| POS-08.01 | Laporan | C3 C8 | N U | P0 | Sediakan laporan penjualan per tanggal dan per shift dengan batas tanggal sesuai zona operasional yang disepakati. | AC-08.01 |
| POS-08.02 | Stok | C3 C8 | N U | P0 | Tampilkan saldo dan riwayat mutasi per produk dengan rujukan sumber, jumlah, waktu dan pelaku. | AC-08.02 |
| POS-09.01 | Cadangan | C6.1 C8 C9 C13 | U R | P0 | Buat cadangan lokal yang konsisten dan laporkan hasilnya. | AC-09.01 |
| POS-09.02 | Pemulihan | C6.1 C8 C9 | U R | P0 | Uji restore ke lingkungan terpisah sebelum dipakai untuk pemulihan operasional. | AC-09.02 |
| POS-10.01 | Windows | C5 C6 C15.2 | T P | P0 | Validasi installer Windows pada PC tujuan. Pilihan pembungkus mengikuti hasil uji perangkat. | AC-10.01 |
| POS-10.02 | Windows | C6 C8 C12 | U R | P0 | Pembaruan paket menjaga database dan konfigurasi lokal. | AC-10.02 |
| POS-03.09 | QRIS manual | DEC-016 DEC-023 | T P | P0 | Kasir hanya mengonfirmasi QRIS setelah memeriksa nominal dan status berhasil di kanal merchant; catat petugas, waktu dan referensi bila tersedia. Belum terverifikasi tidak boleh dicatat lunas. | AC-03.09 |
| POS-07.03 | Koreksi stok | DEC-018 | U P | P0 | ADMIN menyesuaikan stok dengan alasan dan audit; jumlah akhir tidak boleh negatif; tidak boleh mengubah saldo tanpa ledger. | AC-07.03 |
| POS-08.03 | Dashboard | DEC-018 | U | P0 | ADMIN melihat omzet hari ini, jumlah transaksi, tunai vs QRIS, stok menipis/habis, dan ringkasan shift dengan angka dapat ditelusuri. | AC-08.03 |
| POS-10.03 | Migrasi/cutover | DEC-021 | P | P0 | Data barang, barcode, harga dan stok awal dari sistem lama diimpor atau diinput lalu direkonsiliasi sebelum cutover; tersedia keputusan GO/NO-GO dan rencana rollback. | AC-10.03 |

### 5.2 Skenario Given–When–Then

Gunakan database uji terpisah. Untuk baris dengan beberapa upaya, siapkan kondisi awal ulang bila hasil upaya sebelumnya mengubah data. Simpan hasil UI dan bukti dari data tersimpan untuk kasus commit, retry, akses, dan pemulihan.

| ID uji | Given · kondisi awal | When · aksi | Then · hasil teramati |
| --- | --- | --- | --- |
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
| AC-03.09 | QRIS merchant aktif; kasir punya shift aktif dan nominal Rp5.000 | Kasir mencoba konfirmasi tanpa verifikasi, lalu setelah bukti berhasil dengan nominal tepat, mengonfirmasi | Status belum diverifikasi tidak menghasilkan penjualan lunas. Verifikasi sah menghasilkan satu transaksi QRIS, tercatat siapa/kapan, dan masuk rekap QRIS, bukan kas laci |
| AC-07.03 | ADMIN login; stok produk 5 | Admin mengoreksi ke 3 dengan alasan; CASHIER mencoba koreksi; ADMIN mencoba saldo negatif | Koreksi sah menghasilkan mutasi -2 dengan pelaku/alasan; kasir dan saldo negatif ditolak tanpa perubahan |
| AC-08.03 | Ada transaksi tunai dan QRIS terverifikasi di dua shift, dan produk dengan stok 0 serta di bawah ambang | ADMIN membuka dashboard | Total omzet cocok dengan transaksi tersimpan, tunai/QRIS terpisah, dan barang habis/menipis benar; transaksi gagal tidak dihitung |
| AC-10.03 | Data awal dan data sistem lama tersedia dalam sampel representatif | Operator memetakan/impor data, membandingkan jumlah SKU, barcode, harga dan stok; kemudian uji rollback | Selisih dicatat dan diselesaikan sebelum GO. Migrasi dapat diulang tanpa menduplikasi produk; rollback didemonstrasikan pada salinan |

### 5.3 Kandidat yang menunggu keputusan

| ID | Sumber | Prioritas | Keputusan yang diperlukan | Acceptance criteria |
| --- | --- | --- | --- | --- |
| POS-PND-01 | C3 C8 C13 | PENDING | Tentukan apakah void, refund atau retur diperlukan saat rilis. Jika wajib, sepakati otorisasi, referensi transaksi, dampak per metode pembayaran, mutasi stok dan audit sebelum menaikkan prioritas. | Setelah prosedur disahkan |
| POS-PND-02 | C3 C8 C13 | PENDING | Tentukan apakah kredit berarti piutang member. Jika wajib, tetapkan proses member, saldo awal, pencatatan utang, dan pelunasan. | Setelah definisi disahkan |
| POS-PND-03 | C3 C8 C13 | PENDING | Tentukan filter supplier/departemen serta definisi dan sumber data departemen. | Setelah definisi disahkan |
| POS-PND-04 | C3 C13 | PENDING | Tentukan apakah stok awal, stok akhir dan opname perlu scan serta bagaimana penyesuaian disetujui. | Setelah prosedur disahkan |
| POS-PND-05 | C4 C7 C13 | PENDING | Tentukan peran supervisor, alur pengambilalihan shift dan akses admin saat shift aktif atau dari perangkat lain. | Setelah aturan akses disahkan |
| POS-PND-06 | C3 C6.1 C8 C13 | Fase lanjutan | Konfirmasi cloud, arti real-time post, serta hubungan pengiriman data dengan penutupan shift. | Setelah lingkup integrasi disahkan |
| POS-PND-07 | C3 C6 C13 | Fase lanjutan | Validasi kebutuhan e-wallet/pop-up dan kiosk Windows secara terpisah. | Setelah kebutuhan dikonfirmasi |

Prioritas dinaikkan hanya setelah pengelola mengonfirmasi kebutuhan operasional atau syarat uji terima, tim menyetujui dampaknya ke jadwal, dan requirement memperoleh kriteria uji. Jika pengelola membutuhkan koreksi transaksi untuk pilot, keputusan POS-PND-01 menjadi gerbang rilis. Aturan pemblokiran awal POS-03.08 menjaga data sambil menunggu keputusan tersebut.

## 6. Data, arsitektur, dan integrasi

| Kelompok data | Informasi yang diperlukan |
|---|---|
| Akses dan shift | Akun, role, identitas kasir, waktu buka/tutup, status shift, modal/setoran bila berlaku |
| Master | Produk, barcode, harga, status aktif, kategori dan relasi supplier |
| Penjualan | ID transaksi, kunci permintaan untuk retry, shift, waktu, item, harga transaksi, jumlah, total dan metode bayar yang berlaku |
| Inventaris | Pembelian/penerimaan, detail barang diterima, saldo, dan mutasi yang mengacu ke dokumen sumber |
| Operasional | Jejak aksi kritis, metadata cadangan, waktu dan hasil pemulihan |

Frontend React + Vite + TypeScript, backend lokal Node.js + Express, dan SQLite lokal adalah arah awal tim. UI berkomunikasi dengan backend lokal. Backend menjadi tempat pemeriksaan akses, validasi, perhitungan total, dan transaksi database. SQLite menjadi sumber data operasional. Aplikasi tetap harus bisa dijalankan secara lokal saat pengembangan. Catat perubahan arah dari web lokal melalui Chrome ke target desktop Windows sebagai `CONFLICT` dalam catatan keputusan. Pilih Electron atau alternatif setelah uji perangkat.

Untuk pembayaran, simpan penjualan, item, informasi pembayaran, dan mutasi stok dalam satu transaksi SQLite. Gunakan kunci permintaan yang sama ketika checkout yang sama dicoba ulang. Backend mengembalikan hasil asli bila permintaan telah berhasil, serta menolak penggunaan ulang kunci untuk isi yang berbeda. Jalankan cetak sesudah penyimpanan berhasil. Pisahkan status transaksi dari status cetak.

Cloud tidak dibutuhkan untuk menjalankan POS. Jika fase cloud disetujui, rancang identitas unik, antrean yang tersimpan, retry aman, idempotensi, pemulihan konflik, dan status yang membedakan data lokal dari data yang sudah terkirim. Jadwal pengiriman dan hubungan dengan tutup shift menunggu validasi. Cadangan lokal dan uji restore tetap menjadi bagian rilis inti.

## 7. Persyaratan kualitas

| Aspek | Syarat dan pembuktian |
|---|---|
| Offline | Putuskan koneksi sebelum aplikasi dibuka. Uji login lokal, shift, scan, pembayaran, cetak, perubahan stok, dan laporan. |
| Integritas data | Jalankan uji interupsi proses di sekitar commit dan retry. Periksa transaksi, item dan mutasi secara bersamaan. Pada gangguan listrik, bedakan pembayaran fisik yang sudah diterima dari status transaksi yang tercatat sebelum mengambil tindakan. |
| Keamanan | Hash password, validasi input dan gunakan query terparameterisasi. Cek izin pada backend. Batasi akses layanan lokal sesuai topologi satu PC. Rekam petugas dan waktu untuk perubahan akun, harga, stok, dan penutupan shift. |
| Privasi | Gunakan data sintetis untuk pengembangan. Simpan cadangan dengan akses terbatas. Jauhkan rahasia layanan cloud dari frontend, repositori dan installer. |
| Penggunaan | Alur scan dan cari manual dapat dijalankan dengan keyboard. Fokus dan pesan transaksi terlihat jelas. Uji dengan scanner, printer, resolusi layar, dan Windows yang benar-benar akan dipakai. |
| Backup | Tetapkan penanggung jawab, interval, retensi, lokasi terpisah dari PC, dan toleransi kehilangan data sebelum pilot. Uji restore di lingkungan terpisah dan cocokkan hasil dengan titik cadangan. |

## 8. Ukuran keberhasilan dan gerbang rilis

| Ukuran | Target uji yang diusulkan |
|---|---|
| Kelulusan alur inti | Seluruh skenario P0 di §5 lulus dengan bukti uji, termasuk skenario internet putus. Untuk keputusan lapangan, ulangi skenario dengan konfigurasi dan SOP pilot yang disahkan |
| Ketepatan pencatatan | Nol penjualan ganda, mutasi yatim, atau selisih laporan terhadap data uji pada skenario normal, retry, restart, dan pergantian shift |
| Rekonsiliasi shift | Dua shift berurutan dapat dibuka dan ditutup pada satu PC. Nilai laporan dan setoran dapat dijelaskan sesuai SOP |
| Pemulihan | Satu simulasi pemulihan ke lingkungan terpisah berhasil dengan hasil sesuai cadangan. Waktu pemulihan dan titik cadangan dicatat |
| Kinerja | Ukur waktu pencarian produk dan simpan pembayaran pada PC tujuan dengan data representatif. Sepakati ambang dengan pengelola setelah pengukuran awal |

Uji terima melibatkan kasir dan pengelola pada perangkat tujuan. Sebelum penggantian sistem lama, verifikasi hasil ekspor data, cocokkan master barang dan saldo awal, uji pemulihan, dan sepakati jadwal cutover serta prosedur kembali ke sistem lama. Jadwal pilot, penggantian, dan batas toleransi kehilangan data ditetapkan setelah pengelola mengonfirmasi tanggal langganan dan kondisi operasional.

## 9. Tahapan dan penanggung jawab

**Rencana eksekusi terbaru:** hari 1–3 kunci scope, uji perangkat dan data lama; hari 4–7 alur transaksi; hari 8–10 QRIS manual, laporan, koreksi stok, backup dan installer; hari 11–12 migrasi serta uji paralel; hari 13–14 UAT dan GO/NO-GO. Ini **rencana berisiko tinggi**, bukan janji siap produksi. Lihat `TASKS.md` untuk owner dan dependensi.


| Tahap | Hasil yang diperiksa | Penanggung jawab utama |
|---|---|---|
| 0 · Validasi | Alur kasir/admin, SOP shift, metode bayar, spesifikasi PC, jenis perangkat dan tanggal pilot tercatat | David dan Naazmi |
| 1 · Alur pertama | Produk → scan/cari → checkout tunai uji → stok → laporan sederhana, berjalan lokal | Syafroni dan Rahmat, dengan review David |
| 2 · Operasi harian | Izin, penerimaan barang, dua shift, setoran, laporan, struk dan pemulihan transaksi teruji | Rahmat dan Syafroni, dengan QA Naazmi |
| 3 · Pilot Windows | Installer diuji pada PC tujuan, cadangan dipulihkan, data awal direkonsiliasi, dan uji terima dicatat | Naazmi dan David bersama pengelola |

Gunakan satu repositori GitHub, branch dan PR per perubahan, serta database development masing-masing. Kaitkan setiap PR dengan ID kebutuhan dan hasil pengujian yang dijalankan. Review lintas pemilik untuk perubahan skema, kontrak API, izin, atau aturan transaksi. Tahap dinyatakan selesai setelah alurnya bisa dijalankan dan buktinya tercatat.

## 10. Keputusan terbuka sebelum implementasi atau pilot

**Prioritas blocker untuk 14 hari:** (1) identitas merchant QRIS dan prosedur verifikasi; (2) ada/tidaknya kredit, retur, refund wajib harian; (3) ekspor data lama atau alternatif input awal; (4) SOP shift/setoran/selisih; (5) perangkat Windows/scanner/printer; (6) akses media backup dan hasil restore; (7) persetujuan pengelola dan opsi perpanjangan sistem lama. Keputusan teknis tim tidak menggantikan konfirmasi pihak minimarket.


| Hal yang perlu dikonfirmasi | Dampak jika belum terjawab |
|---|---|
| Peran gudang/supervisor, PC khusus kasir, dan akses admin dari perangkat lain | Hak akses, pengambilalihan shift, topologi dan penguncian perangkat |
| Modal awal, setoran, selisih, koreksi, dan perpindahan kasir | Rumus rekap, izin, dan uji penerimaan POS-05.* dan POS-06.* |
| Makna tunai/debit/kredit dan prioritas member kredit | Jenis bayar, pencatatan piutang, serta laporan |
| Retur pelanggan atau supplier, pembelian, penyesuaian dan scan stok awal/akhir | Alur mutasi, kebutuhan persediaan dan cakupan MVP |
| Arti departemen dan pemetaan barang ke supplier dalam laporan | Struktur kategori, relasi supplier dan filter laporan |
| Spesifikasi PC, scanner dan printer | Pilihan packaging, performa, dan kompatibilitas perangkat |
| Arti *real-time post*, kebutuhan cloud dan e-wallet | Jadwal fitur lanjutan dan kriteria keberhasilan pengiriman |
| Ekspor sistem lama, akses proyek senior, tanggal akhir langganan dan tanggal pilot | Migrasi, kesiapan data awal, jadwal uji terima, dan rencana transisi |
| Jadwal, retensi, lokasi dan akses backup | Pemulihan setelah kerusakan perangkat dan tanggung jawab operasional |

David mencatat hasil validasi bersama tanggal, narasumber, dan dampaknya terhadap prioritas atau kriteria uji. Naazmi menggunakan ID POS untuk menghubungkan hasil pengujian dengan kebutuhan produk.

## 11. Hasil pemeriksaan baseline

- **Ambiguitas.** Shift aktif dipisahkan dari sesi login. Pembayaran fisik, commit penjualan, dan hasil cetak diperiksa sebagai kejadian berbeda. Arti debit/kredit, prosedur setoran, kebijakan stok, dan aturan koreksi masih memerlukan validasi pengelola.
- **Duplikasi dan konflik.** Matriks §5.1 memegang ID requirement dan §5.2 memegang ID uji. Bagian alur dan matriks izin menjelaskan cara menerapkannya. Checkout dan penutupan shift memakai urutan commit yang konsisten. Target Windows dan kemampuan pengembangan lokal dicatat sebagai dua kebutuhan dengan tujuan berbeda.
- **Keterujian.** Setiap P0 memiliki skenario Given–When–Then dan sumber. Skenario perangkat, pembayaran, stok, serta SOP yang bergantung pada kondisi lapangan perlu fixture yang disahkan sebelum dinyatakan lulus uji terima. Pemeriksaan dokumen ini dilakukan sebelum implementasi.

## 12. Sinkronisasi product v0.3.1

- `DECISIONS.md` menyimpan status dan alasan keputusan; `SCOPE.md` menentukan batas P0/P1/OUT; `USER_STORIES.md` menjelaskan pekerjaan pengguna; `ACCEPTANCE_CRITERIA.md` adalah rujukan uji; `TASKS.md` mengatur pelaksanaan.
- **Istilah omzet** berarti total nilai penjualan yang sudah tercatat berhasil; bukan laba bersih, saldo rekening QRIS, atau jumlah uang laci.
- Dokumen `ARCHITECTURE.md`, `DATABASE.md`, `AUTHORIZATION.md` masih rancangan dan **wajib diperiksa** untuk dukungan status QRIS manual, koreksi stok, dan migrasi sebelum coding modul terkait. Jangan menambah kolom/endpoint hanya berdasarkan dugaan AI.
- Status dokumen: **baseline draft untuk review**, bukan persetujuan operasional atau hasil pengujian.

## 13. Aturan konflik dan keputusan lapangan

- Matriks izin §2.1 adalah batas minimum otorisasi untuk baseline ini: **hanya ADMIN** boleh koreksi stok dengan alasan dan mutasi; CASHIER tidak boleh. Kebutuhan operasional tetap memerlukan persetujuan pengelola (VAL-02/05).
- **QRIS manual bukan pembayaran otomatis**: sebelum checkout QRIS dianggap berhasil, kasir mengecek status berhasil dan nominal di kanal merchant. Bila pembayaran telah terjadi tetapi commit POS gagal, jangan langsung meminta pembayaran kedua; gunakan lookup idempotensi serta eskalasi insiden ke penanggung jawab.
- Semua rincian P0 yang masih `PROPOSED` adalah baseline implementasi yang bisa dibuat dengan data uji, **bukan izin cutover** tanpa SOP dan verifikasi lapangan. Tidak boleh menandai transaksi pengujian sebagai pembayaran riil.
- Produk dan saldo awal dapat diinput manual apabila ekspor lama tidak tersedia, tetapi **setiap produk aktif, harga, barcode, dan saldo** tetap harus direkonsiliasi dan disetujui sebelum GO.
