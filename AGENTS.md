# AGENTS.md

Panduan kerja untuk AI coding agent di repository Sistem Kasir dan Inventaris Minimarket Kampus.

## 1. Project Overview

MVP melayani satu stasiun kasir dengan dua shift berurutan dalam satu aplikasi, dengan role `ADMIN` dan `CASHIER`. Prioritaskan penjualan, pencatatan stok, dan serah terima shift yang berjalan lokal. SQLite lokal menyimpan data operasional. Target distribusi adalah desktop Windows dengan installer `.exe`, dengan target biaya pengembangan perangkat lunak Rp0. Gunakan lingkup PRD untuk menentukan fitur yang boleh dikerjakan.

## 2. Source of Truth and Document Priority

| Sumber | Gunakan untuk |
| --- | --- |
| [DECISIONS.md](docs/product/DECISIONS.md) v0.1.0 | Status, alasan, batas dan riwayat keputusan. Hormati keputusan `ACCEPTED` dalam cakupannya. |
| [PRD.md](docs/product/PRD.md) v0.2.0 | Lingkup, alur, requirement `POS-*`, dan kriteria penerimaan `AC-*` di §5. |
| [CONTEXT.md](CONTEXT.md) v0.1.0 | Latar belakang, sumber kebutuhan awal, kendala dan pertanyaan lapangan. |
| `AGENTS.md` dan dokumen teknis yang tersedia | Prosedur kerja agent dan detail implementasi sesuai dokumen produk. |

Baca versi aktif di repository dan periksa status keputusan sebelum memakai rincian PRD. Jika requirement, register, atau kode berbeda, catat lokasi, ID, dan dampaknya. Eskalasikan bagian yang terdampak menurut §14. PRD dan register masih berstatus draft. Klaim kesiapan pilot memerlukan bukti uji dan validasi pengelola.

## 3. Decision Status Rules

| Status | Tindakan |
| --- | --- |
| `ACCEPTED` | Terapkan dalam batas entri. Cek keputusan turunan yang masih terbuka. |
| `PROPOSED` | Gunakan untuk baseline pengembangan atau uji yang relevan dan mudah dibalik. Tandai asumsi, fixture dan keterbatasannya. Minta review sebelum mengunci rancangan. |
| `PENDING` | Catat pertanyaan. Gunakan fixture berlabel untuk pekerjaan independen atau uji draft yang sudah ditentukan PRD. Tahan perilaku operasional yang bergantung pada jawaban. |
| `SUPERSEDED` | Ikuti penggantinya pada cakupan yang dicatat dan pertahankan jejak historis. |
| `REJECTED` | Keluarkan opsi dari implementasi. Tinjau ulang hanya lewat review dengan bukti baru. |

P0 di PRD adalah target rilis draft. React/Vite/TypeScript dan Node.js/Express merupakan baseline usulan (DEC-010). Electron adalah kandidat wrapper (DEC-011) dan Supabase kandidat cloud fase lanjutan (DEC-020). SQLite lokal dan target desktop Windows berstatus `ACCEPTED` (DEC-004/005).

## 4. Repository Structure and Ownership

Ikuti struktur yang sudah ada. Periksa instruksi di direktori target sebelum mengedit. `CONTEXT.md` dan `AGENTS.md` berada di root, sedangkan PRD dan register keputusan berada di `docs/product/`. CONTEXT §15.3 memetakan dokumentasi teknis yang direncanakan. Temukan lokasi kode, tes, dan migrasi dari checkout. Buat struktur baru hanya bila tugas membutuhkannya dan setelah review jika berdampak lintas modul.

| Pemilik utama | Fokus |
| --- | --- |
| David | Koordinasi, requirement, desain database dan review integrasi |
| Syafroni | Frontend, UI/UX kasir dan admin, kontrak frontend |
| Rahmat | Backend, API, transaksi, SQLite dan integrasi |
| Naazmi | QA, dokumentasi, pengujian perangkat dan integrasi |

