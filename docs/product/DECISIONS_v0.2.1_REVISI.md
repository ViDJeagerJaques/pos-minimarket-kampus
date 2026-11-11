# DECISIONS — Sistem Kasir dan Inventaris Minimarket Kampus

## 1. Document Control

| Informasi | Isi |
|---|---|
| Lokasi | `docs/product/DECISIONS.md` |
| Versi | 0.2.1 (konfirmasi QRIS manual, 11 November 2026) |
| Status dokumen | DRAFT — revisi usulan koordinator; belum disahkan sebagai kebijakan minimarket |
| Koordinasi | David |
| Pembaca | David, Syafroni, Rahmat, Naazmi, dan AI coding agent |
| Sumber langsung | CONTEXT v0.1.0, PRD v0.2.0, DECISIONS v0.1.0, masukan koordinator 11 November 2026; informasi umum QRIS Merchant BCA sebagai referensi eksternal, **bukan bukti konfigurasi merchant kampus** |

## 2. Purpose and Decision Status

Register ini membedakan arah yang sudah ditetapkan tim, pilihan desain yang masih diuji, dan kebijakan yang memerlukan konfirmasi minimarket. Status ACCEPTED berlaku sebatas ruang lingkup yang disebut dalam entri. Prioritas P0 dalam PRD draft menyatakan target uji atau rilis yang diusulkan, sehingga detailnya dapat tetap PROPOSED atau PENDING. Masukan koordinator 11 November 2026 dicatat sebagai **usulan arah MVP**, kecuali pilihan eksplisit **QRIS manual sebagai mekanisme pembayaran POS** yang sudah dikonfirmasi sebagai keputusan tim pada 11 November 2026. Persetujuan tim ini **tidak** berarti SOP merchant, kepemilikan rekening, atau konfigurasi bank sudah diverifikasi. Target cutover 14 hari adalah **target bisnis berisiko tinggi**, bukan bukti kesiapan produksi.

| Status | Penggunaan |
|---|---|
| ACCEPTED | Arah eksplisit tim atau prinsip desain yang dinyatakan sebagai ketentuan dalam sumber. |
| PROPOSED | Kandidat, baseline awal, atau rincian rancangan yang tersedia untuk ditinjau. |
| PENDING | Pilihan, fakta lapangan, atau kebijakan yang masih memerlukan jawaban. |
| SUPERSEDED | Arah lama yang digantikan pada ruang lingkup tertentu dan tetap tercatat untuk riwayat. |
| REJECTED | Opsi yang secara eksplisit ditolak dengan bukti. |

Tanggal pada entri merujuk ke bukti waktu diskusi terkait. Tanggal revisi sumber dipakai untuk identifikasi dokumen.

## 3. Decision Register

| ID | Keputusan | Kategori | Status |
| --- | --- | --- | --- |
| DEC-001 | Satu aplikasi dan dua role awal | Produk | ACCEPTED |
| DEC-002 | Satu PC kasir untuk MVP | Produk | ACCEPTED |
| DEC-003 | Local-first dan transaksi offline | Arsitektur | ACCEPTED |
| DEC-004 | SQLite sebagai database operasional lokal | Arsitektur | ACCEPTED |
| DEC-005 | Target distribusi desktop Windows | Arsitektur | ACCEPTED |
| DEC-006 | Gangguan sesi atau aplikasi mempertahankan shift | Aturan bisnis | ACCEPTED |
| DEC-007 | Penjualan dan mutasi stok konsisten | Aturan bisnis | ACCEPTED |
| DEC-008 | Satu repositori dan target biaya perangkat lunak Rp0 | Operasional | ACCEPTED |
| DEC-009 | Modul Kasir dan Admin/Inventaris | Produk | PROPOSED |
| DEC-010 | Stack frontend dan backend lokal | Arsitektur | PROPOSED |
| DEC-011 | Electron sebagai kandidat desktop wrapper | Arsitektur | PROPOSED |
| DEC-012 | Satu shift aktif dan tutup eksplisit | Aturan bisnis | PROPOSED |
| DEC-013 | Identitas checkout, pemulihan, dan cetak pascacommit | Arsitektur | PROPOSED |
| DEC-014 | Kontrol backend dan izin per operasi | Keamanan | PROPOSED |
| DEC-015 | Backup lokal dan uji restore | Operasional | PROPOSED |
| DEC-016 | Metode pembayaran dan prosedur setoran | Aturan bisnis | ACCEPTED (pilihan QRIS manual); SOP PENDING |
| DEC-017 | Retur, void, refund, dan member kredit | Produk | PROPOSED |
| DEC-018 | Kebijakan stok, penerimaan dan filter laporan | Aturan bisnis | PROPOSED |
| DEC-019 | Supervisor, akses lintas perangkat, dan kiosk | Keamanan | PENDING |
| DEC-020 | Supabase sebagai kandidat cloud fase lanjutan | Arsitektur | PROPOSED |
| DEC-021 | Pilot dan perpindahan dari sistem lama | Operasional | PROPOSED |
| DEC-022 | Chrome sebagai pengalaman pengguna yang dituju | Arsitektur | SUPERSEDED |
| DEC-023 | Pembayaran digital dan e-wallet | Produk | ACCEPTED (QRIS otomatis ditunda); lainnya PENDING |

## 4. Accepted Decisions

### DEC-001 — Satu aplikasi dan dua role awal

