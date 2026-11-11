# DATA PROTECTION — Penyimpanan Lokal, Sandi, dan Data Operasional

| Atribut | Nilai |
|---|---|
| Lokasi | `docs/security/DATA_PROTECTION.md` |
| Versi / status | 0.1.0 — baseline rancangan, bukan bukti konfigurasi PC |
| Referensi | SECURITY.md; AUTHORIZATION.md; BACKUP_RECOVERY.md; `../architecture/DATABASE.md`; `../product/SCOPE.md` |

## 1. Kategori data dan tujuan

| Data | Lokasi/tujuan | Perlindungan minimum | Tidak boleh |
|---|---|---|---|
| Username, role, active | SQLite `users`, login/otorisasi | Akses backend saja, audit perubahan role | Tampilkan hash sandi di UI/API |
| Password hash | `users.password_hash` | Hash adaptif salted, ACL file, backup terlindungi | Plaintext, log sandi, commit sandi seed |
| Sesi | `sessions.token_digest` | Token mentah hanya sesaat di transport aman; masa berlaku/revoke | Token mentah di log/DB/URL |
| Penjualan, harga snapshot, pembayaran | `sales`, `sale_items`, `payments` | Integritas SQLite, akses sesuai role, retensi sesuai kebijakan | Hapus transaksi untuk "memperbaiki" rekap |
| Identitas verifikator QRIS | `payments.verified_by/verified_at_ms` | Actor dari sesi, metadata minimal | PIN, nomor kartu, OTP, tangkapan layar sensitif tanpa SOP |
| Shift dan kas | `shifts`, `shift_closings` | Terproteksi role/owner, salinan backup | Membocorkan setoran ke kasir lain |
| Stok, penerimaan, adjustment | `inventory_movements`, `goods_receipts` | Ledger dan alasan, audit aktor | UPDATE saldo langsung tanpa mutasi |
| Audit log | `audit_log` | Redaksi field, akses terbatas, append-only service | Token/sandi/full payload pembayaran |
| Backup/ekspor | Media yang disetujui | ACL, media terpisah, inventory backup, uji restore | Menyebut CSV sebagai cadangan DB yang setara |

Data pelanggan secara nominal **tidak perlu diidentifikasi** untuk transaksi Rp5.000 biasa. Member kredit dan profil pelanggan OUT dari P0. Jangan menambah NIK, nomor telepon, alamat, atau informasi pembayaran pribadi yang tidak dibutuhkan.

## 2. Lokasi dan hak akses Windows

- Simpan SQLite di direktori aplikasi-data yang **persisten dan dapat ditulis operator aplikasi**, bukan direktori kode, folder distribusi, `Program Files`, folder temp, atau folder yang bisa diakses semua pengguna Windows.
- Jika berbagi satu akun Windows untuk semua shift, ACL Windows tidak dapat membedakan kasir A/B. RBAC mencegah aksi lewat UI/backend, **bukan** akses file langsung dari akun Windows yang memiliki izin DB. Pengelola harus mengamankan login Windows/akses fisik dan membatasi software asing.
- Pastikan path normalisasi dan whitelist operasi backup/restore. Jangan menerima absolute path arbitrer dari renderer; jangan symlink traversal ke lokasi berbahaya.
- Proses berjalan dengan hak user biasa, bukan Administrator Windows. Installer boleh meminta elevasi pada langkah terpisah bila benar-benar diperlukan; jangan menjalankan aplikasi penjualan sehari-hari dengan elevated privilege.
- Folder backup terpisah harus mengikuti prinsip least privilege. Bila backup di USB, catat penjaga media dan tempat penyimpanan. At-rest encryption adalah **opsi yang memerlukan manajemen kunci**, bukan asumsi bahwa SQLite standar terenkripsi.

## 3. Password dan autentikasi

