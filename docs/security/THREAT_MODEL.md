# THREAT MODEL — Satu PC POS Offline-First

| Atribut | Nilai |
|---|---|
| Lokasi | `docs/security/THREAT_MODEL.md` |
| Versi / status | 0.1.0 — review desain; ancaman belum diuji |
| Metode | Identifikasi aset, batas kepercayaan, skenario penyalahgunaan, kontrol, bukti uji, risiko residu |
| Acuan | SECURITY.md; AUTHORIZATION.md; DATA_PROTECTION.md; BACKUP_RECOVERY.md; AUDIT_LOG.md; PRD, SCOPE, DATABASE, API_CONTRACT |

## 1. Konteks dan aset

**Aset penting:** uang yang tercatat per metode, transaksi penjualan final, saldo stok, shift/setoran, kredensial ADMIN/CASHIER, data barang/barcode/harga, data hasil migrasi, arsip audit, backup, installer yang terpasang. Tidak menyimpan kredensial bank/QRIS pelanggan. Pemrosesan pembayaran QRIS terjadi di kanal merchant luar POS.

**Aktor:** CASHIER yang sah; ADMIN yang sah; kasir lain di PC yang sama; orang yang memperoleh akses Windows/file; program lokal berbahaya; pelanggan yang menyodorkan barcode atau bukti QRIS; pihak yang dapat mengganti file instalasi. Tidak mengasumsikan serangan internet ke backend jika backend benar-benar loopback saja, tetapi website/program lokal masih dapat mencoba mengakses loopback.

## 2. Batas dan asumsi

- Renderer/bridge/API tidak tepercaya; backend tepercaya **hanya** jika proses dan executable belum dimodifikasi.
- SQLite dan backup adalah data persisten. ACL Windows membatasi akses biasa, tidak melindungi dari admin OS/perangkat dicuri.
- Backend tetap dapat menerima percobaan salah ketika internet offline. Batas sumber daya disk, listrik, printer dan korupsi database harus diuji.
- Satu shift aktif pada satu PC bukan jaminan dua proses backend tak berjalan sekaligus; uji lock, unique constraint, dan pencegahan instance ganda.

## 3. Register ancaman yang dapat ditindaklanjuti

Skala prioritas: **KRITIS** = kehilangan uang/data atau bypass izin; **TINGGI** = dapat menghambat operasi/mengekspos data; **SEDANG** = dampak terbatas dengan prosedur penanganan. Ini prioritas desain, bukan skor hasil pentest.