- **Kategori** · Produk
- **Status** · `ACCEPTED`
- **Konteks** · Notulen menyebut sistem kasir dan gudang.
- **Keputusan atau opsi** · Gunakan satu aplikasi dengan role ADMIN dan CASHIER.
- **Alasan berdasarkan sumber** · CONTEXT §4.1 memberi label TEAM_DECISION. §15.2 mencatat perubahan dari istilah dalam notulen.
- **Konsekuensi dan trade-off** · Satu aplikasi menampung dua fungsi. Pemisahan izin tetap perlu dirancang per operasi.
- **Referensi** · CONTEXT §3, §4.1, §15.1–15.2. PRD §2, §2.1; POS-01.01, POS-01.03.
- **Perlu dikonfirmasi** · Arti gudang dan kemungkinan peran tambahan melalui DEC-019.
- **Tanggal keputusan** · 9 November 2026, diskusi rancangan yang dirujuk CONTEXT §15.1.

### DEC-002 — Satu PC kasir untuk MVP

- **Kategori** · Produk
- **Status** · `ACCEPTED`
- **Konteks** · Notulen menyebut dua shift kerja.
- **Keputusan atau opsi** · Batasi MVP ke satu stasiun kasir. Dua shift adalah jadwal operasional yang tercantum di notulen.
- **Alasan berdasarkan sumber** · CONTEXT §5 memberi label TEAM_DECISION pada jumlah PC dan SOURCE pada jumlah shift.
- **Konsekuensi dan trade-off** · MVP dapat diuji pada satu PC. Akses admin dari perangkat lain memerlukan keputusan tersendiri.
- **Referensi** · CONTEXT §5, §8. PRD §1–2; POS-05.01, POS-10.01.
- **Perlu dikonfirmasi** · Apakah PC khusus kasir dan apakah admin perlu perangkat lain.

### DEC-003 — Local-first dan transaksi offline

- **Kategori** · Arsitektur
- **Status** · `ACCEPTED`
- **Konteks** · Pembahasan awal memuat online/offline dan real-time post.
- **Keputusan atau opsi** · Proses dan simpan transaksi secara lokal saat internet terputus. Cloud berada di luar jalur transaksi inti.
- **Alasan berdasarkan sumber** · CONTEXT §5 menetapkan transaksi offline. §15.2 mencatat offline bergeser menjadi kebutuhan inti.
- **Konsekuensi dan trade-off** · Uji dari kondisi internet sudah terputus sebelum aplikasi dibuka. Kerusakan PC tetap membutuhkan pemulihan.
- **Referensi** · CONTEXT §5, §6.1, §15.2. PRD §3, §6–7; POS-01.01, POS-03.05, POS-10.01.
- **Perlu dikonfirmasi** · Arti real-time post dan cakupan cloud melalui DEC-020.

### DEC-004 — SQLite sebagai database operasional lokal

- **Kategori** · Arsitektur
- **Status** · `ACCEPTED`
- **Konteks** · POS perlu menyimpan data operasional tanpa internet.
- **Keputusan atau opsi** · Gunakan SQLite lokal sebagai sumber data operasional.
- **Alasan berdasarkan sumber** · CONTEXT §6 menetapkan SQLite untuk menunjang transaksi offline. PRD §6 mempertahankan arah itu.
- **Konsekuensi dan trade-off** · Penjualan, shift dan stok dapat dipersistenkan di PC. Skema, migrasi, batas transaksi, dan cadangan perlu dirinci.
- **Referensi** · CONTEXT §6, §6.1, §14. PRD §6; POS-03.05, POS-07.02, POS-09.01.
- **Perlu dikonfirmasi** · Skema, migrasi dan pengaturan database.

### DEC-005 — Target distribusi desktop Windows

- **Kategori** · Arsitektur
- **Status** · `ACCEPTED`
- **Konteks** · Rancangan awal mendeskripsikan web lokal via Chrome.
- **Keputusan atau opsi** · Targetkan pengalaman desktop Windows dengan installer .exe. Pertahankan kemampuan menjalankan sistem secara lokal untuk development.
- **Alasan berdasarkan sumber** · CONTEXT §6 membedakan target pengalaman pengguna dari pilihan implementasi. §15.2 mencatat perubahan arah distribusi.
- **Konsekuensi dan trade-off** · Paket harus diuji dengan scanner, printer dan versi Windows tujuan. Pemilihan wrapper tetap terbuka.
- **Referensi** · CONTEXT §5–6, §15.1–15.2. PRD §3, §6; POS-10.01, POS-10.02.
- **Perlu dikonfirmasi** · Perangkat, cara instalasi dan kandidat wrapper melalui DEC-011.
- **Tanggal keputusan** · 9 November 2026, diskusi rancangan yang dirujuk CONTEXT §15.1.

### DEC-006 — Gangguan sesi atau aplikasi mempertahankan shift

- **Kategori** · Aturan bisnis
- **Status** · `ACCEPTED`
- **Konteks** · Sesi login dan shift operasional punya siklus berbeda.
- **Keputusan atau opsi** · Tutup jendela, logout, restart Windows dan listrik mati tidak otomatis menutup shift yang sudah tersimpan.
- **Alasan berdasarkan sumber** · CONTEXT §7.1 memberi label TEAM_DECISION. PRD memetakan transisi saat gangguan.
- **Konsekuensi dan trade-off** · Shift aktif muncul kembali. Otorisasi melanjutkan atau mengambil alih tetap perlu dijelaskan.
- **Referensi** · CONTEXT §7.1, §15.1. PRD §4.2; POS-05.02.
- **Perlu dikonfirmasi** · Prosedur bila kasir pemilik shift tidak tersedia.
- **Tanggal keputusan** · 9 November 2026, diskusi rancangan yang dirujuk CONTEXT §15.1.

