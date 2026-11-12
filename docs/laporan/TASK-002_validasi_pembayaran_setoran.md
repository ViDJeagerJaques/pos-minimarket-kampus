# TASK-002 — Validasi Pembayaran, Setoran, Modal, Selisih, dan Laci Kasir

| Atribut | Isi |
|---|---|
| Tugas | **TASK-002** · Validasi · Owner **David** · Reviewer **Naazmi** · Tahap 1/12 |
| Referensi tugas | POS-03.04/AC-03.04, POS-06.01/AC-06.01 · DEC-016 |
| Referensi tambahan | POS-03.09/AC-03.09, POS-04.02/AC-04.02, POS-06.02–03/AC-06.02–03, POS-10.01/AC-10.01 · DEC-006, DEC-012, DEC-013, DEC-023 · VAL-01, VAL-05 |
| Tanggal penyusunan | 12 November 2026 (waktu lokal agent) |
| Branch / commit awal | `task/p01-001` @ `e3c04d0`, working tree bersih sebelum pekerjaan |
| Status | **BLOCKED — menunggu jawaban dan persetujuan pengelola.** Persiapan sudah dibuat; validasi lapangan belum dilakukan. |

> [!IMPORTANT]
> **Tidak ada wawancara yang dilakukan oleh AI.** Tidak ada narasumber pengelola, tanggal wawancara, contoh hitung nyata, bukti merchant, foto perangkat, atau persetujuan yang dikarang di dokumen ini. Semua jawaban lapangan masih **PENDING**. Angka pada §7 adalah **simulasi sintetis**, bukan data minimarket.

---

## 1. Ringkasan hasil

| Keluaran | Kondisi |
|---|---|
| Formulir pertanyaan untuk pengelola | **Sudah dibuat** — 48 pertanyaan, 30–45 menit, dapat dicetak: [`TASK-002_formulir_pertanyaan_pengelola.md`](TASK-002_formulir_pertanyaan_pengelola.md) |
| Catatan jawaban nyata | **Kosong** — 0 wawancara, 0 jawaban, 0 bukti. Semua topik PENDING (§4) |
| Pemisahan keputusan tim vs SOP merchant | **Sudah dibuat** (§3) |
| Daftar parameter sebelum tutup shift/go-live | **Sudah dibuat** — 43 parameter dengan gate dan pemutus (§6) |
| Contoh hitung setoran | **Sudah dibuat sebagai simulasi** dan diuji 9/9 PASS (§7, §9) |
| Pemeriksaan laci/printer | **Pertanyaan siap; data perangkat belum ada** (§8) |
| Perubahan kode aplikasi/DB/API | **Tidak ada** — sesuai batas tugas |
| Status DEC | **Tidak diubah.** DEC-016 tetap `ACCEPTED` hanya untuk pilihan QRIS manual; SOP tetap `PENDING` |

**Kesimpulan awal:** pekerjaan persiapan TASK-002 selesai, tetapi **TASK-002 belum Selesai**. Kriteria tugas meminta pengelola memberi daftar metode, arti debit/kredit, modal/setoran, contoh selisih, dan prosedur hasil bayar ambigu. Belum satu pun jawaban itu tersedia.

---

## 2. Sumber dan kondisi awal yang diperiksa

### 2.1 Dokumen yang dibaca

| Dokumen | Versi/status yang ditemukan |
|---|---|
| `AGENTS.md` | Aturan kerja agent; mewajibkan sumber nyata dan melarang mengarang SOP/persetujuan |
| `CONTEXT.md` | v0.1.0, draft; kebijakan setoran masih `PENDING` (§5) |
| `docs/product/TASKS.md` | v0.2.1; TASK-002 berstatus awal **Mulai**, acceptance criteria di §6 |
| `docs/product/DECISIONS.md` | v0.2.3; DEC-016 `ACCEPTED` untuk QRIS manual, SOP `PENDING`; VAL-01/VAL-05 `BLOCKER` |
| `docs/product/SCOPE.md` | v0.1.1; S-04 QRIS manual, S-07 setoran/selisih, §6 VAL-01/VAL-05 |
| `docs/product/ACCEPTANCE_CRITERIA.md` | v0.1.1; AC-03.04, AC-03.09, AC-06.01 masih **NOT RUN** |
| `docs/product/PRD.md` | v0.3.1; aturan setoran masih **PROPOSED** |
| `docs/operations and qa/OPERATIONS.md` | v0.1.0; SOP usulan, belum disetujui; setoran belum disahkan |
| `docs/laporan/TASK-001_audit_kontrak_irisan_pertama.md` | Temuan K-08 (`QRIS` vs `QRIS_MANUAL`), K-10 (uang diterima/kembalian), D-13 (VAL-01/VAL-05) |

### 2.2 Kondisi repository