| ID | Skenario / batas diserang | Risiko | Kontrol desain | Uji / bukti | Residu |
|---|---|---|---|---|---|
| TM-01 | CASHIER memanggil endpoint ADMIN tanpa menu UI | KRITIS | Middleware + service RBAC default deny | 403 dan perubahan DB=0 | Akun ADMIN bocor |
| TM-02 | Kasir B akses shift/transaksi kasir A via ID | KRITIS | Ownership dari DB dan sesi | Uji enumerasi ID, filter ringkasan | Akun bersama mengaburkan pelaku |
| TM-03 | Renderer memalsukan harga, role, `verifiedBy` | KRITIS | Harga dan actor dari backend; validasi kontrak | Tamper request, bukti ditolak | Kasir bisa salah attest QRIS |
| TM-04 | Pelanggan menunjukkan screenshot QRIS palsu | KRITIS | Periksa transaksi sukses dan nominal di kanal merchant resmi | Skenario QRIS tidak sukses/beda nominal | Pos manual tidak mendapat bukti bank otomatis |
| TM-05 | QRIS dibayar tetapi commit POS timeout | KRITIS | Persist `attemptKey`, cek status, jangan tagih ulang; jalur rekonsiliasi | Crash sebelum/sesudah commit | SOP pengelola belum disahkan |
| TM-06 | Checkout dikirim dua kali atau beda payload | KRITIS | `attemptKey`, `requestHash`, UNIQUE sale, transaksi penulis | Paralel/retry dan conflict 409 | Kesalahan hash canonicalization |
| TM-07 | Jual melebihi stok saat concurrent write | TINGGI | Validasi saldo dalam `BEGIN IMMEDIATE` + ledger | Dua request memperebutkan stok akhir | Kebijakan stok menunggu SOP |
| TM-08 | ADMIN mengubah stok tanpa alasan; hapus sale lama | KRITIS | ADJUSTMENT mutasi & audit wajib; jual append-only | Uji alasan kosong, direct DB mutation | Akses OS tingkat tinggi |
| TM-09 | Login brute-force pada PC bersama | TINGGI | Rate limit lokal, respons seragam, kebijakan sandi | N percobaan gagal, login sah tetap dapat pulih | DoS akibat lockout |
| TM-10 | Sesi tetap terbuka setelah logout atau akun nonaktif | TINGGI | Revoke token, periksa current user status, UI clear | Token lama 401, shift tetap aktif | PC Windows ditinggal terbuka |
| TM-11 | Website/program lokal memanggil API loopback | TINGGI | Bind localhost, auth, cek Origin/Host, anti-CSRF sesuai mekanisme, CORS ketat | Request cross-origin tanpa token gagal | Malware lokal tetap berisiko |
| TM-12 | Renderer Electron dapat akses filesystem/Node | KRITIS | Isolasi konteks, nodeIntegration off, IPC allowlist | Uji bridge tak bisa operasi arbitrary | Plugin/dep rentan |
| TM-13 | SQL injection dari barcode/nama | TINGGI | Prepared statements, validasi input | String SQL berbahaya tidak mengubah data | Query dinamis salah di masa depan |
| TM-14 | Mati listrik/disk penuh saat commit | KRITIS | Atomisitas SQLite, durable config dan pemulihan upaya | Fault injection + integrity check | Kerusakan disk fisik |
| TM-15 | Backup berupa salinan file aktif tidak konsisten | KRITIS | SQLite online backup API atau metode tervalidasi | Restore pada salinan terisolasi | Media cadangan rusak |
| TM-16 | Backup hanya satu lokasi dan ikut hilang | KRITIS | Salinan media lain; verifikasi tanggal/ukuran/hash dan restore | Simulasi PC sumber hilang | Tidak ada media cadangan tersedia |
| TM-17 | Restore overwrite DB aktif atau file salah | KRITIS | Stop penulis, pre-restore backup, lokasi whitelist, integritas, atomic swap/rollback | Restore korup ditolak | Operator salah langkah |
| TM-18 | Export/log memuat sandi atau token | TINGGI | Data minimization, redaction, ACL, review logging | Inspect log/struk/CSV | Akun Windows berprivilege |
| TM-19 | Installer dari sumber yang dimodifikasi | TINGGI | Distribusi terkontrol, checksum/version, smoke test | Checksum cocok, install fresh/update | Belum ada penandatanganan kode |
| TM-20 | Migrasi harga/barcode/stok salah | KRITIS | Mapping, duplicate checks, reconciliation, uji paralel | Total SKU dan sampel terverifikasi | Format ekspor sistem lama belum diketahui |
| TM-21 | Dua user membuka shift bersamaan | KRITIS | Unique active shift + transaction | Paralel dua open, tepat satu berhasil | API admin/open belum sinkron |
| TM-22 | Audit mengandung detail sensitif atau dapat dihapus UI | TINGGI | Event terbatas, append-only lewat service, admin read terkontrol | Test tidak ada secrets, tidak ada delete log | Akses DB langsung oleh OS admin |

## 4. Skenario penyalahgunaan wajib

1. Kasir B login saat shift A terbuka → tak dapat resume/close atau melihat transaksi milik A; jangan otomatis menutup shift A.
2. Kasir menyerahkan QRIS belum terkonfirmasi → tidak boleh menyimpan sale lunas. QRIS sudah dibayar tetapi hasil checkout tak jelas → tidak boleh meminta pembayaran kedua sebelum rekonsiliasi.
3. Kasir menekan `commit` 5 kali → tepat satu penjualan, satu payment dan mutasi; payload berbeda pada key sama -> konflik.
4. Proses mati ketika menulis → setelah restart DB tetap konsisten; cek `attemptKey` sebelum cetak/tagih ulang.
5. Kartu memori/USB backup korup → restore harus gagal tanpa mengubah produksi.

## 5. Mitigasi terurut untuk 14 hari

**Hari awal:** tutup TM-01–07, TM-11–13, TM-21 karena dapat diselesaikan lewat desain handler/test. **Sebelum uji paralel:** TM-08–10, TM-14–18, TM-22. **Sebelum GO:** TM-19–20 plus seluruh bukti pada PC/perangkat nyata. Jadwal bukan tanda tuntas.

## 6. Risiko residu / eskalasi

- Keamanan Windows dan media fisik membutuhkan pengelola. Sistem satu PC **tidak** tahan ransomware/admin OS berbahaya hanya dengan SQLite atau RBAC.
- QRIS manual bergantung pada kejujuran kasir dan kualitas kanal merchant; pencatatan attestasi tidak sama dengan bukti pembayaran bank.
- Belum ada konfirmasi perangkat, kemampuan ekspor data lama, prosedur kredit/retur, perpanjangan langganan, atau SOP koreksi transaksi; risiko tersebut dapat menyebabkan **NO-GO**.
- Perubahan fitur OUT atau izin admin override memerlukan perubahan Product + Architecture + Security dan pengujian ulang.
