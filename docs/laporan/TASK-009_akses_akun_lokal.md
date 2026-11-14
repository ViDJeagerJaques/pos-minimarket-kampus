# TASK-009 — Akses dan Akun Lokal

| Atribut | Isi |
|---|---|
| Tugas | TASK-009 · Coding DEMO · Owner Rahmat · Reviewer David, Naazmi |
| Referensi | POS-01.01–04 · AC-01.01, AC-01.02, AC-01.03, AC-01.04 · DEC-001, DEC-003, DEC-014 · AUTHORIZATION.md, SECURITY.md, AUDIT_LOG.md |
| Branch | `task/p06-009` (HEAD `40c674c` + perubahan lokal belum di-commit; belum PR) |
| Basis | `origin/master` @ `db4cf69` (memuat TASK-008 + TASK-006 + CI) |
| Tanggal | 14 November 2026 |
| Status | **REVIEW** — login/sesi/otorisasi/rate-limit lulus tes DB + HTTP development; belum diuji offline PC tujuan dan keputusan sesi/sandi masih terbuka |
| Lingkup | Hash sandi, sesi server-side, login/logout/me, manajemen akun ADMIN, guard HTTP, bootstrap ADMIN |

> Dokumen ini mencatat bukti yang benar-benar dijalankan. Tidak ada klaim
> persetujuan pengelola, uji perangkat, atau CodeRabbit review.

## 1. Yang dibuat

| Path | Isi |
|---|---|
| `backend/src/auth/password.ts` | Hash/verifikasi `scrypt$N$r$p$salt$hash`, salt unik, `timingSafeEqual`, biaya serupa untuk username tak dikenal |
| `backend/src/auth/session.ts` | Token acak, digest HMAC-SHA256(secret proses), verify/revoke per request, kedaluwarsa |
| `backend/src/auth/service.ts` | Login generik, logout, `me`, manajemen akun ADMIN, pencabutan sesi, guard admin terakhir |
| `backend/src/auth/audit.ts` | Whitelist AUD-01 + sanitasi `details` |
| `backend/src/auth/errors.ts` | Error domain → status HTTP (401/403/404/409/422) |
| `backend/src/auth/validation.ts` | Validasi username/sandi/role/ID bersama |
| `backend/src/auth/cli.ts` | Bootstrap ADMIN pertama dari `POS_BOOTSTRAP_PASSWORD` |
| `backend/src/security/securityLog.ts` | Log keamanan AUD-09 tanpa sandi/token/hash |
| `backend/src/security/loginRateLimiter.ts` | Rate-limiter in-memory login (`maxAttempts` 1–100, `windowMs` 1.000–3.600.000 ms) dan error 429 generik |
| `backend/src/http/app.ts` | Server `node:http` loopback: JSON, batas body, Host/Origin, Bearer, RBAC per handler, rate-limit `/auth/login`, header `Retry-After`, envelope error |
| `backend/src/http/cli.ts` | `serve` (bind 127.0.0.1, secret sesi acak per proses) |
| `backend/src/auth/password.test.ts` | 4 tes hash/verifikasi (sandi runtime) |
| `backend/src/auth/service.test.ts` | 8 tes login/logout/sesi/akun/audit/rollback/bootstrap bersamaan |
| `backend/src/http/app.test.ts` | 8 tes HTTP end-to-end incl. restart, rate-limit 429, `POS_HTTP_PORT`, & pembersihan bucket |
| `backend/package.json`, `backend/tsconfig.json` | Script `start`, `auth:bootstrap-admin`, daftar tes, include `src/**` |
| `backend/README.md` | §9 autentikasi/server, perintah bootstrap, batas |

Keputusan implementasi:

- **Sandi scrypt** (TECH_STACK.md §3 mengizinkan Argon2id kandidat atau
  scrypt/bcrypt). Tidak ada dependensi baru; hash seed `DEMO_LOCKED_NO_LOGIN`
  ditolak, bukan sekadar tidak cocok.
- **Sesi server-side dengan secret proses.** `sessions.token_digest` berisi
  HMAC-SHA256(secret, token); secret 32 byte acak per start dan tidak disimpan.
  Restart backend membuat token lama invalid (AUTHORIZATION.md AUTH-05), dan
  bocornya DB saja tidak cukup memalsukan sesi. Logout set `revoked_at_ms`.
