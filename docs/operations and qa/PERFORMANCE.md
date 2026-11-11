# PERFORMANCE — Anggaran Kinerja dan Metode Pengukuran

| Atribut | Nilai |
|---|---|
| Lokasi | `docs/operations/PERFORMANCE.md` |
| Versi / tanggal | 0.1.0 / 11 November 2026 |
| Status | BASELINE PROSEDUR DAN RENCANA — belum dilaksanakan atau disetujui pengelola |
| Dasar | `docs/product/SCOPE.md` v0.1.1; `docs/product/ACCEPTANCE_CRITERIA.md` v0.1.1; `docs/product/TASKS.md` v0.2.1; `docs/security/SECURITY_CHECKLIST.md` v0.1.0 |

## 1. Lingkup dan status
Satu PC Windows, SQLite lokal, tidak ada SLA organisasi yang disetujui. Nilai di bawah merupakan **target percobaan awal**, bukan hasil benchmark, bukan kewajiban yang sudah disetujui pengelola. Angka final harus disesuaikan dengan spesifikasi PC setelah diketahui (VAL-04), jumlah SKU hasil ekspor (VAL-03), printer dan konfigurasi. Keamanan uang/stok serta keutuhan database **lebih penting** dari kecepatan.

## 2. Sasaran kinerja usulan untuk diuji
| Operasi | Target awal usulan | Cara ukur | Jika gagal |
|---|---|---|---|
| Buka kasir setelah login lokal | UI siap <= 5 detik setelah login, tidak termasuk boot Windows | 20 sampel cold/warm pada PC tujuan | Profiling startup & driver, jangan mengurangi auth |
| Lookup barcode lokal | p95 <= 300 ms untuk katalog uji representatif | 100 scan/input manual pada dataset yang disetujui | Cek indeks dan roundtrip renderer/API |
| Prepare/commit CASH SQLite (tanpa print) | p95 <= 1 detik pada dataset uji, excluding manual cash count | 100 checkout sintetis, tanpa internet, setelah warmup | Profiling SQL/WAL/IPC; jangan bypass idempotency |
| Tampilan laporan harian | p95 <= 3 detik pada volume data uji | 20 load dashboard pada rentang yang ditentukan | Perbaiki query/index; jangan cache stale tanpa indikator |
| Cetak struk | Ukur waktu nyata dari commit sampai printer selesai; **belum ada target disepakati** | 20 struk pada printer target, termasuk printer mati | Atasi driver dan spooler, jangan rollback sale |
| Backup/restore | Ukur durasi dan size sampai verifikasi tuntas; **tidak ada RTO/RPO disetujui** | 3 percobaan pada media kedua dan DB berisi contoh transaksi | Eskalasi prosedur operasional dan media |
| Memori/RAM | Tidak menetapkan ambang sebelum mengetahui RAM PC | Catat idle, 1 jam penggunaan, setelah 100 transaksi uji | Evaluasi Electron/native deps bila membebani PC |

`p95` = nilai persentil ke-95 dari sampel yang berhasil diamati; catat jumlah gagal **secara terpisah**, jangan keluarkan error untuk memperindah latensi. Nominal target awal bersifat *proposed benchmark objectives* dan boleh direvisi lewat bukti perangkat, bukan diam-diam.

## 3. Dataset representatif
Uji 100/1.000/10.000 SKU sintetis **hanya bila realistis dibanding katalog asli**; sertakan produk tanpa barcode, nama panjang, stok nol, harga berubah, dan 1–12 bulan transaksi simulasi dengan dua shift per hari. Ukur dengan dataset ukuran nyata setelah pengelola memberi jumlah SKU. Jangan memakai data transaksi pelanggan asli ke layanan benchmarking online.

## 4. Prosedur pengukuran
1. Rekam model PC, OS, CPU, RAM, disk, printer/scanner, versi Electron/Node/SQLite driver, app commit, schema/index dan volume dataset.
2. Jaga mode jaringan offline saat mengukur fitur lokal; bandingkan warm startup dan cold startup, dengan logging normal dan antivirus aktif.
3. Jalankan setiap skenario sedikitnya 20 kali (100 untuk lookup/checkout bila memungkinkan); ambil median, p95, maksimum, tingkat kegagalan, jumlah retry, pemakaian RAM dan durasi cold start.
4. Pisahkan waktu manusia memverifikasi QRIS dan waktu printer dari latensi commit database; jangan mengakui konfirmasi bank otomatis.
5. Bandingkan terhadap target usulan, catat regresi setelah update, dan jalankan smoke serta AC uang/stok setelah optimasi.

## 5. Batas aman optimasi
- Jangan menonaktifkan `foreign_keys`, transaksi atomik, idempotency, audit atau hash password demi hasil benchmark.
- Jangan meng-cache stok yang dapat membuat dua checkout lolos stok negatif; kebenaran diperiksa lagi saat commit.
- Jangan menaruh DB di folder installer atau remote drive demi 'kemudahan' tanpa uji risiko.
- Pengindeksan/query/perubahan skema melewati review dan migration test.

## 6. Form hasil (kosong sampai pengujian)
```text
Tanggal / penguji:
Build & schema; perangkat OS/RAM/CPU/disk/driver:
Dataset (SKU, sale, range tanggal):
Scenario, N total, N sukses, N gagal:
Median/p95/max (ms); startup/RAM jika relevan:
Konfigurasi jaringan dan printer:
Target usulan / keputusan PASS atau NEEDS REVIEW:
Log/profiler teredaksi:
Perubahan kode dan regresi keamanan/integritas yang diuji:
```
