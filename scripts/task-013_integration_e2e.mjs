#!/usr/bin/env node
/**
 * TASK-013 E2E integrasi akses + katalog (tanpa mock), memakai fixture TASK-006.
 *
 * Alur:
 *   1. Reset fixture QA sintetis (TASK-006) di direktori temp `pos-qa-*` + verifikasi snapshot.
 *   2. Salin fixture ke DB sesi terpisah (fixture asli tetap utuh).
 *   3. Setel kata sandi sementara acak untuk akun fixture ADMIN/CASHIER/nonaktif
 *      HANYA pada salinan sesi (bukan fixture, bukan DB operasional).
 *   4. Jalankan server loopback nyata lalu uji AC-01.01-04, AC-02.01-03,
 *      AC-03.01, AC-03.07 lewat API langsung + verifikasi SQLite/audit.
 *
 * Jalankan dari root repo:
 *   node scripts/task-013_integration_e2e.mjs [--json-out <file>] [--keep-db]
 *
 * Tidak memakai database development/operasional. Kata sandi/token hanya di memori
 * proses dan tidak dicetak. Semua data sintetis dan berlabel DEMO/QA.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { release as osRelease, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../backend/src/auth/password.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = join(root, "backend");
const fixtureDir = mkdtempSync(join(tmpdir(), "pos-qa-task013-fixture-"));
const fixtureDb = join(fixtureDir, "fixture.sqlite");
const sessionDir = mkdtempSync(join(tmpdir(), "pos-task013-e2e-"));
const dbPath = join(sessionDir, "session.sqlite");

const args = process.argv.slice(2);
const jsonOutIndex = args.indexOf("--json-out");
const jsonOut = jsonOutIndex >= 0 ? args[jsonOutIndex + 1] : null;
const keepDb = args.includes("--keep-db");

const adminUsername = "demo.admin"; // akun fixture TASK-006 (ADMIN)
const cashierUsername = "demo.kasir.pagi"; // akun fixture TASK-006 (CASHIER, shift 101 sudah ditutup)
const soreUsername = "demo.kasir.sore"; // akun fixture TASK-006 (CASHIER, pemilik shift 102 AKTIF)
const inactiveUsername = "demo.kasir.nonaktif"; // akun fixture TASK-006 (nonaktif)
const adminPassword = `adm-${randomBytes(12).toString("hex")}`;
const cashierPassword = `ksr-${randomBytes(12).toString("hex")}`;
const sorePassword = `sor-${randomBytes(12).toString("hex")}`;
const inactivePassword = `ina-${randomBytes(12).toString("hex")}`;
const newCashierUsername = "kasir.t13.uji";
const newCashierPassword = `baru-${randomBytes(12).toString("hex")}`;

let server = null;
let passCount = 0;
const results = [];

function record(ac, label, status = "PASS") {
  results.push({ ac, label, status });
  if (status === "PASS") {
    passCount += 1;
    console.log(`PASS ${passCount}. [${ac}] ${label}`);
  } else {
    console.log(`FAIL [${ac}] ${label}`);
  }
}

function runNode(nodeArgs, options = {}) {
  const result = spawnSync(process.execPath, nodeArgs, {
    cwd: options.cwd ?? root,
    env: { ...process.env, POS_DB_PATH: options.dbPath ?? "", ...options.env },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `Perintah gagal (${nodeArgs.join(" ")}): ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

/** Commit/branch nyata saat uji berjalan, agar bukti tidak bergantung ingatan. */
function gitInfo() {
  const read = (gitArgs) => {
    const result = spawnSync("git", gitArgs, { cwd: root, encoding: "utf8" });
    return result.status === 0 ? result.stdout.trim() : null;
  };
  return {
    commit: process.env.GIT_COMMIT_SHA ?? read(["rev-parse", "HEAD"]),
    branch: read(["rev-parse", "--abbrev-ref", "HEAD"]),
  };
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
  return { status: response.status, json, rawText: text };
}

function dataOf(result) {
  return result.json?.data;
}

function errorCode(result) {
  return result.json?.error?.code;
}

function errorMessage(result) {
  return result.json?.error?.message ?? "";
}

function openReadOnly() {
  return new DatabaseSync(dbPath, { readOnly: true });
}

function countRows(db, table, where = "", params = []) {
  return Number(
    db.prepare(`SELECT COUNT(*) AS total FROM ${table} ${where}`).get(...params).total,
  );
}

function counts(tables) {
  const db = openReadOnly();
  try {
    const out = {};
    for (const table of tables) {
      out[table] = countRows(db, table);
    }
    return out;
  } finally {
    db.close();
  }
}

function auditRows() {
  const db = openReadOnly();
  try {
    return db
      .prepare(
        "SELECT actor_id, action, entity_type, entity_id, details, created_at_ms FROM audit_log ORDER BY id",
      )
      .all()
      .map((row) => ({ ...row }));
  } finally {
    db.close();
  }
}

