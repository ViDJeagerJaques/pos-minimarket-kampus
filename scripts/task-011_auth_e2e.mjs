#!/usr/bin/env node
/**
 * TASK-011 E2E API nyata (tanpa mock):
 * migrasi SQLite sementara → bootstrap ADMIN → server loopback → login/akun/403/audit.
 *
 * Jalankan dari root repo: `node scripts/task-011_auth_e2e.mjs`
 * Tidak memakai database development/operasional; semua data di folder temp dan dihapus.
 * Kata sandi/token hanya di memori proses dan tidak dicetak.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = join(root, "backend");
const tempDir = mkdtempSync(join(tmpdir(), "pos-task011-e2e-"));
const dbPath = join(tempDir, "task011.sqlite");

const adminPassword = `adm-${randomBytes(12).toString("hex")}`;
const cashierPassword = `ksr-${randomBytes(12).toString("hex")}`;
const cashierUsername = "kasir.e2e";
const adminUsername = "admin.e2e";

let server = null;
let passCount = 0;

function pass(label) {
  passCount += 1;
  console.log(`PASS ${passCount}. ${label}`);
}

function runNode(args, extraEnv = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: backendDir,
    env: { ...process.env, POS_DB_PATH: dbPath, ...extraEnv },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `Perintah gagal (${args[0]} ${args[1] ?? ""}): ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

function freeLoopbackPort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (typeof address !== "object" || address === null) {
        probe.close(() => reject(new Error("Gagal mendapat port loopback.")));
        return;
      }
      const { port } = address;
      probe.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

function waitForServerStart(child) {
  return new Promise((resolveUrl, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      reject(new Error("Server tidak siap dalam 15 detik."));
    }, 15_000);
    const finish = (error, url) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolveUrl(url);
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/Server DEMO berjalan di (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        finish(null, match[1]);
      }
    });
    child.once("error", (error) => finish(error));
    child.once("exit", (code) => finish(new Error(`Server berhenti (exit ${code}).`)));
  });
}

async function stopServer() {
  if (!server || server.exitCode !== null) {
    return;
  }
  const exited = once(server, "exit").catch(() => undefined);
  server.kill();
  await Promise.race([exited, new Promise((resolveDelay) => setTimeout(resolveDelay, 3000))]);
  if (server.exitCode === null) {
    server.kill("SIGKILL");
  }
}

async function call(baseUrl, path, options = {}) {
  const headers = { accept: "application/json" };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (options.token !== undefined) {
    headers.authorization = `Bearer ${options.token}`;
  }
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

function dataOf(result) {
  return result.json?.data;
}

function errorCode(result) {
  return result.json?.error?.code;
}

async function main() {
  // 1. Database sementara di luar source tree + skema + bootstrap ADMIN.
  runNode(["db/src/cli.ts", "migrate", "--db", dbPath]);
  runNode(
    ["src/auth/cli.ts", "bootstrap-admin", "--username", adminUsername, "--db", dbPath],
    { POS_BOOTSTRAP_PASSWORD: adminPassword },
  );
  pass("Migrasi SQLite sementara dan bootstrap ADMIN (kata sandi dari env, bukan repo)");

  // 2. Server loopback nyata.
  const port = await freeLoopbackPort();
  server = spawn(
    process.execPath,
    ["src/http/cli.ts", "serve", "--db", dbPath, "--port", String(port)],
    {
      cwd: backendDir,
      env: { ...process.env, POS_DB_PATH: dbPath },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stderr.setEncoding("utf8");
  server.stderr.on("data", () => {
    // Log keamanan backend tidak memuat kata sandi/token; jangan dicetak agar output ringkas.
  });
  const baseUrl = await waitForServerStart(server);
  pass(`Server lokal berjalan di ${baseUrl} (127.0.0.1)`);

  // 3. Login ADMIN + profil.
  const adminLogin = await call(baseUrl, "/auth/login", {
    method: "POST",
    body: { username: adminUsername, password: adminPassword },
  });
  assert.equal(adminLogin.status, 200, "login admin harus 200");
  const adminToken = dataOf(adminLogin)?.token;
  assert.equal(typeof adminToken, "string");
  assert.equal(dataOf(adminLogin)?.user?.role, "ADMIN");
  const adminMe = await call(baseUrl, "/auth/me", { token: adminToken });
  assert.equal(adminMe.status, 200);
  assert.equal(dataOf(adminMe)?.username, adminUsername);
  assert.equal(dataOf(adminMe)?.role, "ADMIN");
  pass("AC-01.01 ADMIN login dan GET /auth/me mengembalikan role backend");

  // 4. Sandi salah: pesan generik, tidak ada sesi.
  const wrongLogin = await call(baseUrl, "/auth/login", {
    method: "POST",
    body: { username: adminUsername, password: `${adminPassword}-salah` },
  });
  assert.equal(wrongLogin.status, 401);
  assert.equal(errorCode(wrongLogin), "INVALID_CREDENTIALS");
  assert.match(wrongLogin.json?.error?.message ?? "", /Nama pengguna atau kata sandi salah/);
  pass("AC-01.02 sandi salah ditolak generik (401 INVALID_CREDENTIALS)");

  // 5. ADMIN membuat kasir (201) dan kasir dapat login.
  const created = await call(baseUrl, "/users", {
    method: "POST",
    token: adminToken,
    body: { username: cashierUsername, password: cashierPassword, role: "CASHIER" },
  });
  assert.equal(created.status, 201);
  const cashierId = dataOf(created)?.id;
  assert.equal(Number.isSafeInteger(cashierId), true);
  assert.equal(dataOf(created)?.active, true);

  const cashierLogin = await call(baseUrl, "/auth/login", {
    method: "POST",
    body: { username: cashierUsername, password: cashierPassword },
  });
  assert.equal(cashierLogin.status, 200);
  const cashierToken = dataOf(cashierLogin)?.token;
  assert.equal(typeof cashierToken, "string");
  pass("AC-01.04 ADMIN membuat akun kasir; akun baru dapat login");

  // 6. CASHIER ditolak 403 pada endpoint ADMIN; DB tidak berubah.
  const deniedList = await call(baseUrl, "/users", { token: cashierToken });
  assert.equal(deniedList.status, 403);
  assert.equal(errorCode(deniedList), "FORBIDDEN");
  const deniedCreate = await call(baseUrl, "/users", {
    method: "POST",
    token: cashierToken,
    body: { username: "kasir.tidak.boleh", password: cashierPassword, role: "CASHIER" },
  });
  assert.equal(deniedCreate.status, 403);
  pass("AC-01.03 CASHIER menerima 403 dari backend dan tidak dapat membuat akun");

  // 7. Nonaktifkan kasir -> sesi lama 401 -> login ditolak generik.
  const disabled = await call(baseUrl, `/users/${cashierId}`, {
    method: "PATCH",
    token: adminToken,
    body: { active: false },
  });
  assert.equal(disabled.status, 200);
  assert.equal(dataOf(disabled)?.active, false);
  const revoked = await call(baseUrl, "/auth/me", { token: cashierToken });
  assert.equal(revoked.status, 401);
  assert.equal(errorCode(revoked), "AUTH_REQUIRED");
  const disabledLogin = await call(baseUrl, "/auth/login", {
    method: "POST",
    body: { username: cashierUsername, password: cashierPassword },
  });
  assert.equal(disabledLogin.status, 401);
  assert.equal(errorCode(disabledLogin), "INVALID_CREDENTIALS");
  assert.match(disabledLogin.json?.error?.message ?? "", /Nama pengguna atau kata sandi salah/);
  pass("AC-01.04 akun nonaktif: sesi lama dicabut dan login ditolak generik");

  // 8. Logout ADMIN -> token lama 401 (AUTH-04).
  const logout = await call(baseUrl, "/auth/logout", { method: "POST", token: adminToken });
  assert.equal(logout.status, 200);
  assert.equal((await call(baseUrl, "/auth/me", { token: adminToken })).status, 401);
  pass("Logout mencabut sesi; token lama tidak dapat dipakai");

  // 9. Audit tercatat tanpa kata sandi/token/hash.
  const db = new DatabaseSync(dbPath);
  try {
    const rows = db
      .prepare(
        "SELECT actor_id, action, entity_type, entity_id, details, created_at_ms FROM audit_log ORDER BY id",
      )
      .all();
    const actions = rows.map((row) => row.action);
    assert.ok(actions.includes("ACCOUNT_CREATED"), "ACCOUNT_CREATED harus tercatat");
    assert.ok(actions.includes("ACCOUNT_DISABLED"), "ACCOUNT_DISABLED harus tercatat");
    assert.ok(actions.filter((action) => action === "ACCOUNT_CREATED").length >= 2);
    for (const row of rows) {
      assert.equal(Number(row.actor_id) > 0, true);
      assert.equal(Number(row.created_at_ms) > 0, true);
    }
    const auditBlob = JSON.stringify(rows.map((row) => ({ ...row })));
    for (const secret of [adminPassword, cashierPassword, adminToken, cashierToken, "scrypt$"]) {
      assert.equal(auditBlob.includes(secret), false, "audit tidak boleh memuat rahasia");
    }
    const hashes = db.prepare("SELECT password_hash FROM users").all();
    for (const row of hashes) {
      assert.equal(String(row.password_hash).startsWith("scrypt$"), true);
      assert.equal(String(row.password_hash).includes(adminPassword), false);
      assert.equal(String(row.password_hash).includes(cashierPassword), false);
    }
    pass(
      `Audit akun tercatat (${actions.filter((action) => action.startsWith("ACCOUNT_")).length} entri), tanpa sandi/token/hash`,
    );
  } finally {
    db.close();
  }
}

try {
  await main();
  console.log(`\nPASS total ${passCount} pemeriksaan E2E API nyata (TASK-011).`);
} catch (error) {
  console.error(`\nFAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await stopServer();
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Folder temp bisa dikunci sebentar di Windows; tidak memengaruhi hasil tes.
  }
}