- `backend/`, `frontend/`, `shared/`, dan `scripts/` **kosong** sebelum tugas ini. Tidak ada `package.json`, kode `.ts/.js/.sql`, migrasi, build, atau tes aplikasi.
- Path yang diminta tugas, `docs/operations/OPERATIONS.md`, **tidak ada**. Dokumen sebenarnya berada di `docs/operations and qa/OPERATIONS.md`. Ini dicatat sebagai isu minor.
- Belum ada pekerjaan pendahulu TASK-002. Satu-satunya laporan sebelumnya adalah TASK-001.
- `git status` awal: bersih. Tidak ada commit/push/merge yang dijalankan.

---

## 3. Tiga lapis yang harus dibedakan

### 3.1 Keputusan tim yang sudah disetujui — **bukan** persetujuan SOP merchant

| Item | Status sebenarnya | Sumber | Batas |
|---|---|---|---|
| QRIS **manual** sebagai mekanisme pembayaran MVP | `ACCEPTED` sebagai keputusan tim, 11 November 2026 | DEC-016, DEC-023, TASKS §1 | Hanya memilih cara: POS tidak terintegrasi bank; bukan bukti merchant, rekening, atau notifikasi |
| Tunai + QRIS manual sebagai jalur P0 | Baseline tim | SCOPE S-03/S-04, PRD §3 | SOP merchant dan verifikasi nominal tetap `PENDING` |
| Satu shift aktif, tutup eksplisit | `PROPOSED` DEC-012; prinsip sesi `ACCEPTED` DEC-006 | DECISIONS, PRD §4.2 | SOP serah terima dan otorisasi belum disahkan |
| Formula setoran `modal + tunai - ... - setoran` | **PROPOSED**, bukan SOP disahkan | DEC-016, PRD §3 | Angka fixture tidak boleh menjadi kebijakan produksi |
| QRIS tidak menambah uang laci | Prinsip konsisten di DEC-016/PRD/AC-X-03 | DEC-016, AC-03.09, AC-X-03 | Perlu dibuktikan pada aplikasi nyata; belum ada aplikasi |

> **Penting:** kalimat “QRIS_MANUAL disetujui” hanya berlaku untuk **pilihan teknis tim**. Kalimat “SOP QRIS/setoran disetujui” **tidak benar** dan tidak boleh ditulis sampai ada tanda tangan pengelola.

### 3.2 Rekomendasi teknis — belum disetujui, belum dibuat kodenya

| Rekomendasi | Alasan | Status |
|---|---|---|
| Laci otomatis hanya dibuka **setelah** transaksi tunai `COMMITTED` | Pembukaan sebelum commit dapat menyesatkan kasir bahwa transaksi tersimpan | Usulan; menunggu data perangkat dan review scope |
| Jangan buka laci otomatis untuk QRIS | QRIS tidak menambah uang fisik laci | Usulan konsisten DEC-016 |
| Jangan buka laci saat checkout gagal/ambigu | Mencegah uang keluar untuk transaksi yang belum pasti | Usulan |
| Aksi “Buka laci tanpa transaksi” harus terbatas role, beralasan, dan tercatat audit | Kunci laci adalah kontrol uang | Usulan; menunggu DEC-014/019 |
| Cek merek, model, driver, dan koneksi sebelum menjanjikan kompatibilitas | Belum ada bukti perangkat | Wajib melalui TASK-005 |
| Rekap QRIS terpisah dari kas fisik | Dana QRIS ada di merchant, bukan laci | Prinsip DEC-016; implementasi belum ada |

### 3.3 Masih harus ditanyakan kepada pengelola

Seluruh topik pada §4 dan §6. Tidak ada yang boleh diisi dengan “biasanya begini” atau rekomendasi AI.

---

## 4. Catatan jawaban nyata — **masih kosong**

**Status pengumpulan per 12 November 2026:** 0 wawancara · 0 narasumber · 0 contoh hitung dari pengelola · 0 bukti dokumen/foto.

| ID | Topik/pertanyaan kunci | Jawaban aktual | Narasumber & tanggal | Contoh hitung | Bukti | Yang belum diketahui | Status |
|---|---|---|---|---|---|---|---|
| J-01 | Metode bayar yang benar-benar dipakai; arti debit/kredit | — | — | — | — | Semua metode, arti debit/kredit, field wajib | **PENDING** |
| J-02 | Identitas merchant QRIS, penyedia, statis/dinamis, pemilik rekening | — | — | — | — | Merchant, penyedia, tipe QR, pemilik rekening | **PENDING** |
| J-03 | Cara kasir memastikan nominal dan status QRIS berhasil; siapa berwenang | — | — | — | — | Bukti sah dan pihak yang berwenang | **PENDING** |
| J-04 | Penanganan QRIS pending, nominal salah, screenshot, refund | — | — | — | — | Batas pending, nominal salah, screenshot, refund | **PENDING** |
| J-05 | Modal awal: jumlah, sumber, pecahan, pencatatan | — | — | — | — | Nominal, sumber, pecahan, format catatan | **PENDING** |
| J-06 | Uang diambil tengah shift: boleh/tidak, batas, izin, bukti | — | — | — | — | Izin, batas, tujuan, bukti | **PENDING** |
| J-07 | Pengeluaran kas/penambahan uang laci dan pengawasannya | — | — | — | — | Jenis, izin, bukti, pengawasan | **PENDING** |
| J-08 | Setoran: tujuan, jadwal, per shift/harian, bukti | — | — | — | — | Tujuan, jadwal, penggabungan shift, slip | **PENDING** |
| J-09 | Toleransi selisih, penanganan kurang/lebih, penyetuju, sanksi | — | — | — | — | Toleransi, penyetuju, sanksi, berita acara | **PENDING** |
| J-10 | Contoh hitung nyata dan format rekap sistem lama | — | — | — | — | Contoh hitung, format rekap/ekspor | **PENDING** |
| J-11 | Transaksi ambigu: QRIS sukses/POS gagal, tunai tanpa struk, listrik mati, duplikat | — | — | — | — | Langkah tiap kegagalan dan kontak darurat | **PENDING** |
| J-12 | Laci/printer: otomatis/manual, merek, model, koneksi, pemegang kunci, log | — | — | — | — | Seluruh detail perangkat, kunci, dan log | **PENDING** |

