# CONTEXT — Sistem Kasir dan Inventaris Minimarket Kampus

> **Status:** Draft untuk review tim — bukan spesifikasi final minimarket  
> **Versi:** 0.1.0  
> **Diperbarui:** 9 November 2026  
> **Pemilik konteks:** Tim proyek POS Minimarket Kampus  
> **Tujuan file:** Memberi konteks bersama kepada anggota tim dan AI coding agent sebelum menyusun PRD, arsitektur, database, antarmuka, atau kode.

## 1. Cara membaca dokumen ini

Dokumen ini merangkum latar belakang, kebutuhan awal, keputusan sementara, kendala, dan pertanyaan yang masih terbuka. **Jangan menganggap semua isi sebagai kebutuhan yang sudah divalidasi oleh minimarket.**

Gunakan label berikut secara konsisten:

| Label | Makna |
|---|---|
| `SOURCE` | Tercantum dalam notulen awal atau laporan rancangan awal; belum tentu sudah divalidasi ulang. |
| `TEAM_DECISION` | Pilihan rancangan yang telah dinyatakan dalam diskusi tim/pengguna; dapat berubah setelah survei. |
| `PROPOSED` | Rekomendasi rancangan yang belum disahkan. |
| `PENDING` | Informasi yang belum diketahui atau membutuhkan konfirmasi. |
| `CONFLICT` | Ada perbedaan antara sumber/dokumen/keputusan yang perlu diselesaikan. |

**Aturan sumber:** notulen menjadi rujukan kebutuhan awal; laporan rancangan menjadi rujukan interpretasi dan rencana awal; keputusan terbaru dari tim digunakan untuk arah rancangan *jika dinyatakan eksplisit*. Konflik tidak boleh disembunyikan. Lihat bagian 15.

## 2. Ringkasan proyek

- **Nama kerja:** Sistem Kasir dan Inventaris Minimarket Kampus.
- **Masalah awal (`SOURCE`):** minimarket menggunakan sistem kasir berlangganan yang dilaporkan akan berakhir pada **Desember 2026**. Tim mempertimbangkan sistem mandiri sebagai alternatif. Tanggal tepat berakhirnya langganan belum dikonfirmasi.
- **Sasaran (`TEAM_DECISION`):** mengembangkan **MVP (Minimum Viable Product)** yang mengutamakan ketepatan transaksi, pencatatan persediaan, dan operasional kasir; peluang menjadikannya produk lebih luas adalah tujuan jangka panjang, bukan ruang lingkup rilis pertama.
- **Konteks akademik:** proyek tim mahasiswa semester 3, dikerjakan dengan bantuan AI coding agent (*vibe coding*).
- **Anggaran:** target pengembangan perangkat lunak **Rp0**; belum termasuk perangkat, UPS, media backup, atau biaya operasional yang mungkin diperlukan.
- **Tingkat kesiapan:** tahap analisis kebutuhan dan penyiapan rancangan. **Belum ada bukti dari konteks ini bahwa aplikasi telah siap digunakan secara operasional.**

## 3. Sumber kebutuhan awal: notulen rapat

Di bawah ini adalah pokok notulen sebagaimana diberikan oleh tim. Penjelasan dalam tanda kurung siku merupakan normalisasi istilah, bukan hasil wawancara tambahan.

1. Sudah ada senior yang lebih dahulu mengerjakan proyek serupa; detail, hasil, dan akses proyek belum tersedia (`SOURCE`, `PENDING`).
2. Sistem yang disebut dalam notulen: **sistem kasir** dan **sistem gudang** (`SOURCE`).
3. Laporan: penelusuran berdasarkan **tanggal, supplier, dan departemen** (`SOURCE`). Makna *departemen* perlu ditanyakan.
4. Setoran kasir: **dua shift**, serta laporan **kredit, debit, tunai** (`SOURCE`). Makna *kredit* (member berutang, kartu kredit, atau klasifikasi lain) belum dipastikan.
5. Admin: **input barang, retur barang, tambah member kredit, penjualan dan pembelian** (`SOURCE`).
6. Data barang mencakup **data supplier** (`SOURCE`).
7. Scan: **pembayaran pada sistem kasir serta stok awal/akhir** (`SOURCE`). Peran barcode dalam inventaris perlu diperinci.
8. Saat notulen dibuat, sistem dibicarakan sebagai **berbasis web** (`SOURCE`).
9. **E-wallet/pop-up pembayaran belum tersedia**, rencana setelah **ATM fisik dipindahkan** (`SOURCE`). Ini bukan syarat MVP yang sudah disahkan.
10. Diusahakan **online atau offline** dan disebut *real-time post* (`SOURCE`). Arti *real-time post* perlu ditanyakan, terutama saat internet terputus.
11. Istilah modul lain yang muncul: **inventory, ringkasan, kasir** (`SOURCE`).

