# SECURITY — POS Minimarket Kampus

| Atribut | Nilai |
|---|---|
| Lokasi | `docs/security/SECURITY.md` |
| Versi / status | 0.1.0 — **baseline rancangan keamanan untuk review**, 11 November 2026 |
| Penanggung jawab | David (kebijakan), Rahmat (backend), Syafroni (frontend), Naazmi (QA) |
| Acuan wajib | `../../CONTEXT.md`, `../../AGENTS.md`, `../product/PRD.md` v0.3.1, `../product/SCOPE.md` v0.1.1, `../product/DECISIONS.md` v0.2.3, `../product/ACCEPTANCE_CRITERIA.md` v0.1.1, `../architecture/ARCHITECTURE.md` v0.2.1, `../architecture/DATABASE.md` v0.2.1, `../architecture/API_CONTRACT.md` v0.1.1 |

## 1. Tujuan dan status

Menjaga uang, identitas operator, transaksi, stok dan kemampuan memulihkan usaha pada **satu PC Windows, dua role (ADMIN/CASHIER), SQLite lokal dan dua shift berurutan**. Sistem wajib bekerja tanpa internet untuk login dan penjualan tunai. QRIS adalah **QRIS_MANUAL**: konfirmasi kasir dari kanal merchant, **bukan verifikasi otomatis bank**. Keamanan adalah syarat penerimaan sistem, bukan fitur tambahan setelah rilis (SCOPE S-01, S-04, S-05, S-10–S-12).

Dokumen ini membedakan (a) prinsip minimum implementasi, (b) desain yang belum diimplementasikan, dan (c) SOP pengelola yang belum divalidasi. **Tidak ada hasil penetration test, audit kode, persetujuan pengelola atau bukti siap produksi** yang dinyatakan di sini.

## 2. Batas kepercayaan

```text
CASHIER/ADMIN -> Electron renderer (tidak tepercaya)
                 -> bridge terbatasi / HTTP loopback terautentikasi
                 -> backend lokal (otorisasi + validasi)
                 -> SQLite pada folder data persisten Windows
                 -> backup tersalin ke media terpisah
Kasir -> aplikasi/HP merchant QRIS (di luar POS; bukti dicek manusia)
Printer/scanner -> periferal lokal (input/output tidak dianggap sumber izin)
```

- Renderer, barcode, URL, payload API, nilai harga, status QRIS, dan setiap `userId`/`role` dari klien **tidak tepercaya**. Backend mengambil identitas dari sesi dan harga dari database.
- Batasi HTTP backend pada loopback (`127.0.0.1`) jika menggunakan Express; autentikasi semua route privat; periksa asal permintaan dan risiko akses website lokal/cross-origin. Jangan membuka port LAN/Internet untuk MVP.
- Jika Electron dipilih: `contextIsolation: true`, `nodeIntegration: false`, sandbox sesuai kompatibilitas; bridge IPC menggunakan daftar fungsi eksplisit; batasi navigasi, pop-up dan pemuatan konten eksternal. Jangan memberikan akses file/database langsung ke renderer.
- Proses backend dan SQLite tetap memiliki batas dari keamanan akun Windows dan perangkat. Orang dengan hak OS tinggi dapat merusak file lokal: klaim "RBAC melindungi dari administrator Windows" adalah **tidak benar**.

## 3. Kontrol minimum rilis (keharusan implementasi)

| ID | Kontrol | Implementasi dan bukti wajib | Rujukan |
|---|---|---|---|
| SEC-01 | Login offline dan akun aktif | Hash sandi adaptif ber-salt, sesi acak; akun nonaktif ditolak; test tanpa internet | POS-01.01–04 / AC-01.01–04 |
| SEC-02 | RBAC backend | ADMIN/CASHIER diperiksa di handler; pengujian akses langsung tanpa UI dan ownership; default deny | POS-01.03 / AC-01.03 |
| SEC-03 | Shift persisten dan terlindungi | Login/logout tidak menutup shift; hanya owner CASHIER yang menutup baseline; konkurensi dijaga | POS-05–06 / AC-05–06 |
| SEC-04 | Penjualan dan saldo atomik | SQLite transaksi tunggal untuk sale, item, payment, movement, result idempotensi; test crash/retry | POS-03.05, POS-04.* |
| SEC-05 | QRIS manual aman | Tanda lunas hanya setelah kasir memeriksa kanal merchant; `verified_by` dari sesi; ketidakpastian -> rekonsiliasi, bukan bayar ulang | POS-03.09 / AC-03.09 |
| SEC-06 | Pembatasan stok & audit | Blok stok negatif sesuai fixture; koreksi hanya ADMIN dengan alasan dan mutasi/audit; tak mengedit histori penjualan | POS-03.06, POS-07.03 |
| SEC-07 | Basis data aman | Foreign key aktif per koneksi; query terparameter; data dan backup di lokasi persisten dengan ACL Windows | DEC-004 / DATABASE.md |
| SEC-08 | Data rahasia | Sandi/PIN/token/hash sesi tidak di log, struk, ekspor, atau renderer; tidak ada kredensial merchant dalam POS | DATA_PROTECTION.md |
| SEC-09 | Backup + pemulihan | Snapshot SQLite konsisten, salinan terpisah, restore ke lokasi uji, verifikasi integritas/referensial | POS-09.* / AC-09.* |
| SEC-10 | Bukti cutover | Skenario keamanan dan transaksi lulus di PC tujuan; kritis = NO-GO; rollback tersedia | SCOPE §7, AC-GO-01 |

