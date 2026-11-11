# DESIGN SYSTEM — Sistem Kasir dan Inventaris Minimarket Kampus

| Atribut | Keterangan |
|---|---|
| Path kanonis | `docs/architecture/DESIGN_SYSTEM.md` |
| Versi | 0.2.0 — 11 November 2026 |
| Status | **BASELINE UI UNTUK IMPLEMENTASI DAN UJI**, bukan bukti siap produksi |
| Menggantikan | `DESIGN_SYSTEM.md` v0.1.0; **tidak** membuat file `DESIGN.md` tambahan |
| Rujukan produk | `docs/product/PRD.md` v0.3.1, `SCOPE.md` v0.1.1, `DECISIONS.md` v0.2.3, `ACCEPTANCE_CRITERIA.md` v0.1.1 |
| Pengampu | Syafroni (UI), David (review alur), Rahmat (kontrak dan status backend), Naazmi (uji) |

## 1. Tujuan dan batas desain

Satu aplikasi desktop Windows offline-first untuk `CASHIER` dan `ADMIN`, satu PC kasir dan dua shift berurutan. Kasir harus dapat menyelesaikan pembelian kecil (misalnya Rp5.000) tanpa pendaftaran member atau isian yang tidak diperlukan. Prioritas: **kejelasan nominal, kecepatan scan, pencegahan salah bayar, dan kejelasan hasil penyimpanan**. Pilihan visual tim: **hijau sebagai identitas utama; oranye sebagai aksen**, dengan permukaan dominan putih dan netral.

Dokumen ini mendefinisikan tampilan dan perilaku UI, **bukan** mengganti otorisasi backend, skema database, API, atau aturan operasional yang masih `PENDING`. Jika dokumen ini berbeda dari `DECISIONS.md`, PRD atau `API_CONTRACT.md`, **laporkan konfliknya sebelum coding**; jangan menebak. Jangan membuat otomatisasi bank/QRIS, member, atau refund yang tidak termasuk MVP.

## 2. Prinsip tampilan

1. **Desktop operasional, bukan game:** tidak ada confetti, glow mencolok, bouncing CTA, atau animasi terus-menerus.
2. **Fokus kerja kasir:** scan dan keranjang terlihat tanpa berpindah halaman; total dan tombol bayar mudah ditemukan.
3. **Jangan hanya memakai warna** untuk menyampaikan status: selalu sertakan label teks (dan ikon bila perlu).
4. **Bahasa Indonesia sehari-hari:** `Bayar`, `Cetak ulang`, `Stok habis`, `Cek status transaksi`, bukan jargon teknis.
5. **Bukti sebelum sukses:** UI tidak boleh menganggap transaksi lunas hanya karena klik tombol, printer berhasil, atau QRIS ditampilkan.
6. **Performa pada PC terbatas:** minim efek visual; tidak ada font web wajib, gambar besar, dan komponen berat untuk data tabel.
7. **Aksesibilitas dasar:** fokus keyboard terlihat; klik utama minimal 44 × 44 px; pesan error dekat masalahnya; kontras teks diuji.

## 3. Palet dan token warna

Gunakan token semantik, bukan menyalin hex di setiap komponen. Nilai awal di bawah dapat disetel setelah uji perangkat, **tanpa mengubah fungsi warna**.