**Interpretasi yang belum final (`PENDING`):** tim menduga *sistem gudang* berarti modul administrasi/inventaris yang dioperasikan admin, bukan aplikasi kedua atau peran gudang tersendiri. Konfirmasi ke minimarket tetap diperlukan.

## 4. Batas produk dan model aplikasi

### 4.1 Satu aplikasi, dua peran

- `TEAM_DECISION`: **Satu aplikasi**, bukan dua aplikasi terpisah.
- `TEAM_DECISION`: Dua role awal, **`ADMIN`** dan **`CASHIER`** (pekerja/kasir).
- `PROPOSED`: Antarmuka dan menu yang tersedia menyesuaikan role pengguna; pemeriksaan izin wajib dilakukan pada lapisan backend, bukan hanya dengan menyembunyikan menu.
- `PENDING`: Apakah ada petugas gudang/supervisor terpisah dan apakah admin harus mengakses sistem dari laptop/perangkat lain.

### 4.2 Pemisahan modul yang diusulkan

| Modul | Pengguna utama | Cakupan awal |
|---|---|---|
| Kasir | `CASHIER` | Login, buka shift, scan/pilih produk, penjualan, pembayaran, struk, setoran dan tutup shift. |
| Admin / Inventaris | `ADMIN` | Kelola produk, kategori, supplier, pembelian/penerimaan barang, restock, stok, laporan dan akun. |

**Catatan:** daftar modul di atas masih harus diterjemahkan menjadi requirement terverifikasi di `docs/product/PRD.md`. Pencatatan retur dan member kredit ada di notulen, tetapi prioritas dan prosedurnya belum dipastikan.

## 5. Model operasional yang diketahui

| Aspek | Kondisi / status |
|---|---|
| Lokasi awal | Minimarket kampus (`SOURCE`). |
| Komputer kasir | Direncanakan **satu stasiun/PC kasir** (`TEAM_DECISION` untuk MVP). |
| Shift | **Dua shift kerja** (`SOURCE`), bukan dua komputer kasir. |
| Perangkat tambahan | Scanner barcode dan printer struk (`SOURCE` dalam laporan rancangan). |
| Akses internet | Transaksi harus dapat berlangsung tanpa internet (`TEAM_DECISION`); cloud bukan prasyarat kasir melayani pembeli. |
| Penggunaan PC | `PENDING`: PC khusus kasir atau juga dipakai pekerjaan lain. |
| Spesifikasi PC / Windows | `PENDING`: RAM, prosesor, SSD/HDD, versi/edisi Windows. |
| Kewenangan admin | `PENDING`: apakah restock selalu dilakukan di PC kasir atau perlu akses perangkat lain. |
| Kebijakan setoran | `PENDING`: uang awal, uang akhir, selisih kas, siapa menyetujui, dan cara koreksi. |

## 6. Arah teknologi — belum semuanya final

| Lapisan | Arah saat ini | Status dan catatan |
|---|---|---|
| Frontend | React + Vite + TypeScript | `TEAM_DECISION` sebagai rancangan awal. |
| Backend lokal | Node.js + Express | `TEAM_DECISION` sebagai rancangan awal. |
| Database operasional | SQLite lokal | `TEAM_DECISION`: sumber operasional utama agar transaksi bisa offline. |
| Cloud | Supabase | `PROPOSED`: tujuan sinkronisasi/backup setelah core lokal stabil; kemampuan dan rancangan sinkronisasi belum disahkan. |
| Packaging desktop | Installer Windows `.exe` | `TEAM_DECISION` sebagai **target pengalaman pengguna**, belum keputusan implementasi final. |
| Desktop wrapper | Electron | `PROPOSED`: kandidat; perlu diuji terhadap spesifikasi perangkat. |
| Kiosk Windows | Penguncian tingkat OS | `PENDING`: hanya dipertimbangkan jika PC benar-benar khusus kasir dan kebutuhannya dikonfirmasi. |
| Pengembangan | VS Code, Git, GitHub, coding agent | `TEAM_DECISION`: kolaborasi satu repository. |

