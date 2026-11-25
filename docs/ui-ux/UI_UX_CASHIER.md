# UI/UX CASHIER - POS Minimarket Kampus

| Atribut | Nilai |
|---|---|
| Versi | 0.1.0 |
| Status | Rancangan visual disepakati; review teknis diperlukan |
| Lokasi | `docs/architecture/UI_UX_CASHIER.md` |
| Lingkup | Empat menu kasir dan seluruh state transaksi |
| Konsep | Minimalist Transaction Workspace - Less UI, Faster Checkout |

## 1. Acuan dan batasan
Berdasarkan screenshot aplikasi dan mockup yang dibahas bersama pengguna. Baca AGENTS.md, DESIGN_SYSTEM.md, PRD.md, DECISIONS.md, SCOPE.md, API_CONTRACT.md, DATABASE.md, AUTHORIZATION.md, BACKUP_RECOVERY.md dan SYNC_STRATEGY.md versi aktif di repository sebelum implementasi. Jangan mengubah kontrak API, aturan bisnis, database atau otorisasi secara sepihak. Login didokumentasikan di UI_UX_AUTH.md. Pertahankan operasi offline-first dan SQLite sebagai sumber data utama. Seluruh nominal contoh adalah data DEMO, bukan data operasional.

## 2. Standar visual
Gunakan DESIGN_SYSTEM.md sebagai sumber token kanonis. Primary #267349; hover #1F5E3B; soft #E8F5EE; background #F7F9F8; surface #FFFFFF; border #D9E2DD; text #1F2937; muted #6B7280; warning #B85A00; danger #DC2626; info #2563EB. Font Inter lokal atau Segoe UI. Radius input/tombol 10 px, card 14 px. Spacing 4/8/12/16/24 px. Target desktop 1366 x 768. Target klik utama minimal 44 x 44 px. Tabel 14 px, label minimal 12 px, angka tabular, nominal rata kanan. Gunakan Lucide SVG lokal dengan label aksesibel, ukuran 16-24 px dan stroke konsisten. Dilarang menggunakan emoji, karakter keyboard sebagai ikon, font ikon online, gradient dekoratif atau animasi berat. Shortcut keyboard ditulis sebagai teks biasa.

## 3. Navigasi dan shell
Header ringkas: identitas POS, satu status shift yang konsisten, identitas kasir dan Keluar. Banner DEMO ringkas tetapi jelas bahwa bukan transaksi uang sungguhan. Navigasi horizontal dalam urutan Kasir, Riwayat/Struk, Shift, Ganti Sandi. Tidak ada sidebar. Layar Pelanggan dinonaktifkan untuk MVP: sembunyikan aksi dan akses normal, pertahankan kode yang sudah ada jika memungkinkan; jangan menghapus fungsi permanen tanpa review. Status lokal harus dibedakan dari koneksi internet. Jangan tampilkan attempt key, payload, HTTP status atau istilah debug sebagai pesan operasional; simpan informasi teknis untuk diagnosis internal.

## 4. Kasir - pembukaan shift
Jika belum ada shift aktif milik kasir, tampilkan card pembukaan shift terpusat dalam area kerja. Judul Buka shift, deskripsi singkat, input modal awal dengan fokus otomatis, tombol Buka shift. Modal awal opsional sesuai perilaku backend saat ini; jelaskan nilai kosong atau nol hanya setelah diverifikasi. Area transaksi dan pembayaran belum dapat digunakan. Jangan menampilkan semua form transaksi aktif bersamaan. Setelah backend memastikan shift dibuka, tampilkan status aktif dan fokus ke scan. Jika gagal, pertahankan input dan tampilkan pesan jelas; cegah submit ganda.

## 5. Kasir - workspace utama
Layout desktop 65:35. Gunakan ruang layar secara efektif, tanpa dashboard KPI atau grafik. Panel checkout tetap terlihat; keranjang menjadi area scroll utama jika item banyak. Tinggi input scan 48-52 px, tombol Bayar 52-56 px, baris keranjang 56-64 px.

| Kiri (65%) | Kanan (35%) |
|---|---|
| Scan atau cari barang (F2) | Ringkasan belanja |
| Dropdown hasil hanya ketika diperlukan | Subtotal dan diskon |
| Keranjang: barang, harga, jumlah, subtotal, aksi | Total belanja besar 40-48 px |
| Peringatan tepat di baris yang bermasalah | Pilihan Tunai / QRIS |
| Batal draft di bagian bawah | Bayar [nominal] (F9) |
| Status draft ringkas | Promo dan pelanggan (collapsible) |

Contoh layout dari screenshot terakhir: Teh Kemasan 350 ml, 8 unit x Rp4.000 = Rp32.000; Air Mineral Botol 600 ml, 32 unit x Rp3.000 = Rp96.000; total 40 unit Rp128.000. Jangan menyimpulkan batas stok sebenarnya dari jumlah contoh.