**Aturan pengisian:** jawaban hanya boleh diisi setelah wawancara nyata. Setiap baris wajib menyebut narasumber, tanggal, dan bukti. Jika pengelola tidak tahu, tulis **“BELUM TAHU”** dan tetap `PENDING`; jangan diubah menjadi asumsi.

---

## 5. Formulir pertanyaan

Formulir lengkap: [`TASK-002_formulir_pertanyaan_pengelola.md`](TASK-002_formulir_pertanyaan_pengelola.md)

Cakupan 48 pertanyaan:

| Bagian | Isi | Jumlah |
|---|---|---|
| A | Identitas dan kewenangan narasumber | 4 |
| B | Metode pembayaran dan arti debit/kredit | 4 |
| C | QRIS manual: kepemilikan, verifikasi, bukti, pending, refund | 8 |
| D | Modal awal laci | 3 |
| E | Uang masuk/keluar tengah shift | 4 |
| F | Tutup shift, setoran, selisih, serah terima | 8 |
| G | Transaksi ambigu dan kegagalan | 5 |
| H | Laci kasir dan printer | 7 |
| I | Persetujuan, bukti, tanda tangan | 5 |

Formulir memakai bahasa sederhana, menyediakan kolom “BELUM TAHU”, meminta foto label perangkat dan contoh dokumen, serta melarang pencatatan PIN/OTP/nomor rekening lengkap.

---

## 6. Parameter yang wajib dikonfirmasi

Kolom **Gate** menunjukkan kapan parameter minimal harus tersedia. “Tutup shift” berarti penutupan shift nyata tidak boleh dikunci sebelum nilai disetujui; “Go-live” berarti pilot/cutover terhalang.