**Penting:** PDF rancangan awal menyebut aplikasi web lokal yang dibuka lewat Chrome. Diskusi kemudian mengarah pada pengalaman desktop Windows. Ini merupakan **perubahan arah yang disengaja tetapi teknologi finalnya belum dipilih** (`CONFLICT` yang perlu dicatat di `DECISIONS.md`), bukan alasan menghapus kemampuan menjalankan sistem secara lokal selama development.

### 6.1 Prinsip local-first

1. Transaksi operasional diproses dan disimpan secara lokal walaupun internet terputus.
2. Integritas penjualan dan perubahan stok harus dijaga dalam transaksi database yang konsisten.
3. Data yang berhasil disimpan secara lokal tidak otomatis berarti sudah tersalin ke cloud.
4. Sinkronisasi cloud memerlukan desain identitas unik, antrean pengiriman, retry aman, idempotensi, dan pemulihan konflik. Detailnya milik `SYNC_STRATEGY.md`.
5. Backup lokal berkala dan pengujian restore tetap diperlukan; **sinkronisasi bukan pengganti backup**.

## 7. Rancangan manajemen shift

Kebutuhan dua shift bersumber dari notulen; detail perilaku berikut adalah rancangan tim yang harus diuji bersama kasir minimarket.

### 7.1 Aturan awal

- `PROPOSED`: Pada satu stasiun kasir hanya boleh terdapat **satu shift aktif** pada satu waktu.
- `PROPOSED`: Saat membuka shift, catat identitas kasir, waktu mulai, dan modal awal jika proses tersebut memang digunakan minimarket.
- `TEAM_DECISION`: **Menutup jendela aplikasi, logout sesi, restart Windows, atau listrik mati tidak boleh otomatis menutup shift.**
- `PROPOSED`: Shift yang belum ditutup ditampilkan untuk dilanjutkan atau ditangani dengan prosedur supervisor setelah aplikasi kembali berjalan.
- `PROPOSED`: Penutupan shift harus melalui aksi eksplisit dan menghasilkan ringkasan transaksi, setoran dan selisih sesuai prosedur yang nanti dikonfirmasi.
- `PENDING`: Apakah admin boleh berpindah ke modul inventaris saat shift kasir aktif dan bagaimana proses otentikasi/kunci sesinya.

### 7.2 Kegagalan yang wajib diantisipasi

- Komputer mati setelah pembayaran tetapi sebelum struk tercetak.
- Aplikasi terhenti di tengah penyimpanan transaksi.
- Kasir mengulang klik bayar setelah timeout.
- Pergantian kasir terjadi ketika shift sebelumnya belum ditutup.

**Prinsip penerimaan:** transaksi yang sudah berhasil tersimpan tidak boleh tercatat dua kali akibat retry, dan stok tidak boleh berkurang tanpa transaksi penjualan yang valid. Perinciannya masuk PRD, DATABASE, dan TEST_CASES.

## 8. Fitur: pemetaan awal untuk penyusunan PRD

Ini **daftar kandidat**, bukan janji rilis atau prioritas final.

| Kelompok | Kebutuhan/kandidat | Status prioritas |
|---|---|---|
| Akses | Login dan pemisahan izin `ADMIN`/`CASHIER` | Kandidat MVP |
| Master data | Produk, barcode, kategori, supplier | Kandidat MVP |
| Kasir | Penjualan, perhitungan total, jenis pembayaran, cetak struk | Kandidat MVP; detail jenis pembayaran `PENDING` |
| Stok | Pengurangan stok saat penjualan, penerimaan barang, riwayat perubahan | Kandidat MVP |
| Shift | Buka/tutup shift, setoran kasir, ringkasan per shift | Kandidat MVP |
| Laporan | Penjualan harian/shift, persediaan dasar | Kandidat MVP |
| Keandalan | Operasi offline, backup dan restore lokal, pemulihan setelah restart | Kandidat MVP |
| Pembelian | Pencatatan pembelian dan barang masuk | Kandidat MVP; alur supplier `PENDING` |
| Retur | Retur barang | Berasal dari notulen; prioritas `PENDING` |
| Kredit/member | Member kredit dan transaksi kredit | Berasal dari notulen; aturan/prioritas `PENDING` |
| Laporan lanjutan | Berdasarkan supplier/departemen | Berasal dari notulen; definisi/prioritas `PENDING` |
| Cloud | Sinkronisasi ke Supabase, akses lintas perangkat | Fase lanjutan yang diusulkan |
| Pembayaran digital | E-wallet/pop-up | Fase lanjutan, terkait rencana pemindahan ATM |
| Skala | Multi-stasiun atau multi-cabang | Di luar fokus MVP saat ini |