- **Identitas dari sesi.** Handler menerima `SessionUser` dari verify token;
  body tidak boleh berisi `userId`/`role`. Cek ulang `users.active`/role di
  service dan transaksi untuk manajemen akun.
- **Login gagal generik.** Username tidak dikenal, sandi salah, dan akun
  nonaktif menghasilkan status/pesan yang sama (401 `INVALID_CREDENTIALS`),
  dengan biaya komputasi serupa untuk username tak dikenal.
- **Bootstrap terpisah.** Akun ADMIN pertama hanya lewat CLI saat `users`
  kosong; sandi dari environment, tidak dicetak, tidak ada password default.
- **HTTP zero-dependensi.** Adapter `node:http` (Express tetap kandidat
  DEC-010). Bind hanya 127.0.0.1; Host/Origin loopback; `Authorization:
  Bearer`; body JSON maksimum 64 KiB.

## 2. Verifikasi yang dijalankan

Lingkungan: Windows, PowerShell, Node.js 26.13.1 portable, SQLite 3.54.1,
database uji di direktori temp OS (di luar source tree).

| # | Perintah (dari `backend/`) | Hasil |
|---|---|---|
| V1 | `npm run typecheck` | **PASS**, exit 0 tanpa diagnostik |
| V2 | `npm test` (DB + QA + auth + HTTP) | **PASS 55/55**, 0 fail, ±3,6 s |
| V3 | `node --test src/auth/password.test.ts` | **PASS 4/4** |
| V4 | `node --test src/auth/service.test.ts` | **PASS 8/8** |
| V5 | `node --test src/http/app.test.ts` | **PASS 8/8** |
| V6 | CLI manual: `node db/src/cli.ts migrate --db <temp>` lalu `POS_BOOTSTRAP_PASSWORD=… node src/auth/cli.ts bootstrap-admin --username admin.pertama --db <temp> --json` | **PASS** — `{"created":true,"username":"admin.pertama","role":"ADMIN"}` |
| V7 | CLI bootstrap diulang pada DB berisi akun | **PASS (ditolak)** — exit 1, pesan hanya menyebut aturan bootstrap |
| V8 | CLI bootstrap tanpa `POS_BOOTSTRAP_PASSWORD` | **PASS (ditolak)** — exit 1, sandi tidak dicetak |
| V9 | Login HTTP dengan akun hasil bootstrap (script sementara) | **PASS** — 200, token + `role:"ADMIN"` |

### 2.1 Bukti tes wajib

| Wajib | Terbukti |
|---|---|
| Login benar | 200 + token; `/auth/me` mengembalikan userId/username/role |
| Login salah | 401 `INVALID_CREDENTIALS`, pesan identik untuk sandi salah, username tidak ada, akun nonaktif, hash seed DEMO |
| Rate-limit login | Gagal berulang per `IP:username` dan per-IP (banyak username berbeda) → 429 `LOGIN_RATE_LIMITED` + header `Retry-After` + `retryable: true` tanpa membocorkan status registrasi; login normal bergantian tetap 200 dan pulih 200 setelah cooldown berakhir |
| Akun nonaktif | login 401; sesi yang masih ada dicabut saat penonaktifan |
| Logout lalu replay token | logout 200; pemakaian ulang token 401; logout kedua 401 |
| Restart backend | server baru dengan secret baru: token lama 401, baris sesi tetap ada di SQLite, login ulang 200 |
| Endpoint admin langsung sebagai CASHIER | `POST /users` dan `GET /users` → 403 `FORBIDDEN`; jumlah baris `users` dan `audit_log` tidak berubah; `ACCESS_DENIED` masuk log keamanan |
| Audit/log tanpa sensitif | Scan isi `audit_log.details` + log keamanan: tidak memuat sandi, token, `scrypt$`, `password_hash` |
| AC-01.04 | Admin membuat, menonaktifkan, mengaktifkan ulang, mengubah role; sesi target dicabut; admin terakhir dilindungi (409) |

### 2.2 Cakupan AC

