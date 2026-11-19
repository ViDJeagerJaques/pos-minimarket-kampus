# API CONTRACT — Backend Lokal

| Atribut | Keterangan |
|---|---|
| Lokasi | `docs/architecture/API_CONTRACT.md` |
| Versi | 0.1.1 — 11 November 2026 |
| Status | **BASELINE DESAIN UNTUK REVIEW TEKNIS** — bukan hasil uji/perizinan produksi |
| Acuan utama | `docs/product/PRD.md` v0.3.1, `SCOPE.md` v0.1.1, `DECISIONS.md` v0.2.3, `ACCEPTANCE_CRITERIA.md` v0.1.1 |
| Pemeriksa | David (model data), Rahmat (backend & integrasi), Syafroni (UI), Naazmi (QA) |

## 1. Sifat kontrak

**Kontrak kandidat untuk implementasi**; belum ada server yang diuji. Dasar: SCOPE S-01–S-12, PRD POS-01.*–POS-10.*, DEC-007, DEC-013, DEC-014. Base URL proses lokal: `/api/v1` melalui `127.0.0.1` dan antarmuka Electron yang aman. Semua `POST/PATCH` memerlukan sesi; `ADMIN` atau `CASHIER` dibatasi di backend; properti `actor_id` tidak dipercaya dari request klien.

## 2. Aturan umum

- Format request/response JSON UTF-8; `Content-Type: application/json`; uang integer rupiah, qty integer unit; waktu ISO-8601 di boundary API atau epoch ms konsisten setelah review (jangan campur dalam endpoint yang sama).
- `requestId` untuk korelasi log, tidak memuat token atau PIN. Respons error standar di bawah.
- Semua endpoint mutasi yang memengaruhi uang/stok memakai identitas upaya idempotent: `attemptKey` untuk checkout, `receiptKey` untuk receiving, `closeKey` untuk penutupan shift.
- `requestHash` adalah SHA-256 dari representasi kanonis UTF-8 yang berversi atas **niat operasi tidak berubah**; detail persis di §2A. Kunci lama + niat sama => kembalikan hasil tersimpan; kunci lama + niat berbeda => `409 IDEMPOTENCY_CONFLICT`. Untuk QRIS, bendera konfirmasi manusia tidak dimasukkan ke hash niat karena baru tersedia setelah prepare.
- Pagination `limit` maksimum 100 (usulan), filter tanggal `[start,end)` zona lokal yang ditetapkan; jangan mengembalikan hash password.
- Jika commit tak jelas, klien wajib *query status*, bukan mengulang pembayaran fisik.

### 2A. Kanonisasi checkout dan status prepare/commit (kontrak yang harus sama di UI/backend/tests)

1. `POST /checkouts/prepare` menerima `attemptKey`, `shiftId`, `items` dan `payment.method`. Backend mengambil `cashierId` dari sesi; memvalidasi shift, item, harga, jumlah, stok sementara; lalu menghasilkan snapshot `quote` berisi `productId`, `quantity`, `unitPriceRp`, `lineTotalRp`, `totalRp` dan `payment.method`, serta `requestHash`. Simpan `attemptKey`, pemilik, shift dan hash di SQLite sebelum mengembalikan `PREPARED`. **Harga diambil backend**, bukan dipercayai dari UI.
2. Untuk menghitung hash, bentuk objek niat versi `checkout-v1` dengan kunci tetap `version`, `cashierId`, `shiftId`, `items` (tersortir menaik menurut `productId`, ID unik, kuantitas integer positif, harga dan subtotal integer rupiah dari quote), `totalRp`, `paymentMethod`. Gunakan serialisasi JSON kanonis yang didefinisikan bersama di `shared` (urutan kunci objek deterministik, tanpa whitespace tak bermakna, tanpa floating point), UTF-8, lalu SHA-256. Buat fixture golden-vector dan ujikan frontend/backend dengan hasil hash sama; jangan membuat implementasi serialisasi terpisah yang berbeda.
3. `POST /checkouts/commit` membawa `attemptKey`, `requestHash` dari prepare, dan data **konfirmasi pembayaran**: tunai `cashReceivedRp`, atau QRIS `merchantConfirmed=true` dan `confirmedAmountRp` sesuai total. Backend mengambil snapshot niat dari prepare, memeriksa ulang hash, hak akses, shift, harga, saldo dan kelayakan bayar dalam transaksi penulis. Untuk perubahan barang/harga/metode, **buat upaya baru** (jangan pakai `attemptKey` lama). Untuk uang tunai, uang diterima/kembalian diproses dalam transaksi commit; untuk QRIS, informasi konfirmasi tidak berasal dari bank, hanya attestasi kasir, dan identitas/waktu diset dari sesi/jam backend.
4. **Retry**: query `GET /checkouts/:attemptKey` terlebih dahulu jika status tidak jelas. Jika sudah `COMMITTED`, kembalikan sale tersimpan tanpa menjual/menagih kembali; jika `PREPARED` lanjutkan hanya dengan niat yang sama. `ABANDONED` tidak boleh commit. Saat hasil commit tak diketahui, jangan ulangi aksi pembayaran fisik; ikuti prosedur rekonsiliasi.
5. Respons `prepare` mengandung `attemptKey`, `requestHash`, `quote`, `status=PREPARED`; respons `commit` mengandung `saleId`, `saleNo`, `status=COMMITTED` dan info pembayaran yang aman. Kesalahan quote kedaluwarsa/harga berubah memakai `409` dan mengharuskan prepare baru. Semua ini adalah **spesifikasi baseline implementasi**, belum endpoint nyata.

