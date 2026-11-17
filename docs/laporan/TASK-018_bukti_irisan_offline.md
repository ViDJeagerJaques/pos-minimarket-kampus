# Laporan TASK-018 — Bukti Irisan Pertama Offline

| Atribut | Nilai |
|---|---|
| Tugas | TASK-018 (P15) — Buktikan irisan pertama offline |
| Tanggal eksekusi | 2026-11-17 |
| Branch / HEAD | `task/p15-018` · `6b5d11a8f8012420f38926a56e87cfaad72e16ff` |
| Owner / penguji | Naazmi (QA) — eksekusi oleh AI agent QA; butuh review Naazmi/Rahmat |
| Lingkungan | `win32 10.0.26200 (x64)`; Node `v24.22.3` portable (di `%LOCALAPPDATA%\Temp\opencode\node24\...`, di luar repo) |
| Mode data | DEMO/QA sintetis; SQLite sementara `%TEMP%/pos-task018-e2e-*`, dihapus setelah uji |
| Status | **REVIEW — 16/16 pemeriksaan E2E PASS untuk jalur API/DB nyata; PARTIAL untuk klaim "offline fisik" dan AC yang bergantung SOP/perangkat** |

## 1. Status dan ringkasan

Berhasil dibuktikan dengan backend nyata: **login → buka shift → scan → checkout tunai → cek sale/payment/saldo SQLite**, ditambah jalur negatif (input invalid, non-owner, harga berubah, stok kurang, klik bayar ganda, retry paralel, kunci sama isi beda), serta interupsi proses **sebelum** dan **sesudah** commit. Rekonsiliasi dilakukan **sebelum dan sesudah setiap tes**.

**Tidak ditemukan bug kehilangan uang, penjualan ganda, atau mutasi stok ganda** pada cakupan yang dijalankan. Tidak ada blocker rilis dari irisan ini. Namun:

- **Internet tidak diputus secara fisik.** Yang dijalankan adalah *simulasi offline logis*: semua request klien dibatasi hanya ke `127.0.0.1`/`localhost` dan child process diberi proxy dummy `127.0.0.1:9`. Tidak ada kabel/Wi-Fi yang dimatikan; uji offline fisik pada PC tujuan tetap **NOT RUN**.
- Tidak ada browser/Electron/perangkat scanner-printer/uang fisik; semua bukti berasal dari API + SQLite nyata, bukan screenshot atau simulasi perangkat.
- QRIS manual, rekap akhir shift, cetak struk, dan SOP pengelola masih menunggu keputusan/tugas lain.

**Status DONE tidak berarti GO-LIVE.**

## 2. File yang dibuat / diubah

| Path | Alasan |
|---|---|
| `scripts/task-018_offline_slice_e2e.mjs` | Harness QA baru: server loopback nyata + SQLite sementara + offline guard + 16 pemeriksaan + snapshot rekonsiliasi per tes + bukti JSON |
| `docs/laporan/TASK-018_bukti_irisan_offline.md` | Laporan ini |
| `docs/laporan/evidence/TASK-018/task018-evidence.json` | 58 requestId, 18 attemptKey sintetis, 16 rekaman tes dengan snapshot sebelum/sesudah |
| `docs/laporan/evidence/TASK-018/task018-e2e.log` | Log konsol E2E (16 PASS) |
| `docs/laporan/evidence/TASK-018/task018-{backend-test,backend-typecheck,frontend-test,frontend-build,task017-regression}.log` | Log baseline/regresi yang benar-benar dijalankan |

Tidak ada perubahan pada kode produksi, skema, migrasi, kontrak API, atau aturan uang/stok.

## 3. Lingkungan dan kontrol offline