### 5.1 Scan dan pencarian
Usulan satu input scan/nama/SKU. Uji dengan scanner fisik dan perilaku Enter; jika penggabungan mengganggu alur existing, pertahankan dua input dengan scan sebagai fokus utama. Scan barcode valid menambah barang sesuai validasi, barcode tidak dikenal menampilkan pesan dan mengembalikan fokus. Dropdown ringkas menampilkan nama, SKU, harga, status stok dan aksi Tambah; item aktif disorot. Panah atas/bawah memilih, Enter menambah item yang dipilih, Esc menutup dropdown. Jangan mengizinkan penambahan barang habis atau nonaktif. Tutup dropdown setelah barang ditambah. Jangan menampilkan hasil pencarian, modal pembayaran dan pembukaan shift bersamaan.

### 5.2 Keranjang
Nama barang dominan, SKU di bawah; kontrol jumlah mudah diklik, subtotal jelas, aksi hapus memakai Lucide Trash2 dengan label aksesibel. Tampilkan jumlah jenis dan unit secara terpisah. Potongan harga tetap tersedia jika didukung; jangan menyembunyikan diskon yang memengaruhi total. Batal draft memerlukan konfirmasi bila berisi barang. Keranjang kosong memberi instruksi scan/cari dan tombol bayar nonaktif.
- Jika penambahan melebihi stok, tolak penambahan dan beri peringatan pada baris barang; keranjang yang masih valid tetap dapat dibayar.
- Jika jumlah keranjang sudah melebihi stok terkini, blokir checkout sampai diperbaiki dan divalidasi ulang.
- Harga, promo, jumlah dan stok harus diverifikasi backend; total frontend hanya representasi.
- Promo lokal DEMO dan kode pelanggan/poin tetap tersedia dalam bagian opsional yang dapat dibuka; jangan menambah aturan promo baru.

### 5.3 Checkout dan keyboard
Total dominan, pilihan metode berupa dua tombol yang jelas. QRIS diberi keterangan manual pada alur terkait. F2 fokus scan/cari, F9 membuka pembayaran jika valid, Esc kembali dari pembayaran sebelum penyimpanan dimulai, Enter konfirmasi hanya ketika form valid dan fokus tepat. Jangan mengganggu pengetikan input. Setelah transaksi tersimpan dan kasir menyelesaikan layar hasil, reset draft dan fokus kembali ke scanner. Uji shortcut di aplikasi desktop.

## 6. Modal pembayaran Tunai
Modal terpusat, lebar usulan 420-480 px, latar workspace diredupkan dan tidak interaktif. Judul Pembayaran Tunai. Total besar, rincian belanja dapat dibuka (default tertutup), input Uang diterima (Rp) autofocus. Nominal cepat dalam grid seragam: Uang pas dan pecahan relevan (mis. Rp10.000, Rp20.000, Rp50.000, Rp100.000); reset input. Jangan memberi kesan pecahan yang lebih kecil mencukupi.
| Kondisi | Tampilan | Aksi konfirmasi |
|---|---|---|
| Kosong | Kembalian belum tersedia, petunjuk netral | Nonaktif |
| Kurang | Uang kurang dengan nominal kekurangan | Nonaktif |
| Pas | Kembalian Rp0 | Aktif jika valid |
| Lebih | Kembalian besar dan jelas | Aktif jika valid |

Contoh: total Rp15.000, diterima Rp20.000, kembalian Rp5.000. Validasi nominal integer nonnegatif sesuai aturan mata uang proyek; jangan diam-diam mengubah input tidak valid. Footer Batal dan Konfirmasi pembayaran. Hindari istilah Commit. Pertahankan nominal kembalian pada layar hasil. Cegah klik ganda.

## 7. Modal pembayaran QRIS manual
Gunakan pola visual sama dengan Tunai. Total besar, status Menunggu verifikasi kasir, rincian belanja collapsible, instruksi singkat untuk memeriksa pembayaran berhasil dan nominal pada aplikasi merchant. Checkbox verifikasi wajib kosong setiap transaksi baru. Referensi bukti tetap opsional sesuai aturan existing. Tombol Konfirmasi pembayaran baru aktif setelah verifikasi. QRIS tidak otomatis lunas, tidak masuk kas fisik, dan tidak menampilkan QR dinamis atau konfirmasi bank palsu. Enter tidak boleh melewati verifikasi. Jangan meminta pembayaran ulang jika status penyimpanan belum pasti.