## 3. Matriks endpoint baseline

| Metode + endpoint | Role | Hasil/kontrak utama | Catatan |
|---|---|---|---|
| `POST /auth/login` | publik lokal | session terautentikasi | throttle kegagalan |
| `POST /auth/logout` | login | sesi dicabut, shift tetap aktif | DEC-006 |
| `GET /auth/me` | login | user id, role, session | tanpa credential |
| `GET /products?query=&barcode=` | ADMIN/CASHIER | list id, sku, name, price, stock, active | minimal fields |
| `POST /products` | ADMIN | produk baru | validasi SKU/barcode unik |
| `PATCH /products/:id` | ADMIN | perubahan katalog | audit harga |
| `GET /shifts/current` | login | shift aktif atau null | kasir hanya shift milik sendiri; ADMIN ringkasan |
| `POST /shifts/open` | CASHIER | shiftId, openingCashRp | ADMIN **belum diizinkan** selama DEC-019 `PENDING`; cek tidak ada shift aktif |
| `GET /shifts/:id/close/preview` | CASHIER pemilik | pratinjau rekap shift aktif | hanya baca; 409 jika sudah tutup |
| `GET /shifts/:id/close` | CASHIER pemilik | hasil penutupan tersimpan, sama dengan respons POST | 404 jika belum ada hasil; bukan bukti POST yang masih berjalan gagal |
| `POST /shifts/:id/close` | CASHIER pemegang shift | closing, totals, variance | closeKey idempotent; ADMIN belum diizinkan (DEC-019 `PENDING`) |
| `POST /checkouts/prepare` | CASHIER pada shift | attemptKey, ringkasan harga dan status | **tidak** membuat sale |
| `POST /checkouts/commit` | CASHIER pada shift | saleId, saleNo, totalRp, payment method | commit atomik |
| `GET /checkouts/:attemptKey` | owner/ADMIN | status PREPARED / COMMITTED / ABANDONED | pemulihan |
| `GET /sales/:id` | owner/ADMIN sesuai policy | header/items/payments | cetak ulang tanpa sale baru |
| `POST /sales/:id/print` | owner/ADMIN | hasil upaya print | postcommit |
| `POST /goods-receipts` | ADMIN | id penerimaan | receiptKey |
| `POST /inventory/adjustments` | ADMIN | mutasi dan saldo baru | alasan wajib |
| `GET /reports/daily` | ADMIN | omzet, CASH, QRIS, jumlah transaksi | time range |
| `GET /reports/stock` | ADMIN | saldo/low/zero | batas minimum belum final |
| `POST /backups` | ADMIN | metadata lokasi/hash | path tidak arbitrer dari UI |

Pembagian endpoint hanya usulan; perubahan harus diselaraskan dengan UI, backend, dan tests. **Jangan implementasi endpoint sampai skema `DATABASE.md` untuk verifikasi QRIS disetujui**.

**Shift (TASK-014, baseline DEMO).** `POST /shifts/open` hanya untuk `CASHIER`; `ADMIN` **belum diizinkan** membuka shift selama DEC-019 masih `PENDING` (AUTHORIZATION.md §3 dan SECURITY.md §4: ADMIN bukan otomatis kasir). Perubahan ini memerlukan review David dan pembaruan DEC-019. `openingCashRp` bersifat opsional (DEMO); kewajiban modal awal menunggu konfirmasi SOP pengelola. Satu shift aktif per PC ditegakkan constraint `ux_shifts_single_open`; pemilik shift hanya dari sesi.

**Baca penutupan (TASK-022 lanjutan, DEMO; review integrasi diperlukan).**
`GET /shifts/:id/close/preview` hanya membaca snapshot shift aktif: `shiftId`,
`openingCashRp` (nullable), `cashTotalRp`, `qrisTotalRp`, `expectedCashRp` dan
`saleCount`. Fixture menghitung modal null sebagai 0 dan memisahkan QRIS dari
kas. Tidak menerima uang dihitung atau menghitung selisih. Preview merupakan
snapshot saat dibaca; transaksi yang commit setelahnya dapat mengubah hasil final.
Shift tertutup menghasilkan `409 SHIFT_CLOSED`.