/** Setel hash scrypt valid pada salinan sesi agar akun fixture dapat dipakai login. */
function setSessionPasswords() {
  const db = new DatabaseSync(dbPath);
  try {
    const update = db.prepare("UPDATE users SET password_hash = ? WHERE username = ?");
    const changed = [];
    for (const [username, password] of [
      [adminUsername, adminPassword],
      [cashierUsername, cashierPassword],
      [soreUsername, sorePassword],
      [inactiveUsername, inactivePassword],
    ]) {
      const result = update.run(hashPassword(password), username);
      assert.equal(Number(result.changes), 1, `akun fixture ${username} harus ada`);
      changed.push(username);
    }
    return changed;
  } finally {
    db.close();
  }
}

function snapshotStockBalances() {
  const db = openReadOnly();
  try {
    return db
      .prepare(
        `SELECT p.id AS productId, p.sku, b.barcode, p.price_rp AS priceRp, sb.on_hand AS onHand
         FROM products p
         JOIN product_barcodes b ON b.product_id = p.id
         JOIN stock_balances sb ON sb.product_id = p.id
         ORDER BY p.id`,
      )
      .all()
      .map((row) => ({ ...row }));
  } finally {
    db.close();
  }
}

async function main() {
  // ---------------------------------------------------------------------------
  // 0. Fixture TASK-006: reset + verifikasi snapshot di temp `pos-qa-*`.
  // ---------------------------------------------------------------------------
  const fixtureResetOutput = runNode(
    [
      "backend/qa/qa_runner.ts",
      "reset",
      "--db",
      fixtureDb,
      "--confirm-dev-reset",
    ],
    { env: { POS_DB_PROFILE: "test" } },
  );
  const fixtureVerifyOutput = runNode(["backend/qa/qa_runner.ts", "verify", "--db", fixtureDb]);
  assert.match(fixtureVerifyOutput, /PASS: snapshot/);
  record("FIXTURE", "TASK-006 fixture reset + verify PASS (DB sementara pos-qa-*)");

  // Salin fixture utuh ke DB sesi; fixture asli tidak diubah.
  const checkpoint = new DatabaseSync(fixtureDb);
  try {
    checkpoint.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  } finally {
    checkpoint.close();
  }
  copyFileSync(fixtureDb, dbPath);
  const changedUsers = setSessionPasswords();
  record(
    "FIXTURE",
    `Salinan sesi dibuat; kata sandi acak hanya di salinan untuk ${changedUsers.join(", ")}`,
  );

  const expectedFixtureDb = new DatabaseSync(fixtureDb, { readOnly: true });
  let expectedStock;
  let expectedSaleItem303;
  try {
    expectedStock = expectedFixtureDb
      .prepare(
        `SELECT product_id AS productId, on_hand AS onHand FROM stock_balances ORDER BY product_id`,
      )
      .all()
      .map((row) => ({ ...row }));
    expectedSaleItem303 = expectedFixtureDb
      .prepare(
        "SELECT unit_price_rp AS unitPriceRp, line_total_rp AS lineTotalRp FROM sale_items WHERE id = 303",
      )
      .get();
  } finally {
    expectedFixtureDb.close();
  }

  // ---------------------------------------------------------------------------
  // Server loopback nyata.
  // ---------------------------------------------------------------------------
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
    // Log keamanan backend tidak memuat kata sandi/token; tidak dicetak.
  });
  const baseUrl = await waitForServerStart(server);

  // ---------------------------------------------------------------------------
  // AC-01.01 — login ADMIN/CASHIER, role dari backend, sesi hanya digest token.
  // ---------------------------------------------------------------------------
  const adminLogin = await call(baseUrl, "/auth/login", {
    method: "POST",
    body: { username: adminUsername, password: adminPassword },
  });
  assert.equal(adminLogin.status, 200, "login ADMIN fixture harus 200");
  const adminToken = dataOf(adminLogin)?.token;
  assert.equal(typeof adminToken, "string");
  assert.equal(dataOf(adminLogin)?.user?.role, "ADMIN");
  const adminMe = await call(baseUrl, "/auth/me", { token: adminToken });
  assert.equal(adminMe.status, 200);
  assert.equal(dataOf(adminMe)?.username, adminUsername);
  assert.equal(dataOf(adminMe)?.role, "ADMIN");

  const cashierLogin = await call(baseUrl, "/auth/login", {
    method: "POST",
    body: { username: cashierUsername, password: cashierPassword },
  });
  assert.equal(cashierLogin.status, 200, "login CASHIER fixture harus 200");
  const cashierToken = dataOf(cashierLogin)?.token;
  assert.equal(typeof cashierToken, "string");
  assert.equal(dataOf(cashierLogin)?.user?.role, "CASHIER");
  const cashierMe = await call(baseUrl, "/auth/me", { token: cashierToken });
  assert.equal(cashierMe.status, 200);
  assert.equal(dataOf(cashierMe)?.role, "CASHIER");

  const sessionDb = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = sessionDb
      .prepare("SELECT user_id, token_digest FROM sessions ORDER BY expires_at_ms")
      .all();
    assert.ok(rows.length >= 2, "dua sesi login harus tersimpan");
    for (const row of rows) {
      assert.equal(row.token_digest.length, 32, "token_digest harus 32 byte");
      assert.equal(
        Buffer.from(row.token_digest).toString("utf8").includes(adminToken) ||
          Buffer.from(row.token_digest).toString("utf8").includes(cashierToken),
        false,
        "token mentah tidak boleh tersimpan",
      );
    }
  } finally {
    sessionDb.close();
  }
  record("AC-01.01", "ADMIN & CASHIER fixture login; /auth/me mengembalikan role backend; sesi menyimpan digest 32 byte, bukan token mentah");

  // Pergantian role: logout CASHIER -> token lama 401 -> login ADMIN masih valid.
  const cashierLogout = await call(baseUrl, "/auth/logout", {
    method: "POST",
    token: cashierToken,
  });
  assert.equal(cashierLogout.status, 200);
  assert.equal((await call(baseUrl, "/auth/me", { token: cashierToken })).status, 401);
  assert.equal((await call(baseUrl, "/auth/me", { token: adminToken })).status, 200);
  const cashierLogin2 = await call(baseUrl, "/auth/login", {
    method: "POST",
    body: { username: cashierUsername, password: cashierPassword },
  });
  assert.equal(cashierLogin2.status, 200);
  assert.equal(dataOf(cashierLogin2)?.user?.role, "CASHIER");
  const cashierToken2 = dataOf(cashierLogin2)?.token;
  const soreLogin = await call(baseUrl, "/auth/login", {
    method: "POST",
    body: { username: soreUsername, password: sorePassword },
  });
  assert.equal(soreLogin.status, 200, "kasir pemilik shift aktif harus dapat login");
  assert.equal(dataOf(soreLogin)?.user?.role, "CASHIER");
  const soreToken = dataOf(soreLogin)?.token;
  record("AC-01.01", "Pergantian role lewat logout/login: sesi CASHIER lama dicabut, sesi ADMIN tetap valid, role CASHIER kembali dari backend");

  // ---------------------------------------------------------------------------
  // AC-01.02 — sandi salah, akun nonaktif, username tak dikenal: generik, tanpa sesi.
  // ---------------------------------------------------------------------------
  const sessionsBeforeFailures = counts(["sessions"]).sessions;

  const wrongPassword = await call(baseUrl, "/auth/login", {
    method: "POST",
    body: { username: adminUsername, password: `${adminPassword}-salah` },
  });
  assert.equal(wrongPassword.status, 401);
  assert.equal(errorCode(wrongPassword), "INVALID_CREDENTIALS");
  assert.match(errorMessage(wrongPassword), /Nama pengguna atau kata sandi salah/);
  assert.equal(wrongPassword.rawText.includes(`${adminPassword}-salah`), false);

  const unknownUser = await call(baseUrl, "/auth/login", {
    method: "POST",
    body: { username: "tidak.ada.t13", password: `${adminPassword}-salah` },
  });
  assert.equal(unknownUser.status, 401);
  assert.equal(errorCode(unknownUser), "INVALID_CREDENTIALS");
  assert.equal(errorMessage(unknownUser), errorMessage(wrongPassword));

  const inactiveUser = await call(baseUrl, "/auth/login", {
    method: "POST",
    body: { username: inactiveUsername, password: inactivePassword },
  });
  assert.equal(inactiveUser.status, 401, "akun nonaktif tidak boleh mendapat sesi");
  assert.equal(errorCode(inactiveUser), "INVALID_CREDENTIALS");
  assert.equal(errorMessage(inactiveUser), errorMessage(wrongPassword));

  assert.equal(
    counts(["sessions"]).sessions,
    sessionsBeforeFailures,
    "login gagal tidak boleh membuat sesi",
  );

  // Brute force pada server nyata: username unik, kegagalan berulang dibatasi 429 generik.
  const sprayUsername = "t13.spray.uji";
  const sprayStatuses = [];
  let rateLimited = null;
  for (let attempt = 0; attempt < 7 && rateLimited === null; attempt += 1) {
    const response = await call(baseUrl, "/auth/login", {
      method: "POST",
      body: { username: sprayUsername, password: "sandi-salah-t13" },
    });
    sprayStatuses.push(response.status);
    if (response.status === 429) {
      rateLimited = response;
    } else {
      assert.equal(response.status, 401, "selama di bawah batas harus 401 generik");
      assert.equal(errorCode(response), "INVALID_CREDENTIALS");
    }
  }
  assert.ok(rateLimited, "server nyata harus membatasi percobaan login berulang");
  assert.equal(errorCode(rateLimited), "LOGIN_RATE_LIMITED");
  assert.match(errorMessage(rateLimited), /Terlalu banyak percobaan login/);
  assert.equal(errorMessage(rateLimited).includes(sprayUsername), false);
  const sprayDb = new DatabaseSync(dbPath, { readOnly: true });
  let spraySessionCount;
  try {
    spraySessionCount = Number(
      sprayDb
        .prepare(
          "SELECT COUNT(*) AS total FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)",
        )
        .get(sprayUsername).total,
    );
  } finally {
    sprayDb.close();
  }
  assert.equal(spraySessionCount, 0, "username yang dibatasi tidak boleh punya sesi");
  record(
    "AC-01.02",
    `Sandi salah, akun nonaktif (sandi benar), dan username tak dikenal: 401 generik identik, tanpa sesi baru, tidak membocorkan status akun; brute force ${sprayStatuses.filter((status) => status === 401).length}x gagal lalu 429 LOGIN_RATE_LIMITED generik tanpa sesi`,
  );

  // ---------------------------------------------------------------------------
  // AC-01.03 — CASHIER ditolak backend pada operasi ADMIN; tanpa token 401.
  // ---------------------------------------------------------------------------
  const protectedTables = ["users", "products", "product_barcodes", "categories", "suppliers", "audit_log", "sessions"];
  const beforeDenied = counts(protectedTables);

  const deniedList = await call(baseUrl, "/users", { token: cashierToken2 });
  assert.equal(deniedList.status, 403);
  assert.equal(errorCode(deniedList), "FORBIDDEN");

  const deniedCreateUser = await call(baseUrl, "/users", {
    method: "POST",
    token: cashierToken2,
    body: { username: "kasir.tidak.boleh", password: newCashierPassword, role: "CASHIER" },
  });
  assert.equal(deniedCreateUser.status, 403);
  assert.equal(errorCode(deniedCreateUser), "FORBIDDEN");

  const deniedCreateCategory = await call(baseUrl, "/categories", {
    method: "POST",
    token: cashierToken2,
    body: { name: "Kategori Dilarang" },
  });
  assert.equal(deniedCreateCategory.status, 403);

  const deniedCreateProduct = await call(baseUrl, "/products", {
    method: "POST",
    token: cashierToken2,
    body: {
      categoryId: 1,
      sku: "DILARANG-001",
      name: "Produk Dilarang",
      priceRp: 1000,
      barcodes: [],
    },
  });
  assert.equal(deniedCreateProduct.status, 403);

  const deniedPatchProduct = await call(baseUrl, "/products/1", {
    method: "PATCH",
    token: cashierToken2,
    body: { priceRp: 1 },
  });
  assert.equal(deniedPatchProduct.status, 403);

  const deniedIncludeInactive = await call(baseUrl, "/products?includeInactive=true", {
    token: cashierToken2,
  });
  assert.equal(deniedIncludeInactive.status, 403);

  assert.equal((await call(baseUrl, "/products")).status, 401);
  assert.equal((await call(baseUrl, "/users")).status, 401);
  assert.equal((await call(baseUrl, "/auth/me")).status, 401);

  const afterDenied = counts(protectedTables);
  assert.deepEqual(afterDenied, beforeDenied, "403/401 tidak boleh mengubah tabel terlindungi");
  record("AC-01.03", "CASHIER 403 pada GET/POST /users, POST kategori/produk, PATCH produk, includeInactive; tanpa token 401; tidak ada perubahan DB/audit/sesi");

  // ---------------------------------------------------------------------------
  // AC-01.04 — ADMIN membuat lalu menonaktifkan akun; akses dicabut; audit tercatat.
  // ---------------------------------------------------------------------------
  const created = await call(baseUrl, "/users", {
    method: "POST",
    token: adminToken,
    body: {
      username: newCashierUsername,
      password: newCashierPassword,
      role: "CASHIER",
    },
  });
  assert.equal(created.status, 201);
  const newCashierId = dataOf(created)?.id;
  assert.equal(Number.isSafeInteger(newCashierId), true);
  assert.equal(dataOf(created)?.active, true);
  assert.equal(dataOf(created)?.role, "CASHIER");

  const newCashierLogin = await call(baseUrl, "/auth/login", {
    method: "POST",
    body: { username: newCashierUsername, password: newCashierPassword },
  });
  assert.equal(newCashierLogin.status, 200, "akun baru harus dapat login");
  const newCashierToken = dataOf(newCashierLogin)?.token;

  const disabled = await call(baseUrl, `/users/${newCashierId}`, {
    method: "PATCH",
    token: adminToken,
    body: { active: false },
  });
  assert.equal(disabled.status, 200);
  assert.equal(dataOf(disabled)?.active, false);

  assert.equal((await call(baseUrl, "/auth/me", { token: newCashierToken })).status, 401);
  const disabledLogin = await call(baseUrl, "/auth/login", {
    method: "POST",
    body: { username: newCashierUsername, password: newCashierPassword },
  });
  assert.equal(disabledLogin.status, 401);
  assert.equal(errorCode(disabledLogin), "INVALID_CREDENTIALS");
  assert.equal(errorMessage(disabledLogin), errorMessage(wrongPassword));

  const auditsAfterAccountOps = auditRows();
  const accountAudits = auditsAfterAccountOps.filter((row) =>
    ["ACCOUNT_CREATED", "ACCOUNT_DISABLED"].includes(String(row.action)),
  );
  assert.ok(
    accountAudits.some((row) => String(row.action) === "ACCOUNT_CREATED" && Number(row.entity_id) === newCashierId),
    "ACCOUNT_CREATED untuk akun baru harus tercatat",
  );
  assert.ok(
    accountAudits.some((row) => String(row.action) === "ACCOUNT_DISABLED" && Number(row.entity_id) === newCashierId),
    "ACCOUNT_DISABLED untuk akun baru harus tercatat",
  );
  for (const row of accountAudits) {
    assert.ok(Number(row.actor_id) > 0);
    assert.ok(Number(row.created_at_ms) > 0);
  }
  const auditBlob = JSON.stringify(auditsAfterAccountOps);
  for (const secret of [
    adminPassword,
    cashierPassword,
    sorePassword,
    inactivePassword,
    newCashierPassword,
    adminToken,
    cashierToken2,
    goTokenSafe(soreToken),
    goTokenSafe(newCashierToken),
    "scrypt$",
  ]) {
    assert.equal(auditBlob.includes(secret), false, "audit tidak boleh memuat rahasia");
  }
  record("AC-01.04", "ADMIN membuat akun CASHIER, akun dapat login; setelah dinonaktifkan sesi lama 401 dan login ditolak generik; ACCOUNT_CREATED/ACCOUNT_DISABLED tercatat dengan pelaku+waktu tanpa rahasia");

  // ---------------------------------------------------------------------------
  // AC-02.01 — master produk valid + relasi; relasi tidak ada ditolak.
  // ---------------------------------------------------------------------------
  const category = await call(baseUrl, "/categories", {
    method: "POST",
    token: adminToken,
    body: { name: "Kategori T13" },
  });
  assert.equal(category.status, 201);
  const categoryId = dataOf(category)?.id;

  const supplier = await call(baseUrl, "/suppliers", {
    method: "POST",
    token: adminToken,
    body: { name: "Supplier T13" },
  });
  assert.equal(supplier.status, 201);
  const supplierId = dataOf(supplier)?.id;

  const product = await call(baseUrl, "/products", {
    method: "POST",
    token: adminToken,
    body: {
      categoryId,
      sku: "T13-001",
      name: "Produk T13 Uji",
      priceRp: 8000,
      barcodes: ["000777"],
      supplierIds: [supplierId],
    },
  });
  assert.equal(product.status, 201);
  const productId = dataOf(product)?.id;
  assert.equal(dataOf(product)?.sku, "T13-001");
  assert.deepEqual(dataOf(product)?.barcodes, ["000777"]);
  assert.deepEqual(dataOf(product)?.supplierIds, [supplierId]);
  assert.equal(dataOf(product)?.stockOnHand, 0);

  const cashierSearch = await call(baseUrl, "/products?query=Produk%20T13", {
    token: cashierToken2,
  });
  assert.equal(cashierSearch.status, 200);
  assert.equal(dataOf(cashierSearch).length, 1);
  assert.equal(dataOf(cashierSearch)[0]?.id, productId);

  const cashierScanNew = await call(baseUrl, "/products?barcode=000777", {
    token: cashierToken2,
  });
  assert.equal(cashierScanNew.status, 200);
  assert.equal(dataOf(cashierScanNew).length, 1);
  record("AC-02.01", "ADMIN membuat kategori/supplier/produk valid; CASHIER menemukan produk via pencarian manual dan barcode");

  const productsBeforeInvalidRelation = counts(["products"]).products;
  const badCategory = await call(baseUrl, "/products", {
    method: "POST",
    token: adminToken,
    body: {
      categoryId: 999999,
      sku: "T13-BADCAT",
      name: "Kategori Tidak Ada",
      priceRp: 1000,
      barcodes: [],
    },
  });
  assert.equal(badCategory.status, 422);
  assert.equal(errorCode(badCategory), "VALIDATION_ERROR");

  const badSupplier = await call(baseUrl, "/products", {
    method: "POST",
    token: adminToken,
    body: {
      categoryId,
      sku: "T13-BADSUP",
      name: "Supplier Tidak Ada",
      priceRp: 1000,
      barcodes: [],
      supplierIds: [999999],
    },
  });
  assert.equal(badSupplier.status, 422);
  assert.equal(errorCode(badSupplier), "VALIDATION_ERROR");
  assert.equal(counts(["products"]).products, productsBeforeInvalidRelation);
  record("AC-02.01", "Relasi kategori/supplier yang tidak ada ditolak 422 tanpa baris produk baru");

  // ---------------------------------------------------------------------------
  // AC-02.02 — barcode ganda ditolak; scan tetap ke produk pertama.
  // ---------------------------------------------------------------------------
  const productsBeforeDuplicate = counts(["products"]).products;
  const barcodeBefore = counts(["product_barcodes"]).product_barcodes;
  const duplicate = await call(baseUrl, "/products", {
    method: "POST",
    token: adminToken,
    body: {
      categoryId: 1,
      sku: "T13-DUP",
      name: "Produk Barcode Ganda",
      priceRp: 1000,
      barcodes: ["0000000000017"], // barcode fixture produk 1
    },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(errorCode(duplicate), "DUPLICATE_BARCODE");
  assert.equal(counts(["products"]).products, productsBeforeDuplicate);
  assert.equal(counts(["product_barcodes"]).product_barcodes, barcodeBefore);

  const duplicateInRequest = await call(baseUrl, "/products", {
    method: "POST",
    token: adminToken,
    body: {
      categoryId: 1,
      sku: "T13-DUP2",
      name: "Barcode Ganda Dalam Permintaan",
      priceRp: 1000,
      barcodes: ["000888", "000888"],
    },
  });
  assert.equal(duplicateInRequest.status, 422);
  assert.equal(counts(["products"]).products, productsBeforeDuplicate);

  const scanFixture = await call(baseUrl, "/products?barcode=0000000000017", {
    token: cashierToken2,
  });
  assert.equal(scanFixture.status, 200);
  assert.equal(dataOf(scanFixture).length, 1);
  assert.equal(dataOf(scanFixture)[0]?.sku, "DEMO-001");
  record("AC-02.02", "Barcode fixture 0000000000017 dan barcode ganda dalam satu permintaan ditolak (409/422) tanpa baris baru; scan 0000000000017 tetap ke DEMO-001");

  // ---------------------------------------------------------------------------
  // AC-02.03 — harga master berubah; snapshot penjualan lama tetap; audit harga.
  // ---------------------------------------------------------------------------
  assert.equal(Number(expectedSaleItem303.unitPriceRp), 5000, "fixture sale item 303 = Rp5.000");
  const priceUpdate = await call(baseUrl, "/products/8", {
    method: "PATCH",
    token: adminToken,
    body: { priceRp: 6500 },
  });
  assert.equal(priceUpdate.status, 200);
  assert.equal(dataOf(priceUpdate)?.priceRp, 6500);

  const cashierNewPrice = await call(baseUrl, "/products?barcode=0000000000089", {
    token: cashierToken2,
  });
  assert.equal(cashierNewPrice.status, 200);
  assert.equal(dataOf(cashierNewPrice).length, 1);
  assert.equal(dataOf(cashierNewPrice)[0]?.priceRp, 6500);

  const saleDb = new DatabaseSync(dbPath, { readOnly: true });
  let saleItemAfter;
  let priceAuditRow;
  try {
    saleItemAfter = saleDb
      .prepare(
        "SELECT unit_price_rp AS unitPriceRp, line_total_rp AS lineTotalRp FROM sale_items WHERE id = 303",
      )
      .get();
    priceAuditRow = saleDb
      .prepare("SELECT details FROM audit_log WHERE action = 'PRICE_CHANGED' ORDER BY id DESC LIMIT 1")
      .get();
  } finally {
    saleDb.close();
  }
  assert.equal(Number(saleItemAfter.unitPriceRp), 5000, "snapshot harga sale lama tidak boleh berubah");
  assert.equal(Number(saleItemAfter.lineTotalRp), 5000);
  assert.ok(priceAuditRow, "audit PRICE_CHANGED harus ada");
  const priceDetails = JSON.parse(priceAuditRow.details);
  assert.equal(priceDetails.sku, "QA-HARGA-UBAH");
  assert.equal(priceDetails.oldPriceRp, 6000);
  assert.equal(priceDetails.newPriceRp, 6500);
  record("AC-02.03", "Harga QA-HARGA-UBAH 6000→6500 terlihat untuk keranjang baru; snapshot sale_items 303 tetap 5000; audit PRICE_CHANGED mencatat SKU/harga lama/baru");

  const priceBeforeInvalid = await call(baseUrl, "/products?barcode=0000000000089", {
    token: cashierToken2,
  });
  for (const invalidPrice of [-100, 1.5, "7000"]) {
    const invalid = await call(baseUrl, "/products/8", {
      method: "PATCH",
      token: adminToken,
      body: { priceRp: invalidPrice },
    });
    assert.equal(invalid.status, 422, `harga ${JSON.stringify(invalidPrice)} harus 422`);
    assert.equal(errorCode(invalid), "VALIDATION_ERROR");
  }
  const priceAfterInvalid = await call(baseUrl, "/products?barcode=0000000000089", {
    token: cashierToken2,
  });
  assert.deepEqual(dataOf(priceAfterInvalid), dataOf(priceBeforeInvalid));
  record("AC-02.03", "Harga invalid (-100, 1.5, string \"7000\") ditolak 422 dan harga master tidak berubah");

  // ---------------------------------------------------------------------------
  // AC-03.01 — barcode valid, tak dikenal, dan pencarian manual.
  // Memakai pemilik shift AKTIF (demo.kasir.sore / shift 102) agar premis
  // "shift sendiri aktif" pada AC terpenuhi, bukan hanya akun CASHIER mana pun.
  // ---------------------------------------------------------------------------
  const shiftDb = new DatabaseSync(dbPath, { readOnly: true });
  let activeShift;
  try {
    const soreUserId = Number(
      shiftDb.prepare("SELECT id FROM users WHERE username = ?").get(soreUsername).id,
    );
    activeShift = shiftDb
      .prepare(
        "SELECT id, cashier_id AS cashierId, opened_at_ms AS openedAtMs FROM shifts WHERE closed_at_ms IS NULL",
      )
      .all()
      .map((row) => ({ ...row }));
    assert.equal(activeShift.length, 1, "fixture harus punya tepat satu shift aktif");
    assert.equal(Number(activeShift[0].cashierId), soreUserId, "shift aktif milik kasir yang login");
  } finally {
    shiftDb.close();
  }
  record(
    "AC-03.01",
    `Login pemilik shift aktif (shift ${activeShift[0].id}); premis "shift sendiri aktif" terpenuhi`,
  );

  const mutationsBeforeLookup = counts(["sales", "payments", "inventory_movements"]);

  const validScan = await call(baseUrl, "/products?barcode=0000000000017", {
    token: soreToken,
  });
  assert.equal(validScan.status, 200);
  assert.equal(dataOf(validScan).length, 1);
  assert.equal(dataOf(validScan)[0]?.sku, "DEMO-001");
  assert.equal(dataOf(validScan)[0]?.priceRp, 3000);
  assert.equal(dataOf(validScan)[0]?.stockOnHand, 22);

  const unknownScan = await call(baseUrl, "/products?barcode=9999999999999", {
    token: soreToken,
  });
  assert.equal(unknownScan.status, 200, "barcode tak dikenal bukan error server");
  assert.deepEqual(dataOf(unknownScan), []);

  const partialBarcode = await call(baseUrl, "/products?barcode=000000000001", {
    token: soreToken,
  });
  assert.equal(partialBarcode.status, 200);
  assert.deepEqual(dataOf(partialBarcode), []);

  const manualSearch = await call(baseUrl, "/products?query=Air%20Mineral", {
    token: soreToken,
  });
  assert.equal(manualSearch.status, 200);
  assert.ok(dataOf(manualSearch).some((row) => row.sku === "DEMO-001"));

  const invalidBarcode = await call(baseUrl, "/products?barcode=000%20123", {
    token: soreToken,
  });
  assert.equal(invalidBarcode.status, 422);
  assert.equal(errorCode(invalidBarcode), "VALIDATION_ERROR");

  assert.deepEqual(
    counts(["sales", "payments", "inventory_movements"]),
    mutationsBeforeLookup,
    "scan/cari tidak boleh membuat mutasi",
  );
  record("AC-03.01", "Scan barcode valid menemukan DEMO-001; barcode tak dikenal/parsial tidak menambah hasil; pencarian manual tetap tersedia; barcode berspasi 422; tidak ada mutasi penjualan/stok");

  // ---------------------------------------------------------------------------
  // AC-03.07 — batal draft tidak membuat sale/payment/mutasi.
  // ---------------------------------------------------------------------------
  const mutationsBeforeCancel = counts(["sales", "sale_items", "payments", "inventory_movements"]);
  for (const path of ["/sales", "/checkout/prepare", "/checkout/commit"]) {
    const notFound = await call(baseUrl, path, { method: "POST", token: soreToken, body: {} });
    assert.equal(notFound.status, 404, `${path} belum ada di baseline ini`);
  }
  const stockAfter = snapshotStockBalances();
  const stockById = new Map(stockAfter.map((row) => [row.productId, row.onHand]));
  for (const expected of expectedStock) {
    assert.equal(
      stockById.get(expected.productId),
      expected.onHand,
      `saldo produk fixture ${expected.productId} tidak boleh berubah`,
    );
  }
  assert.equal(stockById.get(productId), 0, "produk baru tanpa mutasi harus bersaldo 0");
  assert.deepEqual(
    counts(["sales", "sale_items", "payments", "inventory_movements"]),
    mutationsBeforeCancel,
    "batal draft tidak boleh membuat transaksi/mutasi",
  );
  record("AC-03.07", "Tidak ada endpoint checkout/sale pada baseline; saldo stok & tabel sale/payment/mutasi identik dengan fixture (draft/batal hanya di memori UI)");

  // ---------------------------------------------------------------------------
  // Ringkasan bukti SQLite + audit.
  // ---------------------------------------------------------------------------
  const finalCounts = counts([
    "users",
    "sessions",
    "categories",
    "suppliers",
    "products",
    "product_barcodes",
    "sales",
    "sale_items",
    "payments",
    "inventory_movements",
    "audit_log",
  ]);
  const integrityDb = new DatabaseSync(dbPath, { readOnly: true });
  let integrity;
  let foreignKeyViolations;
  try {
    integrity = integrityDb
      .prepare("PRAGMA integrity_check")
      .all()
      .map((row) => row.integrity_check)
      .join("; ");
    foreignKeyViolations = integrityDb.prepare("PRAGMA foreign_key_check").all().length;
  } finally {
    integrityDb.close();
  }
  assert.equal(integrity, "ok");
  assert.equal(foreignKeyViolations, 0);

  const auditSummary = auditRows().map((row) => ({
    actorId: Number(row.actor_id),
    action: String(row.action),
    entityType: String(row.entity_type),
    entityId: Number(row.entity_id),
    createdAtMs: Number(row.created_at_ms),
  }));

  const git = gitInfo();
  const evidence = {
    task: "TASK-013",
    generatedAtIso: new Date().toISOString(),
    environment: {
      os: `${process.platform} ${osRelease()} (${process.arch})`,
      node: process.version,
      commit: git.commit,
      branch: git.branch,
      dataMode: "DEMO/QA synthetic (TASK-006 fixture qa-synthetic-v1)",
    },
    paths: {
      fixtureDb,
      sessionDb: dbPath,
      kept: keepDb,
    },
    fixtureResetOutput,
    fixtureVerifyOutput,
    fixtureUsersWithTemporaryPasswords: changedUsers,
    activeShift: activeShift[0]
      ? {
          id: Number(activeShift[0].id),
          cashierId: Number(activeShift[0].cashierId),
          openedAtMs: Number(activeShift[0].openedAtMs),
          owner: soreUsername,
        }
      : null,
    loginRateLimit: {
      username: sprayUsername,
      statuses: sprayStatuses,
      blocked: rateLimited !== null,
    },
    results,
    finalCounts,
    integrity,
    foreignKeyViolations,
    audit: auditSummary,
    priceSnapshot: {
      productId: 8,
      masterPriceRp: 6500,
      saleItemId: 303,
      saleUnitPriceRp: Number(saleItemAfter.unitPriceRp),
      saleLineTotalRp: Number(saleItemAfter.lineTotalRp),
    },
    stockBalances: stockAfter,
  };

  if (jsonOut) {
    writeFileSync(jsonOut, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(`\nBukti JSON: ${jsonOut}`);
  } else {
    console.log("\nEVIDENCE_JSON_START");
    console.log(JSON.stringify(evidence, null, 2));
    console.log("EVIDENCE_JSON_END");
  }

  console.log(`\nPASS total ${passCount} pemeriksaan E2E integrasi (TASK-013).`);
}

/** Hindari token kosong di daftar rahasia (jika login gagal sebelum token ada). */
function goTokenSafe(token) {
  return typeof token === "string" && token.length > 0 ? token : "TOKEN_TIDAK_TERSEDIA";
}

function checkpointSessionDb() {
  try {
    const db = new DatabaseSync(dbPath);
    try {
      db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    } finally {
      db.close();
    }
  } catch {
    // DB mungkin masih terkunci; bukti JSON sudah ditulis.
  }
}

try {
  await main();
} catch (error) {
  console.error(`\nFAIL: ${error instanceof Error ? error.message : String(error)}`);
  console.error(error instanceof Error ? error.stack : "");
  process.exitCode = 1;
} finally {
  await stopServer();
  checkpointSessionDb();
  if (!keepDb) {
    for (const dir of [sessionDir, fixtureDir]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Folder temp bisa dikunci sebentar di Windows; tidak memengaruhi hasil.
      }
    }
  } else {
    console.log(`\nDB sesi disimpan (--keep-db): ${dbPath}`);
    console.log(`DB fixture disimpan (--keep-db): ${fixtureDb}`);
  }
}