## 8. State penyimpanan pembayaran
| State | Perilaku |
|---|---|
| Sebelum submit | Boleh kembali dan mengoreksi draft sesuai aturan |
| Menyimpan | Kunci aksi ganda dan perubahan draft/metode |
| Tersimpan | Tampilkan sukses hanya setelah backend memastikan commit |
| Belum pasti | Pertahankan attempt key dan payload; periksa status/retry sesuai kontrak existing; jangan minta bayar ulang |
| Gagal | Jelaskan pemulihan yang tersedia, terutama jika pembayaran fisik telah terjadi |

Pertahankan idempotency, quote pricing dan validasi backend. Jangan menghapus draft atau mengizinkan transaksi baru secara sembarangan saat status belum pasti.

## 9. Transaksi berhasil dan cetak struk
Modal ringkas: judul Transaksi berhasil, nomor penjualan dan metode, total, uang diterima dan kembalian untuk Tunai; QRIS tampilkan metode dan verifikasi manual tanpa kembalian tunai. Rincian/pratinjau struk tertutup secara default. Aksi Cetak struk (sekunder), Transaksi baru (utama). Setelah cetak berhasil, ubah label menjadi Cetak ulang sesuai status aktual. Menu tiga titik berisi Muat ulang struk, Salin teks dan Faktur Pajak (Simulasi DEMO). Tampilkan status pencetakan dengan tepat.
Pratinjau menyerupai struk thermal: identitas toko, nomor penjualan, waktu, kasir, shift, item, kuantitas, harga historis, total, metode, nominal tunai/kembalian bila relevan, penanda asli/cetak ulang dan disclaimer DEMO. Gunakan data transaksi tersimpan; jangan mengubah format printer tanpa uji perangkat.
Jika printer gagal, transaksi tetap tersimpan bila commit berhasil. Tampilkan pesan, pilihan cetak ulang dan transaksi baru sesuai prosedur. Jangan melakukan pembayaran ulang. Mode virtual harus ditandai sebagai virtual; printer fisik belum diuji berdasarkan screenshot. Tidak perlu membuka pratinjau sebelum mencetak. Pertahankan fallback salin teks. Faktur pajak tetap simulasi, bukan dokumen perpajakan resmi.

## 10. Riwayat/Struk
Judul Riwayat & Struk; deskripsi singkat. Toolbar pencarian nomor penjualan atau ID transaksi, tombol reset, filter metode (usulan). Pertahankan kemampuan lookup transaksi historis yang diizinkan backend; jangan membatasi pencarian hanya pada data hari ini jika endpoint mendukung lebih luas. Tabel transaksi hari ini dengan tanggal dan urutan terbaru sesuai data. Kolom nomor penjualan, waktu, metode, total, aksi Lihat struk dan ikon printer. Nomor penjualan juga dapat membuka detail. Tanpa KPI/grafik. Loading, kosong, tidak ditemukan, error dan coba lagi harus tersedia. Filter metode dan shortcut cetak ulang perlu diverifikasi terhadap kode.
Contoh data screenshot: S-000204 Rp15.000 Tunai; S-000203 Rp40.000 QRIS manual; S-000202 Rp22.000 Tunai; S-DEMO-000201 Rp6.000 Tunai. Jangan memperluas cakupan akses kasir.

### 10.1 Popup struk historis
Modal 640-720 px, maksimal satu area scroll, header/footer tetap mudah dijangkau. Nomor transaksi, waktu, status tersimpan, shift, metode dan total dominan. Tabel: barang (SKU di bawah nama), qty, harga historis, subtotal. Ringkasan pembayaran di bawah. Pratinjau dapat dibuka; ketika terbuka di desktop gunakan dua kolom, rincian di kiri dan struk thermal di kanan. Aksi utama Cetak ulang (atau Cetak struk bila belum pernah dicetak), sekunder Tutup, menu tiga titik untuk fallback dan aksi DEMO. Berbeda dari modal pascapembayaran, tidak ada tombol Transaksi baru. Gunakan kembali komponen struk bersama. Cetak ulang tidak membuat transaksi/mutasi stok baru. Jangan menambahkan void, refund, hapus transaksi tanpa keputusan bisnis.

## 11. Shift - penutupan
Layout desktop 50:50, header Shift aktif dan identitas, waktu pembukaan, tombol Perbarui. Ringkasan kiri: modal awal, penjualan tunai, penjualan QRIS, total penjualan (bukan laba), saldo kas seharusnya. Rekonsiliasi kanan: input Uang tunai aktual, selisih otomatis, catatan/alasan jika tidak sesuai. Rincian QRIS shift ini collapsible di bawah. Tombol Tutup shift di kanan bawah.
Contoh Shift #102: modal Rp10.000, tunai Rp15.000, QRIS Rp0, total Rp15.000, saldo kas seharusnya Rp25.000. Rumus DEMO: modal awal + penjualan tunai; selisih = kas aktual - kas seharusnya. Jangan menetapkan rumus setoran final sebelum SOP disahkan.
| Kas aktual | Selisih | Status |
|---|---|---|
| Rp25.000 | Rp0 | Kas sesuai, hijau |
| Rp20.000 | -Rp5.000 | Kas kurang, merah |
| Rp50.000 | +Rp25.000 | Kas lebih, peringatan |

