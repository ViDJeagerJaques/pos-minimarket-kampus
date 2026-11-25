# Sinkronisasi Excel lokal — rancangan sandbox untuk review

ADMIN dapat membaca `GET /sync/excel` (`file`, `lastSync`), menyimpan tujuan dengan `POST /sync/excel/config` (`file` absolut `.xlsx`), dan memperbarui laporan melalui `POST /sync/excel/run`. CASHIER ditolak 403. `GET /reports/excel-sales` menyediakan penjualan committed untuk ADMIN. Tidak ada perubahan skema SQLite.

File asing ditolak; file khusus POS dibuat saat sinkronisasi pertama dan ditulis ulang dari penjualan committed. Perubahan manual dapat tertimpa. File sementara dibuat di direktori tujuan sebelum penggantian; kegagalan dilaporkan tanpa menganggap sinkronisasi sukses. Excel adalah laporan, bukan backup SQLite. Pemilihan file dan pembukaan menggunakan Electron; browser biasa tidak menyediakan tombol ini. Isolasi sandbox dan lokasi konfigurasi lokal tetap berlaku. Rancangan ini belum merupakan persetujuan go-live.
