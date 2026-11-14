import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
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
import { createSecurityLogger, type SecurityLogger } from "../security/securityLog.ts";
import {
  createLoginRateLimiter,
  type LoginRateLimiter,
} from "../security/loginRateLimiter.ts";
import { startHttpServer, type RunningServer } from "./app.ts";

const ADMIN_PASSWORD = "rahasia.admin.http";
const CASHIER_PASSWORD = "rahasia.kasir.http";
const DEFAULT_SECRET = Buffer.from("http-test-secret-0123456789abcdef0123");

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
  return startHttpServer({
    auth,
    sessions,
    securityLog,
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
      { username: "admin.http", password: "salah" },
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
        password: "sandi.kuat.123",
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

    const created = await call(base, "/users", {
      method: "POST",
      token: adminToken,
      payload: JSON.stringify({
        username: "kasir.baru.http",
        password: "sandi.baru.http",
        role: "CASHIER",
      }),
    });
    assert.equal(created.status, 201);
    const newUser = (created.json as { data: { id: number; active: boolean } }).data;
    assert.equal(newUser.active, true);

    const newLogin = await login(base, "kasir.baru.http", "sandi.baru.http");
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
  let handle = await startServerFor(db, Buffer.from("secret-pertama-0123456789abcdef012345"));
  try {
    const first = await login(handle.running.url, "admin.http", ADMIN_PASSWORD);
    const oldToken = (first.json as { data: { token: string } }).data.token;
    assert.equal((await call(handle.running.url, "/auth/me", { token: oldToken })).status, 200);
    await handle.running.close();

    handle = await startServerFor(db, Buffer.from("secret-kedua-0123456789abcdef0123456789"));
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
    const failed = await login(base, "kasir.http", "sandi-yang-salah");
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