Libatkan pemilik komponen terdampak saat mengubah skema, kontrak API, izin, atau aturan transaksi.

## 5. Agent Workflow Before Coding

1. Baca dokumen produk dan bagian teknis terkait. Petakan tugas ke `POS-*`, `AC-*` dan `DEC-*` jika tersedia. Jika ID tidak tersedia, catat sumber atau lingkup tugas.
2. Periksa kode, tes, migrasi, perintah proyek, dan status Git. Identifikasi perubahan pengguna yang harus dipertahankan.
3. Periksa status keputusan serta prasyarat implementasi dan pilot. Tandai konflik dan keputusan terbuka yang memengaruhi tugas.
4. Sampaikan rencana singkat, file atau modul yang diperkirakan terdampak, serta uji yang akan dijalankan. Untuk review, sebutkan lingkup dan bukti yang akan diperiksa.
5. Lanjutkan pilihan kecil yang aman dan mudah dibalik. Eskalasikan keputusan berisiko tinggi menurut §14.

## 6. Implementation Rules

- Kerjakan perubahan terkecil yang memenuhi kriteria uji. Gunakan alur dan komponen yang ada. Pertahankan kontrak, perilaku pengguna, dan data lama yang masih didukung.
- Validasi input di backend. Tangani error secara eksplisit dan tampilkan status yang sesuai hasil penyimpanan. Hindari perubahan pada modul lain tanpa alasan yang terkait tugas.
- Gunakan transaksi database untuk perubahan data yang harus berhasil bersama. Pastikan jalur normal dan pemulihan dapat berjalan tanpa internet.
- Sebelum memasang dependensi baru, jelaskan kebutuhan, opsi yang sudah tersedia, dan dampaknya pada biaya, keamanan, mode offline, serta paket Windows. Minta review bila dependensi mengubah arsitektur atau distribusi secara signifikan.

## 7. Database and Transaction Safety

- **Checkout (POS-03.02–06).** Backend memvalidasi shift aktif milik kasir, keranjang, harga yang disetujui, pembayaran dan kebijakan stok saat commit. Minta persetujuan total baru jika harga berubah. Simpan penjualan, item beserta harga saat transaksi, data pembayaran dan mutasi stok sebagai satu transaksi SQLite. Kegagalan sebelum commit harus rollback utuh.
- **Retry dan pemulihan (POS-04.01–03, DEC-013).** Ikuti baseline PRD dengan mencatat identitas upaya secara lokal sebelum checkout dan menyimpan identitas serta hasil dalam commit yang sama. Periksa kepemilikan dan hasil lama sebelum memvalidasi checkout baru. Retry identik, termasuk permintaan paralel atau sesudah shift ditutup, mengembalikan hasil asli. Tolak kunci yang sama dengan isi berbeda. Jika status belum jelas, arahkan kasir untuk memeriksa status tersimpan dan bukti pembayaran fisik sebelum mencoba lagi.
- **Cetak (POS-04.03).** Cetak setelah commit. Jika printer gagal, tampilkan kegagalan dan izinkan cetak ulang dari transaksi tersimpan dengan nomor yang sama. Penjualan, pembayaran, dan stok tetap mengikuti commit awal.
- **Shift (POS-05.*, POS-06.*, DEC-006/012).** Persistensikan shift secara terpisah dari sesi login. Logout, tutup jendela, restart, dan listrik mati mempertahankan shift aktif yang telah tersimpan. Dalam baseline PRD, cegah dua shift aktif secara atomik. Tutup hanya lewat aksi eksplisit pemilik dengan data valid. Urutkan commit checkout dan tutup shift secara konsisten agar checkout yang lebih dulu tersimpan masuk rekap akhir dan checkout baru setelah penutupan ditolak. Retry penutupan identik mengembalikan hasil asli.
- **Penerimaan dan koreksi (POS-07.*, POS-03.07–08).** Commit penerimaan dan mutasinya bersama serta cegah pencatatan ganda. Jaga riwayat transaksi tersimpan dari edit/hapus langsung. Gunakan tunai dan pemblokiran stok negatif sebagai fixture awal sesuai PRD. Retur, void, refund, penyesuaian stok, dan aturan setoran menunggu keputusan terkait.
- **Skema dan pemulihan (POS-09.*).** Gunakan kueri terparameterisasi. Ajukan review migrasi sebelum implementasi dan uji pada salinan development yang representatif, termasuk data dari versi sebelumnya dan jalur pemulihan. Uji backup dan restore valid/rusak di lingkungan terpisah sesuai PRD. Cegah cadangan rusak menimpa database operasional.