### DEC-007 — Penjualan dan mutasi stok konsisten

- **Kategori** · Aturan bisnis
- **Status** · `ACCEPTED`
- **Konteks** · Proses dapat berhenti saat menyimpan atau saat kasir mengulang pembayaran.
- **Keputusan atau opsi** · Jaga atomisitas penjualan dan mutasi stok. Retry tidak boleh membuat transaksi tersimpan menjadi ganda.
- **Alasan berdasarkan sumber** · CONTEXT §6.1 dan §9 menyatakan konsistensi dan atomisitas. §7.2 menyebut pencegahan transaksi ganda sebagai prinsip penerimaan.
- **Konsekuensi dan trade-off** · Sistem perlu membuktikan hasil lengkap atau rollback. Desain identitas retry dan pemulihan rinci mengikuti DEC-013.
- **Referensi** · CONTEXT §6.1, §7.2, §9. PRD §4.3, §6–7; POS-03.05, POS-04.01, POS-04.02.
- **Perlu dikonfirmasi** · Detail kontrak retry, skema, dan cara rekonsiliasi pembayaran fisik.

### DEC-008 — Satu repositori dan target biaya perangkat lunak Rp0

- **Kategori** · Operasional
- **Status** · `ACCEPTED`
- **Konteks** · Proyek dikerjakan empat anggota dengan bantuan AI coding agent.
- **Keputusan atau opsi** · Gunakan satu repo GitHub. Perlakukan Rp0 sebagai target biaya pengembangan perangkat lunak.
- **Alasan berdasarkan sumber** · CONTEXT §6 dan §11 menyatakan kolaborasi satu repo. §2 menyebut Rp0 sebagai target dan memisahkan biaya perangkat serta operasional.
- **Konsekuensi dan trade-off** · PR lintas komponen dapat dilacak. Perangkat, UPS dan media cadangan tetap perlu dicatat terpisah.
- **Referensi** · CONTEXT §2, §6, §10–11. PRD §1, §9; tidak ada ID POS khusus untuk anggaran atau tata kerja.
- **Perlu dikonfirmasi** · Ketersediaan perangkat dan biaya operasional aktual.

## 5. Proposed Decisions

### DEC-009 — Modul Kasir dan Admin/Inventaris

- **Kategori** · Produk
- **Status** · `PROPOSED`
- **Konteks** · Notulen memuat kasir, gudang, inventaris, ringkasan dan pembelian.
- **Keputusan atau opsi** · Pisahkan menu dan alur menjadi Kasir untuk CASHIER serta Admin/Inventaris untuk ADMIN dalam satu aplikasi.
- **Alasan berdasarkan sumber** · CONTEXT §4.2 menyebut pembagian ini sebagai usulan. PRD menguraikan alur dan layar draft.
- **Konsekuensi dan trade-off** · Frontend dapat membagi navigasi dan pekerjaan. Lingkup fungsi gudang dapat berubah setelah validasi.
- **Referensi** · CONTEXT §3, §4.2, §8. PRD §2, §4; POS-03.01, POS-07.01, POS-08.02.
- **Perlu dikonfirmasi** · Petugas gudang, alur pembelian, dan akses admin.

### DEC-010 — Stack frontend dan backend lokal

- **Kategori** · Arsitektur
- **Status** · `PROPOSED`
- **Konteks** · Tim memerlukan rancangan awal untuk UI dan layanan lokal.
- **Keputusan atau opsi** · Gunakan React + Vite + TypeScript dan Node.js + Express sebagai baseline rancangan untuk ditinjau.
- **Alasan berdasarkan sumber** · CONTEXT §6 mencatat TEAM_DECISION sebatas rancangan awal. PRD §6 menyebutnya arah awal tim.
- **Konsekuensi dan trade-off** · Baseline membantu pembagian kerja dan kontrak UI/backend. Versi, packaging dan komitmen produksi perlu validasi.
- **Referensi** · CONTEXT §6, §11, §14. PRD §6; POS-01.03, POS-03.05, POS-10.01 sebagai requirement terdampak, tanpa mandat stack tersendiri.
- **Perlu dikonfirmasi** · Versi dependensi, kompatibilitas paket Windows dan hasil uji awal. Koordinator 11 November 2026 menyatakan preferensi React/TypeScript dibanding Laravel; ini bukan bukti bahwa stack sudah diuji pada PC tujuan.

### DEC-011 — Electron sebagai kandidat desktop wrapper

- **Kategori** · Arsitektur
- **Status** · `PROPOSED`
- **Konteks** · Target Windows sudah ditetapkan pada tingkat pengalaman pengguna.
- **Keputusan atau opsi** · Evaluasi Electron bersama opsi pembungkus lain dengan alur offline, scan, cetak dan pembaruan pada PC tujuan.
- **Alasan berdasarkan sumber** · CONTEXT §6 memberi label PROPOSED dan §14 menunda pilihan final sampai pengujian.
- **Konsekuensi dan trade-off** · Pilihan memengaruhi kebutuhan sumber daya PC, isolasi proses, distribusi dan pemeliharaan paket.
- **Referensi** · CONTEXT §5–6, §9, §12–14. PRD §3, §6; POS-10.01, POS-10.02.
- **Perlu dikonfirmasi** · RAM, prosesor, disk, Windows, scanner, printer serta hasil uji paket.

### DEC-012 — Satu shift aktif dan tutup eksplisit

