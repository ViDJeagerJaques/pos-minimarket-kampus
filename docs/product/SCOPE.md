# SCOPE — Batas Rilis Sistem Kasir dan Inventaris Minimarket Kampus

| Atribut | Nilai |
|---|---|
| Lokasi | `docs/product/SCOPE.md` |
| Versi / tanggal | 0.1.1 / 11 November 2026 |
| Status | DRAFT — baseline usulan tim, belum disetujui pengelola |
| Owner | David (koordinator), review Rahmat, Syafroni, Naazmi |
| Referensi | `CONTEXT.md` v0.1.0; `PRD.md` v0.3.1; `DECISIONS.md` v0.2.3 |

## 1. Sasaran dan batas waktu

Sistem menggantikan langganan POS lama **ditargetkan** dalam 14 hari sejak 11 November 2026, yaitu sekitar **25 November 2026**. Langganan dilaporkan habis pada Desember 2026; tanggal pastinya belum diketahui. Sasaran 14 hari adalah target, **bukan izin untuk melewati uji keselamatan transaksi atau persetujuan pengelola**. Satu PC Windows, dua shift berurutan, dua role (`ADMIN`, `CASHIER`), SQLite lokal, dan transaksi tunai yang berjalan tanpa internet adalah batas produk.

## 2. P0 — harus tersedia dan terbukti sebelum cutover

| ID | Area | Batas minimal rilis | Rujukan |
|---|---|---|---|
| S-01 | Akses | Login lokal, akun aktif/nonaktif, kontrol role dan shift di backend | POS-01.* |
| S-02 | Master | Admin mengelola produk, barcode unik, harga, kategori dan supplier minimal; impor/input data awal | POS-02.*, POS-10.03 |
| S-03 | Kasir | Scan barcode atau cari manual, keranjang, batal draft, total, checkout tunai dan uang kembalian bila berlaku | POS-03.01–03.08 |
| S-04 | QRIS manual | Pilihan QRIS, pembayaran melalui merchant eksternal, verifikasi nominal dan status berhasil oleh kasir sebelum commit, catat petugas/waktu | POS-03.04, POS-03.09 |
| S-05 | Integritas | Penjualan, pembayaran, item dan pengurangan stok satu commit SQLite; idempotency/retry dan pemulihan setelah restart | POS-03.05, POS-04.01–02 |
| S-06 | Struk | Cetak dari penjualan tersimpan, cetak ulang tanpa membuat penjualan kedua | POS-04.03 |
| S-07 | Shift | Satu shift aktif, dua shift berurutan, modal awal, penutupan eksplisit, rekap tunai/QRIS terpisah, selisih tunai | POS-05.*, POS-06.* |
| S-08 | Stok | Stok awal, penerimaan barang, blokir stok negatif, koreksi ADMIN dengan alasan/audit, riwayat mutasi | POS-03.06, POS-07.*, POS-08.02 |
| S-09 | Laporan admin | Omzet hari ini, jumlah transaksi, per metode, per shift, stok menipis/habis dan histori dasar | POS-08.01–03 |
| S-10 | Pemulihan | Backup SQLite konsisten ke media terpisah, uji restore di lingkungan lain, tidak hanya ekspor spreadsheet | POS-09.* |
| S-11 | Distribusi | Paket desktop Windows berjalan di PC tujuan dengan scanner/printer, termasuk saat offline | POS-10.01–02 |
| S-12 | Migrasi dan cutover | Barang/barcode/harga/stok direkonsiliasi; uji paralel, persetujuan pengelola, prosedur kembali ke sistem lama | POS-10.03, DEC-021 |

**Kriteria batas:** Semua P0 adalah kebutuhan **baseline rancangan** untuk cutover, bukan bukti fitur telah tersedia. Jika operasional nyata membutuhkan fitur lain, jangan diam-diam menandainya selesai; evaluasi perubahan scope dan jadwal.

## 3. P1 — dikerjakan setelah P0 stabil, kecuali terbukti wajib

- Ekspor CSV/Excel laporan penjualan, shift dan stok (berguna, **bukan backup database**).
- Filter laporan supplier/departemen yang lebih rinci; definisi departemen masih belum jelas.
- Scan opname massal dan tampilan admin lanjutan.
- Perbaikan estetika dashboard, grafik dan optimasi non-kritis.

## 4. OUT — tidak dibangun untuk rilis 14 hari

| Fitur | Alasan penundaan | Kapan ditinjau ulang |
|---|---|---|
| Registrasi member dan piutang/kredit pelanggan | Pengelola belum menyatakan kebutuhan wajib; menambah alur checkout dan risiko akuntansi | Jika ditemukan transaksi kredit yang memang berjalan |
| Retur, refund, void transaksi tersimpan secara otomatis | Butuh SOP uang, stok, dan audit; draft keranjang tetap boleh dibatalkan | Jika proses harian mewajibkan koreksi setelah bayar |
| QRIS dinamis/otomatis, integrasi API bank/gateway, webhook | Butuh kontrak merchant, internet, pengujian keamanan dan rekonsiliasi | Setelah POS dasar stabil |
| Cloud sync, Supabase, multi-PC, akses admin jarak jauh | Meningkatkan kompleksitas sinkronisasi dan otorisasi | Fase lanjutan |
| Kiosk Windows, promosi/loyalty, fitur cabang | Bukan kebutuhan inti satu PC | Fase lanjutan |

