# Formulir Wawancara Pengelola — Pembayaran, Setoran, dan Laci Kasir

| Atribut | Isi |
|---|---|
| Untuk tugas | **TASK-002** — Konfirmasi pembayaran dan setoran |
| Versi formulir | 1.0 — disiapkan 12 November 2026 |
| Disiapkan oleh | David (koordinasi), review Naazmi (QA) |
| Perkiraan waktu | 30–45 menit |
| Status formulir | **KOSONG — belum diwawancarai** |

> **Cara memakai formulir ini**
> 1. Ajukan pertanyaan kepada pengelola atau orang yang benar-benar berwenang.
> 2. Tulis **jawaban aktual**, bukan dugaan tim. Jika tidak tahu, tulis **“BELUM TAHU”**.
> 3. Minta contoh nyata, foto label perangkat, slip setoran, atau tangkapan layar merchant. Sensor PIN, OTP, nomor rekening lengkap, dan data pelanggan.
> 4. Jangan mengisi jawaban atas nama pengelola. Jangan menandatangani sebelum benar-benar dijawab.
> 5. Formulir ini mencatat jawaban. Formulir **tidak otomatis** mengubah status keputusan di `DECISIONS.md`.

**Yang perlu dibawa:** alat tulis/laptop, kamera ponsel untuk foto label printer/laci, contoh struk lama, contoh slip setoran, dan contoh laporan tutup shift sistem lama (jika diizinkan).

---

## A. Identitas wawancara

| No | Pertanyaan | Jawaban aktual | Bukti/catatan |
|---|---|---|---|
| A1 | Nama minimarket dan lokasi |  |  |
| A2 | Nama, jabatan, dan lama bekerja narasumber |  |  |
| A3 | Tanggal, jam, dan nama pewawancara |  |  |
| A4 | Apakah narasumber berwenang menyetujui SOP? Jika tidak, siapa yang berwenang menandatangani? |  |  |

---

## B. Metode pembayaran yang benar-benar dipakai

| No | Pertanyaan | Jawaban aktual | Bukti/catatan |
|---|---|---|---|
| B1 | Metode apa yang dipakai harian? (tunai / QRIS / kartu debit / kartu kredit / transfer / e-wallet / utang member / lain) |  |  |
| B2 | Di laporan lama, apa arti **“debit”** dan **“kredit”**? Apakah kartu bank, utang pelanggan, atau kategori lain? |  |  |
| B3 | Apakah satu transaksi boleh dibayar dengan dua metode sekaligus (misalnya sebagian tunai, sebagian QRIS)? |  |  |
| B4 | Siapa yang boleh menerima pembayaran, membatalkan keranjang, dan menyatakan pembayaran lunas? |  |  |

---

## C. QRIS manual

> Konteks: tim memilih **QRIS_MANUAL** untuk MVP. POS tidak terhubung otomatis ke bank. Kasir memeriksa pembayaran di kanal merchant. Prosedur merchant tetap harus dikonfirmasi.

| No | Pertanyaan | Jawaban aktual | Bukti/catatan |
|---|---|---|---|
| C1 | QRIS atas nama merchant siapa? Tulis nama yang muncul di aplikasi. Rekeningnya milik minimarket, perusahaan, atau pribadi? |  |  |
| C2 | Penyedia/aplikasi merchant apa yang dipakai? QRIS statis atau dinamis? Satu QR untuk semua kasir atau masing-masing? |  |  |
| C3 | Bagaimana kasir tahu pembayaran berhasil? (notifikasi suara, aplikasi merchant, riwayat, SMS/email) Data apa yang terlihat: nominal, waktu, ID transaksi, nama pembayar? |  |  |
| C4 | Berapa lama status “pending” biasanya? Kapan kasir harus memeriksa ulang? |  |  |
| C5 | Jika nominal yang masuk berbeda dari tagihan, apa langkahnya? Siapa yang memutuskan? |  |  |
| C6 | Apakah tangkapan layar dari pelanggan cukup sebagai bukti? Bukti minimum apa yang wajib diperiksa kasir? Siapa yang berwenang menyatakan QRIS lunas? |  |  |
| C7 | Kapan dana QRIS masuk ke rekening merchant? Bagaimana dan kapan dicocokkan dengan rekap POS? |  |  |
| C8 | Bagaimana prosedur batal/refund QRIS? Siapa yang melakukan? Apakah ada biaya MDR dan siapa yang menanggung? |  |  |

