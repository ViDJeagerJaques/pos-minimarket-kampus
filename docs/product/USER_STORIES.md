# USER STORIES — Sistem Kasir dan Inventaris Minimarket Kampus

| Atribut | Nilai |
|---|---|
| Lokasi | `docs/product/USER_STORIES.md` |
| Versi / tanggal | 0.1.1 / 11 November 2026 |
| Status | DRAFT untuk review; belum divalidasi pengelola |
| Owner | David; review Syafroni, Rahmat, Naazmi |
| Dasar | `CONTEXT.md` v0.1.0, `PRD.md` v0.3.1, `DECISIONS.md` v0.2.3, `SCOPE.md` v0.1.1 |

## 1. Cara memakai user stories

P0 berarti **harus diuji sebelum cutover**, bukan berarti sudah dibuat. Setiap cerita memiliki ID tetap, aktor, hasil, dan rujukan AC. Cerita di bawah adalah kebutuhan yang disimpulkan dari dokumen dan masukan koordinator; prosedur operasional yang belum dikonfirmasi tetap diberi label `VALIDASI`.

## 2. Cerita pengguna P0

| ID | Aktor | Sebagai ..., saya ingin ..., agar ... | Kriteria selesai | Rujukan |
|---|---|---|---|---|
| US-001 | CASHIER | Saya ingin login tanpa internet agar bisa mulai bekerja saat koneksi terputus. | Login sah berhasil; akun salah/nonaktif ditolak. | AC-01.01–02 |
| US-002 | ADMIN | Saya ingin mengatur akun kasir agar akses tiap petugas terkontrol. | Role diverifikasi backend; perubahan akun diaudit. | AC-01.03–04 |
| US-003 | ADMIN | Saya ingin menambah dan memperbarui barang, kategori, supplier, barcode, dan harga agar daftar jual benar. | Barcode tidak ganda; harga historis tidak berubah. | AC-02.01–03 |
| US-004 | CASHIER | Saya ingin scan barcode atau mencari barang agar melayani pembeli cepat. | Barcode valid masuk keranjang; kode tidak dikenal tidak menambah barang. | AC-03.01 |
| US-005 | CASHIER | Saya ingin membatalkan keranjang yang belum dibayar agar kesalahan input tidak menjadi transaksi. | Tidak ada penjualan, pembayaran, atau stok berubah. | AC-03.07 |
| US-006 | CASHIER | Saya ingin checkout tunai dengan total dan kembalian yang jelas agar uang kas sesuai. | Nominal sah, shift aktif, total terkonfirmasi, transaksi tercatat sekali. | AC-03.02–05 |
| US-007 | CASHIER | Saya ingin memilih QRIS dan memeriksa pembayaran di kanal merchant sebelum mengonfirmasi agar transaksi tidak dianggap lunas terlalu cepat. | Verifikasi manual wajib; nominal cocok; ada pelaku dan waktu. | AC-03.04, AC-03.09 |
| US-008 | CASHIER | Saya ingin tahu jika stok kurang atau harga berubah agar tidak menjual barang dengan nilai keliru. | Penjualan ditolak atau perlu konfirmasi harga baru. | AC-03.03, AC-03.06 |
| US-009 | CASHIER | Saya ingin hasil transaksi aman saat aplikasi macet agar pembeli tidak ditagih dua kali. | Retry identik tidak menduplikasi; status bisa dipulihkan. | AC-04.01–02 |
| US-010 | CASHIER | Saya ingin mencetak dan mencetak ulang struk agar pembeli menerima bukti tanpa transaksi kedua. | Struk berasal dari penjualan tersimpan; printer gagal tidak mengubah stok. | AC-04.03 |
| US-011 | CASHIER | Saya ingin membuka shift dan melanjutkannya setelah logout/restart agar kas tetap satu periode kerja. | Satu shift aktif; identitas dan waktu bertahan. | AC-05.01–02 |
| US-012 | CASHIER | Saya ingin melihat ringkasan tunai dan QRIS terpisah agar tahu hasil kerja saya. | Rekap cocok dengan transaksi, QRIS tidak dihitung sebagai uang laci. | AC-06.01 |
| US-013 | CASHIER | Saya ingin menutup shift dengan uang tunai yang dihitung agar selisih tercatat dan shift berikutnya bisa mulai. | Selisih sesuai SOP; penutupan idempoten; dua shift berurutan. | AC-06.01–03 |
| US-014 | ADMIN | Saya ingin mencatat barang datang agar stok bertambah dengan sumber yang jelas. | Penerimaan dan mutasi stok tersimpan atomik. | AC-07.01–02 |
| US-015 | ADMIN | Saya ingin mengoreksi stok dengan alasan agar selisih stok fisik bisa diperbaiki tanpa menghapus riwayat. | Mutasi dan audit tersimpan; CASHIER ditolak. | AC-07.03 |
| US-016 | ADMIN | Saya ingin melihat omzet harian, jumlah transaksi, per metode dan per shift agar bisa memantau penjualan. | Hanya penjualan berhasil dihitung; angka dapat ditelusuri. | AC-08.01, AC-08.03 |
| US-017 | ADMIN | Saya ingin melihat stok menipis, habis, dan riwayat mutasi agar bisa memutuskan pengadaan barang. | Ambang dan saldo akurat; mutasi dapat ditelusuri. | AC-08.02–03 |
| US-018 | ADMIN/Operator | Saya ingin membuat backup database agar data tidak hilang ketika PC bermasalah. | Backup konsisten, hasil terlihat, salinan di media terpisah. | AC-09.01 |
| US-019 | ADMIN/Operator | Saya ingin menguji pemulihan backup agar tahu data benar-benar bisa dikembalikan. | Restore salinan valid berhasil; backup rusak ditolak. | AC-09.02 |
| US-020 | Kasir/Pengelola | Saya ingin sistem berjalan di PC, scanner, dan printer yang tersedia agar bisa menggantikan sistem lama. | Installer, scan, checkout, cetak dan offline diuji nyata. | AC-10.01–02 |
| US-021 | Pengelola | Saya ingin data barang, barcode, harga, dan stok lama terbawa dengan benar agar operasional tidak mulai dari nol. | Data awal direkonsiliasi; hasil impor tidak duplikat. | AC-10.03 |
| US-022 | Pengelola | Saya ingin melihat bukti uji dan opsi kembali ke sistem lama sebelum cutover agar operasional tidak berhenti. | Semua GO/NO-GO lulus, persetujuan tercatat, rollback tersedia. | AC-GO-01 |