**Jangan mengganti penilaian ini menjadi status `CONFIRMED` tanpa persetujuan tim dan pihak minimarket.**

## 9. Kualitas, keamanan, dan keselamatan data

Hal-hal berikut perlu menjadi persyaratan sejak desain awal, meskipun dokumen teknis rinci dibuat bertahap:

- Password tidak disimpan dalam teks biasa; gunakan mekanisme hash password yang sesuai.
- Hak akses diperiksa di backend untuk setiap operasi penting.
- Penjualan dan perubahan stok dilakukan secara atomik dengan transaksi database.
- Gunakan query terparameterisasi, validasi input, pembatasan aksi berisiko, dan audit untuk perubahan kritis.
- Kunci layanan cloud rahasia tidak boleh berada di frontend, GitHub, atau installer yang dapat diambil sembarang pengguna.
- Database produksi dan data pelanggan nyata tidak digunakan sebagai data uji development.
- Prosedur backup harus disertai **uji restore**.
- Akun admin, perubahan harga, koreksi stok, pembatalan transaksi, dan penutupan shift perlu aturan otorisasi yang jelas.
- Jika menerapkan Electron, evaluasi isolasi proses, kebijakan navigasi, dan akses API lokal sebelum rilis.
- Fullscreen/kiosk aplikasi tidak setara dengan keamanan Windows; tidak dapat dianggap menonaktifkan akses ke seluruh OS.

Detail dan keputusan final berada di `SECURITY.md`, `AUTHORIZATION.md`, `DATABASE.md`, dan `BACKUP_RECOVERY.md`.

## 10. Pembagian peran tim

| Anggota | Fokus utama | Tanggung jawab kolaboratif |
|---|---|---|
| David | Koordinator, analisis kebutuhan, desain database | Menjaga konsistensi requirement, keputusan, dan review integrasi. |
| Syafroni | Frontend dan UI/UX | Mengimplementasikan tampilan kasir/admin dan memastikan kontrak data sesuai backend. |
| Rahmat | Backend dan integrasi | API, logika transaksi/stok, persistensi SQLite, dan integrasi tahap berikutnya. |
| Naazmi | QA, dokumentasi, dan integrasi | Test case, laporan bug, pengujian perangkat, dan validasi fitur terhadap acceptance criteria. |

Pembagian fleksibel. Setiap perubahan schema, kontrak API, aturan transaksi, dan hak akses harus direview lintas pemilik komponen.

## 11. Cara kerja repository dan AI agent

- Semua anggota mengerjakan **satu repository GitHub**, bukan empat aplikasi yang dibuat sendiri-sendiri.
- Setiap anggota memakai branch/PR untuk perubahan fitur, dan menjalankan pengujian sesuai jenis perubahan.
- Setiap developer menggunakan database **lokal development** masing-masing; jangan saling mengirim database produksi aktif.
- Coding agent boleh berbeda, tetapi harus merujuk pada dokumentasi yang sama.
- Baca `AGENTS.md` (jika tersedia), `CONTEXT.md`, kemudian PRD dan dokumen terkait tugas.
- Jangan mengubah arsitektur, menambah dependency besar, atau mengganti kontrak API secara diam-diam.
- Dokumentasikan asumsi dan laporkan hasil pengujian yang benar-benar dijalankan; jangan mengklaim tes berhasil bila belum diuji.
- Selesaikan satu alur vertikal kecil terlebih dahulu: produk → scan/pilih → transaksi → stok → laporan sederhana.

## 12. Ketergantungan dan risiko utama

