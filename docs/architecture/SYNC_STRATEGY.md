# SYNC STRATEGY — Offline-first

| Atribut | Keterangan |
|---|---|
| Lokasi | `docs/architecture/SYNC_STRATEGY.md` |
| Versi | 0.1.0 — 11 November 2026 |
| Status | **BASELINE DESAIN UNTUK REVIEW TEKNIS** — bukan hasil uji/perizinan produksi |
| Acuan utama | `docs/product/PRD.md` v0.3.1, `SCOPE.md` v0.1.1, `DECISIONS.md` v0.2.3, `ACCEPTANCE_CRITERIA.md` v0.1.1 |
| Pemeriksa | David (model data), Rahmat (backend & integrasi), Syafroni (UI), Naazmi (QA) |

## 1. Cakupan rilis

P0 adalah **single device, local-only** (DEC-002–004). Tidak ada cloud synchronization, Supabase, server jarak jauh, atau replikasi multi-PC pada jalur checkout. Kata *sinkronisasi* dalam catatan awal tidak boleh dibaca sebagai fitur yang sudah disetujui untuk MVP. Penutupan shift **tidak bergantung pada internet**. Backup lokal bukan sinkronisasi cloud.

## 2. Source of truth

`SQLite` pada PC kasir adalah sumber data transaksi satu-satunya. Semua perubahan melalui backend lokal dan transaksi SQLite. Waktu transaksi dicatat lokal; apabila jam PC salah, ada risiko laporan tanggal dan harus ada prosedur pemeriksaan jam saat membuka shift. ID upaya tidak dibuat ulang setelah restart.

| Kondisi | Perilaku wajib |
|---|---|
| Internet mati sejak aplikasi dibuka | Login lokal, CASH, stok, laporan, shift tetap bisa digunakan |
| Internet putus saat QRIS manual | POS tetap hidup; kasir tidak menyatakan lunas sebelum dapat bukti berhasil di kanal merchant |
| PC restart sebelum commit | Muat kembali draft/upaya; periksa status sebelum mengulang |
| PC restart setelah commit sebelum cetak | Temukan sale committed; cetak ulang dari sale yang sama |
| Selesai shift | Rekap dan backup konsisten lokal; kegagalan backup dilaporkan dan tidak disembunyikan |

## 3. Backup bukan sinkronisasi

Backup konsisten via SQLite backup API atau mekanisme yang divalidasi; jangan menyalin file `.db` aktif sembarangan terutama bila WAL diaktifkan. Simpan di media fisik terpisah; lakukan restore drill, `integrity_check`, dan rekonsiliasi sale count/omzet/stock. CSV/Excel hanya ekspor laporan, bukan pemulihan penuh. Detail kontrol ada di `docs/security/BACKUP_RECOVERY.md` yang belum final pada tahap Architecture.

## 4. Fase lanjutan (hanya rancangan, bukan P0)

Jika kelak butuh cloud, tinjau kembali DEC-020, tentukan pengenal global per event, outbox atomik, versi skema, replay idempotent, penanganan duplikasi/konflik, akses data dan keamanan transport. Jangan menjadikan pembayaran QRIS manual sebagai sebuah *cloud confirmation event*; itu adalah attestasi kasir. Cloud tidak boleh mengubah histori sale yang telah committed tanpa aturan koreksi/audit.

## 5. Kriteria evaluasi sebelum mengaktifkan cloud

1. Bukti stabilitas transaksi satu PC dan pemulihan lokal; 2. persetujuan pemilik dan kebijakan privasi; 3. operator dan biaya hosting yang jelas; 4. model konflik multi-device; 5. enkripsi dan autentikasi; 6. uji putus-sambung. Bila belum dipenuhi, status cloud tetap OUT.