| Token | Hex | Penggunaan |
|---|---|---|
| `--color-primary` | `#267349` | Tombol utama, navigasi aktif, aksi konfirmasi aman; teks putih |
| `--color-primary-hover` | `#1F5E3B` | Hover/pressed tombol hijau |
| `--color-primary-brand` | `#2E8B57` | Identitas merek/elemen non-teks berkontras tinggi; **bukan** default tombol dengan teks putih kecil |
| `--color-primary-soft` | `#E8F5EE` | Latar aktif lembut; teks `#1F5E3B` |
| `--color-accent` | `#F28C28` | Aksen oranye dekoratif terkendali, garis penanda total; **hindari teks putih kecil di atasnya** |
| `--color-accent-dark` | `#B85A00` | Teks/ikon oranye di atas putih; label penekanan |
| `--color-accent-soft` | `#FFF1E3` | Latar chip/peringatan ringan; teks gelap |
| `--color-bg` | `#F7F9F8` | Latar aplikasi |
| `--color-surface` | `#FFFFFF` | Kartu, dialog, tabel, input |
| `--color-border` | `#D9E2DD` | Garis pemisah dan border |
| `--color-text` | `#1F2937` | Teks utama |
| `--color-text-muted` | `#6B7280` | Keterangan sekunder, tetap harus terbaca |
| `--color-success` | `#267349` | Pesan berhasil (label + ikon) |
| `--color-warning` | `#B85A00` | Peringatan, stok menipis, selisih perlu dicek |
| `--color-danger` | `#DC2626` | Gagal, stok habis, aksi destruktif |
| `--color-info` | `#2563EB` | Informasi netral, proses menunggu; tidak berarti transaksi sukses |

**Catatan aksesibilitas:** `#2E8B57` dengan teks putih memiliki kontras sekitar 4,25:1 dan `#F28C28` dengan teks putih sekitar 2,45:1; keduanya **tidak mencapai 4,5:1 untuk teks biasa**. Karena itu tombol utama berteks putih menggunakan `#267349` (sekitar 5,78:1), sementara oranye cerah dipakai sebagai aksen, bukan latar tombol berteks putih kecil. Periksa kembali kombinasi aktual di aplikasi.

### CSS token awal

```css
:root {
  --color-primary: #267349;
  --color-primary-hover: #1f5e3b;
  --color-primary-brand: #2e8b57;
  --color-primary-soft: #e8f5ee;
  --color-accent: #f28c28;
  --color-accent-dark: #b85a00;
  --color-accent-soft: #fff1e3;
  --color-bg: #f7f9f8;
  --color-surface: #ffffff;
  --color-border: #d9e2dd;
  --color-text: #1f2937;
  --color-text-muted: #6b7280;
  --color-success: #267349;
  --color-warning: #b85a00;
  --color-danger: #dc2626;
  --color-info: #2563eb;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
}
```

## 4. Tipografi, ruang dan bentuk

- **Font:** `Segoe UI`, `Inter` jika dibundel lokal, lalu `system-ui, sans-serif`. Jangan memerlukan unduhan font saat aplikasi berjalan offline.
- **Body:** 14–16 px; tabel padat 14 px; label tambahan minimal 12 px jika masih terbaca pada monitor tujuan.
- **Total dan nominal utama:** 28–36 px, berat 700; gunakan angka tabular (`font-variant-numeric: tabular-nums`). Nominal rupiah dipisahkan ribuan: `Rp5.000`.
- **Spasi:** kelipatan 4 px; standar 8/12/16/24 px. Elemen rapat hanya pada tabel, bukan tombol utama.
- **Radius:** input/tombol 10 px, kartu 14 px, chip 6 px. Hindari tombol berbentuk kapsul sebagai standar POS.
- **Bayangan:** sangat halus, maksimal satu tingkat untuk dialog/panel utama; border lebih diutamakan.
- **Gerak:** transisi hover/fokus singkat (100–150 ms), tanpa animasi berulang pada checkout, hindari efek yang menggeser layout.
- **Layout:** uji pada PC sebenarnya; 1366 × 768 menjadi target *fallback* sementara, **bukan klaim spesifikasi PC sudah diketahui**. Jika tinggi terbatas, tabel produk dapat scroll, tetapi total dan aksi bayar tetap terlihat.

## 5. Navigasi dan rancangan halaman

### 5.1 Pola navigasi