## 3. Cerita alternatif dan kegagalan yang wajib diperhatikan

| ID | Aktor | Sebagai ..., saya ingin ..., agar ... | Kriteria selesai | Rujukan |
|---|---|---|---|---|
| US-023 | CASHIER | Melihat status QRIS belum terverifikasi agar tidak meminta bayar dua kali. | Ada instruksi pemeriksaan kanal merchant; status tidak otomatis lunas. | AC-03.09, AC-04.02 |
| US-024 | CASHIER | Mengembalikan shift dan hasil penjualan tersimpan setelah listrik mati atau restart. | Shift bertahan; checkout yang sudah commit dapat ditemukan. | AC-04.02, AC-05.02 |
| US-025 | CASHIER | Mencetak ulang struk saat printer pulih. | Struk memakai nomor transaksi lama dan tidak menambah mutasi. | AC-04.03 |
| US-026 | CASHIER | Memperoleh prosedur eskalasi jika transaksi tersimpan ternyata salah. | Tidak ada hapus/edit langsung; instruksi SOP pengelola tersedia. | AC-03.08 |

## 4. Cerita yang ditunda (OUT/P1)

| ID | Cerita | Status | Syarat dibuka kembali |
|---|---|---|---|
| US-L01 | Member mendaftar dan memiliki piutang | OUT | Pengelola membuktikan kredit pelanggan wajib |
| US-L02 | Retur/refund/void otomatis setelah commit | OUT | SOP uang, stok, otorisasi dan audit disetujui |
| US-L03 | QRIS otomatis terhubung bank/payment gateway | OUT | Ada kerja sama resmi dan infrastruktur online |
| US-L04 | Cloud sync dan multi-PC | OUT | Desain sinkronisasi dan konflik disetujui |
| US-L05 | Ekspor laporan spreadsheet dan filter supplier/departemen rinci | P1 | P0 stabil atau dinyatakan wajib oleh pengelola |

## 5. Kebutuhan validasi operasional

Cerita terkait QRIS, modal dan setoran, kredit/retur, stok awal, pengambilalihan shift, serta format migrasi **tidak boleh diberi status Accepted oleh pengelola tanpa bukti konfirmasi**. David mencatat nama peran narasumber, tanggal, jawaban dan dampak scope. Naazmi menautkan cerita ke hasil uji; satu cerita dianggap selesai setelah AC terkait benar-benar lulus, bukan ketika kode dihasilkan AI.

## 6. Ketentuan kesiapan cerita pengguna

- Cerita `US-015` adalah pekerjaan **ADMIN** untuk koreksi stok, bukan fitur tertunda. Kasir tidak memiliki hak koreksi stok.
- Untuk `US-007`, penekanan tombol konfirmasi tidak membuktikan uang masuk; kasir perlu memeriksa kanal merchant resmi terlebih dahulu.
- `US-013`, `US-020`, `US-021`, dan `US-022` memerlukan bukti dari lapangan sebelum statusnya boleh `PASS` dalam uji terima.