Kas lebih bukan laba. Alasan wajib untuk selisih merupakan rancangan yang harus diselaraskan dengan aturan backend/SOP. Dialog konfirmasi menampilkan nominal dan alasan. Validasi ulang ringkasan saat close; jika berubah minta kasir memeriksa ulang. Tangani draft dan pembayaran belum pasti sebelum penutupan sesuai kontrak. Cegah close ganda. Setelah backend memastikan berhasil, tampilkan ringkasan akhir (total, QRIS, kas aktual, selisih), status shift tertutup dan arah kembali ke Kasir/pembukaan shift sesuai alur existing. Layar sukses ini adalah usulan, belum ada screenshot.
Temuan untuk audit: header mengatakan shift belum terhubung padahal #102 aktif; ringkasan QRIS Rp0 sementara rincian QRIS Rp40.000. Periksa cakupan ID shift dan sumber status. Jangan memasukkan Rp40.000 ke shift #102 tanpa verifikasi. Jika rincian memang seluruh hari, beri label jelas atau filter shift sesuai dukungan backend. Backup/sinkronisasi jika sudah didukung tidak boleh menghambat close lokal karena jaringan; jangan membuat fitur baru tanpa persetujuan.

## 12. Ganti Sandi
Card terpusat 480-520 px, tanpa card bertingkat. Identitas akun dan role kasir, tiga field: Kata sandi saat ini, Kata sandi baru, Konfirmasi kata sandi baru. Ikon Eye/EyeOff di dalam field kanan; tersembunyi secara default. Indikator panjang minimal (contoh 8 karakter, verifikasi kebijakan aktif) dan konfirmasi cocok. Tombol Reset dan Simpan kata sandi. Pemberitahuan bahwa semua sesi berakhir setelah perubahan berhasil; dialog konfirmasi sebelum submit. Backend memverifikasi kata sandi lama dan role/identitas. Jangan menyimpan kata sandi/log. Tangani draft atau status pembayaran belum pasti sebelum pengakhiran sesi. Setelah sukses, arahkan login sesuai UI_UX_AUTH.md. Gunakan komponen yang sama dengan keamanan akun Admin.

## 13. State bersama dan aksesibilitas
Tampilkan loading lokal, tombol disabled dengan alasan, error dekat field terkait, empty state dengan instruksi singkat, dan sukses berdasarkan respons aktual. Gunakan label selain warna, fokus keyboard terlihat, urutan Tab logis, dialog focus trap dan pengembalian fokus. Hindari scrollbar bersarang; footer aksi modal tetap terjangkau. Pesan keberhasilan ringan dapat hilang otomatis; error kritis atau status belum pasti harus tetap terlihat. Tidak ada emoji atau simbol keyboard sebagai ikon.

## 14. Acceptance checklist
- [ ] Empat menu dalam urutan yang disepakati; Login terpisah; Layar Pelanggan tidak muncul.
- [ ] Layout 65:35 checkout dan 50:50 shift terbaca pada 1366 x 768.
- [ ] Shift belum aktif tidak mengizinkan transaksi; status header konsisten.
- [ ] Scanner fisik, pencarian manual, keyboard dan stok habis diuji.
- [ ] Penambahan melebihi stok dibedakan dari keranjang tidak valid.
- [ ] Promo/poin existing tetap tersedia, nominal dan diskon sesuai backend.
- [ ] Tunai kosong/kurang/pas/lebih dan QRIS manual diverifikasi.
- [ ] Retry dan status belum pasti tidak menyebabkan pembayaran atau commit ganda.
- [ ] Cetak fisik/virtual, kegagalan printer dan cetak ulang diuji tanpa mutasi stok tambahan.
- [ ] Riwayat memakai harga historis dan otorisasi existing.
- [ ] Shift sesuai/kurang/lebih, perubahan ringkasan, QRIS per shift dan penutupan ganda diuji.
- [ ] Ganti sandi memverifikasi backend, mengakhiri sesi, tidak membocorkan kredensial.
- [ ] Offline lokal tetap berjalan; aset SVG dan font tersedia lokal.
- [ ] Regression tests frontend/backend lulus sebelum dianggap selesai.

## 15. Implementasi
Audit kode dan dokumen aktif, buat implementation plan, review tim, implementasi bertahap, uji perangkat dan regresi. Jangan mengubah Admin atau Login sebagai bagian dari perubahan Kasir kecuali komponen bersama yang disetujui. Tidak ada commit/push tanpa persetujuan. Rancangan ini bukan bukti implementasi atau pengujian dan tidak menyertakan mockup pixel-perfect.