- Header ringkas: nama sistem, mode offline/lokal, pengguna, dan shift aktif.
- `CASHIER`: Kasir, Riwayat/Struk, Shift. Menu lain hanya bila diizinkan dokumen otorisasi.
- `ADMIN`: Dashboard, Barang/Stok, Penerimaan, Koreksi Stok, Laporan, Akun, Backup; hak aksi spesifik mengacu `AUTHORIZATION.md`.
- Dashboard bukan halaman wajib saat kasir login; bila shift aktif, bawa kasir ke alur scan/checkout yang sesuai.

### 5.2 Halaman kasir (prioritas pertama)

Pada desktop normal gunakan **dua area utama**:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ POS MINIMARKET      Lokal/Offline     Shift aktif • Kasir A      Akun │
├─────────────────────────────────────┬───────────────────────────────┤
│ Scan barcode / Cari barang          │ RINGKASAN BELANJA             │
│ [___________________________]       │                               │
│                                     │ 3 barang                      │
│ KERANJANG                           │ Subtotal       Rp14.000      │
│ Nama                 Qty    Subtotal│ TOTAL          Rp14.000      │
│ Roti                   1    Rp5.000│                               │
│ Mochi                  1    Rp5.000│ [ Tunai ] [ QRIS Manual ]     │
│ Air mineral            1    Rp4.000│                               │
│ ...                                 │ [ LANJUT PEMBAYARAN ]        │
│                                     │                               │
├─────────────────────────────────────┴───────────────────────────────┤
│ Pesan status yang jelas (bukan sekadar warna)                       │
└─────────────────────────────────────────────────────────────────────┘
```

Sketsa menggambarkan **hierarki informasi**, bukan ukuran piksel wajib. Aturan:

1. Saat halaman siap, fokus otomatis ke `BarcodeInput`. Scanner umumnya mengirim kode + Enter; debounce/penanganan scan hanya sesuai perilaku alat yang diuji.
2. Jika barcode tidak ditemukan, tampilkan `Barang tidak ditemukan` dan opsi pencarian manual tanpa menghapus keranjang.
3. Keranjang menampilkan nama, harga satuan saat transaksi, kuantitas, subtotal, hapus item dengan konfirmasi yang proporsional. Jika stok tidak cukup, jangan izinkan commit yang melanggar kebijakan.
4. Total kanan tetap terlihat saat keranjang panjang. Angka tidak boleh terpotong atau berubah tanpa pemberitahuan.
5. Tombol bayar mati jika keranjang kosong, shift tidak valid, harga belum disetujui, atau proses commit sedang berlangsung.
6. Jangan mengaktifkan shortcut global untuk checkout tanpa konfirmasi; Enter dari scanner hanya berarti selesai memasukkan barcode, **bukan** bayar.

### 5.3 Dialog tunai

Tampilkan `Total`, input `Uang diterima`, dan `Kembalian` yang dihitung otomatis; tidak boleh berlanjut jika nilai uang diterima kurang dari total atau bukan angka valid. Tombol `Simpan transaksi` menjalankan proses backend sesuai kontrak. Sesudah commit berhasil, tampilkan nomor transaksi dan status struk. Gagal cetak tidak membatalkan penjualan.

### 5.4 Dialog QRIS manual

1. Tampilkan total tepat dan instruksi: `Minta pelanggan membayar ke QRIS resmi minimarket`.
2. QR yang ditampilkan, jika ada, **hanya** QRIS merchant yang sudah disahkan minimarket. UI tidak membuat QR pembayaran sendiri dan tidak mengklaim terhubung ke BCA/bank.
3. Tampilkan checkbox/konfirmasi bermakna: `Saya sudah memeriksa transaksi berhasil dan nominal sesuai di aplikasi merchant`.
4. Tombol `Konfirmasi dan simpan` hanya aktif setelah konfirmasi kasir; backend tetap memeriksa sesi, shift, dan payload serta mencatat siapa/kapan verifikasi.
5. Jika pembayaran pelanggan mungkin berhasil tetapi penyimpanan/response POS tidak jelas, tampilkan **`Cek status transaksi`**. Jangan mengarahkan pelanggan membayar ulang tanpa rekonsiliasi.
6. Label di riwayat adalah `QRIS (verifikasi kasir)`, bukan `Terverifikasi bank otomatis`.

### 5.5 Dashboard ADMIN

Urutan: `Penjualan hari ini`, `Tunai`, `QRIS manual`, `Barang stok menipis`, `Barang stok habis`, kemudian tabel aktivitas atau ringkasan shift. Setiap kartu dapat memperlihatkan waktu pembaruan dari database lokal. Penjualan bukan laba bersih; gunakan label `Penjualan/Omzet`, bukan `Keuntungan`, bila tidak ada perhitungan biaya pokok yang tervalidasi.

### 5.6 Barang, penerimaan, dan koreksi stok

- Tabel: nama, SKU/barcode, harga, stok saat ini, status, aksi sesuai izin; pencarian dan filter jelas.
- `Tambah Barang` adalah tombol hijau. Stok menipis memakai label dan aksen oranye; stok habis memakai label dan merah.
- Koreksi stok oleh ADMIN memerlukan kuantitas dan **alasan wajib**, menampilkan nilai sebelum/sesudah, dan mencatat mutasi. Jangan menawarkan edit saldo stok diam-diam tanpa jejak.
- Penerimaan barang mengikuti kontrak data, bukan menambahkan pembelian, retur, atau hutang supplier baru yang belum disetujui.

### 5.7 Shift, laporan, riwayat struk, backup

- Shift: identitas kasir, jam buka, modal awal bila digunakan, total penjualan tunai/QRIS terpisah, uang fisik yang dihitung, selisih; detail formula dan izin menutup shift mengikuti PRD/DECISIONS/AUTHORIZATION.
- Laporan: filter tanggal dan shift, tabel nominal rupiah, label data kosong dan ekspor hanya bila tersedia di lingkup.
- Riwayat: tampilkan status pembayaran, nomor transaksi dan tombol cetak ulang dari data tersimpan; jangan membuat transaksi baru pada cetak ulang.
- Backup/restore: status file, waktu, lokasi dan hasil verifikasi; restore berada pada prosedur terpisah dengan konfirmasi berlapis, **bukan** satu tombol overwrite database aktif.

## 6. Komponen reusable dan state

| Komponen | Perilaku wajib |
|---|---|
| `AppShell` | Identitas user, shift, status lokal; tidak menyembunyikan peringatan kritis |
| `MoneyText` | Rupiah, tabular nums, tidak memformat angka tak valid menjadi `Rp0` diam-diam |
| `BarcodeInput` | Fokus dan Enter dari scanner, validasi kode, fallback pencarian |
| `ProductSearch` | Pencarian nama/barcode dengan empty/loading/error state |
| `CartList` | Qty, harga, subtotal, produk tidak tersedia, tombol hapus aman |
| `PaymentMethodSelector` | Hanya `CASH` dan `QRIS_MANUAL` pada MVP |
| `CashChangeCalculator` | Total, uang diterima, kembalian, input invalid |
| `QrisManualConfirmation` | Instruksi merchant, verifikasi nominal dan pelaku, bukan API bank |
| `TransactionStatus` | Bedakan belum bayar, verifikasi, menyimpan, sukses, gagal, status tidak pasti |
| `ShiftSummary` | Rekap tunai/QRIS dan selisih sesuai aturan bisnis |
| `StockBadge` | Aman, menipis, habis, teks + warna |
| `ErrorBanner` | Pesan dan tindakan lanjut aman, tidak bocorkan stack trace |
| `ConfirmDialog` | Konfirmasi tindakan bermakna, fokus keyboard, tombol batal |

### State checkout yang harus dibedakan

| State UI | Pesan singkat | Aksi yang aman |
|---|---|---|
| `READY` | `Siap menerima pembayaran` | Pilih metode |
| `VERIFYING_QRIS` | `Periksa pembayaran di aplikasi merchant` | Konfirmasi manual atau batal sebelum commit |
| `COMMITTING` | `Menyimpan transaksi…` | Kunci tombol bayar; cegah double click |
| `COMMITTED` | `Transaksi tersimpan` | Cetak struk / transaksi berikutnya |
| `PRINT_FAILED` | `Transaksi tersimpan, struk belum tercetak` | Cetak ulang transaksi yang sama |
| `UNCERTAIN` | `Status belum jelas` | Cek status transaksi dengan kunci permintaan yang sama |
| `REJECTED` | `Transaksi belum tersimpan` | Tampilkan sebab yang aman dan tindakan koreksi |

Jangan memakai `COMMITTED` sebelum backend memastikan commit. Jangan membuat retry checkout dengan identitas baru ketika status lama belum diketahui.

## 7. Aturan tombol, form, tabel, status

- **Primary:** hijau `#267349` berteks putih; satu aksi utama per dialog atau area.
- **Secondary:** putih, border `#D9E2DD`, teks gelap; contoh `Batal`, `Kembali`, `Cetak ulang`.
- **Accent:** oranye lembut untuk total, penekanan visual atau warning; jangan menandai QRIS sebagai sukses hanya karena memilih tab oranye.
- **Destructive:** merah dengan label jelas dan konfirmasi jika mengubah data penting.
- **Disabled:** tampil tidak aktif tetapi tetap punya alasan bila konteks memerlukan (mis. `Buka shift sebelum transaksi`).
- **Form:** label tetap terlihat, contoh input seperlunya, pesan validasi di dekat field, tidak hanya toast yang cepat menghilang.
- **Tabel:** sticky header jika panjang, angka rata kanan, nama rata kiri, row hover halus; pada layar sempit pilih scroll horizontal dengan header tetap jelas daripada memotong nominal.
- **Toast:** hanya notifikasi pendamping. Status transaksi utama **wajib** terlihat stabil dalam area status/dialog.
- **Icon:** membantu pemindaian, tidak mengganti label pada aksi keuangan.
- **Konfirmasi:** hindari modal berlapis atau meminta konfirmasi setiap scan barang; konfirmasi dipakai pada pembayaran/aksi berisiko.

