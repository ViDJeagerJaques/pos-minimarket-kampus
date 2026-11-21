# TASK-032 — Review baseline wrapper Windows

**Status: REVIEW / PENDING LAPANGAN** · 22 November 2026 · Basis `b8ee62e` (PR #44 TASK-031 telah merge). Pemilik review: David dan Rahmat. Acuan: POS-10.01/AC-10.01, POS-10.02/AC-10.02, DEC-005, DEC-010 dan DEC-011.

## Rekomendasi

Lanjutkan **Electron sebagai kandidat baseline untuk eksperimen dan review**, karena spike TASK-031 sudah berjalan pada mesin development. Pilihan untuk paket dan penggunaan operasional masih menunggu bukti PC tujuan dan review David/Rahmat. DEC-011 tetap **PROPOSED**. TASK-033 masih menunggu pilihan wrapper dan dependensinya sesuai register tugas; dokumen ini tidak memberi izin packaging final.

Pembanding potensial adalah Tauri dengan WebView2. Ketersediaan dan kelayakannya pada PC tujuan belum diketahui; aplikasi ini belum memiliki spike Tauri yang teruji. Perbandingan berikut bukan hasil benchmark Tauri. Browser lokal merupakan jalur development, belum menjadi kandidat installer desktop yang memenuhi target DEC-005.

## Bukti dan ketidakpastian

| Kriteria | Electron, bukti TASK-031 | Tauri/WebView2, pembanding yang belum diuji |
|---|---|---|
| RAM | Mesin dev Windows 11 x64, RAM 7,69 GB; median working set pohon proses idle 399,9 MB, 20 sampel. Kebutuhan PC tujuan **UNKNOWN**. | **UNKNOWN** untuk aplikasi dan PC tujuan. |
| Startup | 20/20; median 3.930,7 ms, p95 4.527,9 ms pada mesin dev; bukan cold boot terkontrol. | **UNKNOWN**, belum ada pengukuran setara. |
| Scanner dan printer | Barcode sintetis dibaca lewat API; cetak menggunakan adapter VIRTUAL. Scanner HID, printer dan driver fisik **BLOCKED**. | Kompatibilitas perangkat dan integrasi Node/print **UNKNOWN**. |
| Offline | Aset lokal dan backend loopback pada spike. Alur menyeluruh dari kondisi internet terputus sebelum aplikasi dibuka **belum diuji**. | WebView2 diperlukan di Windows. Installer offline WebView2 tersedia menurut dokumentasi Tauri, tetapi paket dan alur offline aplikasi ini **belum diuji**. |
| Keamanan | Spike menggunakan sandbox, context isolation, Node integration nonaktif, navigasi dibatasi dan backend loopback. Ini bukan audit keamanan paket. | Model izin, isolasi, integrasi backend dan konfigurasi untuk aplikasi ini **UNKNOWN**. |
| Ukuran | `electron.exe` development 249.978.368 byte; **ukuran installer dan paket lengkap UNKNOWN**, termasuk Node eksternal. | Ukuran installer aplikasi **UNKNOWN**. Opsi WebView2 offline menambah ukuran; ukur paket aktual. |
| Biaya | Tidak ada biaya lisensi terukur dalam evaluasi; biaya packaging, pemeliharaan dan distribusi **UNKNOWN**. | Biaya integrasi, pemeliharaan dan distribusi **UNKNOWN**. |

Sumber angka ronde 2 adalah [`task031-summary.json`](evidence/TASK-031/task031-summary.json) dan [`task031-startup20.json`](evidence/TASK-031/task031-startup20.json), serta [laporan TASK-031](TASK-031_evaluasi_electron.md) §4. Ringkasan awal laporan TASK-031 menyebut median 5.099,8 ms dan RAM 398,3 MB, sedangkan §4 dan file hasil ronde 2 mencatat 3.930,7 ms dan 399,9 MB. Angka di tabel ini memakai file hasil ronde 2; perbedaan ringkasan perlu dikonfirmasi pemilik TASK-031 sebelum dipakai sebagai bukti keputusan final. Angka ini tidak membuktikan kelayakan pada PC 4 GB atau spesifikasi PC lain yang belum diketahui.

Electron spike memakai Node 24 eksternal untuk backend `node:sqlite`; kompatibilitas Node bawaan Electron dan strategi distribusi belum terbukti. Electron mengemas Chromium dan Node.js ([dokumentasi Electron](https://www.electronjs.org/docs/latest/)). Tauri menggunakan WebView2 pada Windows dan menyediakan opsi installer WebView2 offline ([prasyarat Tauri](https://v2.tauri.app/start/prerequisites/), [opsi installer Windows](https://v2.tauri.app/distribute/windows-installer/)). Dokumentasi ini menjelaskan opsi teknis, bukan bukti bahwa opsi tersebut tersedia atau berjalan pada PC tujuan.

## Eksperimen minimum dan keputusan lanjutan

1. David/Naazmi mencatat PC sebenarnya: versi dan arsitektur Windows, RAM, disk, hak install, antivirus, model scanner/printer dan driver. Akses perangkat saat review ini **belum dibuktikan**.
2. Rahmat/Naazmi menjalankan kandidat yang dapat diinstal pada PC itu dengan internet terputus sejak sebelum aplikasi dibuka. Catat startup dan RAM, login, scan termasuk nol awal dan perubahan fokus, checkout sintetis, cetak dan cetak ulang pada perangkat fisik. Catat kegagalan dan versi. Ini diperlukan untuk AC-10.01.
3. Uji paket, ukuran total dan runtime Node, isolasi/izin, kemudian update dan rollback dengan DB serta konfigurasi uji yang dapat dipulihkan. Buktikan data tetap dapat digunakan untuk AC-10.02.
   - Uji juga **update gagal** pada instalasi terisolasi dengan data dan konfigurasi sintetis: siapkan serta verifikasi cadangan DB dan konfigurasi sebelum update, catat kondisi awal, lalu simulasikan kegagalan update yang terkontrol. Catat titik kegagalan dan keadaan aplikasi setelahnya.
   - Jalankan prosedur pemulihan yang telah direview pada instalasi terisolasi yang sama tempat update gagal: pulihkan versi aplikasi, DB, dan konfigurasi dari cadangan pra-update, lalu buka aplikasi. Bandingkan data operasional dan konfigurasi dengan kondisi awal serta buktikan keduanya dapat digunakan melalui login dan alur lokal yang relevan. Jangan menimpa DB operasional selama pengujian.
   - Untuk bukti AC-10.02, catat versi sebelum/sesudah, lingkungan, langkah dan hasil update gagal, identitas serta verifikasi cadangan, prosedur dan hasil pemulihan, perbandingan data dan konfigurasi, hasil uji penggunaan, log atau screenshot, serta PASS/FAIL/BLOCKED. Skenario ini belum dijalankan.
4. Jika perangkat tidak memenuhi kebutuhan atau David/Rahmat memerlukan pembanding, lakukan spike Tauri/WebView2 terpisah pada perangkat dan fixture yang sama, termasuk cara membawa backend Node, offline, driver, keamanan, ukuran dan biaya. Bandingkan bukti yang sepadan sebelum keputusan DEC-011.

## Verifikasi dan batas

Review ini memeriksa kode kandidat dan bukti TASK-031 pada `b8ee62e`; tidak menjalankan tes atau build baru karena perubahan berupa dokumen keputusan. TASK-031 mencatat smoke 8/8 dan benchmark katalog 100/100 pada data sintetis, serta printer virtual; hasil itu adalah bukti historis TASK-031, bukan hasil uji baru TASK-032. AC-10.01 dan AC-10.02 **belum terbukti**. `docs/operations/DEPLOYMENT.md` yang disebut prompt tidak tersedia; dokumen yang ada adalah `docs/operations and qa/DEPLOYMENT.md`. Review lintas pemilik, perangkat fisik, izin pengelola, packaging dan kesiapan GO-LIVE masih tertunda.