| ID | Parameter | Kondisi saat ini | Gate | Pemutus |
|---|---|---|---|---|
| PS-01 | Daftar metode bayar yang disahkan | `PENDING`; fixture tim hanya `CASH` + `QRIS_MANUAL` | Go-live | Pengelola |
| PS-02 | Arti “debit” dan “kredit” di laporan | `PENDING`; pertanyaan CONTEXT §13 butir 5 | Go-live | Pengelola |
| PS-03 | Split payment / dua metode dalam satu transaksi | `PENDING`; baseline melarang tanpa keputusan baru | Go-live | Pengelola + David |
| PS-04 | Pembulatan harga/uang dan kebijakan pecahan | `PENDING` | Go-live | Pengelola |
| PS-05 | Kewajiban field uang diterima/kembalian pada struk | `PENDING`; K-10 TASK-001 | Go-live | David + Rahmat + pengelola |
| QR-01 | Nama merchant, pemilik rekening, penyedia/aplikasi | `PENDING`; VAL-01 **BLOCKER** | Go-live | Pengelola |
| QR-02 | QRIS statis/dinamis; satu atau banyak kode | `PENDING` | Go-live | Pengelola |
| QR-03 | Bukti verifikasi nominal yang sah dan pihak berwenang | `PENDING` | Go-live | Pengelola + kasir |
| QR-04 | Batas waktu pending dan kapan dicek ulang | `PENDING` | Go-live | Pengelola |
| QR-05 | Prosedur nominal salah/lebih/kurang | `PENDING` | Go-live | Pengelola |
| QR-06 | Apakah screenshot pelanggan boleh menjadi bukti | `PENDING`; baseline: bukan bukti tunggal | Go-live | Pengelola |
| QR-07 | Waktu settlement dana dan jadwal rekonsiliasi merchant | `PENDING` | Go-live | Pengelola |
| QR-08 | Refund/batal QRIS, biaya MDR, penanggung biaya | `PENDING` | Go-live | Pengelola |
| CA-01 | Apakah modal awal wajib dan berapa nilainya | `PENDING`; DB `opening_cash_rp` opsional (K-15) | Tutup shift + Go-live | Pengelola |
| CA-02 | Sumber modal, pecahan kecil, dan batas uang kembalian | `PENDING` | Tutup shift | Pengelola |
| CA-03 | Format pencatatan modal dan tanda tangan | `PENDING` | Tutup shift | Pengelola |
| CA-04 | Modal ditinggal, diambil, atau disetor saat tutup | `PENDING` | Tutup shift | Pengelola |
| MS-01 | Setoran/ambil uang tengah shift: boleh, batas, tujuan | `PENDING`; baseline **melarang lewat POS** sampai SOP sah | Tutup shift + Go-live | Pengelola |
| MS-02 | Pengeluaran kas: boleh, izin, bukti | `PENDING`; baseline **melarang lewat POS** sampai SOP sah | Tutup shift + Go-live | Pengelola |
| MS-03 | Penambahan uang/tukar pecahan tengah shift | `PENDING` | Tutup shift | Pengelola |
| CL-01 | Jam shift, pemilik, saksi, pihak yang boleh menutup | `PENDING` | Tutup shift | Pengelola |
| CL-02 | Urutan hitung uang, pecahan, alat bantu | `PENDING` | Tutup shift | Pengelola |
| CL-03 | Formula setoran dan definisi setiap komponen | `PROPOSED` di DEC-016/PRD; **belum disahkan** | Tutup shift + Go-live | Pengelola |
| CL-04 | Apakah QRIS dilaporkan terpisah dan bukti apa | Prinsip terpisah ada; format `PENDING` | Tutup shift | Pengelola |
| CL-05 | Toleransi selisih (rupiah/persen) | `PENDING`; tidak boleh diasumsikan nol | Tutup shift | Pengelola |
| CL-06 | Prosedur kurang/lebih, penyetuju, sanksi, berita acara | `PENDING` | Tutup shift | Pengelola |
| CL-07 | Tujuan setoran, jadwal, per shift/harian, slip | `PENDING` | Tutup shift | Pengelola |
| CL-08 | Isi serah terima, format rekap, tanda tangan | `PENDING` | Tutup shift | Pengelola |
| AM-01 | QRIS sudah sukses tetapi POS gagal commit | `PENDING`; baseline: jangan tagih ulang, eskalasi | Go-live | Pengelola + David |
| AM-02 | Tunai sudah dibayar tetapi struk/commit tidak jelas | `PENDING`; baseline: cek status, jangan bayar ulang | Go-live | Pengelola |
| AM-03 | Printer/listrik/aplikasi gagal saat transaksi | `PENDING`; cetak ulang dari sale tersimpan | Go-live | Pengelola + Naazmi |
| AM-04 | Koreksi transaksi ganda: siapa, bukti, otorisasi | `PENDING`; edit langsung dilarang | Go-live | Pengelola + David |
| AM-05 | Refund/retur/utang member dan kontak darurat | `PENDING`; fitur otomatis OUT | Go-live | Pengelola |
| HW-01 | Laci otomatis atau manual; ada kunci fisik | `PENDING` | Go-live | Pengelola + Naazmi |
| HW-02 | Apakah POS lama membuka laci otomatis dan pada transaksi apa | `PENDING` | Go-live | Pengelola |
| HW-03 | Merek/model printer, koneksi, driver | `PENDING`; VAL-04/TASK-005 | Go-live | Naazmi + Rahmat |
| HW-04 | Merek/model laci dan koneksi (RJ11/USB/serial) | `PENDING`; TASK-005 | Go-live | Naazmi + Rahmat |
| HW-05 | Siapa boleh membuka laci tanpa transaksi; pemegang kunci | `PENDING` | Tutup shift + Go-live | Pengelola |
| HW-06 | Persetujuan prinsip buka laci otomatis pasca-commit tunai | `PENDING`; rekomendasi §8.2 | Go-live | Pengelola + David |
| HW-07 | Log buka laci sistem lama dan perangkat cadangan | `PENDING` | Go-live | Pengelola + Naazmi |
| GL-01 | Nama/jabatan penandatangan SOP dan tanggal berlaku | `PENDING` | Go-live | Pengelola |
| GL-02 | Versi SOP yang disahkan | `PENDING` | Go-live | David + pengelola |
| GL-03 | Retensi bukti (slip, rekap, merchant, foto) | `PENDING` | Go-live | Pengelola |

**Aturan gate:** parameter `PENDING` tidak boleh diisi dengan nilai default diam-diam. Fixture boleh memakai angka simulasi berlabel, tetapi penutupan shift nyata dan go-live tetap terblokir.

---

## 7. Contoh perhitungan setoran — **SIMULASI**

> **Bukan SOP produksi dan bukan data minimarket.** Angka di bawah adalah fixture sintetis untuk membuktikan aritmetika dan pemisahan QRIS dari laci.

### 7.1 Data simulasi wajib

