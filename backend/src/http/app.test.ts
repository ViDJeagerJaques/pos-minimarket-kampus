import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  createTempDatabase,
  FIXED_NOW,
  migrateFresh,
} from "../../db/test/helpers.ts";
import { createAuthService, type AuthService } from "../auth/service.ts";
import { createSessionStore, type SessionStore } from "../auth/session.ts";
import { hashPassword } from "../auth/password.ts";
import { createCatalogService } from "../catalog/service.ts";
import { createSecurityLogger, type SecurityLogger } from "../security/securityLog.ts";
import {
  createLoginRateLimiter,
  type LoginRateLimiter,
} from "../security/loginRateLimiter.ts";
import { startHttpServer, type RunningServer } from "./app.ts";
import { parseArgs as parseHttpCliArgs } from "./cli.ts";

function makeRuntimePassword(prefix = "pw"): string {
  return `${prefix}-${randomBytes(12).toString("hex")}`;
}

function makeRuntimeSecret(): Buffer {
  return randomBytes(32);
}

const ADMIN_PASSWORD = makeRuntimePassword("admin-http");
const CASHIER_PASSWORD = makeRuntimePassword("cashier-http");
const DEFAULT_SECRET = makeRuntimeSecret();

type ServerHandle = {
  running: RunningServer;
  sessions: SessionStore;
  auth: AuthService;
  securityLines: string[];
};

function startServerFor(
  db: DatabaseSync,
  secret: Buffer = DEFAULT_SECRET,
  options: {
    maxBodyBytes?: number;
    port?: number;
    loginRateLimiter?: LoginRateLimiter;
    loginIpRateLimiter?: LoginRateLimiter;
    now?: () => number;
  } = {},
): Promise<ServerHandle> {
  const securityLines: string[] = [];
  const sessions = createSessionStore(db, {
    secret,
    ttlMs: 12 * 60 * 60 * 1000,
    now: options.now,
  });
  const securityLog: SecurityLogger = createSecurityLogger({
    sink: (line) => securityLines.push(line),
    now: options.now,
  });
  const auth = createAuthService(db, { sessions, securityLog, now: options.now });
  const catalog = createCatalogService(db, { now: options.now });
  return startHttpServer({
    auth,
    sessions,
    securityLog,
    catalog,
    loginRateLimiter: options.loginRateLimiter,
    loginIpRateLimiter: options.loginIpRateLimiter,
    now: options.now,
    maxBodyBytes: options.maxBodyBytes,
    port: options.port,
  }).then((running) => ({ running, sessions, auth, securityLines }));
}

function insertUser(
  db: DatabaseSync,
  user: { id: number; username: string; password: string; role: "ADMIN" | "CASHIER"; active?: number },
): void {
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, active, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(user.id, user.username, hashPassword(user.password), user.role, user.active ?? 1, FIXED_NOW);
}

function createDatabase(): {
  database: ReturnType<typeof createTempDatabase>;
  db: DatabaseSync;
} {
  const database = createTempDatabase("pos-http-test-");
  const db = database.open();
  migrateFresh(database);
  insertUser(db, { id: 1, username: "admin.http", password: ADMIN_PASSWORD, role: "ADMIN" });
  insertUser(db, { id: 2, username: "kasir.http", password: CASHIER_PASSWORD, role: "CASHIER" });
  return { database, db };
}

type CallOptions = {
  method?: string;
  token?: string;
  payload?: string;
  contentType?: string;
  origin?: string;
};

async function call(base: string, path: string, options: CallOptions = {}) {
  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers.authorization = `Bearer ${options.token}`;
  }
  if (options.payload !== undefined) {
    headers["content-type"] = options.contentType ?? "application/json";
  }
  if (options.origin !== undefined) {
    headers.origin = options.origin;
  }
  const method = options.method ?? (options.payload !== undefined ? "POST" : "GET");
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers,
    body: options.payload,
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text.length > 0 ? (JSON.parse(text) as unknown) : null;
  } catch {
    json = null;
  }
  return { status: response.status, headers: response.headers, json, text };
}

async function login(base: string, username: string, password: string) {
  return call(base, "/auth/login", {
    method: "POST",
    payload: JSON.stringify({ username, password }),
  });
}

