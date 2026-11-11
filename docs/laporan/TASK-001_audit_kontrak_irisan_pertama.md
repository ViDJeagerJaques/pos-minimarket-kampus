# TASK-001 — Audit Kontrak Irisan Pertama

| Atribut | Isi |
|---|---|
| Tugas | TASK-001 · Dokumentasi/Review · Owner David · Reviewer Rahmat |
| Referensi | DEC-004, DEC-007, DEC-010, DEC-014 (+ DEC-006/012/013/016/018/019 karena terdampak) |
| Tanggal audit | 12 November 2026 (waktu lokal agent) |
| Branch / commit | `task/p01-001` @ `38aabd7`, working tree bersih sebelum dan sesudah audit |
| Versi yang diaudit | DECISIONS v0.2.3 · PRD v0.3.1 · SCOPE v0.1.1 · TASKS v0.2.1 · DATABASE v0.2.1 · API_CONTRACT v0.1.1 · AUTHORIZATION v0.2.0 (pembanding: ARCHITECTURE v0.2.1, TECH_STACK v0.1.0, ERROR_HANDLING v0.1.0) |
| Status | **SIAP REVIEW**, belum Selesai. Review Rahmat wajib (TASKS §13) |

> [!IMPORTANT]
> Audit ini tidak mengubah file di repository, tidak menulis endpoint atau migrasi, dan tidak mengubah status DEC apa pun. Semua "rekomendasi" adalah usulan yang harus diputuskan oleh pihak yang tercantum.

---

## 1. Kondisi awal yang diperiksa

- Repository hanya berisi dokumentasi. **Tidak ada** `package.json`, kode `.ts/.js`, `.sql`, migrasi, atau skrip tes. Belum ada pekerjaan pendahulu berupa kode.
- `docs/operations/` tidak ada; folder sebenarnya `docs/operations and qa/`.
- Ada dua register keputusan: `DECISIONS.md` v0.2.3 (aktif) dan `DECISIONS_v0.2.1_REVISI.md` (salinan lama yang mencantumkan lokasi `docs/product/DECISIONS.md`).

---

## 2. Daftar konflik

Severity: **Blocker** = menahan coding modul terkait · **Major** = harus diputuskan sebelum kontrak modul dikunci · **Minor** = koreksi dokumen/penamaan, tidak menahan fondasi.

### 2.1 Izin shift, cetak ulang, dan status checkout (fokus khusus)

