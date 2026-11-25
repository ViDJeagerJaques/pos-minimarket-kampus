# Usulan review: identitas database untuk Sheets DEMO

Status HISTORIS: usulan migrasi tidak dipakai. Lihat revisi sandbox tanpa migrasi di bagian akhir. Tujuan: menjaga namespace stabil bersama database saat restart dan backup/restore, tanpa mengubah checkout.

Usulan migrasi aditif berikutnya `0005` membuat tabel satu baris `sheets_database_identity` dengan kolom `id INTEGER PRIMARY KEY CHECK (id = 1)` dan `namespace TEXT NOT NULL UNIQUE` dengan CHECK panjang dan karakter. Namespace 128 bit acak dibuat sekali oleh backend di transaksi SQLite dengan `INSERT ... ON CONFLICT DO NOTHING` sebelum konfigurasi Sheets diaktifkan. Snapshot/restore SQLite membawa namespace yang sama; instalasi database baru mendapat namespace baru. Penyalinan database menghasilkan identitas yang sama dan karena itu tidak boleh dijalankan bersamaan sebagai database independen tanpa prosedur pemisahan yang ditinjau. Tidak ada secret atau URL dalam tabel.

Konfigurasi sandbox menyimpan tujuan, secret, `databaseNamespace`, dan watermark sale ID yang dikonfirmasi saat aktivasi; antrean dan acknowledgement dipisahkan menurut namespace dan hash identitas tujuan. Penggantian secret pada tujuan sama tidak membuat antrean baru. Penggantian tujuan memerlukan konfirmasi cakupan eksplisit dan tidak boleh memindahkan acknowledgement/antrean lama secara diam-diam. Komit selama jendela antara simpan dan restart harus direkonsiliasi berdasarkan watermark yang persisten; penyimpanan konfigurasi dan pengambilan watermark memerlukan pengurutan atomik untuk mencegah transaksi hilang atau histori ikut terkirim. Jika ada antrean lama tanpa namespace/tujuan terverifikasi, tahan dan tampilkan status rekonsiliasi, jangan migrate otomatis.

Uji sebelum penerapan: migrasi dari versi 0004 pada salinan sintetis, integritas dan rollback migrasi, identitas stabil restart/backup-restore, database baru berbeda, transaksi bersamaan saat aktivasi, pemisahan tujuan, restart dan pending, kegagalan I/O, serta checkout tetap atomik. Perubahan skema dan konsekuensi restore/clone perlu review David dan pemilik backend/QA sesuai AGENTS.md §7 dan §14; tidak ada database existing yang disentuh oleh dokumen ini.

## Persetujuan terbatas dan implementasi lokal

Koordinator dan pemilik backend menyetujui implementasi dan pengujian migrasi identitas untuk SANDBOX saja. Persetujuan tidak meliputi database produksi, merge, atau go-live. Migrasi kandidat `0005_sheets_database_identity.sql` sempat diuji dengan fixture sintetis, kemudian dikeluarkan sebelum penerapan pada database existing. Salinan yang menjadi database independen memerlukan prosedur identitas terpisah yang belum diimplementasikan atau disahkan. Jangan menerapkan kandidat ini pada database existing.

Pada saat catatan ini dibuat sender dan konfigurasi belum terhubung; status tersebut telah diperbarui pada catatan kompatibilitas di bawah.

## Revisi sandbox tanpa migrasi

Atas arahan koordinator untuk satu database sandbox dan satu spreadsheet DEMO, kandidat migrasi 0005 dikeluarkan sebelum diterapkan. Implementasi memakai namespace acak di file konfigurasi lokal, terikat ke path serta identitas file database dan hash tujuan. Metadata ini tidak ikut backup SQLite; penggantian file/tujuan ditolak dan memerlukan rekonsiliasi. Ini bukan solusi identitas database untuk restore/clone produksi. Tidak ada persetujuan go-live atau migrasi produksi.

## Pembaruan kompatibilitas receiver existing

Backend aplikasi utama juga menyediakan konfigurasi lokal baru; sandbox tetap terisolasi. Konfigurasi lama PR #57 tetap dipakai dan tidak dimigrasikan otomatis. Receiver mempertahankan enam kolom dan deduplikasi nomor struk. Namespace baru membatasi satu database per deployment, tetapi payload legacy tanpa namespace tidak dapat membedakan database independen; jangan mencampur sumber tanpa rekonsiliasi. Pengujian lokal mock tidak membuktikan deployment, keamanan ACL Windows, atau kesiapan produksi.