- **Kategori** · Aturan bisnis
- **Status** · `PROPOSED`
- **Konteks** · Satu PC melayani dua shift berurutan.
- **Keputusan atau opsi** · Uji satu shift aktif per PC, pembukaan oleh kasir dan penutupan eksplisit. Usulan PRD memisahkan status AKTIF dari DITUTUP dan mengurutkan commit penutupan dengan checkout.
- **Alasan berdasarkan sumber** · CONTEXT §7.1 memberi label PROPOSED untuk batas shift aktif dan penutupan eksplisit. PRD §4.2 menguraikan transisi.
- **Konsekuensi dan trade-off** · Pembukaan bersamaan hanya menyisakan satu shift. Jika pemilik absen, operasi dapat tertahan sampai pengelola menentukan alur.
- **Referensi** · CONTEXT §5, §7. PRD §4.2; POS-05.01, POS-06.02, POS-06.03.
- **Perlu dikonfirmasi** · SOP serah terima, otorisasi penutupan dan pengambilalihan.

### DEC-013 — Identitas checkout, pemulihan, dan cetak pascacommit

- **Kategori** · Arsitektur
- **Status** · `PROPOSED`
- **Konteks** · Timeout atau listrik mati bisa membuat hasil checkout belum diketahui. Printer dapat gagal setelah commit.
- **Keputusan atau opsi** · Pakai identitas upaya stabil untuk retry, tampilkan status hasil setelah restart, dan cetak ulang dari transaksi tersimpan.
- **Alasan berdasarkan sumber** · CONTEXT §7.2 menetapkan skenario gagal. Detail mekanisme berasal dari rekomendasi PRD §4.3 dan §6.
- **Konsekuensi dan trade-off** · Identitas perlu bertahan lintas restart. QA memeriksa status commit dan struk secara terpisah. Pembayaran fisik perlu rekonsiliasi ketika hasil meragukan.
- **Referensi** · CONTEXT §6.1, §7.2, §9. PRD §4.3, §6; POS-04.01, POS-04.02, POS-04.03.
- **Perlu dikonfirmasi** · Persistensi identitas, kontrak status, dan prosedur pembayaran fisik.

### DEC-014 — Kontrol backend dan izin per operasi

- **Kategori** · Keamanan
- **Status** · `PROPOSED`
- **Konteks** · Dua role memerlukan pemisahan kewenangan dan audit.
- **Keputusan atau opsi** · Tinjau matriks izin PRD dan gunakan pemeriksaan backend, hash kata sandi, validasi input, kueri terparameterisasi, serta audit perubahan kritis sebagai baseline desain.
- **Alasan berdasarkan sumber** · CONTEXT §4.1 mengusulkan penyesuaian menu dan izin backend. §9 merinci persyaratan desain. Matriks PRD §2.1 berstatus usulan.
- **Konsekuensi dan trade-off** · QA menguji aksi langsung dengan role yang salah. Aksi sensitif memerlukan definisi izin dan jejak audit.
- **Referensi** · CONTEXT §4.1, §9, §14. PRD §2.1, §7; POS-01.02, POS-01.03, POS-01.04, POS-02.03.
- **Perlu dikonfirmasi** · Matriks final, akun dengan dua fungsi, akses admin saat shift aktif dan kewenangan koreksi.

### DEC-015 — Backup lokal dan uji restore

- **Kategori** · Operasional
- **Status** · `PROPOSED`
- **Konteks** · PC lokal dapat rusak atau kehilangan data. Cloud dibahas untuk fase lanjutan.
- **Keputusan atau opsi** · Pertahankan backup lokal dan uji restore sebagai baseline pilot. Uji cadangan valid dan rusak di lingkungan terpisah.
- **Alasan berdasarkan sumber** · CONTEXT §6.1 dan §9 mengharuskan prinsip backup dan uji restore. §8 mencatatnya sebagai kandidat MVP. PRD mengusulkan P0 untuk mekanisme dan pengujiannya.
- **Konsekuensi dan trade-off** · Cadangan menyediakan titik pemulihan tersendiri. Pilot bergantung pada prosedur, media, dan akses yang disahkan.
- **Referensi** · CONTEXT §6.1, §8–9, §12–13. PRD §7–8; POS-09.01, POS-09.02.
- **Perlu dikonfirmasi** · Interval, retensi, lokasi, penanggung jawab, toleransi kehilangan data dan runbook restore. Usulan tambahan 11 November 2026: backup SQLite konsisten (misalnya SQLite backup API), verifikasi integritas dan restore ke lokasi terpisah, salinan di media berbeda, serta ekspor CSV/XLSX **hanya untuk laporan**, bukan pengganti backup database.

### DEC-020 — Supabase sebagai kandidat cloud fase lanjutan

- **Kategori** · Arsitektur
- **Status** · `PROPOSED`
- **Konteks** · Kebutuhan real-time post belum didefinisikan. Core beroperasi lokal.
- **Keputusan atau opsi** · Pertimbangkan Supabase setelah core stabil. Jika disetujui, desain identitas, antrean, retry, idempotensi dan penanganan konflik.
- **Alasan berdasarkan sumber** · CONTEXT §6 dan §8 memberi status PROPOSED. PRD §6 memisahkan data lokal dari data yang sudah terkirim.
- **Konsekuensi dan trade-off** · Cloud menambah integrasi dan pekerjaan pengujian, sementara penjualan tetap dapat berjalan tanpa koneksi.
- **Referensi** · CONTEXT §3, §6–6.1, §8, §13–15. PRD §3, §6; POS-PND-06, POS-03.05 sebagai batas local-first.
- **Perlu dikonfirmasi** · Arti real-time post, satu/dua arah, hubungan dengan tutup shift, jadwal dan akses data.