function rawRequest(
  base: string,
  path: string,
  headers: Record<string, string>,
  method = "GET",
): Promise<{ status: number; body: string }> {
  const url = new URL(`${base}/api/v1${path}`);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method,
        headers,
      },
      (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
      },
    );
    request.on("error", reject);
    request.end();
  });
}

function countRows(db: DatabaseSync, table: string): number {
  return Number(
    (db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total,
  );
}

test("AC-01.01/AC-01.02 via HTTP: login, /auth/me, kegagalan generik, dan transport loopback", async () => {
  const { database, db } = createDatabase();
  const handle = await startServerFor(db);
  try {
    const base = handle.running.url;
    const ok = await login(base, "admin.http", ADMIN_PASSWORD);
    assert.equal(ok.status, 200);
    const loginData = (ok.json as { data: { token: string; user: { role: string } } }).data;
    assert.equal(loginData.user.role, "ADMIN");
    assert.equal(typeof loginData.token, "string");

    const me = await call(base, "/auth/me", { token: loginData.token });
    assert.equal(me.status, 200);
    assert.deepEqual((me.json as { data: { username: string; role: string } }).data, {
      id: 1,
      username: "admin.http",
      role: "ADMIN",
      active: true,
    });

    const expectedMessage =
      "Nama pengguna atau kata sandi salah, atau akun tidak dapat dipakai.";
    for (const attempt of [
      { username: "admin.http", password: makeRuntimePassword("wrong") },
      { username: "tidak.ada", password: ADMIN_PASSWORD },
    ]) {
      const failed = await login(base, attempt.username, attempt.password);
      assert.equal(failed.status, 401);
      const error = (failed.json as { error: { code: string; message: string } }).error;
      assert.equal(error.code, "INVALID_CREDENTIALS");
      assert.equal(error.message, expectedMessage);
    }

    const noToken = await call(base, "/auth/me");
    assert.equal(noToken.status, 401);
    assert.equal((noToken.json as { error: { code: string } }).error.code, "AUTH_REQUIRED");
    const badToken = await call(base, "/auth/me", { token: "token-palsu" });
    assert.equal(badToken.status, 401);

    const badHost = await rawRequest(base, "/auth/me", { host: "evil.example" });
    assert.equal(badHost.status, 403);
    const badOrigin = await call(base, "/auth/me", {
      token: loginData.token,
      origin: "http://evil.example",
    });
    assert.equal(badOrigin.status, 403);
    const unknown = await call(base, "/tidak-ada", { token: loginData.token });
    assert.equal(unknown.status, 404);
    const wrongType = await call(base, "/auth/login", {
      method: "POST",
      payload: JSON.stringify({ username: "admin.http", password: ADMIN_PASSWORD }),
      contentType: "text/plain",
    });
    assert.equal(wrongType.status, 422);
    const badJson = await call(base, "/auth/login", {
      method: "POST",
      payload: "{bukan-json",
    });
    assert.equal(badJson.status, 422);
  } finally {
    await handle.running.close();
    db.close();
    database.cleanup();
  }
});

test("AC-01.03 via HTTP: CASHIER ditolak 403 pada endpoint ADMIN tanpa perubahan DB", async () => {
  const { database, db } = createDatabase();
  const handle = await startServerFor(db);
  try {
    const base = handle.running.url;
    const cashier = await login(base, "kasir.http", CASHIER_PASSWORD);
    const cashierToken = (cashier.json as { data: { token: string } }).data.token;

    const usersBefore = countRows(db, "users");
    const auditBefore = countRows(db, "audit_log");

    const deniedCreate = await call(base, "/users", {
      method: "POST",
      token: cashierToken,
      payload: JSON.stringify({
        username: "kasir.hendak.dibuat",
        password: makeRuntimePassword("denied"),
        role: "CASHIER",
      }),
    });
    assert.equal(deniedCreate.status, 403);
    assert.equal((deniedCreate.json as { error: { code: string } }).error.code, "FORBIDDEN");
    const deniedList = await call(base, "/users", { token: cashierToken });
    assert.equal(deniedList.status, 403);
    assert.equal(countRows(db, "users"), usersBefore);
    assert.equal(countRows(db, "audit_log"), auditBefore);
    assert.ok(
      handle.securityLines.some((line) => line.includes("ACCESS_DENIED")),
      "penolakan role dicatat di log keamanan",
    );
  } finally {
    await handle.running.close();
    db.close();
    database.cleanup();
  }
});

test("AC-01.04 via HTTP: ADMIN membuat/menonaktifkan akun; sesi target mati; logout replay 401", async () => {
  const { database, db } = createDatabase();
  const handle = await startServerFor(db);
  try {
    const base = handle.running.url;
    const admin = await login(base, "admin.http", ADMIN_PASSWORD);
    const adminToken = (admin.json as { data: { token: string } }).data.token;

    const createdUserPassword = makeRuntimePassword("baru-http");
    const created = await call(base, "/users", {
      method: "POST",
      token: adminToken,
      payload: JSON.stringify({
        username: "kasir.baru.http",
        password: createdUserPassword,
        role: "CASHIER",
      }),
    });
    assert.equal(created.status, 201);
    const newUser = (created.json as { data: { id: number; active: boolean } }).data;
    assert.equal(newUser.active, true);

    const newLogin = await login(base, "kasir.baru.http", createdUserPassword);
    const newToken = (newLogin.json as { data: { token: string } }).data.token;
    assert.equal((await call(base, "/auth/me", { token: newToken })).status, 200);

    const disabled = await call(base, `/users/${newUser.id}`, {
      method: "PATCH",
      token: adminToken,
      payload: JSON.stringify({ active: false }),
    });
    assert.equal(disabled.status, 200);
    assert.equal((disabled.json as { data: { active: boolean } }).data.active, false);
    assert.equal((await call(base, "/auth/me", { token: newToken })).status, 401);

    const reEnabled = await call(base, `/users/${newUser.id}`, {
      method: "PATCH",
      token: adminToken,
      payload: JSON.stringify({ active: true }),
    });
    assert.equal(reEnabled.status, 200);

    const lastAdmin = await call(base, "/users/1", {
      method: "PATCH",
      token: adminToken,
      payload: JSON.stringify({ active: false }),
    });
    assert.equal(lastAdmin.status, 409);

    const missing = await call(base, "/users/9999", {
      method: "PATCH",
      token: adminToken,
      payload: JSON.stringify({ active: false }),
    });
    assert.equal(missing.status, 404);

    const logout = await call(base, "/auth/logout", { method: "POST", token: adminToken });
    assert.equal(logout.status, 200);
    assert.equal((await call(base, "/auth/me", { token: adminToken })).status, 401);
    const replayLogout = await call(base, "/auth/logout", { method: "POST", token: adminToken });
    assert.equal(replayLogout.status, 401);
  } finally {
    await handle.running.close();
    db.close();
    database.cleanup();
  }
});

test("Restart backend: token proses lama tidak valid; sesi tersimpan di SQLite", async () => {
  const { database, db } = createDatabase();
  let handle = await startServerFor(db, makeRuntimeSecret());
  try {
    const first = await login(handle.running.url, "admin.http", ADMIN_PASSWORD);
    const oldToken = (first.json as { data: { token: string } }).data.token;
    assert.equal((await call(handle.running.url, "/auth/me", { token: oldToken })).status, 200);
    await handle.running.close();

    handle = await startServerFor(db, makeRuntimeSecret());
    assert.equal((await call(handle.running.url, "/auth/me", { token: oldToken })).status, 401);
    const sessionsPersisted = countRows(db, "sessions");
    assert.ok(sessionsPersisted >= 1, "baris sesi tetap ada di SQLite");
    const again = await login(handle.running.url, "admin.http", ADMIN_PASSWORD);
    assert.equal(again.status, 200);
    const newToken = (again.json as { data: { token: string } }).data.token;
    assert.equal((await call(handle.running.url, "/auth/me", { token: newToken })).status, 200);
  } finally {
    await handle.running.close();
    db.close();
    database.cleanup();
  }
});

test("Batas ukuran body ditolak; audit/log keamanan tidak bocor sandi/token", async () => {
  const { database, db } = createDatabase();
  const tiny = await startServerFor(db, DEFAULT_SECRET, { maxBodyBytes: 10 });
  try {
    const big = await call(tiny.running.url, "/auth/login", {
      method: "POST",
      payload: JSON.stringify({ username: "admin.http", password: ADMIN_PASSWORD }),
    });
    assert.equal(big.status, 422);
  } finally {
    await tiny.running.close();
  }

  const handle = await startServerFor(db);
  try {
    const base = handle.running.url;
    const failed = await login(base, "kasir.http", makeRuntimePassword("wrong"));
    assert.equal(failed.status, 401);
    const ok = await login(base, "kasir.http", CASHIER_PASSWORD);
    const token = (ok.json as { data: { token: string } }).data.token;
    await call(base, "/auth/logout", { method: "POST", token });

    const auditBlob = JSON.stringify(
      (db.prepare("SELECT * FROM audit_log").all() as Array<Record<string, unknown>>).map(
        (row) => ({ ...row }),
      ),
    );
    const securityBlob = handle.securityLines.join("\n");
    for (const secret of [ADMIN_PASSWORD, CASHIER_PASSWORD, token, "scrypt$"]) {
      assert.equal(auditBlob.includes(secret), false, `audit memuat ${secret}`);
      assert.equal(securityBlob.includes(secret), false, `security log memuat ${secret}`);
    }
  } finally {
    await handle.running.close();
    db.close();
    database.cleanup();
  }
});

test("Rate limiter login: validasi jendela, HTTP 429 generik untuk user terdaftar & tak dikenal, pemulihan setelah cooldown", async () => {
  assert.throws(() => createLoginRateLimiter({ windowMs: 0 }), /windowMs/);
  assert.throws(() => createLoginRateLimiter({ windowMs: 60 * 60 * 1000 + 1 }), /windowMs/);
  assert.throws(() => createLoginRateLimiter({ maxAttempts: 0 }), /maxAttempts/);
  assert.doesNotThrow(() => createLoginRateLimiter({ windowMs: 60 * 60 * 1000, maxAttempts: 5 }));

  const { database, db } = createDatabase();
  let fakeNow = FIXED_NOW;
  const windowMs = 10_000;
  const limiter = createLoginRateLimiter({
    maxAttempts: 3,
    windowMs,
    now: () => fakeNow,
  });
  const handle = await startServerFor(db, DEFAULT_SECRET, {
    loginRateLimiter: limiter,
    now: () => fakeNow,
  });

  try {
    const base = handle.running.url;

    // 1. User terdaftar gagal 3x -> 401; percobaan ke-4 -> 429 dengan Retry-After & retryable=true
    for (let i = 0; i < 3; i += 1) {
      const fail = await login(base, "kasir.http", "sandi-salah");
      assert.equal(fail.status, 401);
    }
    const blockedKnown = await login(base, "kasir.http", CASHIER_PASSWORD);
    assert.equal(blockedKnown.status, 429);
    assert.ok(Number(blockedKnown.headers.get("retry-after")) >= 1);
    const knownErr = (blockedKnown.json as {
      error: { code: string; message: string; retryable: boolean };
    }).error;
    assert.equal(knownErr.code, "LOGIN_RATE_LIMITED");
    assert.equal(knownErr.retryable, true);

    // 2. User tidak terdaftar juga mendapat 401 3x lalu 429 dengan pesan identik (tidak bocor registrasi)
    for (let i = 0; i < 3; i += 1) {
      const failUnknown = await login(base, "tidak.terdaftar.http", "sandi-salah");
      assert.equal(failUnknown.status, 401);
    }
    const blockedUnknown = await login(base, "tidak.terdaftar.http", "sandi-lain");
    assert.equal(blockedUnknown.status, 429);
    assert.ok(Number(blockedUnknown.headers.get("retry-after")) >= 1);
    const unknownErr = (blockedUnknown.json as {
      error: { code: string; message: string; retryable: boolean };
    }).error;
    assert.equal(unknownErr.code, knownErr.code);
    assert.equal(unknownErr.message, knownErr.message);
    assert.equal(unknownErr.retryable, true);

    // 3. Setelah masa tunggu (cooldown) berakhir, login yang benar berhasil (200)
    fakeNow += windowMs + 1;
    const recovered = await login(base, "kasir.http", CASHIER_PASSWORD);
    assert.equal(recovered.status, 200);
    const token = (recovered.json as { data: { token: string } }).data.token;
    assert.ok(token.length > 0);

    // 4. Pastikan password & token tidak pernah bocor ke security log
    const securityBlob = handle.securityLines.join("\n");
    for (const secret of [CASHIER_PASSWORD, "sandi-salah", token]) {
      assert.equal(securityBlob.includes(secret), false, `security log bocor: ${secret}`);
    }
  } finally {
    await handle.running.close();
    db.close();
    database.cleanup();
  }
});

test("Rate limiter per-IP: banyak username berbeda dibatasi 429, cooldown pulih, login normal tidak terganggu", async () => {
  const { database, db } = createDatabase();
  let fakeNow = FIXED_NOW;
  const windowMs = 10_000;
  const userLimiter = createLoginRateLimiter({
    maxAttempts: 5,
    windowMs,
    now: () => fakeNow,
  });
  const ipLimiter = createLoginRateLimiter({
    maxAttempts: 4,
    windowMs,
    now: () => fakeNow,
  });
  const handle = await startServerFor(db, DEFAULT_SECRET, {
    loginRateLimiter: userLimiter,
    loginIpRateLimiter: ipLimiter,
    now: () => fakeNow,
  });

  try {
    const base = handle.running.url;

    // 1. Login normal bergantian dari satu IP (lebih dari maxAttempts=4) tetap selalu 200.
    for (let i = 0; i < 6; i += 1) {
      const ok =
        i % 2 === 0
          ? await login(base, "admin.http", ADMIN_PASSWORD)
          : await login(base, "kasir.http", CASHIER_PASSWORD);
      assert.equal(ok.status, 200);
    }

    // 2. Percobaan gagal dengan 4 username berbeda dari IP yang sama -> semua 401.
    for (let i = 1; i <= 4; i += 1) {
      const fail = await login(base, `spray.user.${i}`, "sandi-salah");
      assert.equal(fail.status, 401);
    }

    // 3. Username ke-5 (termasuk username valid) dari IP yang sama -> ditolak 429 generik.
    const blockedSpray = await login(base, "kasir.http", CASHIER_PASSWORD);
    assert.equal(blockedSpray.status, 429);
    assert.ok(Number(blockedSpray.headers.get("retry-after")) >= 1);
    const err = (blockedSpray.json as {
      error: { code: string; message: string; retryable: boolean };
    }).error;
    assert.equal(err.code, "LOGIN_RATE_LIMITED");
    assert.equal(err.retryable, true);
    assert.equal(err.message, "Terlalu banyak percobaan login. Coba lagi nanti.");

    // 4. Setelah cooldown berakhir, login normal kembali berhasil 200.
    fakeNow += windowMs + 1;
    const recoveredAdmin = await login(base, "admin.http", ADMIN_PASSWORD);
    const recoveredCashier = await login(base, "kasir.http", CASHIER_PASSWORD);
    assert.equal(recoveredAdmin.status, 200);
    assert.equal(recoveredCashier.status, 200);

    const securityBlob = handle.securityLines.join("\n");
    for (const secret of [ADMIN_PASSWORD, CASHIER_PASSWORD, "sandi-salah"]) {
      assert.equal(securityBlob.includes(secret), false, `security log bocor: ${secret}`);
    }
  } finally {
    await handle.running.close();
    db.close();
    database.cleanup();
  }
});

function allocateFreeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (typeof address !== "object" || address === null) {
        probe.close(() => reject(new Error("Gagal membaca port sementara.")));
        return;
      }
      const { port } = address;
      probe.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

test("HTTP CLI port & pembersihan bucket rate-limiter kedaluwarsa", async () => {
  // 1. CLI tanpa --port membiarkan port undefined agar startHttpServer memakai POS_HTTP_PORT.
  const withoutPort = parseHttpCliArgs(["serve"]);
  assert.equal(withoutPort.port, undefined);
  const withPort = parseHttpCliArgs(["serve", "--port", "8787"]);
  assert.equal(withPort.port, 8787);

  const prevEnvPort = process.env.POS_HTTP_PORT;
  const { database, db } = createDatabase();
  let handle: ServerHandle | undefined;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const chosenPort = await allocateFreeLoopbackPort();
      process.env.POS_HTTP_PORT = String(chosenPort);
      try {
        handle = await startServerFor(db, DEFAULT_SECRET, { port: withoutPort.port });
        assert.equal(handle.running.port, chosenPort);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        if (code === "EADDRINUSE" && attempt < 2) {
          continue;
        }
        throw error;
      }
    }
    assert.ok(handle, "Server gagal dimulai menggunakan POS_HTTP_PORT dinamis");
  } finally {
    if (prevEnvPort === undefined) {
      delete process.env.POS_HTTP_PORT;
    } else {
      process.env.POS_HTTP_PORT = prevEnvPort;
    }
    await handle?.running.close();
    db.close();
    database.cleanup();
  }

  // 2. Bucket kedaluwarsa untuk key yang tidak dipakai lagi dibersihkan saat sweep.
  let fakeNow = FIXED_NOW;
  const limiter = createLoginRateLimiter({
    maxAttempts: 3,
    windowMs: 5_000,
    now: () => fakeNow,
  });
  limiter.recordFailure("127.0.0.1:lama.1");
  limiter.recordFailure("127.0.0.1:lama.2");
  assert.equal(limiter.size(), 2);

  fakeNow += 5_001;
  limiter.assertAllowed("127.0.0.1:baru");
  assert.equal(limiter.size(), 0);
});

