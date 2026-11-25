# UI/UX ADMIN — POS Minimarket Kampus

| Atribut | Nilai |
|---|---|
| Path rekomendasi | `docs/ui-ux/UI_UX_ADMIN.md` |
| Versi | 0.2.0 — 25 November 2026 |
| Status | Rancangan visual disetujui pengguna; review teknis tim diperlukan |
| Lingkup | Admin saja; redesign visual dan spesifikasi fitur integrasi terpisah; bukan bukti siap produksi |
| Pengampu | Syafroni (frontend), David (review), Rahmat (backend), Naazmi (QA) |

## 1. Tujuan dan sumber

Mengubah tampilan pengujian teknis menjadi antarmuka operasional desktop yang bersih, konsisten, mudah dipahami, dan efisien. Pertahankan fungsi yang sudah tersedia, SQLite sebagai sumber data utama, dan operasi offline-first. Jangan mengubah UI kasir dalam pekerjaan ini.

Acuan repository: [POS Minimarket Kampus](https://github.com/ViDJeagerJaques/pos-minimarket-kampus), branch `master` yang diperiksa dalam diskusi. Dokumen rujukan:

- [AGENTS.md](https://github.com/ViDJeagerJaques/pos-minimarket-kampus/blob/master/AGENTS.md)
- [DESIGN_SYSTEM.md v0.2.0](https://github.com/ViDJeagerJaques/pos-minimarket-kampus/blob/master/docs/architecture/DESIGN_SYSTEM.md)
- [PRD.md v0.3.1](https://github.com/ViDJeagerJaques/pos-minimarket-kampus/blob/master/docs/product/PRD.md)
- [DECISIONS.md v0.2.3](https://github.com/ViDJeagerJaques/pos-minimarket-kampus/blob/master/docs/product/DECISIONS.md)
- [SCOPE.md](https://github.com/ViDJeagerJaques/pos-minimarket-kampus/blob/master/docs/product/SCOPE.md)
- [AUTHORIZATION.md](https://github.com/ViDJeagerJaques/pos-minimarket-kampus/blob/master/docs/security/AUTHORIZATION.md)
- [SYNC_STRATEGY.md](https://github.com/ViDJeagerJaques/pos-minimarket-kampus/blob/master/docs/architecture/SYNC_STRATEGY.md)
- [BACKUP_RECOVERY.md](https://github.com/ViDJeagerJaques/pos-minimarket-kampus/blob/master/docs/security/BACKUP_RECOVERY.md)

Baca versi aktif, API_CONTRACT.md, DATABASE.md, dan kode serta tes terkait sebelum implementasi. Jika terdapat konflik, laporkan; jangan menetapkan SOP atau mengubah keputusan secara sepihak. Rancangan ini merangkum mockup dalam percakapan, bukan hasil pengujian aplikasi.

## 2. Identitas visual dan komponen bersama

Gaya: Modern Minimalist Enterprise POS. Gunakan token kanonis repo, bukan hex mockup awal. Tidak perlu membuat design system baru.

| Token | Nilai |
|---|---|
| Primary | #267349 |
| Primary hover | #1F5E3B |
| Brand | #2E8B57 |
| Primary soft | #E8F5EE |
| Accent | #F28C28 |
| Accent dark / warning | #B85A00 |
| Accent soft | #FFF1E3 |
| Background | #F7F9F8 |
| Surface | #FFFFFF |
| Border | #D9E2DD |
| Text | #1F2937 |
| Muted | #6B7280 |
| Danger | #DC2626 |
| Info | #2563EB |

Font Segoe UI atau Inter yang dibundel lokal; fallback system-ui. Judul halaman usulan 24 px semibold, section 18 px, body 14–16 px, tabel 14 px, keterangan minimal 12 px. Nominal utama 28–36 px bold, angka tabular. Gunakan spasi 4/8/12/16/24 px, radius input/tombol 10 px, card 14 px, chip 6 px. Target klik utama minimal 44 × 44 px. Target fallback desktop 1366 × 768, uji pada PC tujuan. Hindari font online wajib, gradient, efek berat, animasi berulang, dan bayangan berlebihan.

Sidebar putih dengan ikon dan label; menu aktif hijau lembut. Header menampilkan judul, deskripsi singkat, dan aksi utama. Tabel memakai header netral, pemisah ringan, nominal rata kanan, fokus keyboard jelas, pagination bila data besar (usulan 25/50 baris). Jangan mengandalkan warna saja; gunakan label status. Gunakan dialog untuk tindakan destruktif atau konfirmasi sensitif. Tooltip bukan satu-satunya tempat menyampaikan informasi penting.

### 2.1 Standar ikon (wajib)

- Gunakan ikon SVG Lucide yang konsisten, melalui library ikon yang sudah tersedia di proyek. Jika belum tersedia, ajukan review dependensi sebelum menambahkan library; ikon harus tersedia secara lokal dan tidak memerlukan internet.
- Dilarang menggunakan emoji, emotikon, karakter Unicode dekoratif, simbol keyboard, atau karakter teks sebagai pengganti ikon pada navigasi, tombol, menu aksi, indikator status, dan empty state. Gunakan komponen SVG untuk ikon tambah, pencarian, edit, menu tindakan, tampil/sembunyikan kata sandi, arah navigasi, unduh, cetak, dan status.
- Gunakan ukuran ikon 16 px untuk tabel, 20 px untuk navigasi dan tombol, serta 24–32 px untuk empty state bila diperlukan. Pertahankan stroke konsisten (usulan 2 px), warna semantik, dan label yang jelas. Tombol dengan ikon saja wajib memiliki nama aksesibel dan tooltip jika diperlukan.
- Wireframe Markdown berikut memakai label teks dan delimiter struktur, bukan ikon yang harus dirender secara literal. Jangan menerjemahkan tanda kurung siku, pemisah tabel, atau tanda matematika menjadi dekorasi UI. Pertahankan simbol matematika yang bermakna pada nilai stok dan nominal.
- Pertahankan layout, hierarki, posisi komponen, dan seluruh fungsi yang sudah disetujui. Revisi ini tidak mengubah aturan bisnis atau kontrak backend.

## 3. Navigasi Admin (penamaan sesuai koreksi pengguna)

```text
POS MINIMARKET — Administrator
  Dashboard
  Barang/Stok          # tabel katalog dan saldo stok
  Daftar Barang        # input produk, kategori, supplier, tag harga
  Penerimaan
  Koreksi Stok
  Laporan
  Akun
  Cadangan Data (Backup)
  Pengguna aktif / Keluar
```

Kelompok visual opsional: Utama, Barang & Persediaan, Pelaporan, Sistem. Akun harus tepat sebelum Cadangan Data. Nama menu Barang/Stok dan Daftar Barang tidak boleh tertukar. Gunakan tab internal untuk subfungsi; jangan menambah route atau menu redundan tanpa kebutuhan. Pertahankan akses role ADMIN dan validasi backend.

## 4. Spesifikasi halaman

### 4.1 Dashboard

Tujuan: gambaran cepat penjualan dan persediaan, bukan laporan audit lengkap.

```text
Dashboard                              [Ekspor laporan (dropdown)]
[Periode (dropdown)] [Tanggal] [Perbarui]       Waktu pembaruan
[Omzet] [Jumlah transaksi] [Stok menipis] [Stok habis]
[Metode pembayaran: donut + nominal] [Penjualan per shift]
[Produk perlu perhatian: nama, SKU, saldo, status]
```

- Empat KPI dalam satu baris pada desktop; omzet menjadi fokus hijau, lainnya permukaan putih. Gunakan warning untuk menipis dan danger untuk habis; QRIS bukan peringatan.
- Metode pembayaran: Tunai dan QRIS, nominal serta jumlah transaksi; persentase hanya bila denominator valid. Empty state jika belum ada transaksi.
- Ringkasan shift: ID/label shift, transaksi, tunai, QRIS, omzet. Produk perhatian: tautan menuju Barang/Stok bila navigasi mendukung.
- Judul periode harus mengikuti filter aktual; jangan menyebut omzet sebagai laba. Penjualan dan stok dapat memiliki waktu pembaruan terpisah. Gunakan zona operasional WIB setelah konfigurasi disepakati; jangan mengubah timestamp tersimpan.
- Ekspor CSV/Excel melalui dropdown sesuai kemampuan existing; pertahankan cakupan data dan filter.

### 4.2 Barang/Stok

Tujuan: mencari, memeriksa, dan mengelola barang yang sudah terdaftar.

```text
Barang/Stok                              [Tambah Barang]
[Total barang] [Aktif] [Menipis] [Habis]
[Cari nama/SKU/barcode] [Kategori (dropdown)] [Status (dropdown)] [Stok (dropdown)] [Reset]
Nama + SKU | Kategori | Harga jual | Stok | Status | Aksi
...                                                        
Menampilkan ... dari ...                     [Pagination]
```

- Tambah Barang membuka form pada Daftar Barang. Jangan menambah produk dari dua jalur yang berbeda secara bisnis.
- Pencarian barcode mempertahankan leading zero; gunakan filter lokal atau backend sesuai kontrak dan volume data. Barcode tetap dapat dilihat di detail/edit atau kolom opsional.
- Bedakan status akun barang aktif/nonaktif dengan kondisi stok aman/menipis/habis. Ambang stok mengikuti konfigurasi yang disepakati; jika belum ditetapkan, tampilkan status yang jujur.
- Ikon edit dan menu tiga titik untuk aksi tambahan yang sudah tersedia. Nonaktifkan barang memerlukan konfirmasi; jangan hapus histori transaksi.
- Pertahankan semua fungsi edit/barcode existing. Pindahkan tombol sinkronisasi spreadsheet ke Laporan, bukan menghapus integrasi backend.

### 4.3 Daftar Barang

Tujuan: menambahkan master barang dan mengelola data pendukung.

```text
Daftar Barang
[Tambah Barang] [Kategori] [Supplier] [Tag Harga]
[Informasi barang: nama, SKU, kategori, harga] [Supplier]
                                              [Barcode]
* Wajib diisi                                  [Reset] [Simpan]
```

- Informasi dasar di kiri, supplier dan barcode di kanan. Field wajib/opsional mengikuti kontrak existing. Harga rupiah jelas; validasi duplikat dan format di backend.
- Supplier mendukung relasi beberapa pemasok yang sudah tersedia; pencarian multi-select sebagai usulan visual bila daftar panjang. Jangan menambah relasi baru tanpa review.
- Barcode berupa string, dapat dimasukkan melalui scanner/manual. Input dinamis per barcode, tombol tambah/hapus, validasi duplikat. Pertahankan kemampuan yang sudah ada.
- Tab Kategori dan Supplier: daftar berbentuk tabel, input tambah ringkas; edit/hapus hanya bila API dan izin mendukung.
- Tab Tag Harga: pemilihan produk, pratinjau label, cetak/PDF sesuai kemampuan existing. Barcode produksi harus benar-benar dapat dipindai; mockup dekoratif bukan barcode yang valid. Pemilihan batch kategori merupakan usulan, bukan fitur terkonfirmasi.
- Stok awal tidak dicampur dengan perubahan katalog jika kontrak memisahkannya. Hilangkan catatan developer seperti “Ide 2”, endpoint, dan HTTP 403 dari tampilan umum.

### 4.4 Penerimaan

```text
Penerimaan
[Penerimaan Baru] [Riwayat Penerimaan]
[Supplier / referensi]       [Draft: nama | jumlah | aksi]
[Barang / jumlah / Tambah]   [Jenis barang / total unit]
                             [Batalkan draft] [Konfirmasi]
```

- Rasio desktop sekitar 40:60. Pilih supplier, cari barang aktif, masukkan jumlah unit positif, tambahkan ke draft; tampilkan daftar yang dapat diperiksa sebelum commit.
- Gabungkan pencarian dan pemilihan bila memungkinkan; dukung keyboard. Jumlah dapat diubah/hapus sebelum pengiriman. Referensi surat jalan hanya jika didukung kontrak (usulan).
- Draft kosong: ikon paket dan petunjuk. Tombol konfirmasi nonaktif jika draft tidak valid. Dialog menampilkan supplier, jumlah jenis, dan total unit.
- Stok belum berubah sebelum commit. Saat processing cegah klik ganda. Jika hasil tidak pasti, pertahankan receipt key dan payload identik, jangan reset draft atau mengizinkan perubahan yang menimbulkan duplikasi. Retry mengikuti backend.
- Riwayat existing berbasis mutasi RECEIPT per barang; jangan mengarang dokumen penerimaan lengkap. Tampilkan waktu, barang, kuantitas, petugas dan detail referensi. UUID lengkap tersedia di detail.

### 4.5 Koreksi Stok

```text
Koreksi Stok
[Pilih barang / informasi produk]   [Stok sebelumnya ke stok aktual]
[Stok aktual]                      [Selisih bertanda atau nol]
[Alasan koreksi]                   [Penjelasan perubahan]
                                   [Reset] [Simpan koreksi]
```

- Rasio sekitar 60:40. Stok aktual adalah jumlah akhir fisik, bukan delta. Tampilkan saldo sistem dengan jelas dan hitung delta secara langsung untuk pratinjau.
- Contoh ilustratif: 11 menjadi 8 = -3; 11 menjadi 15 = +4; 11 menjadi 11 = tidak berubah. Nilai nol valid; bilangan bulat nonnegatif jika satuan unit. Alasan wajib.
- Konfirmasi menampilkan barang, saldo lama, saldo baru, selisih dan alasan. Cegah pengiriman ganda. Backend menjadi otoritas saldo aktual; bila stok berubah selama form terbuka, minta pemeriksaan ulang sesuai kemampuan/kontrak.
- Pertahankan audit mutasi, pelaku, waktu, alasan. Tidak menambah approval berjenjang atau kategori alasan tanpa keputusan. Penanganan no-op mengikuti kontrak; usulan UI menonaktifkan simpan bila tidak ada perubahan.

### 4.6 Laporan

Empat tab internal: Pembayaran, Penjualan, Persediaan & Mutasi, Ekspor & Sinkronisasi. Ekspor mengikuti tab/dataset aktif dan filter yang benar-benar diterapkan. Jangan menampilkan ekspor sukses bila file belum dihasilkan.

**Pembayaran**

```text
[Total pembayaran] [Tunai] [QRIS]
[Distribusi nominal: stacked bar + legenda]
[QRIS manual: nomor transaksi | waktu | kasir | status | nominal]
```

- Tampilkan hanya status yang didukung data. QRIS merupakan verifikasi manual oleh kasir, bukan konfirmasi gateway; QRIS tidak menambah saldo kas fisik. Referensi bukti jika tersedia.

**Penjualan**

```text
[Tanggal mulai] [Tanggal akhir] [Shift opsional] [Tampilkan] [Reset]
[Omzet] [Transaksi] [Tunai] [QRIS]
[Ringkasan shift dan rincian yang didukung API]
```

- Validasi rentang tanggal, batas hari operasional dan ID shift. Nyatakan periode yang benar-benar dimuat. Jangan menampilkan angka demo sebagai hasil filter aktual.

**Persediaan & Mutasi**

```text
[Total produk] [Menipis] [Habis]
[Cari produk/SKU] [Status stok] [Filter lanjutan: ambang]
Produk | Awal | Masuk | Jual | Koreksi | Saldo | Detail
```

- Ambang stok ditempatkan pada filter lanjutan; perbedaan dengan dashboard harus dijelaskan atau diselaraskan melalui keputusan. Jangan menyatakan barang aman bila ambang tidak ditetapkan dan status tidak diketahui.
- Detail mutasi menggunakan panel samping: nama/SKU, saldo awal/akhir, timeline terbaru dahulu dan/atau tabel waktu, jenis mutasi, delta, saldo, petugas, referensi. Pertahankan referensi lengkap untuk audit.
- Saldo berjalan hanya dihitung jika urutan dan seluruh data mutasi diketahui; jika tidak, tampilkan data yang benar-benar tersedia. Koreksi adalah delta bertanda. Jangan menghilangkan tabel yang diperlukan audit/ekspor.

**Ekspor & Sinkronisasi**

Pusat pengelolaan laporan dengan tiga kartu vertikal, mengikuti token visual kanonis. Dashboard tetap menyediakan ekspor ringkasan existing. Tidak ada tombol sinkronisasi di Barang/Stok setelah pemindahan selesai.

```text
Laporan
[Pembayaran] [Penjualan] [Persediaan & Mutasi] [Ekspor & Sinkronisasi]

Microsoft Excel — Lokal / Offline
Perbarui workbook lokal yang sama.
[File tujuan / Belum memilih file]
[Pilih file] [Sinkronkan]

Google Sheets — Online
Pemantauan penjualan secara online.
[Status integrasi] [Transaksi tertunda]
[Konfigurasi] [Sinkronkan]

Ekspor Manual
Unduh laporan sesuai periode.
[Jenis laporan] [Periode laporan]
[Ekspor CSV] [Ekspor Excel]
```

#### A. Redesign existing — wajib pada tahap UI

- Pindahkan status, handler, dan tombol Google Sheets dari `frontend/src/pages/ProductsPage.tsx` ke Laporan, dengan reuse `getSheetsSyncStatus` dan `syncSheetsNow`. Pertahankan ADMIN-only, penanganan sesi, validasi respons, antrean, retry dan acknowledgement existing dari PR #57 dan #58.
- Kontrak status: `enabled`, `pendingCount`; hasil flush: `sentCount`, `pendingCount`, `enabled`. Tombol aktif hanya jika enabled, status berhasil dimuat dan tidak sedang sinkronisasi. Bedakan belum dikonfigurasi, memuat, gagal membaca status, siap, mengirim, sebagian terkirim, dan selesai. Enabled bukan bukti koneksi berhasil; jangan mengarang waktu sinkronisasi atau riwayat.
- Backend `backend/src/sync/sheetsSync.ts` memakai webhook HTTPS dan secret. Payload HTTP saat ini: `secret`, `saleNo`, `totalRp`, `method`, `cashier`, `committedAtMs`, `items`; `attemptKey` dipakai internal untuk antrean dan acknowledgement, bukan field payload HTTP yang terverifikasi. Jangan membangun ulang mekanisme ini pada tahap visual.
- Pertahankan ekspor penjualan CSV/XLSX existing di Dashboard dan ekspor QRIS CSV/XLSX existing di Laporan. Pusat ekspor dapat menggunakan kembali generator dan data source tersebut. Pilihan jenis laporan dan periode hanya sesuai kemampuan API yang terbukti; tampilkan batas dataset/pagination secara jujur. Ekspor manual menghasilkan file snapshot baru; jangan menyatakan berhasil jika file belum dibuat. Sanitasi formula injection.
- Kartu Microsoft Excel dan tombol Konfigurasi Google Sheets merupakan rancangan fitur baru. Pada tahap UI, tampilkan sebagai belum tersedia dengan aksi nonaktif yang jelas, atau sembunyikan hingga implementasi disetujui. Tidak ada simulasi keberhasilan menggunakan mock data pada aplikasi nyata.

#### B. Local Excel Sync — fitur baru, task/commit terpisah

- Admin memilih atau membuat satu workbook `.xlsx` melalui dialog file lokal; simpan lokasi tujuan sesuai profil aplikasi. Sinkronisasi berikutnya memperbarui file yang sama, bukan membuat file baru setiap hari. Aksi manual dahulu; otomatisasi memerlukan keputusan tambahan.
- Mulai dari dataset penjualan yang dapat diambil secara lengkap melalui API existing. Rekap harian, pembayaran, shift, stok dan mutasi merupakan perluasan setelah kontrak data, identitas baris, cakupan periode dan pagination dibuktikan. Jangan menggandakan transaksi atau menghapus histori. Gunakan identitas transaksi stabil dan kunci baris yang sesuai dataset; stok merupakan snapshot, bukan append transaksi.
- Usulan implementasi: penulisan melalui Electron main process dengan IPC terbatas dan otorisasi ADMIN yang diverifikasi; review library XLSX serta kontrak keamanan sebelum implementasi. Tidak perlu akses SQLite langsung dari renderer. Microsoft Excel tidak harus berjalan untuk menulis file.
- Hanya kelola sheet/range milik POS yang disepakati; pertahankan rumus, sheet lain dan edit manual pengelola. Jangan menerima perubahan Excel sebagai perubahan SQLite. Tolak workbook tidak kompatibel atau file terkunci; tampilkan pesan untuk menutup Excel dan mencoba kembali. Gunakan penulisan ke file sementara, validasi, penggantian aman dan pemulihan file lama jika gagal. Jangan mengklaim sukses sebelum file tersimpan.
- Tampilkan file tujuan, status belum dipilih/siap/mengirim/berhasil/gagal, dan waktu terakhir hanya jika benar-benar disimpan. Operasi lokal tidak memerlukan internet dan tidak boleh menghambat checkout atau tutup shift.

#### C. Konfigurasi Google Sheets — fitur baru, task/commit terpisah

- Temuan audit: config default `backend/config/sheets-sync.json` atau `POS_SHEETS_SYNC_CONFIG`; folder config tidak dipaketkan oleh installer existing. Jangan menyertakan secret dalam repo atau installer. Gunakan konfigurasi persisten per profil pada direktori data pengguna yang terlindungi.
- Dialog ADMIN: URL Google Apps Script HTTPS, secret token input tersamarkan, uji koneksi, simpan konfigurasi. Jangan mengirim secret kembali melalui API status, log, atau penyimpanan renderer. Batasi tujuan webhook sesuai kebijakan keamanan; validasi URL dan redirect. Uji koneksi tidak boleh mencatat transaksi palsu. Jelaskan jika restart atau reload service diperlukan.
- Receiver Apps Script belum terverifikasi di repo: siapkan dan uji penerima yang memvalidasi secret, mencegah duplikasi dengan identitas transaksi stabil dalam lingkup database/toko yang benar, dan mengembalikan `{ "ok": true }` hanya setelah penyimpanan berhasil. Retry ketika respons hilang tidak boleh menambah baris ganda. Jangan mengaktifkan integrasi nyata sebelum uji end-to-end.
- Penjualan otomatis existing tetap berjalan setelah commit saat konfigurasi valid; offline menggunakan antrean dan retry. Penutupan shift tidak menunggu cloud. Dataset tambahan, tautan workbook, riwayat sinkronisasi, sinkronisasi saat tutup shift dan multisheet adalah perluasan terpisah.
- SQLite tetap sumber kebenaran. Excel dan Google Sheets adalah salinan pelaporan, bukan backup pemulihan database. Prioritas P1 dan perluasan cloud memerlukan review scope/DEC sebelum rilis.

#### D. Isolasi sandbox dan kriteria uji integrasi

- Kerjakan di `sandbox/production-redesign` setelah checkpoint isolasi `1ac635c`. Gunakan script sandbox sesuai `docs/architecture/SANDBOX.md`; jangan menjalankan launcher biasa. Gunakan database sintetis, workbook percobaan, webhook dan secret percobaan saja. Google Sheets tetap disabled secara default. Jangan memasang installer percobaan di lingkungan existing.
- Uji perpindahan tombol, status disabled, kegagalan API, sesi habis, retry, offline, kembali online dan duplikasi; pastikan checkout tetap berhasil. Untuk fitur baru uji file terkunci, penulisan gagal, sinkronisasi berulang, pelestarian formula/sheet, receiver kehilangan respons, dan pemisahan DEMO/REAL.
- Pisahkan commit UI dari konfigurasi Sheets dan Excel Sync. Saat integrasi ke master, review perubahan per commit; jangan ikut membawa konfigurasi eksperimen secara membabi buta.

### 4.7 Akun

```text
Akun                                    [Tambah akun]
[Pengguna] [Keamanan]
[Total] [Aktif] [Nonaktif]              (opsional, ringkas)
[Cari username] [Status]
Username | Role | Status | Aksi (menu)
```

- Daftar pengguna menjadi konten utama. Tambah akun kasir melalui dialog: username, kata sandi awal, role Kasir terkunci sesuai backend. Ikon mata di dalam field; fokus keyboard dan pesan validasi jelas. Panjang password mengikuti aturan aktual backend, bukan asumsi mockup.
- Menu aksi: reset kata sandi dan nonaktifkan sesuai izin. Konfirmasi penonaktifan, pertahankan histori. Akun admin sendiri ditandai; aksi yang dilarang tidak tersedia.
- Tab Keamanan: kata sandi saat ini, baru, konfirmasi; tampilkan kecocokan dan ketentuan yang benar. Setelah perubahan berhasil, ikuti kebijakan invalidasi sesi backend dan arahkan login bila diperlukan.
- Jangan mengaktifkan role baru, hapus permanen, aktivasi ulang, permission khusus, atau akses lintas perangkat tanpa keputusan. Jangan mencatat atau menyimpan plaintext password. RBAC backend tetap wajib, bukan sekadar menyembunyikan tombol.

### 4.8 Cadangan Data

```text
Cadangan Data                            [Buat backup]
[Status cadangan | waktu terakhir | jumlah | lokasi bila diketahui]
[Riwayat: tanggal/waktu | format | status | Uji pemulihan | Menu aksi]
[Penjelasan: pengujian tidak menimpa database operasional]
```

- Nama file teknis tersedia di detail; tanggal/waktu sebagai label utama. Ukuran file, lokasi, hasil verifikasi hanya bila tersedia. Bedakan backup dibuat, terverifikasi, gagal, dan belum diuji; jangan menyimpulkan aman hanya karena file ada.
- Buat backup memakai mekanisme existing yang konsisten. Tampilkan progres dan keberhasilan berdasarkan respons aktual. Uji pemulihan menggunakan salinan terpisah, bukan database operasional. Konfirmasi tindakan dan tampilkan hasil uji aktual.
- Pertahankan kebijakan backup SQLite dan perlindungan file. Cadangan pada disk yang sama tidak melindungi dari kerusakan disk; media eksternal dan retensi membutuhkan persetujuan SOP. Backup otomatis/cloud dan restore produksi bukan bagian redesign ini tanpa review.

## 5. Perilaku lintas halaman

| Keadaan | Respons UI |
|---|---|
| Loading | Indikator lokal atau skeleton ringan; pertahankan layout |
| Empty | Jelaskan belum ada data dan aksi relevan |
| Filter tanpa hasil | Pesan tidak ditemukan dan reset filter |
| Error validasi | Pesan dekat field, fokus ke field terkait |
| Gagal API | Pesan operasional, retry bila aman; detail diagnostik terpisah |
| Akses ditolak/sesi habis | Ikuti handler existing; jangan mengungkap data internal |
| Penyimpanan berlangsung | Cegah submit ganda; jangan menyatakan sukses sebelum hasil pasti |
| Hasil commit tidak pasti | Pertahankan identitas dan data upaya, gunakan jalur pemulihan existing |
| Offline | Fungsi lokal tetap tersedia; integrasi eksternal menunjukkan status yang benar |
| Form belum disimpan | Peringatan sebelum meninggalkan jika relevan; jangan menghapus draft sensitif |

## 6. Implementasi dan QA

1. Audit route, komponen, CSS tokens, data source, API, dan tes pada checkout terbaru. Cocokkan POS/AC/DEC yang relevan; catat konflik. Buat rencana dan minta review sebelum perubahan lintas modul.
2. Rapikan shell Admin dan komponen bersama tanpa mengubah Kasir; gunakan styling scoped bila diperlukan. Pertahankan perilaku, aksesibilitas dan routing existing.
3. Implementasikan Dashboard, Barang/Stok, Daftar Barang, Penerimaan, Koreksi Stok, Laporan, Akun, Cadangan Data secara bertahap. Jalankan regresi per tahap.
4. Pindahkan UI spreadsheet menggunakan API existing sesuai §4.6 A. Local Excel Sync dan konfigurasi Google Sheets mengikuti §4.6 B–D sebagai task/commit terpisah. Jangan menambah dependency atau mengubah kontrak tanpa review.
5. QA pada data sintetis di sandbox sesuai SANDBOX.md dan kemudian PC target; dokumentasikan perintah, hasil dan keterbatasan. Commit/push hanya atas instruksi eksplisit.

### Checklist penerimaan desain (usulan, bukan hasil tes)

- [ ] Delapan menu memiliki nama dan urutan yang benar; Akun sebelum Cadangan Data.
- [ ] Token visual kanonis, font lokal, fokus keyboard, ukuran klik dan keterbacaan pada 1366 × 768.
- [ ] Semua ikon UI berupa SVG konsisten dan tersedia offline; tidak ada emoji atau simbol keyboard sebagai ikon. Tombol ikon memiliki nama aksesibel. Wireframe tidak dirender sebagai karakter dekoratif.
- [ ] Dashboard mengikuti filter aktual; nominal dan metode pembayaran konsisten dengan laporan.
- [ ] Barang/Stok mempertahankan pencarian, barcode, edit, status, serta akses fungsi yang ada.
- [ ] Daftar Barang mempertahankan input produk, kategori, supplier, dan tag harga.
- [ ] Penerimaan dan koreksi lolos validasi, konfirmasi, kegagalan, retry dan pencegahan mutasi ganda.
- [ ] Laporan mempertahankan dataset, filter, ekspor, dan rincian mutasi yang didukung.
- [ ] Spreadsheet: status disabled tanpa konfigurasi, flush ketika enabled, kegagalan/antrean terlihat, retry tanpa duplikasi; operasi lokal tidak terhambat.
- [ ] Ekspor manual existing mempertahankan filter dan cakupan data; tidak ada tombol sinkronisasi di Barang/Stok.
- [ ] Fitur baru (jika diimplementasikan): workbook yang sama diperbarui tanpa duplikasi, kegagalan tidak merusak file, dan konfigurasi Sheets tidak bocor; uji end-to-end terpisah.
- [ ] Akun: backend menolak role tidak sah, validasi password dan sesi tidak mengalami regresi.
- [ ] Backup dan uji pemulihan tidak menimpa database operasional; status sesuai hasil nyata.
- [ ] Semua halaman memiliki loading, empty, error, dan feedback yang sesuai.
- [ ] Tidak ada perubahan tak disetujui pada API, database, aturan bisnis, scope, atau UI Kasir.
- [ ] Tes existing dan regresi relevan lulus; bukti uji dicatat, bukan hanya klaim visual.

## 7. Batasan dan keputusan terbuka

Rancangan layout dan penamaan telah disetujui pengguna dalam diskusi. Token mengikuti dokumen repository, bukan palet awal mockup. Statistik, filter tambahan, pagination, drawer, surat jalan, dan konfigurasi spreadsheet UI merupakan usulan bila belum tersedia. Audit sebelumnya hanya membaca dokumen dan sebagian source code, belum menjalankan aplikasi atau tes, memeriksa perangkat nyata, maupun menguji webhook. Status SOP, prioritas P1, dan perubahan kontrak memerlukan review tim. Tidak ada klaim siap pilot. Dokumen ini tidak menggantikan DESIGN_SYSTEM.md atau keputusan produk.

## 8. Riwayat revisi

| Versi | Perubahan |
|---|---|
| 0.1.0 | Rancangan awal delapan menu Admin berdasarkan review screenshot dan repository. |
| 0.1.1 | Standar ikon SVG wajib; hapus simbol dekoratif dari wireframe; tambah kriteria QA ikon. Layout, navigasi, fungsi dan batas backend dipertahankan. |
| 0.2.0 | Finalisasi Ekspor & Sinkronisasi: pemindahan Sheets existing, Local Excel Sync dan konfigurasi Sheets sebagai fitur baru terpisah, ekspor manual, isolasi sandbox dan QA integrasi. Pertahankan desain seluruh halaman lain. |