## 6. Pending and Revised Proposed Decisions

### DEC-016 — Metode pembayaran dan prosedur setoran

- **Kategori** · Aturan bisnis
- **Status** · `ACCEPTED` untuk pilihan teknis QRIS manual pada MVP berdasarkan konfirmasi koordinator 11 November 2026; `PENDING` untuk SOP merchant, setoran, dan rekonsiliasi yang memerlukan konfirmasi minimarket.
- **Konteks** · Notulen menyebut tunai, debit, kredit, dan dua shift. Koordinator mengamati QRIS dipakai melalui HP karyawan; merek BCA dan status merchant belum terverifikasi.
- **Keputusan atau opsi** · Pilihan tim untuk MVP: `CASH` dan `QRIS` dengan verifikasi manual. QRIS diproses di kanal merchant eksternal yang sah, **bukan** gateway atau notifikasi otomatis dari aplikasi POS. Kasir memeriksa transaksi berhasil dan nominal pada aplikasi/riwayat merchant sebelum menandai pembayaran QRIS terverifikasi secara manual di POS. Status belum terverifikasi tidak boleh otomatis dianggap lunas. Catat metode, nominal, petugas, waktu, dan referensi pembayaran bila tersedia; hindari menyimpan kredensial perbankan.
- **Rumus setoran usulan** · `kas_seharusnya = modal_awal + penjualan_tunai - pengembalian_tunai - pengeluaran_kas_terotorisasi - setoran_tunai_di_tengah_shift`; `selisih_kas = uang_fisik_dihitung - kas_seharusnya`. Nilai QRIS dilaporkan terpisah dan direkonsiliasi dengan riwayat merchant; **tidak** ditambahkan ke uang fisik laci. Untuk MVP, pengeluaran kas, refund, dan setoran tengah shift sebaiknya dilarang melalui POS sampai SOP disahkan, bukan diasumsikan nol tanpa pengawasan.
- **Konsekuensi dan trade-off** · Checkout tunai bisa berjalan tanpa internet; QRIS memerlukan kanal pembayaran yang dapat diverifikasi. UI harus membedakan pembayaran menunggu verifikasi, pembayaran berhasil, dan transaksi POS tersimpan. Penandaan manual rawan salah input dan harus dapat diaudit.
- **Referensi** · CONTEXT §3, §5, §7, §13–14; PRD §3, §10; POS-03.04, POS-06.01–02. Masukan koordinator 11 November 2026.
- **Perlu dikonfirmasi** · QRIS milik merchant minimarket atau rekening pribadi; aplikasi merchant sebenarnya; apakah tersedia notifikasi transaksi dan riwayat; prosedur pembayaran salah nominal/tertunda, kas awal, serah-terima, pengeluaran kas, dan selisih. Konfirmasi langsung dengan pihak yang berwenang sebelum cutover.

### DEC-017 — Retur, void, refund, dan member kredit

- **Kategori** · Produk
- **Status** · `PROPOSED` (defer untuk MVP, belum disetujui pengelola)
- **Konteks** · Retur dan member kredit muncul dalam notulen, tetapi koordinator menilai pembeli kampus lebih sering melakukan transaksi singkat bernilai kecil; fitur member berisiko menambah langkah checkout tanpa manfaat teruji.
- **Keputusan atau opsi** · Tidak membangun registrasi member, piutang/kredit member, refund otomatis, retur pelanggan, atau void transaksi tersimpan dalam rilis 14 hari. Transaksi draft yang belum tersimpan dapat dibatalkan. Jangan mengubah/menghapus transaksi penjualan yang sudah commit. Jika terjadi kesalahan nyata, gunakan prosedur eskalasi manual yang disetujui pengelola dengan catatan insiden dan rekonsiliasi; bukan perubahan diam-diam pada SQLite.
- **Konsekuensi dan trade-off** · Mempercepat fokus ke transaksi dasar, tetapi tidak boleh cutover jika proses harian minimarket ternyata mewajibkan kredit, retur, refund, atau pembatalan penjualan yang sudah tercatat.
- **Referensi** · CONTEXT §3, §8, §13–14; PRD §5.3; POS-03.08, POS-PND-01–02; masukan koordinator 11 November 2026.
- **Perlu dikonfirmasi** · Apakah ada transaksi kredit/member aktif atau retur yang harus dilayani sejak hari pertama; cara penanganan transaksi salah sebelum/selepas pembayaran; apakah histori sistem lama harus dibawa.

### DEC-018 — Kebijakan stok, penerimaan dan filter laporan

- **Kategori** · Aturan bisnis
- **Status** · `PROPOSED` (rancangan minimal untuk cutover)
- **Konteks** · Notulen memuat scan stok awal/akhir dan laporan supplier/departemen. Koordinator meminta stok mudah dikoreksi secara manual serta dashboard admin yang sederhana.
- **Keputusan atau opsi** · Baseline: checkout **menolak stok negatif**; admin dapat membuat penyesuaian stok dengan alasan, waktu, identitas pelaku dan mutasi audit, bukan mengedit saldo tanpa jejak. Penerimaan barang tetap harus menambah stok secara atomik. Dashboard admin minimum: omzet penjualan hari ini, total transaksi, penjualan per metode bayar, ringkasan per shift, stok menipis, stok habis, dan histori mutasi; laporan supplier/departemen rinci ditunda sampai kebutuhan dikonfirmasi.
- **Konsekuensi dan trade-off** · Perlu saldo awal yang benar sebelum go-live, ambang stok menipis yang bisa ditentukan admin, serta uji koreksi dan rollback. Definisi omzet adalah total transaksi penjualan tersimpan, bukan laba atau uang tunai di laci.
- **Referensi** · CONTEXT §3, §8, §13; PRD §4.3, §10; POS-03.06, POS-07.01, POS-08.02, POS-PND-03–04; masukan koordinator 11 November 2026.
- **Perlu dikonfirmasi** · Stok awal dan hasil opname, siapa berhak koreksi, apakah ada penjualan saat stok belum diinput, dan apakah laporan supplier/departemen benar-benar wajib pada hari pertama.