## 8. Keyboard, scanner, printer, offline

- Alur scan dapat dilakukan tanpa mouse: fokus barcode → scan → barang masuk keranjang → scan berikutnya. Tab/Shift+Tab mengikuti urutan logis.
- Fokus yang pindah akibat modal pembayaran harus dikembalikan ke barcode setelah transaksi selesai/cancel dengan aman.
- Tampilkan fokus yang terlihat, misalnya outline hijau gelap 2 px dengan jarak 2 px; jangan hilangkan outline browser tanpa pengganti.
- Scanner barcode dan printer struk harus diuji di perangkat sebenarnya. UI tidak boleh menganggap perangkat tersedia hanya karena driver muncul.
- Internet putus tidak mematikan login lokal, scan, penjualan tunai, pencatatan QRIS manual setelah verifikasi merchant, laporan lokal atau shift. **Pembayaran QRIS eksternal tetap memerlukan layanan/koneksi sebagaimana diatur penyedia merchant.**
- Jika printer gagal sesudah commit: tampilkan status tepat, nomor transaksi, dan `Cetak ulang`. Jangan otomatis menyimpan transaksi baru.

## 9. Kondisi kosong, error dan loading

- **Belum ada barang:** `Belum ada barang. Tambahkan barang melalui menu Admin.`
- **Pencarian tidak ada:** `Barang tidak ditemukan. Periksa barcode atau cari nama barang.`
- **Stok tidak cukup:** `Stok tidak cukup untuk jumlah ini.`
- **Shift belum dibuka:** `Buka shift untuk mulai berjualan.`
- **Nominal QRIS belum diverifikasi:** `Periksa status pembayaran di aplikasi merchant dan cocokkan nominalnya.`
- **Timeout checkout:** `Status transaksi belum jelas. Cek status sebelum mencoba lagi.`
- **Backup gagal:** `Backup belum berhasil. Data lama tidak dihapus; periksa lokasi dan coba ulang sesuai prosedur.`