## 8. Authentication and Authorization

- Login akun aktif harus berjalan lokal. Simpan hash kata sandi dan hindari membocorkan status akun melalui pesan gagal login.
- Backend wajib memeriksa sesi, role, izin per operasi dan kepemilikan objek seperti shift dan transaksi. Gunakan matriks PRD §2.1 sebagai baseline draft (DEC-014). Penyembunyian menu membantu navigasi. Penolakan di backend tetap wajib untuk akses langsung.
- Tolak aksi yang belum diizinkan. Pengambilalihan shift, peran supervisor dan akses dari perangkat lain menunggu DEC-019. Batasi layanan lokal sesuai topologi satu PC. Pisahkan izin operator Windows dari role aplikasi.
- Catat pelaku dan waktu pada perubahan kritis seperti status akun, harga, stok dan penutupan shift. Jaga kredensial dan secrets di luar source code, log, frontend, serta installer.

## 9. Offline-First and Windows Desktop Constraints

- Uji aplikasi dari kondisi internet sudah terputus sebelum dibuka. Login, shift, scan/cari, checkout, cetak, stok, dan laporan harus memakai jalur lokal.
- Pertahankan mode lokal untuk development. Target distribusi Windows `.exe` menggantikan pengalaman pengguna Chrome pada rancangan awal (DEC-005/022). Evaluasi wrapper berdasarkan Windows, spesifikasi PC, scanner, printer, dan alur offline pada perangkat tujuan. Uji agar pembaruan paket menjaga database dan konfigurasi lokal (POS-10.*).
- Kiosk OS menunggu DEC-019. Cloud dan e-wallet menunggu validasi terpisah. Jika sinkronisasi disetujui, bedakan status tersimpan lokal dan terkirim. Pastikan gangguan cloud tidak menghambat checkout atau penutupan shift. Cadangan lokal dan pemulihan tetap diuji secara terpisah.

## 10. Testing and Definition of Done

- Jalankan pemeriksaan proyek dan skenario `AC-*` yang relevan melalui jalur yang dipakai pengguna. Gunakan database development terpisah dan data sintetis. Catat perintah atau langkah, lingkungan, hasil, dan bukti yang dapat diperiksa.
- Pilih regresi berdasarkan risiko. Untuk akses, coba backend langsung dengan role atau kepemilikan yang salah. Untuk checkout dan stok, periksa data tersimpan setelah rollback, retry paralel, restart dan printer gagal. Untuk shift, uji pembukaan bersamaan, pemulihan shift aktif dan penutupan yang berbarengan dengan checkout.
- Untuk perubahan offline, backup, restore, dan paket Windows, jalankan skenario terkait di PRD. Cantumkan perangkat yang dipakai dan bedakan simulasi dari uji di PC tujuan.
- Tandai selesai bila perubahan berjalan melalui jalur normal, kriteria relevan terbukti, dan review yang diwajibkan sudah dipenuhi. Jika pengujian atau review wajib terhambat, catat hasil parsial, penyebab, dan langkah berikutnya. Kelulusan fixture pengembangan harus diikuti uji dengan SOP dan perangkat yang disahkan sebelum klaim siap pilot.