### DEC-019 — Supervisor, akses lintas perangkat, dan kiosk

- **Kategori** · Keamanan
- **Status** · `PENDING`
- **Konteks** · Belum jelas apakah PC khusus kasir dan apakah gudang atau admin perlu akses terpisah.
- **Keputusan atau opsi** · Konfirmasi peran supervisor, pengambilalihan, akses admin saat shift aktif/dari perangkat lain dan kebutuhan kiosk Windows.
- **Alasan berdasarkan sumber** · CONTEXT §4–7 dan §13–14 menyebut pertanyaan ini masih terbuka. Kiosk bergantung pada penggunaan PC.
- **Konsekuensi dan trade-off** · Akses tambahan mengubah topologi dan batas otorisasi. Tanpa alur pengambilalihan, shift yang tertahan perlu eskalasi ke pengelola.
- **Referensi** · CONTEXT §4–7, §9, §13–14. PRD §2.1, §10; POS-01.03, POS-PND-05, POS-PND-07.
- **Perlu dikonfirmasi** · Kewenangan, perangkat yang dipakai, penguncian sesi dan kebutuhan kiosk.

### DEC-021 — Pilot dan perpindahan dari sistem lama

- **Kategori** · Operasional
- **Status** · `PROPOSED` (target bisnis 14 hari; cutover belum disetujui)
- **Konteks** · Koordinator menargetkan sistem menggantikan aplikasi berlangganan dalam 14 hari sejak 11 November 2026 (target sekitar 25 November 2026). Langganan lama dilaporkan berakhir pada Desember, tanpa tanggal pasti dan tanpa bukti akses ekspor.
- **Keputusan atau opsi** · Jalankan pekerjaan dokumentasi, implementasi, migrasi data, dan pengujian secara bertumpang tindih; **batalkan strategi menyelesaikan seluruh 33 dokumen sebelum mulai coding** karena tidak kompatibel dengan tenggat produksi. 33 file tetap menjadi peta dokumentasi; untuk dokumen yang memerlukan hasil implementasi, buat rencana sebelum coding dan isi hasil faktual setelah diuji. Cutover hanya dilakukan setelah gerbang GO/NO-GO pada §11 terpenuhi.
- **Konsekuensi dan trade-off** · Tenggat sangat agresif untuk tim pemula. Bila gerbang tidak terpenuhi, jangan mengganti sistem lama secara paksa; minta perpanjangan langganan, akses sementara, atau jalur cadangan resmi dari pengelola.
- **Referensi** · CONTEXT §2–3, §12–13; PRD §8–10; POS-09.02, POS-10.01–02; masukan koordinator 11 November 2026.
- **Perlu dikonfirmasi** · Tanggal berakhir yang tepat, apakah 25 November memang tenggat operasional, hak ekspor produk/barcode/stok/harga, jumlah SKU, spesifikasi PC/scanner/printer, SOP manual darurat, ketersediaan operator untuk uji paralel dan penerimaan tertulis.

### DEC-023 — Pembayaran digital dan e-wallet

- **Kategori** · Produk
- **Status** · `ACCEPTED` untuk menunda integrasi QRIS otomatis pada MVP; detail layanan pembayaran eksternal masih memerlukan validasi
- **Konteks** · Notulen mengaitkan rencana e-wallet dengan ATM. Koordinator mengamati pelanggan membayar QRIS dengan memindai kode yang ditunjukkan melalui HP karyawan.
- **Keputusan atau opsi** · Dukung pencatatan QRIS sebagai metode pembayaran di POS, tanpa membuat atau memproses QRIS melalui integrasi bank. Jangan menganggap notifikasi HP sebagai API POS. Fitur QRIS dinamis dari POS, callback/webhook, auto-verification, dan settlement otomatis **di luar scope 14 hari** kecuali tersedia integrasi resmi dan pengujian menyeluruh yang disetujui.
- **Konsekuensi dan trade-off** · Tidak ada biaya/ketergantungan integrasi baru, tetapi kasir perlu verifikasi transaksi melalui kanal merchant. QRIS tidak boleh dinyatakan 'offline' hanya karena POS offline-first.
- **Referensi** · CONTEXT §3, §8, §13; PRD §3, §10; POS-PND-07; masukan koordinator 11 November 2026. Referensi eksternal: https://www.bca.co.id/id/bisnis/produk/penerimaan-bisnis/Merchant-BCA (fitur Merchant BCA, **bukan bukti penggunaan oleh minimarket**).
- **Perlu dikonfirmasi** · Pemilik rekening merchant, penyedia QRIS, bentuk QRIS statis/dinamis, dan siapa yang berwenang memverifikasi pembayaran.

## 7. Superseded / Rejected Decisions

### DEC-022 — Chrome sebagai pengalaman pengguna yang dituju