`GET /shifts/:id/close` mengembalikan DTO penutupan yang sama dengan POST,
termasuk `closeKey`, `requestHash`, `closedAtMs`, `totals`, dan `varianceRp`.
Kedua endpoint hanya untuk CASHIER aktif pemilik: kasir lain dan ADMIN 403,
shift tidak ada 404; GET hasil juga 404 jika belum tersimpan. Respons 404 ketika
POST mungkin masih berjalan **bukan bukti gagal**: periksa lagi atau retry POST
identik dengan `closeKey` dan payload yang sama; jangan membuat kunci baru.
Rumus merupakan fixture DEMO dan SOP setoran masih PENDING (DEC-016).

## 4. Kontrak contoh checkout QRIS manual

```json
{
  "attemptKey": "co_20261111_draft001",
  "requestHash": "<SHA256_HEX_DARI_PREPARE>",
  "paymentConfirmation": {"method": "QRIS_MANUAL",
    "merchantConfirmed": true, "confirmedAmountRp": 5000}
}
```

Backend mengambil actor dari sesi dan `verifiedAt` dari jam server lokal saat menerima verifikasi; jangan percaya `verifiedBy` dari body. Backend **tidak dapat membuktikan pembayaran bank** hanya dari boolean. Kasir harus memeriksa aplikasi merchant; audit menyimpan attestasi manusia. Jika hasil bank/commit ambigu => `PAYMENT_RECONCILIATION_REQUIRED`, hentikan penagihan ulang dan serahkan pada prosedur yang disetujui pengelola.

**Tunai**: `paymentConfirmation.method: CASH`, `cashReceivedRp` >= total, `changeRp` dihitung backend. **Split payment** tidak termasuk P0 tanpa perubahan DEC-016.

## 5. Response sukses dan gagal

```json
{"data":{"saleId":102,"saleNo":"S-000102","totalRp":5000},"requestId":"r-001"}
```
```json
{"error":{"code":"INSUFFICIENT_STOCK","message":"Stok tidak cukup","requestId":"r-002","retryable":false}}
```

Gunakan kode pada `ERROR_HANDLING.md`; `401` auth, `403` role, `404` not found, `409` state/idempotency/stok, `422` input, `500` kesalahan internal. Tidak boleh kirim stack trace, password, session token, atau detail bank ke renderer.

## 6. Contract tests minimum

Login benar/salah; CASHIER mengakses adjustment => 403; stok kurang => tidak ada sale/movement; dua permintaan identik => satu sale; kunci sama isi berbeda => 409; QRIS tanpa merchantConfirmed atau beda nominal => ditolak; test golden-vector hash prepare/commit, metode bayar berbeda pada key sama => 409; cetak ulang => tidak menambah sale; shift close dua kali => hasil sama/tolak sesuai closeKey; restart => status persisted; offline => endpoint tetap bisa dijalankan.


## TASK-039 � kontrak DEMO koreksi stok (K-11)

Implementasi backend `POST /inventory/adjustments` hanya untuk ADMIN aktif.
Kontrak aditif untuk uji TASK-039; SOP koreksi/DEC-018 tetap PROPOSED dan perlu
validasi pengelola. K-11 ditangani secara teknis oleh migrasi 0003, bukan klaim
persetujuan operasional. Tidak mengubah kontrak checkout atau penerimaan.

Request: `{ "adjustmentKey": "adj-demo-1", "productId": 1,
"expectedOnHand": 5, "targetOnHand": 3, "reason": "DEMO hasil hitung fisik" }`.
Kunci 1�128 karakter, alasan 1�200 karakter (trim, tanpa karakter kontrol);
ID positif, saldo integer aman nonnegatif. Saldo tujuan harus berbeda dari saldo awal.
Actor dan waktu diambil dari sesi dan jam backend; field tambahan actor/waktu diabaikan.
Produk harus ada; produk nonaktif tetap dapat dikoreksi oleh ADMIN.

Transaksi `BEGIN IMMEDIATE` memeriksa retry sebelum saldo: key dan niat kanonis
(versi, actor, productId, expectedOnHand, targetOnHand, reason) sama mengembalikan
hasil tersimpan, termasuk setelah restart atau perubahan saldo berikutnya.
Key sama dengan niat/actor berbeda ditolak `409 IDEMPOTENCY_CONFLICT`.
Saldo aktual berbeda dari expectedOnHand ditolak `409 CONFLICT` agar hitungan
lama tidak menimpa transaksi yang telah masuk. Buat upaya baru hanya setelah
hasil lama diketahui dan saldo dihitung ulang. Timeout: ulangi payload/key identik.

HTTP 201 `{data: {adjustmentKey, requestHash, movementId, productId,
previousOnHand, onHand, delta, reason, actorId, committedAtMs, duplicate}}`.
`onHand` adalah snapshot sesudah koreksi itu, bukan saldo terkini pada retry.
401 untuk sesi invalid, 403 untuk CASHIER, 404 produk tidak ada, 422 input invalid
(termasuk saldo negatif, alasan kosong, delta nol). Kesalahan tidak menambah mutasi/audit.
Ledger ADJUSTMENT, identitas retry, dan audit INVENTORY_ADJUSTED commit/rollback bersama.