| Komponen | Nilai |
|---|---:|
| Modal awal (`openingCashRp`) | Rp100.000 |
| Penjualan tunai (`cashSalesRp`) | Rp500.000 |
| Penjualan QRIS (`qrisSalesRp`) | Rp300.000 |
| Pengembalian tunai | Rp0 (fitur belum disahkan) |
| Pengeluaran kas | Rp0 (fitur belum disahkan) |
| Setoran tengah shift | Rp0 (fitur belum disahkan) |
| Uang fisik dihitung | Rp600.000 |

### 7.2 Formula yang diuji

```text
kas_seharusnya = modal_awal + penjualan_tunai - pengembalian_tunai
                 - pengeluaran_kas - setoran_tengah_shift
selisih        = uang_fisik_dihitung - kas_seharusnya
```

Formula di atas mengikuti **usulan** DEC-016/PRD; statusnya masih `PROPOSED`, bukan SOP yang disahkan.

### 7.3 Hasil

| Ukuran | Hasil | Penjelasan |
|---|---:|---|
| Kas seharusnya di laci | **Rp600.000** | `100.000 + 500.000` |
| QRIS | **Rp300.000** | Direkap terpisah; **tidak** ditambahkan ke laci |
| Total penjualan | **Rp800.000** | `500.000 + 300.000` |
| Uang fisik | Rp600.000 | Hasil hitung simulasi |
| Selisih | **Rp0** | Cocok secara aritmetika |

**Bukti kunci:** total penjualan Rp800.000 **tidak sama** dengan kas seharusnya Rp600.000. Selisih Rp200.000 adalah nilai QRIS yang berada di kanal merchant, bukan uang laci.

### 7.4 Variasi selisih — belum ada SOP yang mengizinkan penyelesaian

| Skenario | Uang fisik | Selisih | Tindakan yang boleh diklaim sekarang |
|---|---:|---:|---|
| Kurang | Rp590.000 | **−Rp10.000** | Catat sebagai `REVIEW_REQUIRED_SOP_PENDING`; **tidak** auto-disetujui |
| Pas | Rp600.000 | Rp0 | Cocok secara hitung; tetap perlu verifikasi fisik sesuai SOP |
| Lebih | Rp610.000 | **+Rp10.000** | Catat sebagai `REVIEW_REQUIRED_SOP_PENDING`; **tidak** auto-disetujui |

Toleransi, sanksi, penyetuju, dan arah koreksi **belum ada**. Karena itu simulasi sengaja tidak menyatakan selisih ±Rp10.000 “lulus”.

### 7.5 Simulasi setoran tengah shift

Jika pengelola nanti mengizinkan setoran tengah shift Rp200.000:

| Komponen | Nilai |
|---|---:|
| Modal awal | Rp100.000 |
| Penjualan tunai | Rp500.000 |
| Setoran tengah shift | −Rp200.000 |
| Kas seharusnya | **Rp400.000** |
| Uang fisik simulasi | Rp400.000 |
| Selisih | Rp0 |

Status kebijakan: **PENDING**. Baseline dokumen saat ini justru **melarang** setoran tengah shift melalui POS sampai SOP disahkan (DEC-016, PRD §3). Simulasi ini hanya menunjukkan rumus, bukan izin operasional.

### 7.6 Yang terbukti dan yang belum

| Klaim | Status |
|---|---|
| QRIS tidak menambah kas seharusnya di laci | **PASS secara simulasi** (T1/T2) |
| Total penjualan tidak boleh disamakan dengan uang laci | **PASS secara simulasi** (T1) |
| Selisih kurang/lebih tidak auto-disetujui | **PASS secara simulasi** (T3/T4) |
| Selisih mengikuti SOP yang disahkan | **BLOCKED — SOP belum ada** |
| Perilaku aplikasi/DB/API nyata | **BELUM ADA APLIKASI** |

---

## 8. Laci kasir dan printer — data perangkat belum tersedia

### 8.1 Jawaban yang masih diperlukan

| Pertanyaan | Jawaban |
|---|---|
| Laci otomatis atau manual? | **PENDING** |
| Apakah laci otomatis terbuka melalui sistem kasir lama? | **PENDING** |
| Transaksi apa yang memicu buka laci di sistem lama? | **PENDING** |
| Merek dan model printer struk? | **PENDING** |
| Merek dan model laci? | **PENDING** |
| Koneksi laci ke printer/komputer? | **PENDING** |
| Koneksi printer ke PC dan driver yang dipakai? | **PENDING** |
| Siapa boleh membuka laci tanpa transaksi? | **PENDING** |
| Siapa memegang kunci manual? | **PENDING** |
| Apakah ada sensor status laci atau perangkat cadangan? | **PENDING** |
| Apakah sistem lama menyimpan log buka laci? | **PENDING** |

### 8.2 Rekomendasi teknis (belum disetujui, belum dikodekan)