| Risiko | Dampak | Tindakan saat ini |
|---|---|---|
| Persyaratan minimarket belum lengkap | Fitur yang dibuat salah sasaran | Survei alur kasir dan admin; validasi PRD. |
| Tenggat langganan Desember 2026 | Waktu uji coba terbatas | MVP bertahap; jangan mengganti sistem lama sebelum uji terima. |
| Spesifikasi PC tidak diketahui | Electron/installer mungkin terlalu berat | Ukur dan uji pada PC yang akan dipakai. |
| Gangguan listrik / kerusakan PC | Transaksi terhenti dan risiko kehilangan data | Pertimbangkan UPS, backup terpisah, recovery test. |
| Internet tidak stabil | Sinkronisasi cloud tertunda | Local-first; antrean sinkronisasi ditunda sampai desain matang. |
| Penggunaan AI oleh tim pemula | Bug, perubahan kode tidak terkontrol | PR review, pengujian, requirement terukur, dokumentasi. |
| Project senior belum tersedia | Duplikasi pekerjaan atau migrasi tidak jelas | Minta akses/status proyek senior. |
| Migrasi data dari sistem lama belum jelas | Barang/supplier/saldo awal tidak akurat | Inventarisasi ekspor dan prosedur cutover. |

## 13. Pertanyaan prioritas untuk minimarket

**Kritis sebelum finalisasi PRD dan desain:**

1. Apakah *sistem gudang* memang hanya modul admin/inventaris, atau ada petugas gudang dengan alur/akun tersendiri?
2. Apakah komputer dipakai khusus kasir? Apakah admin mengelola barang pada PC yang sama atau laptop lain?
3. Apa versi/edisi Windows, RAM, CPU, kapasitas disk, serta tipe scanner dan printer?
4. Bagaimana prosedur sebenarnya untuk buka shift, modal awal, serah terima, setoran, selisih kas, dan otorisasi koreksi?
5. Dalam laporan pembayaran, apa arti tepat *kredit* dan *debit*? Apakah termasuk piutang member, kartu, transfer atau EDC?
6. Bagaimana proses pembelian, penerimaan barang, retur, penyesuaian stok, dan stok opname?
7. Apa maksud kategori *departemen* di laporan? Apakah departemen kampus, kategori barang, atau unit pembelian?
8. Apa yang dimaksud *real-time post* dan apa yang harus terjadi saat internet mati?
9. Apakah data produk/stok dari sistem berlangganan dapat diekspor? Dalam format apa?
10. Kapan persis langganan sistem lama berakhir, dan kapan harus ada uji coba/serah terima?

**Perlu dipastikan sebelum implementasi lanjutan:**

11. Apakah ada beberapa level admin atau supervisor?
12. Apakah retur dan member kredit wajib ada pada MVP?
13. Apakah laporan harus dipantau dari luar minimarket pada hari pertama?
14. Bagaimana kebijakan backup, retensi data, dan penyimpanan media eksternal?
15. Apa hubungan operasional pemindahan ATM dengan kebutuhan pembayaran e-wallet/pop-up?

## 14. Keputusan yang belum boleh dianggap final

- Electron vs alternatif desktop lain; keputusan bergantung pada pengujian PC.
- Kiosk atau pembatasan Windows tingkat sistem operasi.
- Akses admin dari perangkat berbeda.
- Aturan lengkap kredit, debit, piutang, refund, retur, setoran, dan penanganan selisih uang.
- Implementasi sinkronisasi dua arah vs backup satu arah, jadwal dan skema cloud.
- Detail skema database, endpoint API, izin tiap aksi, dan target performa numerik.
- Prioritas akhir seluruh fitur yang berasal dari notulen.

## 15. Sumber, dokumen rujukan, dan penanganan konflik

### 15.1 Sumber saat penyusunan

1. **Notulen projek sistem basis data** — teks yang dibagikan pengguna dalam diskusi (sumber kebutuhan awal).
2. **LAPORAN RANCANGAN AWAL.pdf** — laporan awal delapan halaman tentang sistem kasir/inventaris berbasis web lokal, SQLite, MVP, dan pembagian tugas.
3. **Diskusi keputusan rancangan 9 November 2026** — satu aplikasi dua role; target desktop; mode kasir; manajemen shift tidak otomatis tertutup; status fitur kiosk/admin multi-perangkat belum pasti.