- **Kategori** · Arsitektur
- **Status** · `SUPERSEDED`
- **Konteks** · Laporan awal menggambarkan aplikasi web lokal yang dibuka lewat Chrome.
- **Keputusan atau opsi** · Untuk distribusi pengguna, arah ini digantikan target desktop Windows pada DEC-005. Mode lokal tetap relevan untuk development.
- **Alasan berdasarkan sumber** · CONTEXT §6 dan §15.2 mencatat perubahan arah yang disengaja. PRD §6 mempertahankan eksekusi lokal selama development.
- **Konsekuensi dan trade-off** · Tim perlu membuktikan installer pada PC tujuan. Catatan rancangan web lokal tetap menjelaskan asal arsitektur.
- **Referensi** · CONTEXT §3, §6, §15.1–15.2. PRD §3, §6; POS-10.01.
- **Perlu dikonfirmasi** · Wrapper dan perangkat melalui DEC-011.

## 8. Dependencies and Impact

| Keputusan terkait | Ketergantungan | Dampak ke tim |
|---|---|---|
| DEC-001, DEC-009, DEC-014, DEC-019 | Pembagian peran, gudang dan akses admin | Syafroni menyesuaikan menu. Rahmat dan David meninjau batas akses. Naazmi menguji operasi yang diizinkan dan ditolak. |
| DEC-003, DEC-004, DEC-007, DEC-013, DEC-018 | Operasi lokal, transaksi database dan kebijakan stok | David dan Rahmat merinci skema serta commit. Syafroni menampilkan status checkout. Naazmi menguji offline, interupsi, retry dan stok. |
| DEC-006, DEC-012, DEC-016, DEC-017, DEC-019 | SOP shift, pembayaran, koreksi dan otorisasi | Validasi dengan pengelola menentukan fixture pilot dan kebutuhan yang harus masuk cakupan rilis. |
| DEC-005, DEC-010, DEC-011, DEC-015, DEC-021 | PC tujuan, paket Windows, cadangan dan data awal | Uji installer dan restore serta cocokkan saldo sebelum perpindahan sistem. |
| DEC-020, DEC-023 | Definisi cloud dan pembayaran digital | Validasi fase lanjutan terpisah dari uji jalur penjualan offline. |

## 9. Decision Review Process

1. David mencatat pertanyaan, bukti, dan ID DEC terkait. Untuk proses minimarket, catat narasumber dan tanggal konfirmasi ketika tersedia.
2. Syafroni meninjau dampak pada antarmuka, Rahmat pada layanan dan integrasi, David pada kebutuhan dan data, serta Naazmi pada skenario uji dan perangkat.
3. Dalam review perubahan, catat status baru, ruang lingkup, alasan yang didukung bukti, dan ID POS terdampak. Pertahankan jejak keputusan lama ketika arah berubah.
4. Sebelum menaikkan prioritas kandidat, konfirmasi kebutuhan operasional, nilai dampak jadwal, dan siapkan kriteria penerimaan bersama tim.
5. Anggota tim dan AI coding agent memakai ACCEPTED sesuai batas entri. Untuk PROPOSED atau PENDING, sebutkan asumsi pada PR dan gunakan fixture yang ditandai sebagai data uji. Saat PRD dan register berbeda, catat konflik untuk review lintas pemilik.

## 10. Revision Impact and Required Document Updates (11 November 2026)

- `docs/product/PRD.md`: usulkan pembatasan MVP ke CASH + QRIS eksternal, non-member, koreksi stok terotorisasi, laporan admin minimal, dan rencana cutover 14 hari. **Belum otomatis merevisi PRD.**
- `docs/product/SCOPE.md`: bedakan fitur rilis wajib vs ditunda (member, kredit, retur/refund otomatis, integrasi QRIS otomatis, cloud sync).
- `docs/product/TASKS.md`: ubah prioritas dan dependency menjadi rencana 14 hari; sertakan migrasi data, pengujian perangkat, dan cutover.
- `docs/architecture/DATABASE.md`: tinjau dukungan mutasi koreksi stok, referensi verifikasi QRIS, dan laporan. **Jangan ubah skema tanpa review migrasi.**
- `docs/architecture/API_CONTRACT.md`: kontrak pembayaran dan penandaan verifikasi manual, koreksi stok, laporan admin, serta error yang tidak mengklaim sukses tanpa bukti.
- `docs/security/AUTHORIZATION.md`: periksa hak ADMIN untuk koreksi stok dan hak CASHIER untuk verifikasi QRIS; audit wajib.
- `docs/security/BACKUP_RECOVERY.md`, `docs/operations/TEST_PLAN.md`, `docs/operations/DEPLOYMENT.md`, `docs/operations/OPERATIONS.md`: prosedur backup-restore, uji nyata, fallback, dan cutover.

## 11. Fourteen-Day Production Plan and Go/No-Go Gate

**Jadwal bersifat usulan dan harus diperiksa setiap hari; target 25 November 2026 tidak sama dengan jaminan siap produksi.**