1. **Buka otomatis hanya untuk tunai yang sudah commit.** Urutan aman: backend menyimpan `sale + payment + mutasi stok` sebagai satu commit → UI menerima status `COMMITTED` → adapter desktop mengirim perintah buka laci. Jangan membuka laci sebelum commit.
2. **QRIS tidak membuka laci.** QRIS tidak menambah uang fisik; membuka laci hanya menambah risiko.
3. **Checkout gagal/ambigu tidak membuka laci.** Kasir harus menyelesaikan pemeriksaan status, bukan menganggap transaksi sah.
4. **Sediakan aksi manual terbatas.** “Buka laci tanpa transaksi” hanya untuk role berwenang, dengan alasan dan audit. Ini menyentuh izin (DEC-014) dan perlu review David/Rahmat.
5. **Jangan menganggap kompatibilitas.** Banyak laci terhubung ke printer struk melalui kabel RJ11 dan dibuka dengan pulsa `ESC/POS`; sebagian memakai USB/serial. Namun model minimarket **belum diketahui**, jadi tidak ada klaim kompatibilitas.

### 8.3 Mengapa belum ada kode

- TASK-002 adalah tugas validasi, bukan coding.
- Pembukaan laci adalah fitur baru yang tidak tercantum eksplisit di PRD/AC; perlu review scope sebelum masuk backlog.
- Kompatibilitas perangkat adalah bagian TASK-005 (inventaris perangkat) dan TASK-031 (evaluasi Windows).
- Perubahan menyentuh uang dan perangkat, sehingga memerlukan review David + Rahmat + Naazmi.

---

## 9. Verifikasi yang benar-benar dijalankan

### 9.1 Perintah dan hasil

| # | Perintah/langkah | Lingkungan | Hasil |
|---|---|---|---|
| V1 | `git status`, `git branch --show-current`, `git log --oneline -5` | Windows, PowerShell | Branch `task/p01-001` @ `e3c04d0`; tree bersih sebelum perubahan |
| V2 | Pencarian `package.json`, file `.js/.ts/.tsx/.mjs/.sql/.json` di repository | Repo lokal | **Tidak ada proyek/build/test aplikasi**; direktori kode kosong (script simulasi dibuat oleh tugas ini) |
| V3 | `node --version` | Node.js v24.18.0 | Tersedia untuk menjalankan simulasi |
| V4 | `node scripts/task-002_settlement_simulation.mjs` | Node.js v24.18.0, Windows | **9/9 PASS, 0 FAIL** |
| V5 | Pemeriksaan dokumen `docs/operations/OPERATIONS.md` | Repo lokal | **Tidak ada**; path aktual `docs/operations and qa/OPERATIONS.md` |
| V6 | Pemeriksaan hasil wawancara/bukti pengelola | Repo lokal | **Tidak ada** — tidak ada narasumber, tanggal, foto, atau dokumen |

### 9.2 Output simulasi (ringkas, sesuai eksekusi)

```text
PASS T1 — modal 100.000 + tunai 500.000 + QRIS 300.000; laci cocok 600.000
PASS T2 — QRIS 0 / 300.000 / 999.000 tidak mengubah kas seharusnya
PASS T3 — uang laci kurang 10.000 dicatat, tidak auto-disetujui
PASS T4 — uang laci lebih 10.000 dicatat, tidak auto-disetujui
PASS T5 — simulasi setoran tengah shift 200.000 (kebijakan BELUM disahkan)
PASS T6 — simulasi pengeluaran kas 50.000 (kebijakan BELUM disahkan)
PASS T7 — nominal negatif ditolak oleh fixture
PASS T8 — hanya CASH dan QRIS_MANUAL yang masuk allowlist fixture
PASS T9 — QRIS merchant 290.000 vs rekap POS 300.000 perlu rekonsiliasi

Ringkasan: 9/9 PASS, 0 FAIL
Catatan: hasil ini hanya membuktikan aritmetika fixture, bukan SOP produksi.
```

Script: [`scripts/task-002_settlement_simulation.mjs`](../../scripts/task-002_settlement_simulation.mjs). Script ini **bukan kode aplikasi**, tidak memakai DB/API/UI, dan tidak menyimpan data nyata.

### 9.3 Bukti kelulusan wajib TASK-002

| Bukti yang diminta | Status | Alasan |
|---|---|---|
| Skenario tunai 100.000 + tunai 500.000 + QRIS 300.000; QRIS tidak menambah laci | **PASS (simulasi)** | T1/T2 membuktikan aritmetika fixture |
| Selisih mengikuti SOP yang disahkan | **BLOCKED** | Tidak ada SOP/toleransi/penyetuju yang disahkan; DEC-016 masih `PENDING` untuk SOP |
| Tidak ada jawaban tanpa sumber | **PASS (disiplin dokumen)** | Semua 12 topik jawaban berstatus PENDING; tidak ada jawaban karangan |
| Item tidak diketahui tetap PENDING dan memblokir pilot | **PASS (kontrol dokumen) / BLOCKED (validasi lapangan)** | PENDING tercatat dan gate pilot disebut; tetapi belum ada jawaban untuk diverifikasi |

**Status keseluruhan bukti:** persiapan dan simulasi lulus; **validasi manusia belum lulus**. Karena itu TASK-002 belum bisa dinyatakan Selesai.