## 11. Git and Collaboration Rules

- Gunakan satu repository GitHub, branch dan PR per perubahan, serta database development masing-masing. Jaga diff tetap fokus dan pertahankan perubahan pengguna.
- Hubungkan PR dengan ID POS/AC dan DEC yang relevan, hasil uji yang benar-benar dijalankan, serta review lintas pemilik bila diperlukan. Jika tugas sudah tercatat di TaskPlanner, rujuk ID tugas tersebut untuk menjaga ketertelusuran.
- Commit dan push hanya atas instruksi eksplisit. Hindari reset, force push atau perubahan riwayat yang menghapus pekerjaan.

## 12. Documentation Update Rules

- Perbarui dokumen teknis terdampak bila perubahan yang disetujui mengubah kontrak API, skema, izin, atau langkah operasi. Pertahankan ketertelusuran antara kode, dokumentasi, dan uji.
- Perubahan requirement, scope, atau aturan bisnis perlu review sebelum memperbarui PRD. Catat keputusan yang disahkan di DECISIONS dengan status, cakupan, alasan berbukti, dan ID POS terdampak. Pertahankan riwayat serta catat tanggal dan narasumber bila tersedia. Perbarui CONTEXT bila konteks atau asumsi utama berubah.
- Laporkan dokumen yang belum tersedia atau masih berbeda dengan kode. Jangan membuat rujukan fiktif atau mengubah status hanya karena fitur sudah ditulis.

## 13. Prohibited Actions

- Menambah fitur tanpa persetujuan atau mengarang SOP minimarket, hasil rapat, hasil uji, atau persetujuan.
- Mengubah diam-diam requirement, aturan bisnis, kontrak publik, arsitektur, skema, atau izin.
- Memakai database produksi atau data pelanggan nyata untuk pengembangan dan pengujian.
- Menghapus atau mereset database, data operasional, atau migrasi tanpa prosedur yang disetujui. Jangan menimpa migrasi yang sudah diterapkan.
- Menyimpan kata sandi plaintext atau secrets dalam repository, termasuk fixture dan contoh konfigurasi.

## 14. Escalation and Open Questions

- Lanjutkan keputusan kecil yang lokal dan mudah dibalik, seperti penamaan internal atau penataan tes. Laporkan asumsi bila memengaruhi hasil.
- Tahan bagian yang terdampak dan ajukan review ke David serta pemilik terkait bila perubahan menyentuh scope, uang, stok, aturan shift, izin, kontrak API, skema/migrasi, arsitektur, distribusi, atau keselamatan data. Jika keputusan bergantung pada SOP atau perangkat, minta David dan Naazmi memvalidasi dengan pengelola. Lanjutkan pekerjaan independen yang aman.
- Sertakan ID POS/AC/DEC, sumber atau konflik, keputusan yang diperlukan, dampak, dan bagian yang dapat dilanjutkan. Rujuk PRD §10 dan DECISIONS untuk pertanyaan terbuka tentang pembayaran dan setoran, koreksi/retur dan kredit, stok dan laporan, supervisor dan akses perangkat, packaging, backup, cloud, serta pilot dan cutover.

## 15. Agent Completion Report Format

- **Status dan lingkup** — Selesai, parsial, terblokir, atau hasil review. Ringkas perubahan atau temuan.
- **File** — Daftar path yang diubah dan alasan. Untuk review, cantumkan lokasi temuan.
- **Ketertelusuran** — ID POS, AC, dan DEC yang relevan serta kriteria yang sudah atau belum terbukti.
- **Verifikasi** — Perintah atau langkah yang benar-benar dijalankan, lingkungan, hasil lulus/gagal, serta uji yang belum dijalankan dan alasannya.
- **Asumsi dan tindak lanjut** — Fixture, risiko, konflik sumber, keputusan terbuka, dan pekerjaan atau review yang masih diperlukan.