Pesan error teknis atau detail query hanya untuk log aman; kasir mendapat pesan tindakan, bukan stack trace.

## 10. Checklist uji UI sebelum dinyatakan siap

Tiap pengujian harus dicatat hasil, perangkat, penanggung jawab dan bukti; yang belum diuji diberi status `NOT TESTED`, bukan `PASS`.

- [ ] Kontras dan fokus keyboard terbaca pada monitor kasir yang sebenarnya.
- [ ] Layar 1366×768 (fallback) tidak memotong total, tombol bayar, maupun pesan kritis.
- [ ] Scanner mengirim barcode dan Enter tanpa mengaktifkan pembayaran secara tidak sengaja.
- [ ] Scan 10 barang berurutan tidak menghilangkan fokus atau menggandakan item di luar perilaku qty yang disepakati.
- [ ] Barang tidak dikenal, qty tidak valid dan stok kurang menampilkan pesan yang jelas.
- [ ] Tunai menghitung kembalian dan menolak nominal kurang.
- [ ] QRIS manual tidak dapat dikonfirmasi sebelum kasir mengakui verifikasi di merchant.
- [ ] Double click bayar tidak menghasilkan penjualan kedua.
- [ ] Timeout commit memakai `Cek status transaksi`, bukan `Bayar lagi`.
- [ ] Gagal cetak menunjukkan penjualan tetap tersimpan, lalu cetak ulang dengan nomor yang sama.
- [ ] Shift yang aktif tetap tampil setelah logout/restart.
- [ ] Kasir tidak bisa mengakses layar admin melalui navigasi ataupun panggilan backend langsung.
- [ ] Koreksi stok meminta alasan dan memperlihatkan perubahan yang terjadi.
- [ ] Tampilan dan alur bisa digunakan saat internet aplikasi terputus.
- [ ] Performa, scanner, printer, dan alur backup diuji di PC sebenarnya, terutama jika RAM sekitar 4 GB.