### 9.4 Yang belum diuji dan tidak boleh diklaim

- Tidak ada unit/integration/E2E test aplikasi karena aplikasi belum ada.
- Tidak ada pengujian DB/API/UI, karena belum ada kode.
- Tidak ada pengujian laci, printer, scanner, atau Windows pada PC tujuan.
- Tidak ada wawancara pengelola, bukti QRIS merchant, slip setoran, atau foto perangkat.
- Tidak ada CodeRabbit atau review otomatis yang dijalankan.
- Semua AC-03.04, AC-03.09, AC-06.01, AC-06.02, AC-06.03, AC-04.03, AC-10.01 tetap **NOT RUN/BLOCKED**.

---

## 10. Ketertelusuran requirement dan keputusan

| ID | Hubungan dengan TASK-002 | Kondisi |
|---|---|---|
| POS-03.04 / AC-03.04 | Hanya metode bayar disahkan dan data wajib yang lengkap boleh dicatat | **BLOCKED** — daftar metode/field belum dikonfirmasi |
| POS-06.01 / AC-06.01 | Ringkasan per metode, setoran, dan selisih sesuai SOP pilot | **BLOCKED** — formula/toleransi/setoran belum disahkan |
| POS-03.09 / AC-03.09 | QRIS hanya lunas setelah verifikasi kasir; tidak masuk kas laci | **BLOCKED** — prosedur merchant dan bukti belum tersedia |
| POS-04.02 / AC-04.02 | Hasil checkout ambigu harus diperiksa, bukan dibayar ulang | **BLOCKED** — prosedur pengelola belum ada |
| POS-06.02–03 / AC-06.02–03 | Urutan checkout vs tutup, retry tutup | **NOT RUN** — belum ada aplikasi |
| POS-10.01 / AC-10.01 | Perangkat PC/printer/scanner diuji | **BLOCKED** — data perangkat belum ada |
| DEC-016 | QRIS manual `ACCEPTED` tim; formula setoran `PROPOSED`; SOP `PENDING` | Tidak berubah |
| DEC-023 | Integrasi QRIS otomatis ditunda | Tidak berubah |
| VAL-01 | Identitas merchant dan bukti pembayaran | **BLOCKER, belum dijawab** |
| VAL-05 | Modal, setoran, selisih, penyetuju | **BLOCKER, belum dijawab** |
| TASK-005 | Inventaris perangkat dan driver | Belum dijalankan; bagian laci/printer bergantung padanya |
| TASK-034/035/041 | Kebijakan pilot, uji terima, GO/NO-GO | Tertahan sampai TASK-002 selesai |

---

## 11. Isu berdasarkan severity

### Blocker

| ID | Isu | Dampak |
|---|---|---|
| B-01 | **Tidak ada jawaban pengelola** untuk metode, debit/kredit, modal, setoran, selisih, atau transaksi ambigu | TASK-002 tidak memenuhi acceptance criteria; TASK-034/035 tertahan |
| B-02 | **Identitas dan bukti QRIS merchant belum diketahui** (VAL-01) | QRIS tidak boleh dinyatakan siap pilot; AC-03.09/AC-X-01 tertahan |
| B-03 | **SOP setoran/selisih belum disahkan** (VAL-05) | Penutupan shift nyata tidak boleh mengunci formula/toleransi; GO/NO-GO tertahan |
| B-04 | **Data printer/laci belum ada** | Printer adalah bagian P0 (AC-10.01); kompatibilitas dan opsi buka laci otomatis belum bisa dinilai |
| B-05 | **Prosedur transaksi ambigu belum ada** | Risiko menagih dua kali atau menandai QRIS lunas tanpa bukti |

### Major

| ID | Isu | Dampak |
|---|---|---|
| M-01 | Formula setoran di DEC-016/PRD masih `PROPOSED`, bukan SOP | Implementasi penutupan shift tidak boleh dianggap final |
| M-02 | Field uang diterima/kembalian belum ada di skema (K-10) | Struk/cetak ulang dan audit tunai belum pasti |
| M-03 | Kode `QRIS` vs `QRIS_MANUAL` berbeda antar dokumen (K-08) | Risiko salah enum UI/API/DB |
| M-04 | Toleransi selisih dan penyetuju belum ditentukan | Tidak ada dasar untuk menutup shift dengan selisih |
| M-05 | Bukti setoran/merchant dan retensinya belum ditentukan | Rekonsiliasi fisik dan audit lemah |
| M-06 | Pembukaan laci otomatis adalah fitur baru di luar PRD/AC eksplisit | Perlu review scope sebelum masuk backlog |

### Minor

| ID | Isu | Dampak |
|---|---|---|
| N-01 | Path `docs/operations/OPERATIONS.md` tidak ada; aktual `docs/operations and qa/OPERATIONS.md` | Rujukan dokumen membingungkan |
| N-02 | Laporan TASK-002 berada di `docs/laporan/`, di luar 33 dokumen kanonik | Konsisten dengan TASK-001, tetapi perlu keputusan David |
| N-03 | Status TASK-002 di `TASKS.md` masih “Mulai” | Sengaja tidak diubah; status sebenarnya di laporan ini |