| Hari | Fokus | Bukti wajib |
|---|---|---|
| 1 | Kunci scope, cek perangkat, cek ekspor data sistem lama, cek QRIS merchant dan SOP shift | Daftar keputusan/risiko; data sampel; inventaris PC/scanner/printer |
| 2–3 | Review dokumen kritis, finalkan kontrak data/API, spike Electron + SQLite + scanner/printer | Demo instalasi lokal, uji perangkat, spesifikasi disetujui |
| 4–7 | Implementasi vertikal: login, produk/barcode, checkout tunai, shift, stok | Unit/integration test, PR ter-review, transaksi atomik |
| 8–10 | QRIS verifikasi manual, penerimaan/koreksi stok, laporan, backup-restore, packaging | Bukti uji negatif dan restore, installer yang berjalan |
| 11–12 | Impor dan cocokkan data awal; uji paralel dengan sistem lama di PC tujuan | Rekonsiliasi SKU, harga, stok, transaksi, setoran; uji offline |
| 13 | Uji penerimaan pengguna, failure drills, latihan rollback | Berita acara uji, daftar bug kritis nol |
| 14 | Keputusan GO/NO-GO dan cutover terkendali bila semua lolos | Persetujuan pengelola, backup akhir, rollback plan, PIC siaga |

**GO hanya jika seluruh syarat berikut dipenuhi:**

1. Pengelola minimarket menyetujui scope dan SOP pembayaran/shift, serta tidak ada fitur harian wajib yang hilang.
2. Semua produk aktif, barcode, harga dan stok awal yang diperlukan tersedia dan direkonsiliasi; ada cara menambah barang baru tanpa merusak histori.
3. Checkout tunai dan QRIS yang terverifikasi manual diuji end-to-end; tidak ada transaksi ganda, stok parsial, atau penjualan tersimpan tanpa status pembayaran yang benar.
4. Satu shift aktif, tutup shift, selisih kas, login dan otorisasi diuji dengan data nyata; QRIS direkonsiliasi terpisah dari uang tunai.
5. Scanner dan printer diuji pada PC tujuan; gagal cetak tidak menggandakan penjualan; restart/listrik mati/offline diuji.
6. Backup SQLite berhasil dipulihkan pada lingkungan terpisah; cadangan ada pada media lain dan operator tahu prosedurnya.
7. Installer dapat dijalankan ulang, ada SOP pemulihan dan rollback, serta pengguna menyelesaikan uji terima tanpa bug kritis terbuka.

**NO-GO:** jika salah satu syarat di atas gagal, tetap gunakan sistem lama bila masih memungkinkan, minta perpanjangan/opsi cadangan resmi, dan jangan mengklaim aplikasi baru siap produksi.

## 12. Open Validation Items (Blocking vs Nonblocking)

| ID | Pertanyaan | Pemilik jawaban | Prioritas |
|---|---|---|---|
| VAL-01 | QRIS atas nama merchant siapa dan notifikasi apa yang benar-benar diterima? | Pengelola/kasir | BLOCKER |
| VAL-02 | Ada transaksi member/kredit/retur yang wajib ditangani pada hari pertama? | Pengelola | BLOCKER |
| VAL-03 | Bisa ekspor data master produk, barcode, harga, dan stok dari sistem lama? | Pengelola + David | BLOCKER |
| VAL-04 | Spesifikasi Windows, scanner, printer dan hasil uji installer? | Rahmat, Syafroni, Naazmi | BLOCKER |
| VAL-05 | SOP shift, modal, setoran, selisih, pembayaran QRIS pending? | Pengelola + David | BLOCKER |
| VAL-06 | Metode backup, retensi, media eksternal, dan restore berhasil? | Rahmat + Naazmi | BLOCKER |
| VAL-07 | Apakah dashboard perlu laporan supplier/departemen untuk cutover? | Pengelola | BLOCKER untuk scope |
| VAL-08 | Kapan tepatnya langganan habis dan adakah masa perpanjangan? | Pengelola | BLOCKER untuk cutover |
| VAL-09 | QRIS otomatis / cloud / member fase berikutnya? | Pengelola + tim | NONBLOCKING bila ditunda |

## 13. Revision Note — v0.2.1

- Pada 11 November 2026, koordinator secara eksplisit memilih **Cara A: QRIS manual** sebagai mekanisme pembayaran QRIS untuk MVP. Status keputusan teknis ini diperbarui pada DEC-016.
- Integrasi QRIS otomatis dengan bank/payment gateway tidak termasuk MVP 14 hari (DEC-023).
- Konfirmasi pilihan teknis oleh tim **bukan** konfirmasi atas identitas merchant, kepemilikan rekening, notifikasi pembayaran, atau SOP rekonsiliasi. VAL-01 dan VAL-05 tetap menjadi syarat sebelum penggunaan produksi.
- Versi ini menggantikan draft revisi v0.2.0 untuk keperluan review; tidak mengubah file asli dalam GitHub secara otomatis.

## 14. References

- `CONTEXT.md` v0.1.0, salinan yang tersedia bernama `CONTEXT(1).md`. Bagian §15 merangkum notulen, laporan rancangan awal, dan diskusi 9 November 2026.
- `docs/product/PRD.md` v0.2.0, dibaca dari salinan `PRD.md` yang dilampirkan. §5 memuat ID requirement dan kriteria penerimaan.
- Rujukan ke notulen, PDF rancangan awal, dan diskusi berasal dari ringkasan dalam CONTEXT. Register menggunakan kedua dokumen di atas sebagai sumber langsung.
- Masukan koordinator dalam percakapan 11 November 2026 mengenai QRIS HP, prioritas member, koreksi stok, laporan, stack, backup, dan target 14 hari.
- Situs resmi BCA: https://www.bca.co.id/id/bisnis/produk/penerimaan-bisnis/Merchant-BCA dan https://www.bca.co.id/id/informasi/edukatips/2025/04/16/03/35/aktifkan-notifikasi-suara-di-aplikasi-merchant-bca-untuk-pantau-transaksi-lebih-mudah. Fitur resmi tersebut tidak membuktikan bahwa minimarket kampus sudah memakai layanan tersebut.
