# AUTHORIZATION — Authentication, RBAC, Ownership

| Atribut | Nilai |
|---|---|
| Lokasi | `docs/security/AUTHORIZATION.md` |
| Versi / status | 0.2.0 — baseline review (merevisi draft lama v0.1.0; **tidak otomatis disahkan pengelola**) |
| Acuan | `../product/PRD.md` v0.3.1, `../product/SCOPE.md` v0.1.1, `../product/DECISIONS.md` v0.2.3, `../architecture/DATABASE.md` v0.2.1, `../architecture/API_CONTRACT.md` v0.1.1 |

## 1. Tujuan

Backend lokal, bukan tombol UI, menentukan siapa dapat melakukan operasi pada katalog, shift, checkout, penerimaan, stok, laporan, dan backup. Kebijakan **deny by default**, least privilege, otorisasi ulang di setiap request, dan ownership dari data tersimpan berlaku untuk dua role `ADMIN` dan `CASHIER` (DEC-001, DEC-014). Tambahan role dan pengambilalihan shift adalah PENDING (DEC-019).

## 2. Autentikasi dan sesi

- Login offline memeriksa username, hash password ber-salt adaptif dan `users.active`; gunakan pustaka matang yang kompatibel dengan Windows. Argon2id kandidat utama, alternatif dinilai sesuai perangkat; jangan membuat algoritme hash sendiri.
- Token sesi acak kriptografis diterbitkan backend. Hanya digest token disimpan di `sessions.token_digest` (BLOB 32 byte); token mentah **tidak** pernah masuk SQLite/log. Durasi, idle timeout dan tempat penyimpanan token dalam Electron harus ditetapkan dan diuji sebelum pilot.
- Gunakan transport aman dalam satu PC: HTTP loopback autentikasi + validasi Host/Origin dan proteksi CSRF bila cookies digunakan, **atau** IPC sempit. Jangan simpan token di `localStorage` renderer jika dapat dihindari. Jangan akses server melalui 0.0.0.0.
- Logout mencabut sesi dan membersihkan renderer, **bukan** menutup shift. Login ulang pemilik dapat resume shift setelah restart. Status akun yang menjadi nonaktif berlaku pada request selanjutnya.
- Hindari akun ADMIN default dengan password tertanam. Bootstrap akun pertama dilakukan secara terkendali (installer/operator), dengan ganti sandi wajib dan pencatatan. Alur reset password tanpa bergantung internet memerlukan prosedur pengelola dan audit.

## 3. Matriks izin minimum P0

Arti: **Own** = terbatas pada `shifts.cashier_id`, `checkout_attempts.cashier_id` atau transaksi yang terhubung ke shift miliknya, diperiksa di backend; **Yes** = boleh sesuai precondition; **No** = 403; **Pending** = jangan aktifkan sampai desain disahkan.

| Tindakan API/domain | ADMIN | CASHIER | Batas penting |
|---|---|---|---|
| Login/logout, melihat profil sendiri | Yes | Yes | Pengguna aktif; logout sesi sendiri |
| Buat/nonaktifkan akun | Yes | No | Tidak boleh menonaktifkan akun terakhir yang dapat memulihkan ADMIN tanpa prosedur |
| Lihat katalog untuk penjualan | Yes | Yes | Harga dari DB, barcode disanitasi |
| Buat/ubah produk, kategori, supplier, harga | Yes | No | Harga baru tidak mengubah penjualan historis; audit perubahan |
| Buka shift | **No** | Own | Backend menetapkan owner dari sesi; satu shift aktif |
| Lanjut/lihat shift berjalan | Read summary | Own | ADMIN bukan pemilik, tidak boleh kasir atas nama owner |
| Tutup shift | **No** | Own | `closeKey`, cash count dan SOP; close tidak otomatis |
| Checkout prepare/commit | No | Own | Shift aktif milik sendiri; validasi ulang dalam transaksi |
| Lihat status upaya checkout | **Read** (untuk investigasi) | Own | ADMIN tidak mengulang pembayaran atau membuat sale |
| Baca sale/print/reprint | Read | Own | `POST /sales/:id/print` **CASHIER own**; ADMIN hanya melihat kecuali izin cetak admin ditetapkan |
| Penerimaan barang | Yes | No | `receiptKey` idempotent, delta stok atomik |
| Koreksi stok manual | Yes | No | Alasan wajib, mutasi `ADJUSTMENT`, identitas/waktu dari backend |
| Laporan harian/stok/lintas shift | Yes | No | CASHIER boleh melihat ringkasan shift sendiri |
| Buat backup | Yes | No | Tujuan terkonfigurasi, media berbeda; audit |
| Restore backup | Yes + operator | No | Maintenance mode, konfirmasi dan uji restore; jangan akses endpoint publik tanpa guard |
| Baca audit sensitif | Pending (ADMIN candidate) | No | Jenis data dan retensi perlu ditetapkan |
| Void/refund/retur/member kredit | No | No | Di luar MVP sampai SOP disetujui |
| Force close/ambil alih shift | No | No | PENDING DEC-019 |
| QRIS otomatis, cloud sync | No | No | OUT/P1 |