---

## 12. Keputusan manusia yang diperlukan

| ID | Keputusan/tindakan | Pemilik | Menahan |
|---|---|---|---|
| H-01 | Jadwalkan dan lakukan wawancara nyata dengan pengelola memakai formulir §5 | **David** | Seluruh TASK-002 |
| H-02 | Isi catatan jawaban §4 dengan narasumber, tanggal, contoh hitung, dan bukti | **David + pengelola** | TASK-002, TASK-034 |
| H-03 | Sahkan daftar metode bayar, arti debit/kredit, dan field wajib per metode | **Pengelola + David** | AC-03.04, TASK-016/037 |
| H-04 | Sahkan formula setoran, toleransi selisih, penyetuju, dan bukti setoran | **Pengelola + David** | AC-06.01, TASK-022/034 |
| H-05 | Sahkan prosedur QRIS merchant dan penanganan transaksi ambigu | **Pengelola + David** | AC-03.09, AC-X-01, TASK-037 |
| H-06 | Inventarisasi printer/laci dan uji kompatibilitas | **Naazmi + Rahmat** | TASK-005, TASK-031 |
| H-07 | Putuskan apakah buka laci otomatis masuk scope; jika ya, review izin/API/DB | **David + Rahmat + Syafroni** | Fitur baru; belum dikodekan |
| H-08 | Review laporan dan formulir ini | **Naazmi** | Penutupan TASK-002 |

**Tidak ada keputusan bisnis yang diubah oleh laporan ini.** DEC-016/DEC-023/PRD/SCOPE/TASKS tidak diedit, dan tidak ada status yang dinaikkan menjadi `ACCEPTED`.

---

## 13. Langkah untuk reviewer (Naazmi) dan agent pengganti

1. **Verifikasi kejujuran sumber:** pastikan §4 tetap kosong kecuali ada wawancara nyata. Jangan menambahkan jawaban dari rekomendasi tim.
2. **Jalankan simulasi:** `node scripts/task-002_settlement_simulation.mjs`; hasil harus 9/9 PASS. Periksa bahwa T2 membuktikan QRIS tidak masuk kas dan T3/T4 tidak auto-approve selisih.
3. **Bawa formulir** `TASK-002_formulir_pertanyaan_pengelola.md` ke pengelola. Minta contoh hitung, slip setoran, rekap lama, dan foto label printer/laci.
4. **Simpan bukti** dengan tanggal dan narasumber. Sensor data sensitif. Jangan menyimpan PIN/OTP/nomor rekening.
5. **Isi §4** dan perbarui parameter §6. Pertanyaan yang tidak dijawab tetap `PENDING`.
6. **Setelah ada jawaban sah,** David mengajukan perubahan DEC/PRD/SCOPE melalui review terpisah. Agent tidak boleh menaikkan status DEC atau mengubah skema/API berdasarkan laporan ini.
7. **Untuk laci otomatis:** tunggu TASK-005 dan keputusan scope H-07. Jangan membuat kode atau mengklaim kompatibilitas sebelum ada uji perangkat.
8. **Status tugas:** tetap **BLOCKED** sampai minimal H-01–H-05 dan H-08 selesai. Setelah itu, bukti AC-03.04/AC-06.01 masih harus diuji pada aplikasi nyata melalui TASK-016/022/035.

---

## 14. Ringkasan bahasa Indonesia sederhana

- **Apa yang berhasil dikerjakan:** formulir 48 pertanyaan untuk pengelola, catatan jawaban yang masih kosong, daftar 43 parameter yang harus disahkan, simulasi setoran 9/9 PASS, dan daftar pertanyaan laci/printer sudah siap. Tidak ada kode aplikasi, DB, atau API yang diubah.
- **Apa yang masih menunggu jawaban pengelola:** semua hal penting — metode bayar, arti debit/kredit, identitas dan cara cek QRIS, modal awal, uang keluar tengah shift, setoran, toleransi selisih, bukti fisik, transaksi ambigu, serta merek/model/koneksi printer dan laci.
- **Apakah TASK-002 sudah selesai:** **BELUM. Masih BLOCKED.** Persiapan dan simulasi sudah lulus, tetapi validasi manusia belum terjadi. Belum ada jawaban, bukti, atau persetujuan pengelola.
- **Apa yang harus dilakukan David berikutnya:** bawa formulir ke pengelola, catat jawaban nyata beserta tanggal dan bukti, isi §4, lalu minta Naazmi review. Setelah jawaban lengkap, ajukan persetujuan SOP dan review perubahan keputusan secara terpisah. Jangan tandai TASK-002 selesai sebelum itu.

---

**Status akhir dokumen:** PERSIAPAN SELESAI, VALIDASI LAPANGAN **BLOCKED**. Tidak ada persetujuan pengelola, hasil wawancara, pengujian perangkat, atau klaim siap pilot di dalam dokumen ini.