---

## D. Modal awal laci

| No | Pertanyaan | Jawaban aktual | Bukti/catatan |
|---|---|---|---|
| D1 | Apakah ada modal awal di laci? Berapa biasanya? Tetap setiap shift atau berubah? Dari mana sumber uangnya? |  |  |
| D2 | Pecahan uang kecil untuk kembalian disiapkan berapa? Bagaimana modal dan pecahan dicatat? Minta contoh format catatan. |  |  |
| D3 | Saat tutup shift, modal diambil, ditinggal, atau disetor? Bagaimana modal shift berikutnya disiapkan? |  |  |

---

## E. Uang masuk/keluar di tengah shift

| No | Pertanyaan | Jawaban aktual | Bukti/catatan |
|---|---|---|---|
| E1 | Apakah ada uang tunai yang diambil dari laci **sebelum** tutup shift (setoran ke safe, bank, atau pengelola)? Kapan dan berapa batasnya? |  |  |
| E2 | Siapa yang boleh mengambil uang tengah shift? Apakah perlu izin/admin? Bukti apa yang dibuat? |  |  |
| E3 | Apakah ada pengeluaran kas (misalnya beli air galon, bayar kurir, kembalian pecahan)? Siapa yang mengizinkan dan bukti apa yang disimpan? |  |  |
| E4 | Apakah pernah ada penambahan uang ke laci atau pinjam uang laci? Bagaimana pengawasan dan pencatatannya? |  |  |

---

## F. Tutup shift, setoran, dan selisih

| No | Pertanyaan | Jawaban aktual | Bukti/catatan |
|---|---|---|---|
| F1 | Kapan shift berakhir? Jam tetap atau menyesuaikan? Siapa pemilik shift dan siapa yang boleh menutup? |  |  |
| F2 | Siapa yang menghitung uang? Apakah disaksikan orang lain? Berapa orang yang menandatangani? |  |  |
| F3 | Bagaimana urutan menghitung uang? Per pecahan, pakai mesin hitung, atau cara lain? |  |  |
| F4 | Setoran berupa seluruh uang atau menyisakan modal? Disetor ke siapa/ke mana, jam berapa, per shift atau per hari? |  |  |
| F5 | Bukti setoran apa yang dipakai (slip bank, buku setoran, aplikasi, tanda tangan)? Apakah QRIS dilaporkan terpisah dan dengan bukti apa? |  |  |
| F6 | Berapa toleransi selisih yang masih diterima? Jika kurang atau lebih, siapa yang menyetujui, apa sanksinya, dan bagaimana catatannya? |  |  |
| F7 | Apa isi serah terima shift? Siapa menandatangani? Apakah rekap sistem lama bisa dicetak/diekspor? Dalam format apa? |  |  |
| F8 | **Contoh hitung nyata dari pengelola** (boleh angka contoh, bukan data pelanggan): isi tabel di bawah. | Lihat tabel |  |

**Contoh hitung dari pengelola — belum ada:**

| Modal awal | Penjualan tunai | Penjualan QRIS | Uang keluar | Setoran tengah shift | Uang fisik dihitung | Selisih | Catatan |
|---:|---:|---:|---:|---:|---:|---:|---|
|  |  |  |  |  |  |  |  |

---

## G. Transaksi ambigu dan kegagalan