| ID | Sev | Konflik | Lokasi A | Lokasi B | Dampak | Rekomendasi | Pemutus |
|---|---|---|---|---|---|---|---|
| K-01 | **Blocker** | **Buka shift:** API membolehkan "CASHIER/ADMIN dengan izin". PRD, AUTHZ, dan DEC-012 hanya membolehkan kasir. | [API_CONTRACT.md §3 L43](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/API_CONTRACT.md#L43) | [PRD.md §2.1 L42](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/PRD.md#L42), [PRD §4.2 L97](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/PRD.md#L97), [AUTHORIZATION.md §3 L31](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/security/AUTHORIZATION.md#L31), [DECISIONS.md DEC-012 L189](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/DECISIONS.md#L189) | Kalau ADMIN boleh membuka shift, ADMIN juga bisa checkout dan menutup shift. Skema mengizinkan ADMIN tercatat di `shifts.cashier_id` (probe D3). | Ubah baris API menjadi **CASHIER own, owner diambil dari sesi**. ADMIN mendapat 403. Jika lapangan membutuhkan ADMIN merangkap kasir, putuskan lewat DEC-019/TASK-004 dengan akun terpisah. | David + Rahmat. Pengelola (TASK-004) jika ADMIN perlu merangkap kasir |
| K-02 | **Blocker** | **Tutup shift:** API mengizinkan "ADMIN jika dia sendiri pemilik shift". Menurut PRD, ADMIN tidak pernah menjadi pemilik shift. | [API_CONTRACT.md §3 L44](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/API_CONTRACT.md#L44) | [PRD.md §2.1 L47](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/PRD.md#L47), [AUTHORIZATION.md L33](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/security/AUTHORIZATION.md#L33), [DATABASE.md §10 L301](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/DATABASE.md#L301), [ARCHITECTURE.md L141](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/ARCHITECTURE.md#L141) | FK komposit `shift_closings(shift_id, closed_by)` hanya menjamin penutup = pemilik (probe D4/D5). Role tidak ditegakkan, jadi shift milik ADMIN tetap bisa ditutup ADMIN. | Hapus klausa ADMIN di API. Backend menolak ADMIN untuk `POST /shifts/:id/close`. Force close/takeover tetap PENDING DEC-019. | David + Rahmat |
| K-03 | **Major** | **Cetak/cetak ulang:** API membolehkan `owner/ADMIN`. PRD dan AUTHZ menyatakan ADMIN **Tidak** boleh cetak ulang. | [API_CONTRACT.md §3 L49](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/API_CONTRACT.md#L49) | [PRD.md §2.1 L45](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/PRD.md#L45), [AUTHORIZATION.md L36](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/security/AUTHORIZATION.md#L36), [AUTH-07 L98](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/security/AUTHORIZATION.md#L98) | Izin untuk endpoint TASK-021 dan uji AUTH-07 akan saling bertentangan. | `POST /sales/:id/print` hanya **CASHIER own** (rantai `sales.attempt_key → checkout_attempts.cashier_id`). ADMIN cukup membaca lewat `GET /sales/:id`. Izin cetak admin hanya ditambahkan lewat keputusan baru. | David + Rahmat. Pengelola jika admin perlu mencetak ulang |
| K-04 | **Major** | **Status upaya checkout:** API dan AUTHZ memberi ADMIN akses baca. PRD menyatakan "Checkout, **periksa retry** …: ADMIN Tidak". | [API_CONTRACT.md L47](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/API_CONTRACT.md#L47), [AUTHORIZATION.md L35](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/security/AUTHORIZATION.md#L35) | [PRD.md §2.1 L43](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/PRD.md#L43) | Matriks izin TASK-019 dan AC-01.03 jadi ambigu. | Sampai ada keputusan: ADMIN mendapat 403 di `GET /checkouts/:attemptKey`. Investigasi memakai "Baca transaksi tersimpan" ([PRD L44](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/PRD.md#L44)). Jika read-only ADMIN diperlukan, PRD §2.1 direvisi lewat review. | David + Rahmat |

### 2.2 Skema vs kontrak checkout/pembayaran

| ID | Sev | Konflik | Lokasi A | Lokasi B | Dampak | Rekomendasi | Pemutus |
|---|---|---|---|---|---|---|---|
| K-05 | **Blocker** (TASK-016) | API mewajibkan backend "mengambil snapshot niat dari prepare", dan body commit tidak membawa item. Tabel `checkout_attempts` hanya menyimpan hash (probe D15). | [API_CONTRACT.md §2A L26–L28](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/API_CONTRACT.md#L26-L28) | [DATABASE.md §5 L86](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/DATABASE.md#L86), [DDL L172–L180](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/DATABASE.md#L172-L180) | Commit tidak bisa membangun `sale_items` dan tidak bisa mendeteksi perubahan harga terhadap quote. Kontrak tidak bisa diimplementasikan seperti tertulis. | Pilih salah satu, lalu ajukan review migrasi: (a) tambah snapshot quote seperti item, total, dan `payment_method` ke attempt, atau (b) commit mengirim ulang item dan backend menghitung ulang hash. | David (skema) + Rahmat (API) |
| K-06 | **Major** | Isi `requestHash` berbeda. API: `version, cashierId, shiftId, items, totalRp, paymentMethod`, tanpa jumlah bayar. DB §14: termasuk "**jumlah bayar**". | [API_CONTRACT.md §2A L27](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/API_CONTRACT.md#L27) | [DATABASE.md §14 L317](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/DATABASE.md#L317) | Golden-vector frontend/backend tidak bisa disepakati, sehingga retry identik berisiko terbaca sebagai `IDEMPOTENCY_CONFLICT`. | Ikuti API: jumlah bayar **tidak** ikut hash, karena prepare belum mengenal uang diterima dan nominal QRIS harus sama dengan total. Revisi DB §14. | Rahmat + David; Syafroni untuk fixture hash |
| K-07 | **Blocker** (QRIS) | Skema verifikasi QRIS opsi A baru berstatus "diusulkan" dan perlu review Rahmat/Naazmi. API melarang implementasi endpoint sebelum skema disetujui. SOP merchant PENDING. | [API_CONTRACT.md L56](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/API_CONTRACT.md#L56) | [DATABASE.md §22.1 L470](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/DATABASE.md#L470), [DECISIONS.md DEC-016 L244](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/DECISIONS.md#L244), [VAL-01 L374](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/DECISIONS.md#L374) | TASK-037 dan jalur QRIS di TASK-016 tertahan. | TASK-037 = **BLOCKED**. Checkout tunai boleh lanjut setelah K-05/K-06 diputuskan. Review opsi A dicatat sebagai keputusan desain. | Rahmat + Naazmi (skema); David + pengelola (VAL-01) |
| K-08 | Minor | Kode metode: DEC-016 menulis `QRIS`, sedangkan DB/API memakai `QRIS_MANUAL`. DB menolak `'QRIS'` (probe D9). | [DECISIONS.md L246](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/DECISIONS.md#L246) | [DATABASE.md DDL L204](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/DATABASE.md#L204), [API_CONTRACT.md L64](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/API_CONTRACT.md#L64) | Ada risiko enum tidak cocok antara UI, API, dan DB. | Kode teknis `QRIS_MANUAL`, label UI "QRIS". Catat di glosarium kontrak. | David |
| K-09 | Minor | Requirement mencatat "referensi bila tersedia" dan DB punya `evidence_ref`, tetapi contoh body commit API tidak memiliki field referensi. | [PRD.md POS-03.09 L151](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/PRD.md#L151), [DATABASE.md L206](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/DATABASE.md#L206) | [API_CONTRACT.md §4 L60–L67](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/API_CONTRACT.md#L60-L67) | Referensi merchant tidak bisa disimpan lewat API. | Tambahkan `evidenceRef` opsional dengan batas panjang dan larangan PIN/OTP/nomor rekening, menunggu K-07. | Rahmat |
| K-10 | Major | API menerima `cashReceivedRp` dan menghitung `changeRp`, SCOPE meminta menampilkan uang diterima/kembalian, tetapi DB tidak punya kolomnya (probe D14). | [API_CONTRACT.md L71](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/API_CONTRACT.md#L71), [SCOPE.md §5 L55](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/SCOPE.md#L55) | [DATABASE.md §8 L289](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/DATABASE.md#L289), [DDL L201–L213](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/DATABASE.md#L201-L213) | Cetak ulang setelah restart tidak bisa menampilkan Tunai/Kembali, dan retry identik bisa mengembalikan kembalian yang berbeda. | Putuskan apakah struk wajib memuat Tunai/Kembali. Jika ya, tambah kolom lewat review migrasi sebelum TASK-008 dikunci. | David + Rahmat; pengelola untuk format struk |
| K-13 | Major | Status `ABANDONED` dan pagar upaya dijelaskan, tetapi tidak ada endpoint untuk menutup upaya. | [API_CONTRACT.md §2A L29](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/API_CONTRACT.md#L29) | [DATABASE.md §14.4 L320](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/DATABASE.md#L320) | AC-04.02 ("dipastikan belum tersimpan → lanjut") tidak punya jalur API. | Tambah operasi pagar, misalnya `POST /checkouts/:attemptKey/abandon` (owner only, `BEGIN IMMEDIATE`). Dibutuhkan untuk TASK-019, bukan untuk irisan pertama. | Rahmat + David |

### 2.3 Cakupan endpoint dan aturan lain

| ID | Sev | Konflik | Lokasi A | Lokasi B | Dampak | Rekomendasi | Pemutus |
|---|---|---|---|---|---|---|---|
| K-11 | Major | API menyatakan semua mutasi uang/stok idempotent, tetapi `POST /inventory/adjustments` tidak punya kunci, dan DB juga tidak punya kolom atau tabelnya (probe D16). | [API_CONTRACT.md L19](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/API_CONTRACT.md#L19), [L51](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/API_CONTRACT.md#L51) | [DATABASE.md DDL L232–L257](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/DATABASE.md#L232-L257) | Retry koreksi stok bisa tercatat dua kali (AC-07.03). | Tambah `adjustmentKey` + `request_hash` lewat review migrasi sebelum TASK-039. | Rahmat + David |
| K-12 | Major | Endpoint P0 untuk fondasi M1 belum ada di matriks API: kelola akun, kategori/supplier/barcode, dan impor stok awal (OPENING). | [API_CONTRACT.md §3 L34–L54](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/API_CONTRACT.md#L34-L54) | [PRD.md POS-01.04 L123](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/PRD.md#L123), [POS-02.01 L124](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/PRD.md#L124), [POS-10.03 L154](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/PRD.md#L154), [AUTHORIZATION.md L28](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/security/AUTHORIZATION.md#L28) | TASK-010/011/015 tidak punya kontrak untuk mock UI. | Rahmat menambah baris endpoint (ADMIN only + audit) di API_CONTRACT lewat PR yang direview. | Rahmat (+ Syafroni) |
| K-14 | Minor | Barcode unik global (termasuk produk nonaktif) vs PRD yang menguji keunikan pada produk aktif. DB sudah mencatat perbedaan ini. | [PRD.md AC-02.02 L167](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/PRD.md#L167) | [DATABASE.md §7 L281](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/DATABASE.md#L281) | Barcode produk lama yang dinonaktifkan tidak bisa dipakai ulang. | Pertahankan unik global sebagai baseline ketat. Pemindahan barcode diputuskan bersama migrasi data (VAL-03). | David |
| K-15 | Minor | `opening_cash_rp` opsional, sementara SCOPE S-07 menyebut modal awal sebagai P0. | [DATABASE.md L150](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/DATABASE.md#L150) | [SCOPE.md S-07 L25](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/SCOPE.md#L25) | Kewajiban modal bergantung pada SOP (VAL-05). | Biarkan nullable. Wajibkan lewat validasi backend yang dapat dikonfigurasi sebagai fixture. | David + pengelola (VAL-05) |
| K-16 | Minor | Format waktu API: "ISO-8601 atau epoch ms setelah review". DB: epoch ms. | [API_CONTRACT.md L17](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/API_CONTRACT.md#L17) | [DATABASE.md §2 L21](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/DATABASE.md#L21) | DTO `shared` belum bisa dikunci. | Usulan: epoch ms integer di API. Konversi ke zona operasional hanya di UI/laporan. | Rahmat + Syafroni |
| K-17 | Minor | "Semua POST/PATCH memerlukan sesi" bertentangan dengan `POST /auth/login` yang publik. | [API_CONTRACT.md L13](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/API_CONTRACT.md#L13) | [API_CONTRACT.md L36](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/API_CONTRACT.md#L36), [PRD.md L34](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/PRD.md#L34) | Hanya masalah redaksi. | Tambahkan "kecuali login". | Rahmat |
| K-22 | Minor | DB §8 masih menyebut "fixture awal memakai tunai" dan metode dari kebijakan lokal, padahal DDL dan DEC-016 sudah memuat QRIS_MANUAL. | [DATABASE.md §8 L289](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/DATABASE.md#L289) | [DATABASE.md L204](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/DATABASE.md#L204), [DECISIONS.md L246](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/DECISIONS.md#L246) | Teks §8 sudah ketinggalan. | Sinkronkan teks §8. | David |

### 2.4 Integritas dokumen dan rujukan

| ID | Sev | Konflik | Lokasi A | Lokasi B | Rekomendasi | Pemutus |
|---|---|---|---|---|---|---|
| K-20 | **Major** | AGENTS.md menunjuk DECISIONS **v0.1.0** dan PRD **v0.2.0** sebagai sumber kebenaran, padahal versi aktif v0.2.3 dan v0.3.1. Agent bisa menerapkan baseline lama. | [AGENTS.md §2 L13–L14](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/AGENTS.md#L13-L14) | [DECISIONS.md L8](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/DECISIONS.md#L8), [PRD.md L5](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/PRD.md#L5) | Perbarui tabel versi AGENTS.md lewat review. | David |
| K-23 | Major | `DECISIONS_v0.2.1_REVISI.md` mengaku berlokasi di `docs/product/DECISIONS.md` (v0.2.1). Ada dua register yang bersaing. | [DECISIONS_v0.2.1_REVISI.md L7–L8](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/DECISIONS_v0.2.1_REVISI.md#L7-L8) | [DECISIONS.md L7–L8](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/DECISIONS.md#L7-L8) | Tandai salinan lama sebagai arsip/SUPERSEDED, atau pindahkan dengan persetujuan David. Jangan dihapus tanpa persetujuan. | David |
| K-19 | Minor | Rujukan ke file/path yang tidak ada: `AUDIT_SECURITY.md`, `docs/operations/…`, `CONTEXT(1).md`. | [AUTHORIZATION.md L47](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/security/AUTHORIZATION.md#L47), [L105](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/security/AUTHORIZATION.md#L105), [SECURITY.md L51](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/security/SECURITY.md#L51) | [DECISIONS.md L342](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/DECISIONS.md#L342), [L402](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/DECISIONS.md#L402), [TASKS.md L11](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/TASKS.md#L11) | Ganti rujukan ke `docs/operations and qa/`, `CONTEXT.md`, dan file audit yang benar-benar ada, atau tandai "belum dibuat". | David (product), Naazmi (security/QA) |
| K-21 | Minor | ERD_REVIEW memakai basis DATABASE **v0.1.0**. ERD.drawio tidak memuat `verified_by` dan `adjustment_reason` (string tidak ditemukan). | [ERD_REVIEW.md L4](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/erd/ERD_REVIEW.md#L4) | [DATABASE.md L207–L208](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/DATABASE.md#L207-L208), [L240](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/DATABASE.md#L240) | Regenerasi ERD setelah K-05/K-10/K-11 diputuskan. | David |

**Ringkasan (22 konflik; ID K-18 tidak dipakai):** Blocker 4 (K-01, K-02, K-05, K-07) · Major 9 (K-03, K-04, K-06, K-10, K-11, K-12, K-13, K-20, K-23) · Minor 9 (K-08, K-09, K-14–K-17, K-19, K-21, K-22).

---

## 3. Matriks kontrak minimal irisan pertama

Irisan pertama mengikuti TASKS §2/M1–M2: login → katalog/scan → buka shift → checkout tunai → saldo stok.

| Area | Kontrak baseline (reversibel) | Status sumber | Jenis | Boleh dipakai coding? |
|---|---|---|---|---|
| Database operasional | Satu file SQLite lokal di direktori data persisten, `foreign_keys=ON` per koneksi, STRICT (SQLite ≥ 3.37) | **ACCEPTED** DEC-004. Detail DDL PROPOSED | Keputusan + desain | Ya. TASK-008 boleh menyiapkan migrasi **setelah review migrasi** dan setelah K-05/K-10 diputuskan untuk tabel checkout |
| Atomisitas | Sale + items + payment + movement + kaitan attempt dalam satu `BEGIN IMMEDIATE … COMMIT`. Gagal = rollback utuh | **ACCEPTED** DEC-007 | Keputusan | Ya |
| Retry/idempotensi | `attemptKey` stabil. Kunci sama + hash sama → hasil asli. Hash beda → `409 IDEMPOTENCY_CONFLICT`. Hasil tidak jelas → query status, bukan bayar ulang | DEC-007 ACCEPTED (prinsip). Mekanisme DEC-013 **PROPOSED** | Desain | Ya, tetapi isi hash dan penyimpanan snapshot **BLOCKED oleh K-05/K-06** |
| Status hasil commit | `PREPARED` (attempt ada, sale belum ada, `abandoned_at_ms` NULL) · `COMMITTED` (ada `sales.attempt_key`) · `ABANDONED` (`abandoned_at_ms` terisi) · tidak diketahui → `PAYMENT_RECONCILIATION_REQUIRED` | DEC-013 PROPOSED, ERROR_HANDLING v0.1.0 | Desain | Ya untuk tampilan dan mock. Endpoint abandon menunggu K-13 |
| Stack | React+Vite+TS, Node+Express+TS, kode bersama di `shared/` | **PROPOSED** DEC-010 | Baseline reversibel | Ya, dengan asumsi ditulis di PR |
| Transport | HTTP hanya di `127.0.0.1`, cek Host/Origin, tanpa `0.0.0.0`. IPC hanya lewat revisi DEC-010 | PROPOSED ([ARCHITECTURE L62](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/ARCHITECTURE.md#L62), [TECH_STACK L55](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/TECH_STACK.md#L55)) | Baseline reversibel | Ya. Penyimpanan token (cookie+CSRF vs bearer di memori) **belum diputuskan** (D-08) |
| Sesi | Token acak. Hanya digest 32 byte di `sessions`. Logout mencabut sesi, **bukan** menutup shift | DEC-006 ACCEPTED (shift ≠ sesi). Detail DEC-014 PROPOSED | Desain | Ya |
| Role | `ADMIN`, `CASHIER`, CHECK di DB. Role dan kepemilikan **ditegakkan backend**, bukan DB (probe D3/D12) | DEC-001 **ACCEPTED** | Keputusan | Ya |
| Matriks izin | **Konservatif = PRD §2.1 + AUTHZ §3**: deny by default. ADMIN tidak membuka/menutup shift, tidak checkout, tidak cetak ulang | DEC-014 **PROPOSED** | Baseline | Ya untuk login/katalog. **BLOCKED untuk endpoint shift (K-01/K-02)** sampai API_CONTRACT dikoreksi dan direview Rahmat |
| Shift | Satu shift aktif per DB (`ux_shifts_single_open`, probe D2). Pemilik dari sesi. Tutup eksplisit dengan `closeKey` | DEC-006 ACCEPTED. DEC-012 PROPOSED | Desain | Tabel: ya. Endpoint buka/tutup: **BLOCKED (K-01/K-02)** |
| Pembayaran | `CASH` untuk irisan pertama. `QRIS_MANUAL` hanya setelah K-07 | DEC-016 ACCEPTED (pilihan QRIS manual). SOP **PENDING** | Keputusan + fixture | CASH: ya (fixture). QRIS: **BLOCKED** |
| Uang/kuantitas | Rupiah INTEGER, unit utuh INTEGER, cek overflow | PROPOSED ([DATABASE L20](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/DATABASE.md#L20)) | Fixture | Ya |
| Stok | Ledger `inventory_movements` sebagai sumber saldo. Tolak checkout jika saldo kurang, dicek di bawah kunci penulis. Skema **tidak** mencegah saldo negatif (probe D13) | DEC-018 **PROPOSED** | Fixture | Ya, sebagai fixture |
| Harga | Diambil backend dari master. Perubahan harga → 409 + prepare baru | POS-03.03, PROPOSED | Desain | Ya |
| Cetak | Setelah commit, di luar transaksi. Cetak ulang dari sale yang sama, CASHIER own | POS-04.03, DEC-013 PROPOSED | Desain | Adapter: ya. Izin endpoint menunggu K-03 |
| Audit | `audit_log` dalam commit yang sama untuk akun, harga, penerimaan, impor, dan tutup shift | DEC-014 PROPOSED | Desain | Ya |
| Waktu | epoch ms UTC di DB | PROPOSED | Desain | DB: ya. Format API menunggu K-16 |

### 3.1 Fixture pengembangan yang TIDAK boleh menjadi SOP produksi

| Fixture | Sumber | Syarat sebelum menjadi kebijakan |
|---|---|---|
| Pembayaran hanya tunai di irisan pertama, tanpa split tender | TASKS §2, API L71 | VAL-02 / TASK-002 |
| Alur konfirmasi QRIS manual (attestasi kasir) | DEC-016, DB §22.1 | VAL-01 + VAL-05 + review skema K-07 |
| Blokir stok negatif | DEC-018, PRD POS-03.06 | TASK-003 |
| Unit utuh (tanpa barang timbang) | DATABASE §2 | TASK-003 |
| Modal awal opsional / nilai modal contoh | DATABASE L150, PRD §4.3 | VAL-05 |
| Rumus `kas_seharusnya` / `selisih_kas` | DEC-016 L247, PRD L68 | Persetujuan pengelola (VAL-05) |
| Larangan pengeluaran kas, refund, dan setoran tengah shift lewat POS | DEC-016, PRD L68 | SOP pengelola |
| ADMIN tidak merangkap kasir; tanpa takeover/force close | PRD §2.1, AUTHZ §3 | DEC-019 / TASK-004 |
| Barcode unik global | DATABASE §7 | VAL-03 |
| Zona waktu laporan, ambang stok menipis | DEC-018, PRD POS-08.01 | TASK-003 |
| Akun dan password uji (hanya hash, tanpa sandi di repo) | AGENTS §13, AUTHZ §6 | Bootstrap admin sesuai prosedur operator |

---

## 4. Keputusan yang harus diambil manusia

| ID | Keputusan | Konflik | Pemutus | Menahan |
|---|---|---|---|---|
| D-01 | Koreksi izin `POST /shifts/open` dan `/shifts/:id/close` menjadi CASHIER own | K-01, K-02 | David + Rahmat (review), pengelola via TASK-004 jika ADMIN perlu merangkap kasir | TASK-014, TASK-017 (bagian shift), TASK-022, TASK-023 |
| D-02 | Izin cetak/cetak ulang ADMIN | K-03 | David + Rahmat; pengelola bila admin perlu | Izin endpoint TASK-021 |
| D-03 | Akses ADMIN ke status upaya checkout | K-04 | David + Rahmat | TASK-019 |
| D-04 | Penyimpanan snapshot quote (opsi a/b) | K-05 | David + Rahmat (review migrasi) | TASK-008 (tabel checkout), TASK-016 |
| D-05 | Isi kanonis `requestHash` `checkout-v1` | K-06 | Rahmat + David + Syafroni | TASK-016, TASK-017 |
| D-06 | Persetujuan skema verifikasi QRIS opsi A | K-07 | Rahmat + Naazmi | TASK-037 |
| D-07 | Persistensi uang diterima/kembalian dan format struk | K-10 | David + Rahmat; pengelola | TASK-008, TASK-021 |
| D-08 | Penyimpanan token sesi (cookie+CSRF vs bearer di memori), timeout | AUTHZ L16–L17 | Rahmat | TASK-009 |
| D-09 | Kunci idempotensi koreksi stok | K-11 | Rahmat + David | TASK-039 |
| D-10 | Tambahan endpoint akun, master, dan impor OPENING | K-12 | Rahmat (+ Syafroni) | TASK-010, TASK-011, TASK-015 |
| D-11 | Endpoint pagar/abandon upaya | K-13 | Rahmat + David | TASK-019, TASK-020 |
| D-12 | Sinkronisasi versi di AGENTS.md dan nasib `DECISIONS_v0.2.1_REVISI.md` | K-20, K-23 | David | Kejelasan sumber kebenaran bagi semua agent |
| D-13 | VAL-01 (identitas merchant QRIS) dan VAL-05 (SOP shift/setoran) | K-07, K-15 | David + pengelola | TASK-034, GO/NO-GO |

**Pemeriksaan klaim persetujuan:** Pemindaian pola "sudah/telah disetujui/disahkan" di dokumen product, architecture, security, AGENTS, dan CONTEXT **tidak menemukan klaim persetujuan pengelola**. Satu-satunya keputusan baru berstatus ACCEPTED adalah pilihan QRIS manual oleh **koordinator (keputusan tim), 11 November 2026** ([DECISIONS L244](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/DECISIONS.md#L244), [§13 L386–L390](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/product/DECISIONS.md#L386-L390)). Register sendiri menegaskan keputusan itu bukan persetujuan SOP merchant. Judul "Keputusan yang telah disetujui" di [TECH_STACK L11](file:///e:/COOLYEAH/Coding/pos-minimarket-kampus/docs/architecture/TECH_STACK.md#L11) merujuk status ACCEPTED tim (DEC-002/003/004/005), bukan persetujuan pengelola.

---

## 5. Verifikasi yang dijalankan

| # | Perintah | Lingkungan | Hasil |
|---|---|---|---|
| V1 | `git status; git branch -a; git log --oneline -10` | Windows, PowerShell | Branch `task/p01-001`, tree bersih, 3 commit dokumen |
| V2 | Pencarian `package.json`/`*.ts`/`*.js`/`*.sql` | Repo lokal | **Tidak ada** → tes proyek, build, dan contract test = **BLOCKED (belum ada kode)** |
| V3 | `python scratch/probe_ddl.py .` (scratch di folder artifact, DB `:memory:`, data sintetis) | Python 3.13.14, SQLite 3.50.4 | **13/13 PASS** sesuai ekspektasi (rincian di bawah) |
| V4 | Pemeriksaan rujukan `*.md` dan `docs/operations/` | Repo lokal | Rujukan hilang: `AUDIT_SECURITY.md`, `CONTEXT(1).md`, `docs/operations/` (K-19) |
| V5 | Pemindaian klaim persetujuan | Repo lokal | Tidak ada klaim pengelola tanpa sumber (lihat §4) |

Rincian probe V3 terhadap DDL PROPOSED DATABASE.md §6 dan §16:

- D0: DDL dan indeks termuat, `foreign_keys=1`.
- D2: shift aktif kedua ditolak oleh `ux_shifts_single_open`.
- **D3: shift dengan pemilik ADMIN diterima** (role tidak ditegakkan DB).
- D4/D5: penutupan oleh bukan pemilik ditolak oleh FK komposit; pemilik diterima.
- D6: attempt dengan kasir ≠ pemilik shift ditolak.
- D7/D8/D10: CHECK verifikasi QRIS_MANUAL/CASH bekerja.
- **D9: kode `QRIS` ditolak.**
- D11: ADJUSTMENT dengan alasan kosong ditolak.
- **D12: ADJUSTMENT dengan actor CASHIER diterima.**
- **D13: saldo bisa menjadi -1 di level skema.**
- D14–D16: kolom `payments` dan `checkout_attempts` sesuai K-05/K-10; tidak ada tabel idempotensi adjustment/log cetak.
- D17: `foreign_key_check` kosong.

> [!NOTE]
> Probe ini hanya membuktikan perilaku **DDL usulan** pada SQLite 3.50.4 (Python), bukan driver `better-sqlite3`/Electron di PC tujuan. Probe bukan migrasi dan bukan uji AC.

**Belum diuji:** semua AC-* (belum ada aplikasi), perilaku driver Windows/Electron, WAL/FULL, uji perangkat, dan CodeRabbit (tidak dijalankan).

---

## 6. Langkah untuk reviewer (Rahmat) dan agent pengganti

1. Buka setiap pasangan lokasi di §2 dan konfirmasi/tolak konflik. Prioritaskan K-01, K-02, K-05, K-06, dan K-07.
2. Ulangi probe: `python C:\Users\USER\.gemini\antigravity\brain\c01f0f39-8f2c-470c-9547-8f56a19d15e0\scratch\probe_ddl.py e:\COOLYEAH\Coding\pos-minimarket-kampus`.
3. Setelah D-01 s.d. D-07 diputuskan, pemilik dokumen merevisi API_CONTRACT/DATABASE/AUTHORIZATION lewat PR terpisah dengan rujukan K-xx. Agent **tidak** boleh merevisi kontrak atau skema tanpa keputusan tersebut.
4. Yang boleh dilanjutkan sekarang (independen): TASK-002–006, TASK-007 (kerangka UI + mock login/katalog), dan persiapan TASK-008 untuk tabel non-checkout (users, sessions, master, shifts, ledger) setelah review migrasi.
5. Yang **BLOCKED**: endpoint shift (K-01/K-02), checkout commit (K-05/K-06), dan QRIS (K-07 + VAL-01).
6. Jika David ingin hasil audit ini masuk repository, tentukan lokasinya. TECH_STACK L28 membatasi penambahan file MD di luar "33 kanonik".