> Referensi sumber di atas tidak otomatis berarti file tersedia di repository. Jika ingin AI agent dapat membacanya, letakkan salinannya di `references/` dan catat nama/path sebenarnya di sini. Agent tidak boleh mengaku membaca file yang tidak tersedia.

### 15.2 Konflik atau perubahan yang diketahui

| Topik | Sumber awal | Arah terbaru | Penanganan |
|---|---|---|---|
| Tampilan aplikasi | Laporan menyebut web lokal via Chrome | Target pengalaman desktop Windows `.exe` | Catat sebagai perubahan arah; validasi opsi packaging sebelum implementasi. |
| Sistem kasir + gudang | Notulen menyebut dua sistem | Satu aplikasi, modul kasir + admin/inventaris | Keputusan tim untuk rancangan; arti *gudang* tetap perlu konfirmasi minimarket. |
| Offline | Laporan mencantumkan offline, termasuk daftar lanjutan | Operasi offline menjadi kebutuhan inti | Spesifikasikan di PRD dan uji dari MVP, jangan menganggap offline hanya fitur nanti. |
| Cloud | Rancangan awal: tahap lanjutan | Supabase diusulkan untuk cloud | Tetap fase lanjutan sampai ada desain dan validasi operasional. |

### 15.3 Peta dokumentasi yang direncanakan

- `CONTEXT.md` — konteks dan status keputusan (**file ini**).
- `AGENTS.md` — aturan kerja agent dan standar penggunaan sumber.
- `docs/product/PRD.md` — persyaratan produk, prioritas, workflow, acceptance criteria.
- `docs/product/DECISIONS.md` — alasan keputusan dan alternatif yang ditolak/ditunda.
- `docs/architecture/ARCHITECTURE.md` — komponen dan deployment.
- `docs/architecture/DATABASE.md` — model data dan integritas.
- `docs/architecture/API_CONTRACT.md` — kontrak API.
- `docs/security/AUTHORIZATION.md` — hak akses rinci.
- `docs/security/SECURITY.md` — model keamanan dan kebijakan implementasi.
- `docs/operations/TEST_PLAN.md` — rencana pembuktian fitur.
- `docs/product/TASKS.md` — status pekerjaan dan penanggung jawab.

**Jangan membuat 33 file hanya untuk memenuhi jumlahnya.** Tambahkan dokumen rinci ketika ada substansi yang dapat dipertanggungjawabkan.

## 16. Langkah kerja terdekat

1. Review file ini bersama seluruh anggota; koreksi detail yang tidak sesuai.
2. Simpan notulen dan laporan asli ke folder referensi repository.
3. Konfirmasi pertanyaan kritis (bagian 13) kepada minimarket; simpan jawabannya dengan tanggal dan narasumber.
4. Susun `docs/product/PRD.md` berdasarkan sumber dan status validasinya, bukan asumsi tersembunyi.
5. Catat keputusan desain dalam `docs/product/DECISIONS.md`.
6. Susun rancangan arsitektur, database, API, otorisasi, dan rencana pengujian yang saling konsisten.
7. Mulai implementasi satu fitur end-to-end, lalu lakukan review dan pengujian nyata.

## 17. Aturan pemeliharaan CONTEXT.md

- Perbarui file saat keputusan produk/arsitektur utama, risiko, status proyek, atau asumsi penting berubah — **bukan setiap kali ada commit kecil**.
- Setiap perubahan penting perlu mencatat tanggal, alasan, dan sumber keputusan pada `DECISIONS.md` jika file tersebut tersedia.
- Tandai informasi yang masih belum pasti; jangan menaikkannya menjadi fakta hanya karena muncul berulang di dokumen AI.
- PRD memegang rincian kebutuhan; DATABASE memegang rincian skema; AGENTS memegang instruksi kerja agent. File ini cukup merangkum dan menghubungkan semuanya.
- Bila isi file ini bertentangan dengan hasil wawancara terbaru yang telah diverifikasi, laporkan konflik dan perbarui dokumentasi terkait secara terkendali.

---

**Status akhir dokumen:** Draft untuk review internal. **Belum menjadi persetujuan kebutuhan dari pihak minimarket dan belum menjadi bukti sistem siap produksi.**