Gunakan pustaka hash sandi yang dipelihara (mis. Argon2id) dengan salt unik; kalibrasi parameter terhadap PC nyata dan uji penundaan login. Jangan hash dengan SHA-256 biasa untuk sandi, dan jangan memasukkan salt/pepper atau password ke GitHub. Respons login gagal tidak membedakan username salah/akun nonaktif. Pembatasan retry jangan menimbulkan penguncian permanen tanpa prosedur admin offline.

## 4. SQLite dan input

- `PRAGMA foreign_keys=ON` untuk tiap koneksi; periksa benar-benar aktif. Tentukan `journal_mode`, `synchronous`, `busy_timeout` dan lokasi WAL berdasarkan uji kompatibilitas driver, crash dan backup; jangan menganggap konfigurasi default cukup tanpa tes.
- Gunakan parameter binding untuk input nama produk, kode barang, filter tanggal dan metadata audit. Whitelist nama kolom/ORDER BY. Batas panjang input, kuantitas integer, harga integer dan validasi barcode sebagai **string** (nol depan tidak hilang).
- Rekaman penjualan/mutasi tidak diedit untuk mengoreksi kesalahan. Update master harus mempertahankan snapshot harga saat penjualan dan dicatat di audit.
- SQLite DB, file WAL/SHM, dan cache tidak boleh ikut masuk repo. `gitignore` wajib mencakup data runtime, ekspor sensitif, snapshot, dan `.env` nyata.

## 5. Proteksi renderer, API dan peripheral

- Electron `nodeIntegration=false`, `contextIsolation=true`, sandbox bila kompatibel, navigasi eksternal terlarang secara default, CSP yang membatasi sumber; preload bridge hanya daftar aksi tersaring. Gunakan proses utama untuk operasi berizin; jangan expose `fs`, `sqlite`, `child_process` atau IPC generic.
- Express loopback saja; semua route privat memerlukan sesi backend, cek Origin/Host/CORS/CSRF sesuai sesi, size limits, validasi skema, dan rate-limit login. Error tidak mengirim SQL, path internal, maupun stack trace ke UI.
- Barcode scanner dianggap keyboard input yang tak tepercaya. Escape nama barang saat tampil/cetak; jangan menyisipkan kode raw ke HTML. Printer menerima data transaksi final saja; isi struk tidak berisi token atau data bank.

## 6. Backup, ekspor, retensi

- Backup SQLite memakai metode snapshot konsisten dan diuji restore. Jangan hanya `copy` file SQLite aktif saat WAL sedang menulis. Retensi minimal yang dipakai selama pilot harus diumumkan dan disetujui; contoh usulan **7 salinan harian + 4 salinan mingguan**, bukan kebijakan final.
- Ekspor CSV bila tersedia harus mencakup formula injection protection (awalan karakter `=`, `+`, `-`, `@` pada teks perlu disanitasi untuk pembukaan di spreadsheet) dan penyimpanan di path pilihan yang aman. CSV tidak dapat memulihkan relasi dan idempotency SQLite secara lengkap.
- Jika file lama/backup dibuang, ikuti prosedur pengelola untuk penghapusan aman dan dokumentasikan siapa dan kapan. Retensi laporan keuangan/arsip mengikuti ketentuan yang berlaku setelah dikonfirmasi; jangan menetapkan masa retensi hukum tanpa kajian.

## 7. Pemulihan insiden kebocoran/kehilangan

Hentikan aplikasi bila dicurigai manipulasi DB/installer; amankan log dan snapshot untuk investigasi; jangan membuka login baru pada instalasi yang tidak tepercaya. Ganti kredensial terdampak, verifikasi sumber installer dan lakukan restore dari salinan yang telah diperiksa ke lingkungan terisolasi. Dokumentasikan gap transaksi sejak backup terakhir untuk rekonsiliasi manual. Eskalasi ke pengelola; tidak mengklaim bahwa backup memulihkan transaksi setelah titik cadangan.

## 8. Bukti uji

Periksa lokasi DB setelah installer/update, permission file, tidak ada data sensitif di renderer/log, logoff session, restore backup, serangan path traversal, injeksi SQL/CSV, dan sistem berjalan saat internet mati. Hasil aktual belum tersedia.
