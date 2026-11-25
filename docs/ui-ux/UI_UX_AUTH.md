# UI/UX AUTH - POS Minimarket Kampus

| Atribut | Nilai |
|---|---|
| Versi | 0.1.0 |
| Lokasi | `docs/architecture/UI_UX_AUTH.md` |
| Status | Rancangan visual; review teknis diperlukan |
| Lingkup | Login bersama Admin dan Kasir |
| Konsep | Centered Minimalist Login |

## 1. Tujuan dan acuan
Berdasarkan screenshot halaman Login dan redesign yang dibahas bersama pengguna. Satu halaman autentikasi lokal untuk kedua role. Baca AGENTS.md, DESIGN_SYSTEM.md, API_CONTRACT.md, AUTHORIZATION.md, PRD.md dan DECISIONS.md versi aktif sebelum perubahan. Dokumen ini tidak menggantikan aturan keamanan. Ganti Sandi tetap didokumentasikan di UI_UX_ADMIN.md dan UI_UX_CASHIER.md; gunakan komponen bersama jika memungkinkan.

## 2. Identitas visual
Gunakan token DESIGN_SYSTEM.md sebagai sumber kanonis: primary #267349, hover #1F5E3B, background #F7F9F8, surface #FFFFFF, border #D9E2DD, text #1F2937, muted #6B7280, warning #B85A00, danger #DC2626. Font Inter lokal atau Segoe UI, radius card 14 px, input dan tombol 10 px. Gunakan Lucide SVG lokal, bukan emoji atau simbol keyboard sebagai ikon. Tidak perlu split screen, foto, gradient, ilustrasi atau animasi dekoratif.

## 3. Layout desktop
Target 1366 x 768. Background netral, konten terpusat horizontal dan vertikal, dengan scroll tunggal bila layar lebih kecil. Banner DEMO ringkas di atas selama mode DEMO; jangan menghilangkan penjelasan bahwa data pengujian bukan transaksi uang sungguhan.

| Urutan vertikal | Komponen |
|---|---|
| 1 | Ikon Store putih dalam kotak hijau (ikon sementara, bukan logo resmi) |
| 2 | POS Minimarket |
| 3 | Sistem Kasir dan Inventaris Kampus |
| 4 | Card Masuk ke akun |
| 5 | Nama pengguna, ikon User, autofocus |
| 6 | Kata sandi, ikon LockKeyhole dan Eye/EyeOff di kanan |
| 7 | Tombol Masuk selebar form |
| 8 | Pemisah dan bantuan Hubungi administrator |
| 9 | Status/kemampuan lokal di bawah card |
| 10 | Identitas POS Minimarket Kampus di footer |

Card lebar 420-460 px, padding 28-32 px, input dan tombol tinggi 48 px, jarak antarfield 16 px. Label selalu terlihat. Deskripsi: Gunakan akun yang telah diberikan oleh pengelola. Bantuan: Belum memiliki akun atau lupa kata sandi? Hubungi administrator. Gunakan teks bantuan biasa, bukan kotak error oranye. Hindari istilah loopback/API pada tampilan normal. Teks Sistem lokal - Mendukung mode offline menjelaskan kemampuan sistem, bukan klaim layanan sedang sehat. Indikator kesehatan aktual hanya bila didukung backend.

## 4. Interaksi
- Nama pengguna fokus otomatis saat halaman siap.
- Tab bergerak secara logis; Enter mengirim form hanya jika valid; tombol tampil/sembunyi kata sandi tidak mengirim form.
- Kata sandi tersembunyi secara default, Eye/EyeOff diberi label aksesibel. Jangan menyimpan kata sandi di local storage, log, atau telemetry.
- Tombol Masuk nonaktif ketika field wajib kosong atau permintaan berjalan. Jangan mengubah kata sandi melalui trimming atau transformasi.
- Backend lokal mengautentikasi dan menentukan role serta sesi. Tidak ada dropdown pilihan Admin/Kasir.
- Setelah sukses, Admin menuju Dashboard dan Kasir menuju halaman Kasir; jika shift belum aktif, gunakan state pembukaan shift sesuai dokumen Kasir.
- Setelah logout atau sesi diakhiri, kembali ke Login sesuai kontrak existing dan bersihkan state sensitif. Jangan menyatakan berhasil sebelum backend mengonfirmasi.

## 5. State dan pesan
| State | Tampilan |
|---|---|
| Normal | Form siap, fokus nama pengguna |
| Input kosong | Petunjuk netral, tombol belum aktif |
| Memproses | Sedang masuk..., cegah submit ganda |
| Kredensial salah | Nama pengguna atau kata sandi tidak sesuai. |
| Akun tidak dapat digunakan | Pesan aman sesuai kebijakan backend; hindari membocorkan keberadaan akun |
| Layanan lokal tidak tersedia | Sistem belum siap. Coba kembali atau hubungi administrator. |
| Sesi berakhir | Silakan masuk kembali. |
| Berhasil | Arahkan berdasarkan role yang diterima dari backend |

Internet mati tidak sama dengan backend lokal tidak tersedia. Login harus tetap bekerja tanpa internet selama layanan lokal sehat. Retry, status akun nonaktif, session expiry, dan aturan pembatasan percobaan mengikuti implementasi serta kebijakan keamanan existing. Jangan menampilkan detail stack trace, token, atau kredensial kepada pengguna.

## 6. Batas lingkup
Tidak ada registrasi mandiri, login Google, CAPTCHA, Remember Me atau reset sandi mandiri dalam redesign ini. Administrator tetap mengelola akun kasir sesuai otorisasi. Tidak mengubah kontrak API, database, cara hash sandi, atau mekanisme sesi. Ikon toko adalah usulan sementara. Tidak ada klaim pengujian autentikasi langsung; desain disusun berdasarkan screenshot dan diskusi.

## 7. Acceptance checklist
- [ ] Login terpusat dan konsisten dengan design system Admin/Kasir.
- [ ] Tampilan terbaca pada resolusi target, tanpa scroll horizontal.
- [ ] Tab/Enter, autofocus, focus ring dan toggle sandi berfungsi.
- [ ] Tidak ada emoji atau simbol keyboard sebagai ikon; aset tersedia offline.
- [ ] Kredensial salah, akun nonaktif, layanan lokal gagal dan sesi berakhir ditangani sesuai kontrak.
- [ ] Tidak ada submit ganda atau kebocoran kredensial.
- [ ] Role hanya ditentukan backend, pengalihan Admin/Kasir sesuai hak akses.
- [ ] Login bekerja saat internet mati dengan backend lokal sehat.
- [ ] Banner DEMO tetap jelas; tidak mengklaim readiness tanpa data.
- [ ] Regression test autentikasi dan otorisasi lulus.

## 8. Implementasi
Audit kode dan versi dokumen aktif, susun rencana, review tim, implementasi dan pengujian. Jangan commit/push tanpa persetujuan. File ini berisi spesifikasi dan layout tekstual, bukan gambar pixel-perfect atau kode siap produksi.