## 4. Keputusan keamanan operasional

- Tidak ada akun bersama/identitas palsu yang dipakai untuk menyembunyikan pelaku transaksi. Setiap kasir harus memiliki akun sendiri; pengelola menyetujui pemegang ADMIN.
- ADMIN **tidak secara otomatis menjadi kasir**. Endpoint `POST /shifts/open` dalam API_CONTRACT.md masih mencantumkan ADMIN secara bersyarat, sedangkan database mengikat shift ke `cashier_id`. **Kontrak belum sinkron**: aturan paling aman sebelum keputusan baru adalah hanya CASHIER membuka/melanjutkan/menutup shift miliknya. Lihat AUTHORIZATION.md §6 dan AUDIT_SECURITY.md.
- ADMIN bisa membaca laporan lintas shift, mengurus katalog, penerimaan dan koreksi stok; CASHIER tidak bisa mengubah stok atau harga. Hak backup/restore dilindungi ADMIN dengan prosedur dan autentikasi ulang bila disetujui.
- Koreksi penjualan setelah commit, refund, retur, void, member kredit, QRIS otomatis, sync cloud dan admin override shift **tidak diaktifkan** untuk MVP; jika proses nyata mengharuskan, rilis ditinjau ulang (SCOPE §4).
- Jangan memberi fungsi restore bebas memilih path dari request renderer. Jalankan pemeliharaan di jendela downtime dengan runbook dan operator yang berwenang.

## 5. Implementasi aman dan verifikasi

1. Tulis test keamanan **sebelum** fitur dianggap selesai: login offline, account disable, role denial, ownership, SQL injection, salah nominal QRIS, duplicate checkout, stok kurang, shutdown saat transaksi, backup rusak.
2. PR Rahmat meninjau handler backend, transaksi SQLite, sesi dan error; Syafroni memeriksa renderer/bridge; Naazmi menjalankan test negatif; David memvalidasi aturan kasir bersama pengelola.
3. CI (jika tersedia) memeriksa unit/contract tests, dependency advisory, dan kebocoran secrets; hasil scanner tidak menggantikan review. Kunci API tidak boleh disimpan di repo dan `.env.example` tidak mengandung nilai nyata.
4. Release berupa paket terkontrol. Catat versi, checksum installer, hasil pemindaian yang tersedia, hasil smoke test di Windows nyata, serta rollback. Jangan auto-update langsung saat transaksi/shift aktif.

## 6. Titik keputusan yang belum boleh dianggap disetujui

- **VAL-01:** identitas dan bukti transaksi QRIS merchant; prosedur salah nominal atau pembayaran diterima tetapi POS gagal.
- **VAL-02/05:** praktik refund dan pelimpahan shift; siapa boleh memperbaiki selisih setoran.
- **VAL-04/06:** Windows/perangkat dan media backup nyata; hak folder dan lokasi backup.
- Detail timeout sesi, kebijakan sandi/akun pertama, pembatas percobaan, penyimpanan token pada Electron, retensi audit, dan opsi enkripsi at-rest perlu ditetapkan melalui review teknis sebelum pengujian penerimaan.

## 7. Acceptance/security gate

Tidak ada "GO" bila ditemukan bypass autentikasi/role, duplikasi pembayaran, kehilangan data setelah crash, stok negatif tak terkendali, backup gagal dipulihkan, atau bukti pembayaran QRIS tidak dapat direkonsiliasi. Kriteria terperinci di `SECURITY_CHECKLIST.md`, dan keputusan akhir tetap mengikuti SCOPE §7 serta persetujuan pengelola.