| Item | Nilai / bukti |
|---|---|
| Commit diuji | `6b5d11a8f8012420f38926a56e87cfaad72e16ff` (merge PR #27 / TASK-017) |
| OS / Node | `win32 10.0.26200 (x64)` / `v24.22.3` |
| DB uji | `%TEMP%\pos-task018-e2e-0nO50E\task018.sqlite` (sementara, dihapus; `--keep-db` tersedia) |
| Server | `127.0.0.1` port acak, 3 kali start (dua di antaranya setelah `SIGKILL`) |
| Guard klien | `fetch` ditimpa; host bukan `127.0.0.1`/`localhost` ditolak → `blockedExternalCalls: []` |
| Guard child | `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY=http://127.0.0.1:9`, `NO_PROXY=127.0.0.1,localhost` |
| Data | produk `T18-KAS-001` barcode `000123` harga awal Rp5.000, stok awal +5 (OPENING sintetis), 3 akun (1 ADMIN, 2 CASHIER) |
| Rekonsiliasi per tes | `counts` (sale/item/payment/movement/attempt/shift/orphan), uang (sale/item/payment), saldo, `movementByKind`, `integrity_check`, `foreign_key_check`, `reconciled` |

Dependensi coding dicek nyata: `backend/src/checkout/service.ts`, `backend/src/shift/service.ts`, `backend/src/inventory/ledger.ts`, migrasi `0002_checkout_attempt_quotes.sql`, `scripts/task-017_checkout_e2e.mjs`, dan tes terkait semuanya ada di checkout dan lulus.

## 4. Matriks penerimaan (hasil nyata)

| AC | Langkah / aksi nyata | Ekspektasi | Hasil aktual | Bukti | Status | Tidak diuji |
|---|---|---|---|---|---|---|
| AC-03.02 | Prepare dengan items `[]`, qty `0`, qty `-2`, produk nonaktif, `shiftId` asing, `payment.method=E_WALLET`; kasir lain pakai shift pemilik; ADMIN checkout | Ditolak tanpa sale/payment/mutasi | 422 `VALIDATION_ERROR`, 409 `SHIFT_NOT_ACTIVE`, 403 `FORBIDDEN`; delta uang/stok nol | Tes #5 | **PASS** | — |
| AC-03.03 | Prepare 1×Rp5.000 → ADMIN ubah harga Rp6.000 → commit lama → prepare baru → commit baru | Commit lama ditolak, quote baru dipakai, histori lama utuh | 409 `PRICE_CHANGED` tanpa mutasi; quote baru Rp6.000; commit sukses; `sale_items` lama tetap Rp5.000 | Tes #9 | **PASS** | — |
| AC-03.04 | Commit tunai tanpa `cashReceivedRp`, tunai Rp1.000 < total Rp5.000; metode `E_WALLET` ditolak saat prepare; pembayaran sah tercatat | Hanya metode sah & lengkap yang tercatat, jenis/nilai benar | 422 untuk ketiga kasus; 6 payment tersimpan semua `CASH`, total Rp39.000 | Tes #5, #6, #16 | **PASS (cakupan CASH)** | QRIS manual valid & rekap metode: **NOT RUN** (VAL-01/TASK-002 & TASK-022 belum ada) |
| AC-03.05 | Prepare 2×Rp5.000 (tanpa sale) → commit tunai Rp20.000; lalu `SIGKILL` sebelum commit dan `SIGKILL` sesudah commit | Sukses = 1 sale + payment + item + mutasi; gagal sebelum commit tidak meninggalkan data parsial | Commit: 1 sale, 1 payment, 1 item, 1 mutasi, stok 5→3, kembalian Rp10.000; `SIGKILL` sebelum commit → 0 parsial, upaya `PREPARED` tetap ada, commit ulang sukses; `SIGKILL` sesudah commit → `COMMITTED` dengan saleId sama | Tes #7, #12 | **PASS** | Putus internet fisik saat aplikasi dibuka: **NOT RUN** |
| AC-03.06 | Stok 1, prepare qty 5 → ditolak; koreksi qty 1 → commit | Ditolak tanpa mutasi; koreksi sukses, stok 0 | 409 `INSUFFICIENT_STOCK`, stok tetap 1; qty 1 sukses, stok 0 | Tes #10 | **PASS** | Scanner fisik: **NOT RUN** |
| AC-03.08 | `DELETE /sales/:id` dan `PATCH /sales/:id` sebagai ADMIN; snapshot DB dibandingkan | Riwayat tidak berubah | Keduanya 404 `NOT_FOUND`; 6 sale/payment/item & saldo utuh | Tes #15 | **PASS (API)** | Direct DB edit dicegah hanya oleh kontrol akses, bukan trigger (lihat O-2) |
| AC-04.01 | Retry identik; dua commit paralel dengan attemptKey/hash sama; attemptKey sama dengan isi beda; interupsi sebelum/sesudah commit | Satu hasil per kunci; isi beda ditolak; tanpa dobel uang/stok | Retry & dua klik paralel → `saleId` sama, 1 sale; kunci sama isi beda → 409 `IDEMPOTENCY_CONFLICT`; interupsi tidak menambah sale | Tes #8, #12, #13 | **PASS** | Jaringan timeout sungguhan: **NOT RUN** (interupsi memakai `SIGKILL` proses) |
| AC-05.01 | Dua `POST /shifts/open` paralel oleh kasir yang sama; ADMIN coba buka | Tepat satu shift aktif | Satu 200, satu 409 `SHIFT_ALREADY_OPEN`; `GET /shifts/current` kasir lain `null`; ADMIN 403 | Tes #3 | **PASS** | Dua klik UI cepat dengan perangkat: **NOT RUN** |
| AC-05.02 | `SIGKILL` + restart backend (2×), login ulang, cek shift pemilik & kasir lain | Shift tetap dengan ID/waktu sama; pemilik lanjut, kasir lain tidak | ID & `openedAtMs` identik; kasir lain `null`, 409 `SHIFT_ALREADY_OPEN`, 409 `SHIFT_NOT_ACTIVE` saat checkout | Tes #12–#14 | **PASS (restart backend)** | Tutup jendela/restart frontend & PC mati: **NOT RUN** (TASK-024) |

Pendukung alur: scan barcode `000123` menemukan produk dengan harga/stok dari backend, barcode asing mengembalikan `[]`, tanpa mutasi (Tes #4 / AC-03.01).

Status **FAIL: tidak ada**; **BLOCKED: tidak ada** dalam cakupan yang dijalankan.

## 5. Rekonsiliasi per tes (ringkasan `before → after`)

Delta = `sesudah − sebelum` untuk jumlah baris dan saldo. Setiap tes mengharuskan `reconciled === true` pada kedua snapshot.

| Tes | AC | Δ sale | Δ item | Δ payment | Δ mutasi | Δ stok | Catatan |
|---|---|---:|---:|---:|---:|---:|---|
| #3 | AC-05.01 | 0 | 0 | 0 | 0 | 0 | shift aktif tepat 1 |
| #4 | AC-03.01 | 0 | 0 | 0 | 0 | 0 | scan/cari |
| #5 | AC-03.02 | 0 | 0 | 0 | 0 | 0 | 8 attemptKey ditolak |
| #6 | AC-03.04 | 0 | 0 | 0 | 0 | 0 | konfirmasi tunai kurang |
| #7 | AC-03.05 | +1 | +1 | +1 | +1 | −2 | Rp10.000, kembalian Rp10.000 |
| #8 | AC-04.01 | +1 | +1 | +1 | +1 | −1 | klik ganda → satu sale |
| #9 | AC-03.03 | +1 | +1 | +1 | +1 | −1 | harga baru Rp6.000 |
| #10 | AC-03.06 | +1 | +1 | +1 | +1 | −1 | stok 1 → 0 |
| #11 | SETUP | 0 | 0 | 0 | +1 | +5 | penyesuaian stok sintetis |
| #12 | AC-03.05 | +1 | +1 | +1 | +1 | −1 | mati sebelum commit |
| #13 | AC-04.01 | +1 | +1 | +1 | +1 | −1 | mati sesudah commit |
| #14 | AC-05.02 | 0 | 0 | 0 | 0 | 0 | ownership setelah restart |
| #15 | AC-03.08 | 0 | 0 | 0 | 0 | 0 | sale immutable via API |

Rekonsiliasi akhir: `sales=6`, `sale_items=6`, `payments=6`, `checkout_attempts=8`, `movements=8` (OPENING +5, ADJUSTMENT +5, SALE −7), `saldo=3`; `saleTotalRp = itemTotalRp = paymentAmountRp = Rp39.000`; `saleNos = S-000001 … S-000006`; semua `method_code=CASH`; `integrity_check=ok`, `foreign_key_check=0`, tidak ada sale tanpa payment maupun item yatim.

## 6. Contoh requestId / attemptKey sintetis

`attemptKey` dibuat sintetis oleh harness, `requestId` dicatat apa adanya dari server (total 58 panggilan di bukti JSON).

| Operasi | attemptKey (sintetis) | requestId (dari server) | Status |
|---|---|---|---|
| login ADMIN | — | `67a3e143-ebdb-4c2a-92ef-3b3c707fe18c` | 200 |
| prepare tunai sukses | `t18_d9fd82fe27_tunai-sukses_10` | `60e8aded-ae14-495c-bab8-8f79b579c264` | 200 |
| commit tunai sukses | `t18_d9fd82fe27_tunai-sukses_10` | `bafa64d5-ade8-43e3-a8f9-8c14ebdf63b0` | 200 |
| klik bayar A / B (paralel) | `t18_d9fd82fe27_klik-ganda_11` | `f21131b2-6572-42ac-a2fc-83659bca18b1` / `9784f350-ca70-4cab-961f-fd36a90e2a2a` | 200 / 200 |
| mati sebelum commit | `t18_d9fd82fe27_mati-sebelum-commit_16` | `cc3f7c3b-1a0c-4798-9237-079d55085a83` | 200 |
| lanjut commit setelah restart | `t18_d9fd82fe27_mati-sebelum-commit_16` | `5e5bd1df-a89a-41d5-9bce-676ae2870f3d` | 200 |
| cek status sesudah mati | `t18_d9fd82fe27_mati-sesudah-commit_17` | `a529bfee-9337-4eda-a9f1-dd1aeb7dc983` | 200 |

## 7. Perintah yang benar-benar dijalankan

Semua dengan `PATH` Node portable di depan:

```powershell
# backend
npm.cmd test          # PASS 97/97, 0 fail
npm.cmd run typecheck # PASS
# frontend
npm.cmd test          # PASS 91/91, 8 file
npm.cmd run build     # PASS (JS 285,12 kB / CSS 10,82 kB)
# root repo
node scripts/task-017_checkout_e2e.mjs                         # regresi PASS 13/13
node scripts/task-018_offline_slice_e2e.mjs --json-out <path>  # PASS 16/16
```

Log mentah ada di `docs/laporan/evidence/TASK-018/`.

## 8. Observasi (bukan bug S1–S3)

| ID | Severity | Observasi | Dampak / tindakan |
|---|---|---|---|
| O-1 | S4 | Token dari proses backend lama tidak valid setelah restart; sesi tetap tersimpan di SQLite, sehingga kasir login ulang | Perilaku yang diharapkan. Uji restart frontend (TASK-024) harus mempertimbangkan ini; jangan menyimpan token di localStorage |
| O-2 | S4 | Tidak ada trigger DB yang menolak `UPDATE`/`DELETE` langsung pada `sales`/`payments`/`sale_items`; imutabilitas hanya lewat tidak adanya endpoint dan kontrol akses | Jika diperlukan pertahanan berlapis, David/Rahmat perlu memutuskan trigger/migrasi baru (review) |
| O-3 | S4 | Schema hanya mengizinkan satu mutasi `OPENING` per produk (`ux_movements_opening_product`) | Harness memakai `ADJUSTMENT` beralasan untuk pengisian ulang stok sintetis; bukan bug |
| O-4 | S4 | QRIS manual, rekap akhir shift, struk, dan SOP pembayaran belum tersedia | AC-03.04/06 masih terbatas; TASK-002/021/022/034 harus menyelesaikan sebelum klaim P0 penuh |
| O-5 | S4 | Internet tidak diputus fisik; tidak ada browser/perangkat/uang nyata | Klaim "offline fisik" dan AC-10.01 tetap NOT RUN; perlu uji lapangan TASK-024/031/035 |

## 9. Risiko, asumsi DEMO, syarat GO-LIVE yang belum terbukti

- Semua angka berasal dari data sintetis (produk, harga, stok, kasir). Tidak ada data pelanggan/uang sungguhan.
- Simulasi offline hanya menjamin tidak ada panggilan eksternal dari jalur yang diuji; **tidak** membuktikan perilaku aplikasi saat kabel/Wi-Fi benar-benar terputus atau saat DNS/Proxy gagal pada PC tujuan.
- Bukti ini adalah API + SQLite, bukan interaksi DOM/browser; tombol "Bayar" ganda disimulasikan lewat dua request paralel, bukan klik fisik.
- Belum terbukti: QRIS manual tersahkan, cetak ulang struk, dua shift penuh dengan penutupan, backup/restore, instalasi Windows, scanner/printer, persetujuan pengelola, dan uji paralel GO/NO-GO.

## 10. Langkah berikutnya paling kecil

1. Naazmi + Rahmat review bukti ini; jika disetujui, commit `task/p15-018` dan buka PR ke `origin/master` dengan rujukan TASK-018 / AC-03.* / AC-04.01 / AC-05.* / DEC-006, DEC-007, DEC-013. Belum ada commit/push/PR saat laporan dibuat.
2. Naazmi: jalankan ulang irisan ini pada PC tujuan dengan internet benar-benar diputus, scanner/printer terpasang, dan SOP tunai yang disahkan (TASK-024/031/035).
3. Rahmat/David: putuskan perlu tidaknya trigger imutabilitas DB (O-2) dan rapikan penamaan aksi audit lintas fixture/API bila belum selesai.
4. TASK-021/022/023: struk, penutupan shift, dan rekap agar AC-03.04/04.03/06.* dapat ditutup penuh.
5. TASK-002/037: QRIS manual setelah VAL-01 dan SOP merchant disetujui pengelola.

## 11. Status Git

- Branch aktif `task/p15-018` (base `origin/master`), checkout bersih sebelum tugas.
- HEAD `6b5d11a8f8012420f38926a56e87cfaad72e16ff`.
- File baru belum di-commit, belum di-push, belum di-merge, dan tidak ada PR yang dibuat.