test("AC-02.01/02/03 & AC-03.01 via HTTP: katalog ADMIN, 403 CASHIER, barcode nol awal, audit harga", async () => {
  const { database, db } = createDatabase();
  const handle = await startServerFor(db);
  const base = handle.running.url;
  const dataOf = <T,>(result: { json: unknown }): T =>
    (result.json as { data: T }).data;
  const codeOf = (result: { json: unknown }): string | undefined =>
    (result.json as { error?: { code?: string } }).error?.code;
  const count = (table: string): number =>
    Number((db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total);

  try {
    const adminLogin = await login(base, "admin.http", ADMIN_PASSWORD);
    const cashierLogin = await login(base, "kasir.http", CASHIER_PASSWORD);
    assert.equal(adminLogin.status, 200);
    assert.equal(cashierLogin.status, 200);
    const adminToken = dataOf<{ token: string }>(adminLogin).token;
    const cashierToken = dataOf<{ token: string }>(cashierLogin).token;

    // AC-02.01: ADMIN menyimpan kategori, supplier, produk aktif valid.
    const category = await call(base, "/categories", {
      token: adminToken,
      payload: JSON.stringify({ name: "Kategori HTTP" }),
    });
    assert.equal(category.status, 201);
    const categoryId = dataOf<{ id: number }>(category).id;

    const supplier = await call(base, "/suppliers", {
      token: adminToken,
      payload: JSON.stringify({ name: "Supplier HTTP" }),
    });
    assert.equal(supplier.status, 201);
    const supplierId = dataOf<{ id: number }>(supplier).id;

    const product = await call(base, "/products", {
      token: adminToken,
      payload: JSON.stringify({
        categoryId,
        sku: "HTTP-001",
        name: "Produk HTTP",
        priceRp: 5000,
        barcodes: ["000123"],
        supplierIds: [supplierId],
      }),
    });
    assert.equal(product.status, 201);
    const productData = dataOf<{
      id: number;
      barcodes: string[];
      supplierIds: number[];
      stockOnHand: number;
      active: boolean;
    }>(product);
    assert.deepEqual(productData.barcodes, ["000123"]);
    assert.deepEqual(productData.supplierIds, [supplierId]);
    assert.equal(productData.stockOnHand, 0);
    assert.equal(productData.active, true);

    // AC-02.02: barcode duplikat ditolak server dan produk tidak tersimpan.
    const productsBefore = count("products");
    const duplicate = await call(base, "/products", {
      token: adminToken,
      payload: JSON.stringify({
        categoryId,
        sku: "HTTP-002",
        name: "Produk Duplikat",
        priceRp: 1000,
        barcodes: ["000123"],
      }),
    });
    assert.equal(duplicate.status, 409);
    assert.equal(codeOf(duplicate), "DUPLICATE_BARCODE");
    assert.equal(count("products"), productsBefore);

    const invalidSku = await call(base, "/products", {
      token: adminToken,
      payload: JSON.stringify({
        categoryId,
        sku: "SKU SALAH",
        name: "SKU Tidak Valid",
        priceRp: 1000,
        barcodes: [],
      }),
    });
    assert.equal(invalidSku.status, 422);
    assert.equal(codeOf(invalidSku), "VALIDATION_ERROR");

    // AC-03.01: CASHIER mencari barcode; nol awal tetap akurat.
    const cashierScan = await call(base, "/products?barcode=000123", { token: cashierToken });
    assert.equal(cashierScan.status, 200);
    const scanRows = dataOf<Array<{ id: number }>>(cashierScan);
    assert.equal(scanRows.length, 1);
    assert.equal(scanRows[0]?.id, productData.id);

    const tanpaNol = await call(base, "/products?barcode=123", { token: cashierToken });
    assert.equal(tanpaNol.status, 200);
    assert.equal(dataOf<unknown[]>(tanpaNol).length, 0);

    // AC-02.03: harga master berubah dan audit mencatat harga lama/baru.
    const priceUpdate = await call(base, `/products/${productData.id}`, {
      method: "PATCH",
      token: adminToken,
      payload: JSON.stringify({ priceRp: 6000 }),
    });
    assert.equal(priceUpdate.status, 200);
    assert.equal(dataOf<{ priceRp: number }>(priceUpdate).priceRp, 6000);
    const priceAudit = db
      .prepare("SELECT details FROM audit_log WHERE action = 'PRICE_CHANGED' ORDER BY id DESC LIMIT 1")
      .get() as { details: string } | undefined;
    assert.ok(priceAudit, "audit PRICE_CHANGED harus ada");
    const auditDetails = JSON.parse(priceAudit.details) as {
      oldPriceRp: number;
      newPriceRp: number;
      sku: string;
    };
    assert.equal(auditDetails.sku, "HTTP-001");
    assert.equal(auditDetails.oldPriceRp, 5000);
    assert.equal(auditDetails.newPriceRp, 6000);

    // Otorisasi backend: CASHIER tidak boleh menulis atau melihat nonaktif.
    const productsBeforeDenied = count("products");
    const cashierCreate = await call(base, "/products", {
      token: cashierToken,
      payload: JSON.stringify({
        categoryId,
        sku: "CASHIER-001",
        name: "Dilarang",
        priceRp: 1000,
        barcodes: [],
      }),
    });
    assert.equal(cashierCreate.status, 403);
    assert.equal(codeOf(cashierCreate), "FORBIDDEN");
    assert.equal(count("products"), productsBeforeDenied);

    const includeInactive = await call(base, "/products?includeInactive=true", {
      token: cashierToken,
    });
    assert.equal(includeInactive.status, 403);

    const categoriesRead = await call(base, "/categories", { token: cashierToken });
    assert.equal(categoriesRead.status, 200);

    // Produk nonaktif tidak terlihat CASHIER, tetapi ADMIN dapat memeriksanya.
    const deactivate = await call(base, `/products/${productData.id}`, {
      method: "PATCH",
      token: adminToken,
      payload: JSON.stringify({ active: false }),
    });
    assert.equal(deactivate.status, 200);
    assert.equal(dataOf<{ active: boolean }>(deactivate).active, false);

    const cashierAfterDisable = await call(base, "/products?barcode=000123", {
      token: cashierToken,
    });
    assert.equal(cashierAfterDisable.status, 200);
    assert.equal(dataOf<unknown[]>(cashierAfterDisable).length, 0);

    const adminInactive = await call(base, "/products?includeInactive=true&barcode=000123", {
      token: adminToken,
    });
    assert.equal(adminInactive.status, 200);
    assert.equal(dataOf<unknown[]>(adminInactive).length, 1);

    // Katalog tidak boleh membuat penjualan, pembayaran, atau mutasi stok.
    assert.equal(count("sales"), 0);
    assert.equal(count("payments"), 0);
    assert.equal(count("inventory_movements"), 0);
  } finally {
    await handle.running.close();
    db.close();
    database.cleanup();
  }
});

test("BUG-005: POST /products/:id/suppliers menolak body tanpa supplierIds atau null, dan mengizinkan [] eksplisit", async () => {
  const { database, db } = createDatabase();
  const handle = await startServerFor(db);
  const base = handle.running.url;
  const dataOf = <T,>(result: { json: unknown }): T =>
    (result.json as { data: T }).data;
  const codeOf = (result: { json: unknown }): string | undefined =>
    (result.json as { error?: { code?: string } }).error?.code;

  try {
    const adminLogin = await login(base, "admin.http", ADMIN_PASSWORD);
    assert.equal(adminLogin.status, 200);
    const adminToken = dataOf<{ token: string }>(adminLogin).token;

    const category = await call(base, "/categories", {
      token: adminToken,
      payload: JSON.stringify({ name: "Minuman" }),
    });
    const categoryId = dataOf<{ id: number }>(category).id;

    const supplier = await call(base, "/suppliers", {
      token: adminToken,
      payload: JSON.stringify({ name: "PT Supplier Uji" }),
    });
    const supplierId = dataOf<{ id: number }>(supplier).id;

    const product = await call(base, "/products", {
      token: adminToken,
      payload: JSON.stringify({
        categoryId,
        sku: "SUP-001",
        name: "Air Mineral",
        priceRp: 3000,
        barcodes: [],
        supplierIds: [supplierId],
      }),
    });
    assert.equal(product.status, 201);
    const productId = dataOf<{ id: number }>(product).id;

    const auditCountBefore = (
      db.prepare("SELECT COUNT(*) AS c FROM audit_log").get() as { c: number }
    ).c;

    // 1. Body kosong `{}` -> ditolak, relasi supplier & audit tidak berubah
    const missingField = await call(base, `/products/${productId}/suppliers`, {
      token: adminToken,
      payload: JSON.stringify({}),
    });
    assert.equal(missingField.status, 422);
    assert.equal(codeOf(missingField), "VALIDATION_ERROR");

    // 2. `{"supplierIds": null}` -> ditolak, relasi supplier & audit tidak berubah
    const nullField = await call(base, `/products/${productId}/suppliers`, {
      token: adminToken,
      payload: JSON.stringify({ supplierIds: null }),
    });
    assert.equal(nullField.status, 422);
    assert.equal(codeOf(nullField), "VALIDATION_ERROR");

    // 3. Tipe non-array `{"supplierIds": "1"}` -> ditolak
    const nonArrayField = await call(base, `/products/${productId}/suppliers`, {
      token: adminToken,
      payload: JSON.stringify({ supplierIds: "1" }),
    });
    assert.equal(nonArrayField.status, 422);
    assert.equal(codeOf(nonArrayField), "VALIDATION_ERROR");

    const linkedAfterInvalid = db
      .prepare("SELECT supplier_id FROM product_suppliers WHERE product_id = ?")
      .all(productId) as Array<{ supplier_id: number }>;
    assert.deepEqual(
      linkedAfterInvalid.map((r) => Number(r.supplier_id)),
      [supplierId],
    );
    const auditCountAfterInvalid = (
      db.prepare("SELECT COUNT(*) AS c FROM audit_log").get() as { c: number }
    ).c;
    assert.equal(auditCountAfterInvalid, auditCountBefore);

    // 4. `{"supplierIds": []}` eksplisit -> diizinkan untuk menghapus relasi
    const explicitEmpty = await call(base, `/products/${productId}/suppliers`, {
      token: adminToken,
      payload: JSON.stringify({ supplierIds: [] }),
    });
    assert.equal(explicitEmpty.status, 200);
    assert.deepEqual(dataOf<{ supplierIds: number[] }>(explicitEmpty).supplierIds, []);

    const linkedAfterEmpty = db
      .prepare("SELECT supplier_id FROM product_suppliers WHERE product_id = ?")
      .all(productId) as Array<{ supplier_id: number }>;
    assert.deepEqual(linkedAfterEmpty, []);
  } finally {
    await handle.running.close();
    db.close();
    database.cleanup();
  }
});