**Pengecualian penting:** Fitur OUT tidak boleh diabaikan jika pengelola membuktikan bahwa proses itu wajib untuk operasional hari pertama. Dalam kasus tersebut, target 14 hari perlu ditinjau, bukan memaksakan sistem yang tidak bisa melayani pembeli.

## 5. Kebijakan sementara untuk implementasi (belum SOP final)

1. **Tunai:** jumlah uang diterima dan kembalian ditampilkan; transaksi tidak boleh tersimpan sebelum input dan konfirmasi valid.
2. **QRIS manual:** POS tidak membuat QRIS dan tidak membaca notifikasi bank. Kasir memeriksa nominal serta status pembayaran di aplikasi/riwayat merchant resmi; bila belum jelas, status belum lunas dan transaksi tidak di-commit sebagai penjualan berhasil. Catat siapa dan kapan memverifikasi. Jangan menyimpan PIN atau kredensial bank.
3. **Shift:** satu shift aktif per PC; logout atau restart tidak menutupnya. QRIS dilaporkan terpisah dari uang tunai fisik. Formula setoran mengikuti DEC-016 dan wajib disetujui pengelola.
4. **Stok:** penjualan yang melebihi stok ditolak; koreksi oleh ADMIN harus menghasilkan mutasi dengan alasan, waktu, dan identitas.
5. **Transaksi salah:** keranjang sebelum checkout boleh dibatalkan. Penjualan tersimpan tidak boleh dihapus atau diedit langsung; penanganan insiden memerlukan SOP pengelola.
6. **Backup:** SQLite backup API/snapshot konsisten; uji restore dan simpan salinan di media lain. Excel/CSV hanya ekspor data/laporan.

## 6. Validasi yang wajib dilakukan — bukan boleh diasumsikan

| ID | Pertanyaan / bukti | PIC | Status |
|---|---|---|---|
| VAL-01 | QRIS atas nama siapa, aplikasi merchant apa, bukti status berhasil dan SOP salah nominal | David + pengelola | BLOCKER |
| VAL-02 | Adakah member kredit, retur, refund, debit/kredit lain yang digunakan sehari-hari? | David + pengelola | BLOCKER |
| VAL-03 | Data sistem lama dapat diekspor? Format, jumlah SKU, barcode, harga, stok, produk tanpa barcode | David + pengelola | BLOCKER |
| VAL-04 | Spesifikasi PC, scanner, printer, driver dan hasil uji | Naazmi + Rahmat | BLOCKER |
| VAL-05 | Modal awal, setoran, selisih, shift berganti, siapa menyetujui koreksi | David + pengelola | BLOCKER |
| VAL-06 | Lokasi, frekuensi, akses backup, hasil restore dan media eksternal | Rahmat + Naazmi | BLOCKER |
| VAL-07 | Apakah supplier/departemen wajib di laporan sejak hari pertama? | David + pengelola | BLOCKER scope |
| VAL-08 | Tanggal akhir langganan, kesempatan uji paralel dan perpanjangan darurat | David + pengelola | BLOCKER |

## 7. Gerbang GO/NO-GO

**GO hanya jika**: SOP pembayaran/shift disetujui; seluruh SKU aktif dan saldo awal cocok; checkout tunai/QRIS manual teruji; penjualan tidak ganda dan stok konsisten; dua shift, printer, scanner, offline, restart, backup dan restore teruji pada PC tujuan; tidak ada bug kritis; kasir/pengelola menandatangani uji terima; dan rollback tersedia. Semua harus memiliki bukti, bukan status "AI sudah membuat kode".

**NO-GO jika satu syarat gagal.** Minta perpanjangan sistem lama atau jalur operasional cadangan yang disetujui; jangan memaksa cutover.

## 8. Pengendalian perubahan

Setiap permintaan fitur baru dicatat bersama alasan, sumber (siapa/tanggal), dampak ke DB/API/UI/QA, waktu tambahan, serta keputusan David dan pihak operasional. Perubahan yang menyangkut uang, stok, atau hak akses perlu review Rahmat dan Naazmi. Perbarui `DECISIONS.md`, `PRD.md`, `USER_STORIES.md`, `ACCEPTANCE_CRITERIA.md`, dan `TASKS.md` bila ada perubahan yang disetujui.

## 9. Urutan penguncian risiko di lapangan

1. **Sebelum coding transaksi:** kunci status QRIS merchant dan contoh bukti pembayaran, SOP shift, serta aturan stok. Implementasi boleh memakai fixture sintetis untuk bagian yang belum terjawab, tetapi label `PENDING` harus terlihat.
2. **Sebelum migrasi:** pastikan akses katalog lama dan metode ekspor atau input manual; siapkan rekonsiliasi lengkap seluruh SKU aktif.
3. **Sebelum cutover:** kasir dan pengelola menyetujui SOP transaksi yang salah, selisih setoran, dan kondisi QRIS sudah dibayar tetapi POS gagal menyimpan; uji pemulihan dan pencetakan di PC tujuan.

`SCOPE.md` adalah **batas rilis**, bukan berita acara bahwa persetujuan atau uji lapangan sudah terlaksana.