| No | Pertanyaan | Jawaban aktual | Bukti/catatan |
|---|---|---|---|
| G1 | QRIS sudah berhasil di aplikasi merchant, tetapi POS mati/gagal menyimpan transaksi. Apa langkah pertama? Siapa yang dihubungi? |  |  |
| G2 | Pelanggan sudah membayar tunai, tetapi struk tidak keluar atau hasil commit tidak jelas. Apakah transaksi dianggap sah? Apa yang dilakukan? |  |  |
| G3 | Printer mati, listrik mati, atau aplikasi restart saat transaksi. Bolehkah pelanggan diminta membayar ulang? Catatan manual apa yang dibuat? |  |  |
| G4 | Jika satu pembayaran tercatat dua kali, siapa yang boleh memperbaiki? Bagaimana bukti dan persetujuannya? |  |  |
| G5 | Bagaimana prosedur manual untuk refund, retur, atau utang member? Siapa nomor darurat yang dihubungi di luar jam kerja? |  |  |

---

## H. Laci kasir dan printer struk

> Bagian ini penting untuk TASK-005 (inventaris perangkat). Belum ada kompatibilitas yang boleh diasumsikan.

| No | Pertanyaan | Jawaban aktual | Bukti/catatan |
|---|---|---|---|
| H1 | Laci sekarang otomatis atau manual? Ada kunci fisik? |  |  |
| H2 | Apakah laci otomatis terbuka melalui sistem kasir lama? Pada transaksi apa saja (tunai/QRIS/semua)? |  |  |
| H3 | Merek dan model printer struk? Foto label perangkat. Koneksi ke PC: USB/LAN/serial/Bluetooth? Driver/software apa? |  |  |
| H4 | Merek dan model laci? Foto label. Bagaimana koneksi laci: kabel RJ11 ke printer, USB, serial, atau lain? |  |  |
| H5 | Siapa yang boleh membuka laci tanpa transaksi? Siapa memegang kunci manual? Apakah laci punya sensor status terbuka? |  |  |
| H6 | Apakah ada printer/laci cadangan? Apakah sistem lama menyimpan log buka laci yang bisa diekspor? |  |  |
| H7 | Jika perangkat mendukung, apakah pengelola **setuju atau tidak** bila laci terbuka otomatis hanya setelah transaksi tunai berhasil tersimpan? (Jawaban ini masukan, belum persetujuan teknis.) |  |  |

---

## I. Persetujuan dan bukti

| No | Pertanyaan | Jawaban aktual | Bukti/catatan |
|---|---|---|---|
| I1 | Metode pembayaran yang disahkan untuk pilot:  |  |  |
| I2 | Formula setoran dan toleransi selisih yang disetujui:  |  |  |
| I3 | Nama/jabatan pihak yang berwenang menyetujui selisih, koreksi, dan refund:  |  |  |
| I4 | Bukti wajib yang harus disimpan setiap shift:  |  |  |
| I5 | Catatan tambahan, lampiran, dan hal yang belum diketahui:  |  |  |

---

## J. Tanda tangan

Dengan menandatangani, narasumber menyatakan jawaban di atas sesuai praktik yang diketahui. Bagian yang belum dijawab tetap **PENDING** dan tidak boleh dianggap disetujui.

| Pihak | Nama dan jabatan | Tanda tangan | Tanggal |
|---|---|---|---|
| Narasumber pengelola |  |  |  |
| David (koordinasi) |  |  |  |
| Naazmi (review QA) |  |  |  |

**Lampiran yang dikumpulkan:** ☐ foto printer ☐ foto laci ☐ contoh struk ☐ contoh slip setoran ☐ contoh rekap tutup shift ☐ bukti verifikasi QRIS (disensor) ☐ lain: __________

> **Catatan:** Formulir kosong atau sebagian **tidak** memenuhi TASK-002. Item yang belum dijawab tetap PENDING dan memblokir pilot sesuai `ACCEPTANCE_CRITERIA.md` dan `SCOPE.md` §6.
