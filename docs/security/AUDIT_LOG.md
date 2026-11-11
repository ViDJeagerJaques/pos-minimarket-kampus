# AUDIT LOG — Jejak Aktivitas Kritis POS

| Atribut | Nilai |
|---|---|
| Lokasi | `docs/security/AUDIT_LOG.md` |
| Versi / status | 0.1.0 — baseline rancangan; retensi & akses baca masih perlu persetujuan |
| Referensi | `../architecture/DATABASE.md` §13, AUTHORIZATION.md, DATA_PROTECTION.md, PRD, AC-01.04, AC-07.03 |

## 1. Prinsip

Audit membantu menjawab **siapa melakukan apa, kapan, pada objek mana, dan hasilnya bagaimana**, bukan menggantikan penjualan/ledger sebagai sumber kebenaran akuntansi. Rekaman audit tidak boleh menjadi pengganti `sale_items`, `payments`, `shift_closings` maupun `inventory_movements`. Audit tidak dapat mencegah admin OS mengubah file langsung; itu risiko residu dari satu PC.

## 2. Model penyimpanan yang benar-benar tersedia

Skema yang **diusulkan** `DATABASE.md` mempunyai `audit_log(id, actor_id, action, entity_type, entity_id, details, created_at_ms)` sebagai 18 tabel desain. **Belum ada** kolom native `request_id`, `ip_address`, `outcome`, `old_value`, `new_value`, `session_id` atau jenis event. Bila ingin menyimpan outcome/korelasi, gunakan `details` JSON yang dibatasi dan berversi **untuk event yang relevan**, atau buat migrasi yang direview. Jangan menulis kode yang mengacu kolom yang belum ada.

| Field | Sumber tepercaya | Ketentuan |
|---|---|---|
| `actor_id` | Sesi backend | Login gagal tanpa actor valid boleh dicatat dalam log keamanan terpisah, bukan FK palsu |
| `action` | Nama aksi terdaftar dalam service | Whitelist nama event, bukan string mentah dari UI |
| `entity_type`/`entity_id` | Objek domain tersimpan | ID dari hasil DB; jangan memuat data pribadi |
| `details` | JSON terstruktur yang telah disaring | Hanya field aman; batas ukuran/jenis; versi schema event |
| `created_at_ms` | Jam UTC backend | Sumber jam lokal dapat berubah; urutan commit transaksi lebih tepercaya daripada jam semata |

## 3. Event minimum

| ID | Event | Bukti wajib | Batas penyimpanan |
|---|---|---|---|
| AUD-01 | `ACCOUNT_CREATED`, `ACCOUNT_DISABLED`, `ROLE_CHANGED` | Actor, target, tindakan, waktu; perubahan role/status | Jangan simpan password atau password hash lama |
| AUD-02 | `PRODUCT_CREATED`, `PRICE_CHANGED`, `BARCODE_CHANGED` | Actor, produk, harga lama/baru untuk perubahan harga | Nama/harga diperbolehkan sesuai kebutuhan operasional |
| AUD-03 | `GOODS_RECEIPT_COMMITTED` | Actor, ID penerimaan, referensi ledger | Tidak menduplikasi seluruh item dalam JSON |
| AUD-04 | `INVENTORY_ADJUSTED` | Actor ADMIN, produk, delta, alasan nonkosong, ID mutasi | Perubahan saldo dapat direkonsiliasi ledger |
| AUD-05 | `SHIFT_OPENED`, `SHIFT_CLOSED` | Actor, shift, waktu, status | Nilai kas dapat tetap di tabel shift/closing; batasi detail log |
| AUD-06 | `BACKUP_CREATED`, `BACKUP_FAILED` | Actor bila diketahui, backup ID, hasil, waktu | Jangan menulis path rahasia lengkap ke log UI |
| AUD-07 | `RESTORE_STARTED`, `RESTORE_FINISHED`, `RESTORE_FAILED` | Operator, persetujuan, backup ID, status | Audit restore harus bertahan di luar DB yang diganti (log operasional terpisah) |
| AUD-08 | `QRIS_MANUAL_CONFIRMED` | Actor, sale/attempt, waktu dan nominal dari payment tersimpan | `payments.verified_by` + `verified_at_ms` adalah sumber utama; audit dapat merujuk saja |
| AUD-09 | `ACCESS_DENIED`, `LOGIN_FAILED` | Correlation ID, waktu, aksi umum, hasil | Catat di log keamanan yang dibatasi, bukan memasukkan actor fiktif ke audit_log |
| AUD-10 | `APP_STARTED`, `DATABASE_INTEGRITY_FAILED` | Versi dan hasil pemeriksaan | Log operasional terpisah bila bukan transaksi domain |