## 11. Aturan implementasi untuk Syafroni dan OpenCode

1. Implementasikan **komponen dan layout kasir terlebih dahulu** sebelum menghabiskan waktu pada visual dashboard atau animasi.
2. Semua token warna dipusatkan di stylesheet/theme, bukan hard-coded menyebar.
3. Pisahkan UI dari kontrak data; jangan membuat state pembayaran yang tidak ada di backend.
4. Untuk setiap layar, uji `loading`, `empty`, `success`, `error`, `uncertain`, dan `disabled` jika relevan.
5. Ikuti `API_CONTRACT.md`, `AUTHORIZATION.md`, `ERROR_HANDLING.md`, `TEST_CASES.md`; catat konflik ke koordinator sebelum mengubah perilaku keuangan.
6. Gunakan mock data sintetis selama pengembangan; jangan mengakses database produksi untuk percobaan desain.
7. Bukti selesai UI adalah screenshot layar, langkah uji keyboard/scanner, dan hasil uji pada ukuran layar target—bukan sekadar komponen sudah dirender.

## 12. Status keputusan desain

**Dipilih tim:** pendekatan hijau dominan dan oranye sebagai aksen; tampilan POS desktop bersih dan fungsional. **Usulan teknis yang perlu diuji:** ukuran pasti panel dan breakpoint, font akhir, posisi elemen pada monitor PC, pola navigasi admin, dan kebutuhan shortcut khusus. **Belum diverifikasi lapangan:** resolusi dan spesifikasi PC, karakter scanner, printer, serta kebiasaan kasir.

Tidak ada perubahan dalam file ini terhadap hak akses, nilai transaksi, metode pembayaran, prioritas fitur, atau kebijakan penutupan shift. Apabila keputusan terkait berubah, perbarui bersama dokumen yang menjadi sumbernya melalui review.