| AC | Terbukti di level DB/HTTP | Belum terbukti |
|---|---|---|
| AC-01.01 | Login lokal akun aktif, `/auth/me`, berjalan di proses lokal | Login tanpa internet di PC tujuan, UI nyata (TASK-011) |
| AC-01.02 | Sandi salah/akun nonaktif ditolak generik; seed DEMO terkunci; rate-limit 429 + pemulihan cooldown diuji | Waktu respons riil di PC tujuan |
| AC-01.03 | CASHIER ditolak 403 pada endpoint ADMIN; identitas/role dari sesi | Matriks penuh shift/checkout/penerimaan/laporan (butuh endpoint tugas lain) |
| AC-01.04 | ADMIN membuat/menonaktifkan/ mengaktifkan/ubah role + audit; admin terakhir dilindungi | UI manajemen akun (TASK-011), reset sandi, prosedur kepemilikan |

## 3. Risiko, asumsi DEMO, dan keputusan terbuka

| Topik | Status/risiko |
|---|---|
| Scrypt, bukan Argon2id | Diizinkan TECH_STACK.md §3; parameter N=16384,r=8,p=1 perlu dikalibrasi di PC tujuan. Review bila Argon2id diwajibkan. |
| Secret sesi di memori | Restart membatalkan semua sesi (sesuai AUTH-05) tetapi update/crash mengharuskan login ulang. Belum ada rotasi/persistensi terenkripsi. |
| Token dibawa `Authorization: Bearer` | HTTP loopback plaintext; risiko sniffing lokal. Cookie HttpOnly/SameSite dan/atau IPC Electron menunggu keputusan (SECURITY.md §2). |
| Timeout sesi | Default 12 jam, env `POS_SESSION_TTL_MS` dijaga 5 menit–7 hari. Timeout idle/absolute belum disahkan. |
| Rate-limit login | In-memory pada `POST /api/v1/auth/login`: per `IP:username` (default 5 gagal / 60 dtk) + per-IP (default 20 gagal / 60 dtk). Login sukses hanya mereset bucket `IP:username` dan tidak dihitung sebagai kegagalan di bucket per-IP, sehingga pergantian kasir normal pada 1 PC (`127.0.0.1`) tetap berjalan. Konsekuensi 1 PC kasir: jika gagal berulang melampaui 20x/menit dari PC tersebut, pengguna lain di PC yang sama ikut terkena cooldown IP. Hitungan reset saat proses restart (batasan DEMO). |
| `ACCOUNT_ENABLED` | Usulan perluasan AUD-01 (AUD-01 hanya mencantumkan CREATED/DISABLED/ROLE_CHANGED). Perlu review Naazmi/David. |
| Server `node:http` | Adapter tipis, bukan Express. Perlu review arsitektur; API contract endpoint tidak berubah. |
| Reset sandi / pemulihan akun | Belum ada; menunggu SOP pengelola (AUTHORIZATION.md §6). |
| Matriks izin penuh | Endpoint katalog/shift/checkout belum ada di branch ini; guard per handler disiapkan untuk tugas tersebut. |

## 4. Git

- Branch `task/p06-009` berbasis `origin/master` @ `db4cf69`, dengan riwayat
  commit: `1e0c8e2` (`feat: TASK-009 local authentication and RBAC`) dan `40c674c`
  (`fix: TASK-009 login rate limiting`).
- Penambahan proteksi per-IP (`loginIpRateLimiter`), tes HTTP terkait, dan
  pembaruan laporan ini saat ini masih **perubahan lokal yang belum di-commit**;
  tidak ada push/PR/merge otomatis.
- `backend/node_modules` tetap diabaikan `.gitignore`.

## 5. Langkah berikutnya

1. Review David/Naazmi: scrypt vs Argon2id, `ACCOUNT_ENABLED`, HTTP adapter vs
   Express, kebijakan sesi/token, batas rate-limit.
2. TASK-011: hubungkan layar login ke `POST /auth/login` + `GET /auth/me`, simpan
   token di memori renderer (bukan localStorage), tampilkan peran dari sesi.
3. TASK-013: uji matriks penuh dengan endpoint modul lain, termasuk kepemilikan
   shift/sale, lalu catat bukti AC.
4. Uji bootstrap + login + restart pada PC tujuan dengan jaringan terputus.