**Konflik spesifikasi yang ditemukan:** `API_CONTRACT.md` masih mencantumkan `POST /shifts/open` untuk CASHIER/ADMIN bersyarat dan `POST /sales/:id/print` untuk owner/ADMIN, sedangkan ownership `shifts.cashier_id` dan model dua role belum menetapkan ADMIN sebagai operator kasir. Sampai keputusan disahkan, **implementasi konservatif hanya CASHIER own**. Koreksi endpoint tersebut di Architecture harus dilakukan **sebelum penguncian kontrak untuk coding**; Security sendiri tidak mengubah dokumen Architecture diam-diam. Lihat `AUDIT_SECURITY.md`.

## 4. Aturan ownership dan state

1. Identitas actor diambil dari sesi backend, bukan `actorId`, `verifiedBy`, `role`, `cashierId` atau `closingBy` di body.
2. Shift yang aktif dibatasi satu dengan constraint/transaction; owner CASHIER tertulis di `shifts.cashier_id`. Kasir lain tidak boleh menutup/melanjutkan tanpa prosedur override yang disahkan.
3. Akses kasir terhadap sale diperoleh lewat `sales.attempt_key -> checkout_attempts.shift_id -> shifts.cashier_id`, bukan hanya `saleId` atau nomor struk yang dapat ditebak.
4. Retry checkout dengan `attemptKey` identik dapat mengembalikan penjualan asli **hanya** kepada pemilik, termasuk setelah shift tertutup. Payload/hash berbeda -> `IDEMPOTENCY_CONFLICT` dan tidak menulis data.
5. `PREPARED` tidak sama dengan penjualan lunas. Hanya backend commit yang menyimpan sale. QRIS manual memerlukan attestasi kasir setelah memeriksa bukti sukses di kanal merchant.
6. Admin koreksi stok hanya melalui mutasi ledger positif/negatif bertipe `ADJUSTMENT`; validasi stok tidak negatif di bawah batas transaksi penulis. Semua alasan dan pelaku tercatat.
7. Daftar, filter, rekap dan ekspor juga wajib scoped, tidak hanya endpoint detail. Tidak mengizinkan IDOR lewat filter query.

## 5. Guard backend yang wajib

```text
handler(action, request):
  if action == auth.login: return authenticate(request.credentials)
  subject = session.lookupAndVerify(request.credential)
  if !subject || !subject.active: return 401
  policy = allowlist[action]
  if !policy || !policy.roles.contains(subject.role): return 403
  input = validateSchema(request.body)
  if action references existing resource:
      resource = loadFromDb(input.resourceId)
      if !policy.ownsOrMayRead(subject, resource): return 404_or_403
  if write domain:
      BEGIN IMMEDIATE
      recheck user active, role, resource owner, state, price/stock, idempotency
      write data + audit in same transaction where supported
      COMMIT
  return sanitizedResult
```

Tidak boleh mengandalkan middleware saja: business service mengulang pemeriksaan penting **di transaksi** untuk mencegah TOCTOU. Error untuk akses lintas user tidak membocorkan detail objek.

## 6. Bootstrap dan pemulihan akses

- ADMIN pertama dibuat hanya sekali dengan mekanisme setup yang memerlukan akses fisik/operator terotorisasi; kredensial sementara harus diganti sebelum kasir sungguhan. Jangan seed sandi tetap dalam kode, migrations atau `.env.example`.
- Kasir nonaktif tidak boleh login. Bila akun pemilik shift hilang atau sandi lupa, jangan mengubah `cashier_id` langsung; eskalasi ke pengelola, karena override shift belum disahkan.
- Jika semua akun ADMIN hilang: prosedur pemulihan terpisah menggunakan backup/persetujuan pengelola dan akses operator OS; jangan menyediakan tombol "master password".

## 7. Pengujian wajib

| ID | Test | Expected |
|---|---|---|
| AUTH-01 | Login benar/akun nonaktif/sandi salah tanpa internet | Hanya akun aktif benar dapat sesi, error tidak bocorkan keberadaan akun |
| AUTH-02 | CASHIER panggil `/inventory/adjustments`, `/products`, `/backups` via HTTP langsung | 403; DB tidak berubah |
| AUTH-03 | CASHIER B akses shift/sale/status attempt CASHIER A | Ditolak; tidak ada data milik A |
| AUTH-04 | Logout lalu pakai token lama | 401; shift tetap aktif |
| AUTH-05 | Restart backend lalu owner login ulang | Token lama invalid; owner resume shift yang sama |
| AUTH-06 | Change active/role user dengan sesi lama | Permission diperbarui dan token lama dicabut atau re-checked |
| AUTH-07 | ADMIN mencoba open/close shift, checkout, print tanpa keputusan tambahan | Ditolak pada baseline konservatif |
| AUTH-08 | QRIS `verifiedBy` dari payload dipalsukan | Server memakai ID sesi dan jam backend |
| AUTH-09 | Audit account create/deactivate dan adjustment | Actor/status/objek tercatat; tidak bocor password/token |
| AUTH-10 | Buka shift simultan | Hanya satu aktif; pelaku tidak dapat mengklaim owner orang lain |

## 8. Keputusan belum final

Timeout sesi, aturan panjang password dan lockout, ownership akun pertama, prosedur shift takeover dan admin cetak ulang memerlukan review David/Rahmat/pengelola. Jangan mengubah status DEC-019 atau membuka endpoint karena kemudahan UI. Bukti pengujian ditulis dalam `docs/operations/TEST_CASES.md` ketika dokumen tersebut dibuat dan test benar-benar dijalankan.
