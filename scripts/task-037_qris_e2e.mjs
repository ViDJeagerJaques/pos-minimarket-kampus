#!/usr/bin/env node
/**
 * TASK-037 E2E API nyata: QRIS manual, verifikasi kasir, audit sesi, retry,
 * dan laporan terpisah dari kas. SQLite sementara + server loopback nyata.
 * Jalankan: node scripts/task-037_qris_e2e.mjs
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = join(root, "backend");
const tempDir = mkdtempSync(join(tmpdir(), "pos-task037-e2e-"));
const dbPath = join(tempDir, "task037.sqlite");
const adminPassword = `adm-${randomBytes(12).toString("hex")}`;
const cashierPassword = `ksr-${randomBytes(12).toString("hex")}`;
const adminUsername = "admin.qris.e2e";
const cashierUsername = "kasir.qris.e2e";
let server = null;
let passCount = 0;
let productId = 0;

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
    throw new Error(`Perintah gagal (${args[0]}): ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function waitForServerStart(child) {
  return new Promise((resolveUrl, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Server tidak siap dalam 15 detik.")), 15_000);
    const finish = (error, url) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolveUrl(url);
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/Server DEMO berjalan di (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) finish(null, match[1]);
    });
    child.once("error", (error) => finish(error));
    child.once("exit", (code) => finish(new Error(`Server berhenti (exit ${code}).`)));
  });
}

async function startServer() {
  // Port 0: backend memilih port bebas sendiri; tidak ada port yang dilepas
  // sebelum di-bind (menghindari race dengan proses lain).
  server = spawn(process.execPath, ["src/http/cli.ts", "serve", "--db", dbPath, "--port", "0"], {
    cwd: backendDir,
    env: { ...process.env, POS_DB_PATH: dbPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.setEncoding("utf8");
  server.stderr.on("data", () => {});
  return waitForServerStart(server);
}

async function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exited = once(server, "exit").catch(() => undefined);
  server.kill();
  await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
  if (server.exitCode === null && server.signalCode === null) {
    server.kill("SIGKILL");
    await exited;
  }
}

async function call(base, path, options = {}) {
  const headers = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  const response = await fetch(`${base}/api/v1${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { status: response.status, json: text.length > 0 ? JSON.parse(text) : null };
}

function dataOf(result) {
  return result.json?.data;
}

function openDb(readOnly = true) {
  return new DatabaseSync(dbPath, readOnly ? { readOnly: true } : {});
}

function count(table) {
  const db = openDb();
  try {
    const row = db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get();
    return Number(row.total);
  } finally {
    db.close();
  }
}

async function main() {
  runNode(["db/src/cli.ts", "migrate", "--db", dbPath]);
  runNode(
    ["src/auth/cli.ts", "bootstrap-admin", "--username", adminUsername, "--db", dbPath],
    { POS_BOOTSTRAP_PASSWORD: adminPassword },
  );
  const base = await startServer();
  pass(`Migrasi SQLite sementara dan server loopback ${base}`);

  const adminLogin = await call(base, "/auth/login", {
    method: "POST",
    body: { username: adminUsername, password: adminPassword },
  });
  assert.equal(adminLogin.status, 200);
  const adminToken = dataOf(adminLogin).token;
  const created = await call(base, "/users", {
    method: "POST",
    token: adminToken,
    body: { username: cashierUsername, password: cashierPassword, role: "CASHIER" },
  });
  assert.equal(created.status, 201);
  const cashierLogin = await call(base, "/auth/login", {
    method: "POST",
    body: { username: cashierUsername, password: cashierPassword },
  });
  assert.equal(cashierLogin.status, 200);
  const cashierToken = dataOf(cashierLogin).token;
  pass("Login ADMIN dan CASHIER melalui backend nyata");

  const category = await call(base, "/categories", {
    method: "POST",
    token: adminToken,
    body: { name: "Kategori QRIS E2E" },
  });
  assert.equal(category.status, 201);
  const product = await call(base, "/products", {
    method: "POST",
    token: adminToken,
    body: {
      categoryId: dataOf(category).id,
      sku: "QRIS-E2E-001",
      name: "Produk QRIS E2E",
      priceRp: 5000,
      barcodes: ["000123"],
      supplierIds: [],
    },
  });
  assert.equal(product.status, 201);
  productId = dataOf(product).id;
  const db = openDb(false);
  try {
    db.prepare(
      `INSERT INTO inventory_movements (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
       VALUES (?, 'OPENING', 5, 'QRIS-E2E-OPEN', 1, ?)`,
    ).run(productId, Date.now());
  } finally {
    db.close();
  }
  pass("Produk sintetis dan stok awal 5 unit tersedia");

  const opened = await call(base, "/shifts/open", {
    method: "POST",
    token: cashierToken,
    body: {},
  });
  assert.equal(opened.status, 200);
  const shiftId = dataOf(opened).id;
  const userDb = openDb();
  let cashierRow;
  try {
    cashierRow = userDb.prepare("SELECT id FROM users WHERE username = ?").get(cashierUsername);
  } finally {
    userDb.close();
  }
  const cashierId = Number(cashierRow?.id);

  const attemptKey = `co_qris_e2e_${randomBytes(6).toString("hex")}`;
  const prepared = await call(base, "/checkouts/prepare", {
    method: "POST",
    token: cashierToken,
    body: {
      attemptKey,
      shiftId,
      items: [{ productId, quantity: 1 }],
      payment: { method: "QRIS_MANUAL" },
    },
  });
  assert.equal(prepared.status, 200);
  const requestHash = dataOf(prepared).requestHash;
  const pending = await call(base, `/checkouts/${attemptKey}`, { token: cashierToken });
  assert.equal(dataOf(pending).status, "PREPARED");
  assert.deepEqual(dataOf(pending).qrisVerification, { status: "pending" });
  assert.equal(count("sales"), 0);
  pass("QRIS PREPARED: status pending dan belum ada penjualan");

  const commit = (confirmation) =>
    call(base, "/checkouts/commit", {
      method: "POST",
      token: cashierToken,
      body: { attemptKey, requestHash, paymentConfirmation: confirmation },
    });

  const missing = await commit({ method: "QRIS_MANUAL", confirmedAmountRp: 5000 });
  assert.equal(missing.status, 422);
  const wrong = await commit({
    method: "QRIS_MANUAL",
    merchantConfirmed: true,
    confirmedAmountRp: 1000,
  });
  assert.equal(wrong.status, 422);
  assert.equal(count("sales"), 0);
  assert.equal(count("inventory_movements"), 1);
  pass("Tanpa konfirmasi dan nominal salah ditolak tanpa sale/mutasi");

  const confirmed = await commit({
    method: "QRIS_MANUAL",
    merchantConfirmed: true,
    confirmedAmountRp: 5000,
    evidenceRef: "REF-E2E-1",
  });
  assert.equal(confirmed.status, 200);
  const committed = dataOf(confirmed);
  assert.equal(committed.qrisVerification.status, "verified");
  assert.equal(committed.qrisVerification.verifiedBy, cashierId);
  assert.ok(committed.qrisVerification.verifiedAtMs > 0);
  assert.equal(count("sales"), 1);
  assert.equal(count("payments"), 1);
  assert.equal(count("inventory_movements"), 2);
  pass("Konfirmasi tepat: satu sale QRIS, satu mutasi, audit kasir/waktu dari sesi backend");

  const replay = await commit({
    method: "QRIS_MANUAL",
    merchantConfirmed: true,
    confirmedAmountRp: 5000,
    evidenceRef: "REF-E2E-1",
  });
  assert.equal(replay.status, 200);
  assert.equal(dataOf(replay).saleId, committed.saleId);
  assert.equal(count("sales"), 1);
  const lookup = await call(base, `/checkouts/${attemptKey}`, { token: cashierToken });
  assert.equal(dataOf(lookup).status, "COMMITTED");
  assert.equal(dataOf(lookup).qrisVerification.status, "verified");
  pass("Retry identik dan lookup status mengembalikan hasil asli (idempotent)");

  const deniedReport = await call(base, "/reports/payments", { token: cashierToken });
  assert.equal(deniedReport.status, 403);
  const report = await call(base, "/reports/payments", { token: adminToken });
  assert.equal(report.status, 200);
  assert.equal(dataOf(report).qrisManual.totalRp, 5000);
  assert.equal(dataOf(report).qrisManual.count, 1);
  assert.equal(dataOf(report).cash.totalRp, 0);
  assert.equal(dataOf(report).qrisSales[0]?.cashierUsername, cashierUsername);
  pass("Laporan QRIS terpisah dari kas; CASHIER ditolak 403");

  const auditDb = openDb();
  let auditActions;
  let auditDetails;
  try {
    auditActions = auditDb.prepare("SELECT action FROM audit_log ORDER BY id").all().map((r) => r.action);
    auditDetails = auditDb
      .prepare("SELECT details FROM audit_log WHERE action = 'QRIS_MANUAL_CONFIRMED'")
      .get();
  } finally {
    auditDb.close();
  }
  assert.equal(auditActions.filter((a) => a === "QRIS_MANUAL_CONFIRMED").length, 1);
  const details = JSON.parse(auditDetails.details);
  assert.equal(details.status, "verified");
  assert.equal(details.verifiedBy, cashierId);
  assert.equal(details.verifiedAtMs, committed.qrisVerification.verifiedAtMs);
  assert.equal(JSON.stringify(details).includes("REF-E2E-1"), false);
  pass("Audit QRIS_MANUAL_CONFIRMED tercatat sekali tanpa menyimpan referensi mentah/kredensial");
}

try {
  await main();
  console.log(`\nPASS total ${passCount} pemeriksaan E2E API nyata (TASK-037).`);
} catch (error) {
  console.error(`\nFAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await stopServer();
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Abaikan kunci file sementara di Windows.
  }
}