## 4. Transaksi dan konsistensi

- Event keberhasilan yang terkait perubahan domain (contoh adjustment, akun, harga, penutupan shift) ditulis **dalam transaksi SQLite yang sama** jika tabel audit dipakai, sehingga tidak ada mutasi tanpa audit atau audit sukses untuk operasi gagal.
- Penjualan final, payment QRIS dan movement diikat oleh commit domain. Jika menulis `QRIS_MANUAL_CONFIRMED`, insert setelah validasi dan **sebelum commit transaksi yang sama**; jangan menyimpulkan QRIS berhasil dari event yang tidak punya sale.
- Event `LOGIN_FAILED` dan `ACCESS_DENIED` tidak boleh melakukan commit transaksi bisnis; simpan dalam log keamanan terpisah atau storage yang sengaja ditentukan, dengan batas retensi agar tidak memenuhi disk.
- Restore dapat mengganti seluruh `audit_log` di database target. Log operasi restore dan catatan persetujuan harus disimpan **di luar DB yang dipulihkan** supaya tindakan itu tetap terlacak.

## 5. Pengamanan log

Data yang **dilarang**: sandi plaintext, hash password, token/digest sesi, OTP/PIN/credential merchant, nomor kartu, full HTTP headers Authorization, seluruh request body pembayaran, stack trace berisi rahasia. Sanitasi line-break/control characters pada teks dari UI agar tidak memalsukan baris log. Batasi ukuran `details` dan akses pembacaan. Buat log rotate dengan ambang batas, jangan menimpa ledger demi menghemat penyimpanan.

## 6. Retensi dan akses

- Pembaca audit sensitif belum diputuskan oleh pengelola; kandidat ADMIN hanya melalui UI/API yang difilter, bukan akses SQL bebas.
- Retensi log keamanan dan audit historis memerlukan aturan bersama pengelola; jangan mengklaim "wajib 5 tahun" atau angka hukum tertentu tanpa dasar. Sumber utama penjualan tetap mengikuti ketentuan arsip yang disetujui.
- Jika kebutuhan integritas lebih tinggi: hash-chain/signing merupakan opsi fase lanjutan, tetapi tanpa root of trust eksternal tetap ada risiko manipulasi oleh admin OS.

## 7. Test yang harus dijalankan

| ID | Tindakan | Hasil |
|---|---|---|
| AUDT-01 | Ubah harga dan akun, lihat audit | Actor/objek/waktu terisi, perubahan harga terlacak |
| AUDT-02 | Koreksi stok ADMIN dengan alasan; coba CASHIER | Admin memiliki satu movement + audit; CASHIER ditolak tanpa movement |
| AUDT-03 | Paksa rollback pada mutasi stok | Tidak ada movement maupun audit sukses parsial |
| AUDT-04 | QRIS manual diselesaikan | Payment verified_by dari sesi; tidak tersimpan PIN/bank screenshot |
| AUDT-05 | Replay checkout identik | Satu sale/payment/movement, tidak ada audit sukses berulang yang menyesatkan |
| AUDT-06 | Login salah dan akses ditolak bertubi-tubi | Tidak membuat akun palsu, logs dibatasi, tanpa informasi sandi |
| AUDT-07 | Jalankan restore uji | Log restore eksternal tetap ada dan menunjuk backup yang digunakan |

**Catatan:** tabel audit dan event di atas merupakan rancangan, bukan bukti bahwa log sudah tersedia saat ini.
