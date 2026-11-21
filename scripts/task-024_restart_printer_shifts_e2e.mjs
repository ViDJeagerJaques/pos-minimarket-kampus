#!/usr/bin/env node
/**
 * TASK-024 E2E — restart, crash prepare/commit, printer gagal & cetak ulang,
 * dua shift, dan close bersamaan checkout. Backend nyata + SQLite sementara.
 *
 * Jalankan dari root repo:
 *   node scripts/task-024_restart_printer_shifts_e2e.mjs [--json-out <file>] [--keep-temp]
 *
 * Server utama = child process CLI (bisa di-SIGKILL/direstart sungguhan).
 * Skenario printer memakai server in-process dengan adapter gagal/virtual yang
 * disuntikkan lewat dependency injection (tetap HTTP nyata + SQLite yang sama).
 * Tidak memakai DB operasional; kata sandi/token hanya di memori proses.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { release as osRelease, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = join(root, "backend");
const tempDir = mkdtempSync(join(tmpdir(), "pos-task024-e2e-"));
const dbPath = join(tempDir, "task024.sqlite");

const { startHttpServer } = await import(pathToFileURL(join(backendDir, "src/http/app.ts")).href);
const { openDatabase } = await import(pathToFileURL(join(backendDir, "db/src/db.ts")).href);
const { createAuthService } = await import(pathToFileURL(join(backendDir, "src/auth/service.ts")).href);
const { createSessionStore } = await import(pathToFileURL(join(backendDir, "src/auth/session.ts")).href);
const { createCatalogService } = await import(pathToFileURL(join(backendDir, "src/catalog/service.ts")).href);
const { createSecurityLogger } = await import(pathToFileURL(join(backendDir, "src/security/securityLog.ts")).href);
const { createShiftService } = await import(pathToFileURL(join(backendDir, "src/shift/service.ts")).href);
const { createCheckoutService } = await import(pathToFileURL(join(backendDir, "src/checkout/service.ts")).href);
const { createPrintService } = await import(pathToFileURL(join(backendDir, "src/print/service.ts")).href);
const { createReportService } = await import(pathToFileURL(join(backendDir, "src/reports/service.ts")).href);
const { createReceivingService } = await import(pathToFileURL(join(backendDir, "src/receiving/service.ts")).href);
const { createAdjustmentService } = await import(pathToFileURL(join(backendDir, "src/inventory/adjustments.ts")).href);
const { createFailingPrinterAdapter, createVirtualPrinterAdapter } = await import(
  pathToFileURL(join(backendDir, "src/print/printer.ts")).href
);

const args = process.argv.slice(2);
const jsonOutIndex = args.indexOf("--json-out");
const jsonOut = jsonOutIndex >= 0 ? args[jsonOutIndex + 1] : null;
const keepTemp = args.includes("--keep-temp");

const runTag = randomBytes(5).toString("hex");
const adminUsername = "admin.t24.sintetis";
const cashierAUser = "kasir.t24.a";
const cashierBUser = "kasir.t24.b";
const adminPass = `adm-${randomBytes(12).toString("hex")}`;
const passA = `ksa-${randomBytes(12).toString("hex")}`;
const passB = `ksb-${randomBytes(12).toString("hex")}`;

let server = null; // child CLI
let inProcess = null; // { running, db }
let productId = 0;
let shiftA1 = 0;
let shiftA2 = 0;
let passCount = 0;
let lastCallIndex = 0;
let finalStatus = "RUNNING";
const calls = [];
const tests = [];
const keys = [];

function pass(ac, label, detail = {}) {
  passCount += 1;
  console.log(`PASS ${passCount}. [${ac}] ${label}`);
  tests.push({ no: passCount, ac, label, status: "PASS", ...detail });
}

function key(label) {
  const value = `t24_${runTag}_${label}_${keys.length + 1}`;
  keys.push({ key: value, label });
  return value;
}

function assertCall(result, expectedStatus, label) {
  assert.equal(
    result.status,
    expectedStatus,
    `${label}: status ${result.status}, code=${result.errorCode}, body=${result.rawText.slice(0, 300)}`,
  );
}

function runNode(args, extraEnv = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: backendDir,
    env: { ...process.env, POS_DB_PATH: dbPath, POS_DB_PROFILE: "test", ...extraEnv },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Perintah gagal (${args.slice(0, 3).join(" ")}): ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function openDb(readOnly = true) {
  return new DatabaseSync(dbPath, readOnly ? { readOnly: true } : {});
}

function count(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total);
}

function snapshot() {
  const db = openDb();
  try {
    const byKind = {};
    for (const row of db.prepare("SELECT kind, COALESCE(SUM(delta),0) AS total FROM inventory_movements GROUP BY kind").all()) {
      byKind[row.kind] = Number(row.total);
    }
    const stock = Number(db.prepare("SELECT on_hand FROM stock_balances WHERE product_id = ?").get(productId)?.on_hand ?? 0);
    const saleTotal = Number(db.prepare("SELECT COALESCE(SUM(total_rp),0) AS total FROM sales").get().total);
    const paymentTotal = Number(db.prepare("SELECT COALESCE(SUM(amount_rp),0) AS total FROM payments").get().total);
    const integrity = db.prepare("PRAGMA integrity_check").all().map((r) => r.integrity_check).join("; ");
    const fk = db.prepare("PRAGMA foreign_key_check").all().length;
    return {
      counts: {
        sales: count(db, "sales"), saleItems: count(db, "sale_items"), payments: count(db, "payments"),
        movements: count(db, "inventory_movements"), attempts: count(db, "checkout_attempts"),
        shifts: count(db, "shifts"), closings: count(db, "shift_closings"), audit: count(db, "audit_log"),
        activeShifts: Number(db.prepare("SELECT COUNT(*) AS total FROM shifts WHERE closed_at_ms IS NULL").get().total),
      },
      stock,
      saleTotalRp: saleTotal,
      paymentTotalRp: paymentTotal,
      saleNos: db.prepare("SELECT sale_no FROM sales ORDER BY id").all().map((r) => r.sale_no),
      ledger: byKind,
      integrity,
      fk,
      reconciled: integrity === "ok" && fk === 0 && saleTotal === paymentTotal && stock >= 0,
    };
  } finally {
    db.close();
  }
}

function core(s) {
  return { sales: s.counts.sales, payments: s.counts.payments, movements: s.counts.movements, stock: s.stock };
}

function deltaOf(before, after) {
  const b = core(before);
  const a = core(after);
  const out = {};
  for (const k of Object.keys(b)) out[k] = a[k] - b[k];
  return out;
}

const NO_CHANGE = { sales: 0, payments: 0, movements: 0, stock: 0 };
const ONE_SALE = { sales: 1, payments: 1, movements: 1, stock: -1 };

function record(ac, label, before, after, expectedDelta, extra = {}) {
  assert.equal(before.reconciled, true, `rekonsiliasi SEBELUM gagal: ${JSON.stringify(before)}`);
  assert.equal(after.reconciled, true, `rekonsiliasi SESUDAH gagal: ${JSON.stringify(after)}`);
  const actual = deltaOf(before, after);
  assert.deepEqual(actual, expectedDelta, `delta tak terduga untuk "${label}"`);
  const used = calls.slice(lastCallIndex);
  lastCallIndex = calls.length;
  pass(ac, label, {
    before, after, delta: actual,
    requestIds: used.map((c) => c.requestId).filter(Boolean),
    calls: used, ...extra,
  });
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
    const timer = setTimeout(() => reject(new Error("Server tidak siap dalam 15 detik.")), 15_000);
    const finish = (error, url) => { clearTimeout(timer); if (error) reject(error); else resolveUrl(url); };
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

async function startChild(port) {
  server = spawn(process.execPath, ["src/http/cli.ts", "serve", "--db", dbPath, "--port", String(port)], {
    cwd: backendDir, env: { ...process.env, POS_DB_PATH: dbPath, POS_DB_PROFILE: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.setEncoding("utf8");
  server.stderr.on("data", () => {});
  return waitForServerStart(server);
}

async function stopChild(hard = false) {
  if (!server || server.exitCode !== null) return;
  const exited = once(server, "exit").catch(() => undefined);
  server.kill(hard ? "SIGKILL" : undefined);
  await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

async function startInProcess(printerKind) {
  const db = openDatabase(dbPath);
  const sessions = createSessionStore(db, { secret: randomBytes(32), ttlMs: 12 * 60 * 60 * 1000 });
  const securityLog = createSecurityLogger({ sink: () => {} });
  const auth = createAuthService(db, { sessions, securityLog });
  const printer = printerKind === "fail" ? createFailingPrinterAdapter("T24-PRINTER-MATI-SIMULASI") : createVirtualPrinterAdapter();
  const running = await startHttpServer({
    auth, sessions, securityLog,
    catalog: createCatalogService(db),
    shift: createShiftService(db),
    checkout: createCheckoutService(db),
    reports: createReportService(db),
    receiving: createReceivingService(db),
    adjustments: createAdjustmentService(db),
    print: createPrintService(db, { printer }),
    port: await freeLoopbackPort(),
  });
  inProcess = { running, db };
  return running.url;
}

async function stopInProcess() {
  if (!inProcess) return;
  try { await inProcess.running.close(); } catch { /* ignore */ }
  try { inProcess.db.close(); } catch { /* ignore */ }
  inProcess = null;
}

async function call(base, path, options = {}) {
  const headers = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  const response = await fetch(`${base}/api/v1${path}`, {
    method: options.method ?? "GET", headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const rawText = await response.text();
  let json = null;
  try { json = rawText.length > 0 ? JSON.parse(rawText) : null; } catch { json = null; }
  const result = {
    status: response.status, json, rawText,
    data: json?.data ?? null,
    errorCode: json?.error?.code ?? null,
    requestId: json?.requestId ?? json?.error?.requestId ?? null,
  };
  calls.push({ label: options.label ?? `${options.method ?? "GET"} ${path}`, method: options.method ?? "GET", path, status: result.status, requestId: result.requestId, errorCode: result.errorCode });
  return result;
}

async function login(base, username, password, label) {
  const result = await call(base, "/auth/login", { method: "POST", body: { username, password }, label });
  assertCall(result, 200, label);
  return result.data.token;
}

async function prepare(base, token, shiftId, quantity, label, method = "CASH") {
  const attemptKey = key(label);
  const result = await call(base, "/checkouts/prepare", {
    method: "POST", token,
    body: { attemptKey, shiftId, items: [{ productId, quantity }], payment: { method } },
    label: `prepare:${label}`,
  });
  return { result, attemptKey };
}

async function commit(base, token, attemptKey, requestHash, confirmation, label) {
  return call(base, "/checkouts/commit", {
    method: "POST", token,
    body: { attemptKey, requestHash, paymentConfirmation: confirmation },
    label: `commit:${label}`,
  });
}

async function main() {
  // -------------------------------------------------------------------------
  // 0. Fixture + server child.
  // -------------------------------------------------------------------------
  runNode(["db/src/cli.ts", "migrate", "--db", dbPath]);
  runNode(["src/auth/cli.ts", "bootstrap-admin", "--username", adminUsername, "--db", dbPath], {
    POS_BOOTSTRAP_PASSWORD: adminPass,
  });
  let port = await freeLoopbackPort();
  let base = await startChild(port);
  const adminToken = await login(base, adminUsername, adminPass, "login ADMIN");
  for (const [username, password] of [[cashierAUser, passA], [cashierBUser, passB]]) {
    const created = await call(base, "/users", {
      method: "POST", token: adminToken,
      body: { username, password, role: "CASHIER" }, label: `buat ${username}`,
    });
    assertCall(created, 201, `buat ${username}`);
  }
  const category = await call(base, "/categories", {
    method: "POST", token: adminToken, body: { name: `T24 Kategori ${runTag}` }, label: "buat kategori",
  });
  assertCall(category, 201, "buat kategori");
  const product = await call(base, "/products", {
    method: "POST", token: adminToken,
    body: { categoryId: category.data.id, sku: "T24-PROD", name: "Produk TASK-024", priceRp: 5000, barcodes: ["000321"], supplierIds: [] },
    label: "buat produk",
  });
  assertCall(product, 201, "buat produk");
  productId = product.data.id;
  const seed = openDb(false);
  try {
    seed.prepare(`INSERT INTO inventory_movements (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms) VALUES (?, 'OPENING', 10, 'T24-OPEN', 1, ?)`).run(productId, Date.now());
  } finally { seed.close(); }
  const s0 = snapshot();
  assert.equal(s0.reconciled, true);
  lastCallIndex = calls.length;
  pass("SETUP", `SQLite sementara siap; baseline ${JSON.stringify(core(s0))}`, { baseline: s0 });

  // -------------------------------------------------------------------------
  // 1. AC-05.01 — dua buka shift paralel (kasir A), kasir B null, ADMIN 403.
  // -------------------------------------------------------------------------
  let tokenA = await login(base, cashierAUser, passA, "login kasir A");
  const tokenB = await login(base, cashierBUser, passB, "login kasir B");
  const beforeOpen = snapshot();
  const [open1, open2] = await Promise.all([
    call(base, "/shifts/open", { method: "POST", token: tokenA, body: { openingCashRp: 100000 }, label: "buka shift paralel 1" }),
    call(base, "/shifts/open", { method: "POST", token: tokenA, body: { openingCashRp: 100000 }, label: "buka shift paralel 2" }),
  ]);
  assert.equal([open1.status, open2.status].filter((s) => s === 200).length, 1);
  assert.equal([open1.status, open2.status].filter((s) => s === 409).length, 1);
  const currentA = await call(base, "/shifts/current", { token: tokenA, label: "shift kasir A" });
  assertCall(currentA, 200, "shift kasir A");
  shiftA1 = currentA.data.id;
  const openedAtMs = currentA.data.openedAtMs;
  const currentB = await call(base, "/shifts/current", { token: tokenB, label: "shift kasir B" });
  assertCall(currentB, 200, "shift kasir B");
  assert.equal(currentB.data, null);
  const adminOpen = await call(base, "/shifts/open", { method: "POST", token: adminToken, body: {}, label: "ADMIN buka shift" });
  assertCall(adminOpen, 403, "ADMIN buka shift");
  record("AC-05.01", "Dua buka paralel → tepat satu shift aktif; kasir B null; ADMIN 403", beforeOpen, snapshot(), NO_CHANGE, { shiftA1, openedAtMs });

  // -------------------------------------------------------------------------
  // 2. AC-05.02/04.01 — logout lalu login owner; restart child; shift utuh.
  // -------------------------------------------------------------------------
  const beforeRestarts = snapshot();
  const logout = await call(base, "/auth/logout", { method: "POST", token: tokenA, label: "logout kasir A" });
  assertCall(logout, 200, "logout kasir A");
  assert.equal((await call(base, "/auth/me", { token: tokenA, label: "token lama" })).status, 401);
  tokenA = await login(base, cashierAUser, passA, "login ulang kasir A setelah logout");
  const afterRelogin = await call(base, "/shifts/current", { token: tokenA, label: "shift setelah logout/login" });
  assertCall(afterRelogin, 200, "shift setelah logout/login");
  assert.equal(afterRelogin.data.id, shiftA1);
  assert.equal(afterRelogin.data.openedAtMs, openedAtMs);

  await stopChild(false); // restart terkendali
  port = await freeLoopbackPort();
  base = await startChild(port);
  tokenA = await login(base, cashierAUser, passA, "login ulang setelah restart child");
  const afterRestart = await call(base, "/shifts/current", { token: tokenA, label: "shift setelah restart" });
  assertCall(afterRestart, 200, "shift setelah restart");
  assert.equal(afterRestart.data.id, shiftA1);
  assert.equal(afterRestart.data.openedAtMs, openedAtMs);
  const otherAfter = await call(base, "/shifts/current", {
    token: await login(base, cashierBUser, passB, "login kasir B setelah restart"), label: "shift B setelah restart",
  });
  assertCall(otherAfter, 200, "shift B setelah restart");
  assert.equal(otherAfter.data, null);
  record("AC-05.02", "Logout→login ulang owner & restart child: shift ID/waktu tetap; token lama 401; kasir B tetap null", beforeRestarts, snapshot(), NO_CHANGE);

  // -------------------------------------------------------------------------
  // 3. AC-04.02 — SIGKILL sebelum commit (child sungguhan).
  // -------------------------------------------------------------------------
  const beforeKillA = snapshot();
  const pending = await prepare(base, tokenA, shiftA1, 1, "mati-sebelum-commit");
  assertCall(pending.result, 200, "prepare sebelum SIGKILL");
  assert.deepEqual(core(snapshot()), core(beforeKillA), "prepare tidak boleh membuat transaksi");
  await stopChild(true); // SIGKILL nyata, tanpa graceful shutdown
  const afterKill = snapshot();
  assert.deepEqual(core(afterKill), core(beforeKillA), "SIGKILL sebelum commit tidak boleh menyisakan data parsial");
  port = await freeLoopbackPort();
  base = await startChild(port);
  tokenA = await login(base, cashierAUser, passA, "login setelah SIGKILL A");
  const statusPrepared = await call(base, `/checkouts/${encodeURIComponent(pending.attemptKey)}`, { token: tokenA, label: "cek status PREPARED" });
  assertCall(statusPrepared, 200, "cek status PREPARED");
  assert.equal(statusPrepared.data.status, "PREPARED");
  const resumed = await commit(base, tokenA, pending.attemptKey, pending.result.data.requestHash, { method: "CASH", cashReceivedRp: 5000 }, "lanjut-setelah-SIGKILL");
  assertCall(resumed, 200, "lanjut commit setelah SIGKILL");
  record("AC-04.02", "SIGKILL sebelum commit: 0 data parsial; upaya PREPARED ditemukan; commit niat sama → 1 sale", beforeKillA, snapshot(), ONE_SALE, {
    attemptKey: pending.attemptKey, statusAfterRestart: statusPrepared.data.status,
  });

  // -------------------------------------------------------------------------
  // 4. AC-04.02 — SIGKILL sesudah commit sebelum hasil tampil.
  // -------------------------------------------------------------------------
  const beforeKillB = snapshot();
  const done = await prepare(base, tokenA, shiftA1, 1, "mati-sesudah-commit");
  assertCall(done.result, 200, "prepare sebelum commit lalu mati");
  const committed = await commit(base, tokenA, done.attemptKey, done.result.data.requestHash, { method: "CASH", cashReceivedRp: 5000 }, "commit-lalu-SIGKILL");
  assertCall(committed, 200, "commit lalu SIGKILL");
  const afterDone = snapshot();
  await stopChild(true);
  port = await freeLoopbackPort();
  base = await startChild(port);
  tokenA = await login(base, cashierAUser, passA, "login setelah SIGKILL B");
  const statusCommitted = await call(base, `/checkouts/${encodeURIComponent(done.attemptKey)}`, { token: tokenA, label: "cek status COMMITTED" });
  assertCall(statusCommitted, 200, "cek status COMMITTED");
  assert.equal(statusCommitted.data.status, "COMMITTED");
  assert.equal(statusCommitted.data.saleId, committed.data.saleId);
  assert.deepEqual(core(snapshot()), core(afterDone), "restart tidak boleh menambah sale");
  record("AC-04.02", "SIGKILL setelah commit: status COMMITTED & saleId sama ditemukan; tanpa penagihan/penjualan ulang", beforeKillB, snapshot(), ONE_SALE, {
    attemptKey: done.attemptKey, saleId: committed.data.saleId, saleNo: committed.data.saleNo,
  });

  // -------------------------------------------------------------------------
  // 5. AC-04.03 — printer gagal (adapter disuntik) lalu cetak ulang.
  // -------------------------------------------------------------------------
  const beforePrint = snapshot();
  await stopChild(false);
  const failBase = await startInProcess("fail");
  const printToken = await login(failBase, cashierAUser, passA, "login untuk printer gagal");
  const saleId = committed.data.saleId;
  const receiptView = await call(failBase, `/sales/${saleId}/receipt`, { token: printToken, label: "baca struk" });
  assertCall(receiptView, 200, "baca struk");
  const failedPrint = await call(failBase, `/sales/${saleId}/print`, { method: "POST", token: printToken, body: {}, label: "cetak saat printer mati" });
  assertCall(failedPrint, 503, "cetak saat printer mati");
  assert.equal(failedPrint.errorCode, "PRINTER_UNAVAILABLE");
  assert.deepEqual(core(snapshot()), core(beforePrint), "gagal cetak tidak boleh mengubah sale/stok");
  await stopInProcess();

  const virtualBase = await startInProcess("virtual");
  const reprintToken = await login(virtualBase, cashierAUser, passA, "login untuk cetak ulang");
  const print1 = await call(virtualBase, `/sales/${saleId}/print`, { method: "POST", token: reprintToken, body: {}, label: "cetak ulang 1" });
  assertCall(print1, 200, "cetak ulang 1");
  const print2 = await call(virtualBase, `/sales/${saleId}/print`, { method: "POST", token: reprintToken, body: {}, label: "cetak ulang 2" });
  assertCall(print2, 200, "cetak ulang 2");
  assert.equal(print1.data.saleNo, print2.data.saleNo);
  assert.equal(print1.data.saleNo, committed.data.saleNo);
  assert.equal(print1.data.text, print2.data.text);
  const afterPrint = snapshot();
  assert.deepEqual(core(afterPrint), core(beforePrint), "cetak ulang tidak boleh menambah sale/mutasi");
  // Hak akses cetak: kasir lain & ADMIN ditolak; baca struk ADMIN diizinkan.
  const otherPrint = await call(virtualBase, `/sales/${saleId}/print`, {
    method: "POST", token: await login(virtualBase, cashierBUser, passB, "login kasir B untuk cetak"), body: {}, label: "kasir B cetak",
  });
  assertCall(otherPrint, 403, "kasir B cetak");
  await stopInProcess();
  port = await freeLoopbackPort();
  base = await startChild(port);
  tokenA = await login(base, cashierAUser, passA, "login setelah skenario printer");
  record("AC-04.03", "Printer gagal → 503 PRINTER_UNAVAILABLE tanpa mutasi; cetak ulang 2× saleNo/teks identik; kasir lain 403", beforePrint, afterPrint, NO_CHANGE, {
    saleNo: print1.data.saleNo, failedCode: failedPrint.errorCode,
  });

  // -------------------------------------------------------------------------
  // 6. AC-06.01/06.03 — tutup shift 1 dengan rekap & idempotensi.
  // -------------------------------------------------------------------------
  const beforeClose1 = snapshot();
  const preview = await call(base, `/shifts/${shiftA1}/close/preview`, { token: tokenA, label: "preview tutup shift 1" });
  assertCall(preview, 200, "preview tutup shift 1");
  const closeBody = { closeKey: key("close-1"), declaredCashRp: preview.data.expectedCashRp };
  const close1 = await call(base, `/shifts/${shiftA1}/close`, { method: "POST", token: tokenA, body: closeBody, label: "tutup shift 1" });
  assertCall(close1, 200, "tutup shift 1");
  assert.equal(close1.data.varianceRp, 0);
  assert.ok(close1.data.totals.totalSalesRp > 0);
  const closeRetry = await call(base, `/shifts/${shiftA1}/close`, { method: "POST", token: tokenA, body: closeBody, label: "retry close identik" });
  assertCall(closeRetry, 200, "retry close identik");
  assert.equal(closeRetry.data.closeKey, close1.data.closeKey);
  const closeConflict = await call(base, `/shifts/${shiftA1}/close`, {
    method: "POST", token: tokenA, body: { closeKey: closeBody.closeKey, declaredCashRp: 0 }, label: "close key sama isi beda",
  });
  assertCall(closeConflict, 409, "close key sama isi beda");
  assert.equal(closeConflict.errorCode, "IDEMPOTENCY_CONFLICT");
  const invalidClose = await call(base, `/shifts/${shiftA1}/close`, {
    method: "POST", token: tokenA, body: { closeKey: key("close-invalid"), declaredCashRp: -1 }, label: "close nominal invalid",
  });
  assertCall(invalidClose, 422, "close nominal invalid");
  const currentAfterClose = await call(base, "/shifts/current", { token: tokenA, label: "shift setelah tutup" });
  assertCall(currentAfterClose, 200, "shift setelah tutup");
  assert.equal(currentAfterClose.data, null);
  const afterClose1 = snapshot();
  assert.equal(afterClose1.counts.closings, 1);
  record("AC-06.01", "Tutup shift 1 dengan rekap & selisih 0; retry identik satu hasil; key sama isi beda 409; nominal invalid 422", beforeClose1, afterClose1, NO_CHANGE, {
    totals: close1.data.totals, varianceRp: close1.data.varianceRp,
  });

  // -------------------------------------------------------------------------
  // 7. AC-06.02 — buka shift 2; close lebih dulu → checkout ditolak; lalu
  //    buka shift 3 → commit lebih dulu masuk rekap.
  // -------------------------------------------------------------------------
  const beforeRace = snapshot();
  const open3 = await call(base, "/shifts/open", { method: "POST", token: tokenA, body: { openingCashRp: 100000 }, label: "buka shift 2 (race)" });
  assertCall(open3, 200, "buka shift 2 (race)");
  shiftA2 = open3.data.id;
  const racePrep = await prepare(base, tokenA, shiftA2, 1, "close-vs-checkout");
  assertCall(racePrep.result, 200, "prepare race");
  const [raceClose, raceCommit] = await Promise.all([
    call(base, `/shifts/${shiftA2}/close`, { method: "POST", token: tokenA, body: { closeKey: key("close-race"), declaredCashRp: null }, label: "close race" }),
    commit(base, tokenA, racePrep.attemptKey, racePrep.result.data.requestHash, { method: "CASH", cashReceivedRp: 5000 }, "commit race"),
  ]);
  // Serial order: salah satu menang. Pastikan konsistensi, bukan asumsi siapa dulu.
  const sRace = snapshot();
  assert.equal(sRace.reconciled, true);
  if (sRace.counts.closings === 2) {
    // close menang → commit harus ditolak SHIFT_NOT_ACTIVE / 409
    assert.ok([409, 500].includes(raceCommit.status), `commit setelah close harus ditolak, dapat ${raceCommit.status}`);
    assert.equal(sRace.counts.sales, afterClose1.counts.sales, "close lebih dulu → tidak ada sale baru");
  } else {
    // commit menang → close tetap tercatat, sale masuk rekap
    assert.equal(raceCommit.status, 200);
    assert.equal(sRace.counts.sales, afterClose1.counts.sales + 1);
  }
  const raceDelta = deltaOf(beforeRace, sRace);
  pass("AC-06.02", `Close vs checkout bersamaan: SSTV konsisten — close=${raceClose.status}, commit=${raceCommit.status}, closings=${sRace.counts.closings}, sales delta=${raceDelta.sales}`, {
    before: beforeRace, after: sRace, delta: raceDelta, closeStatus: raceClose.status, commitStatus: raceCommit.status,
  });

  // -------------------------------------------------------------------------
  // 8b. AC-04.01 — klik bayar ganda / commit paralel identik → satu sale;
  //     kunci sama isi beda ditolak tanpa mutasi.
  // -------------------------------------------------------------------------
  const beforeIdem = snapshot();
  const openIdem = await call(base, "/shifts/open", { method: "POST", token: tokenA, body: { openingCashRp: 100000 }, label: "buka shift idempotensi" });
  assertCall(openIdem, 200, "buka shift idempotensi");
  const idemPrep = await prepare(base, tokenA, openIdem.data.id, 1, "klik-ganda");
  assertCall(idemPrep.result, 200, "prepare klik ganda");
  const [clickA, clickB] = await Promise.all([
    commit(base, tokenA, idemPrep.attemptKey, idemPrep.result.data.requestHash, { method: "CASH", cashReceivedRp: 5000 }, "klik-ganda-A"),
    commit(base, tokenA, idemPrep.attemptKey, idemPrep.result.data.requestHash, { method: "CASH", cashReceivedRp: 5000 }, "klik-ganda-B"),
  ]);
  assert.equal(clickA.status, 200);
  assert.equal(clickB.status, 200);
  assert.equal(clickA.data.saleId, clickB.data.saleId, "dua klik harus merujuk sale yang sama");
  const replay = await commit(base, tokenA, idemPrep.attemptKey, idemPrep.result.data.requestHash, { method: "CASH", cashReceivedRp: 5000 }, "retry-identik");
  assertCall(replay, 200, "retry identik");
  assert.equal(replay.data.saleId, clickA.data.saleId);
  const conflictCommit = await commit(base, tokenA, idemPrep.attemptKey, idemPrep.result.data.requestHash, { method: "CASH", cashReceivedRp: 9999 }, "kunci-sama-isi-beda");
  // Nominal tunai bukan bagian dari niat; gunakan requestHash berbeda untuk memaksa konflik.
  const wrongHash = await commit(base, tokenA, idemPrep.attemptKey, "0".repeat(64), { method: "CASH", cashReceivedRp: 5000 }, "hash-salah");
  assert.ok([409, 500].includes(wrongHash.status), `hash salah harus ditolak, dapat ${wrongHash.status}`);
  const afterIdem = snapshot();
  assert.deepEqual(deltaOf(beforeIdem, afterIdem), ONE_SALE, "klik ganda/retry tidak boleh menambah sale");
  pass("AC-04.01", "Dua commit paralel identik & retry → satu saleId; hash/kunci berbeda ditolak tanpa mutasi", {
    before: beforeIdem, after: afterIdem, delta: deltaOf(beforeIdem, afterIdem),
    saleId: clickA.data.saleId, conflictStatus: conflictCommit.status, wrongHashStatus: wrongHash.status,
  });
  const closeIdem = await call(base, `/shifts/${openIdem.data.id}/close`, {
    method: "POST", token: tokenA, body: { closeKey: key("close-idem"), declaredCashRp: null }, label: "tutup shift idempotensi",
  });
  assertCall(closeIdem, 200, "tutup shift idempotensi");

  // -------------------------------------------------------------------------
  // 8c. AC-06.02 — commit LEBIH DULU lalu close → sale masuk rekap shift.
  // -------------------------------------------------------------------------
  const beforeCommitFirst = snapshot();
  const openCF = await call(base, "/shifts/open", { method: "POST", token: tokenA, body: { openingCashRp: 100000 }, label: "buka shift commit-dulu" });
  assertCall(openCF, 200, "buka shift commit-dulu");
  const cfPrep = await prepare(base, tokenA, openCF.data.id, 1, "commit-dulu");
  assertCall(cfPrep.result, 200, "prepare commit-dulu");
  const cfCommit = await commit(base, tokenA, cfPrep.attemptKey, cfPrep.result.data.requestHash, { method: "CASH", cashReceivedRp: 5000 }, "commit-dulu");
  assertCall(cfCommit, 200, "commit dulu");
  const cfClose = await call(base, `/shifts/${openCF.data.id}/close`, {
    method: "POST", token: tokenA, body: { closeKey: key("close-commit-dulu"), declaredCashRp: null }, label: "tutup setelah commit",
  });
  assertCall(cfClose, 200, "tutup setelah commit");
  assert.equal(cfClose.data.totals.saleCount, 1, "sale yang commit lebih dulu harus masuk rekap");
  assert.equal(cfClose.data.totals.cashRp, 5000);
  const afterCommitFirst = snapshot();
  assert.deepEqual(deltaOf(beforeCommitFirst, afterCommitFirst), { ...ONE_SALE, sales: 1 });
  pass("AC-06.02", "Commit lebih dulu lalu close → sale Rp5.000 masuk rekap shift (saleCount=1, cashRp=5000)", {
    before: beforeCommitFirst, after: afterCommitFirst, delta: deltaOf(beforeCommitFirst, afterCommitFirst),
    closeTotals: cfClose.data.totals,
  });

  // -------------------------------------------------------------------------
  // 8d. AC-06.03 — close invalid mempertahankan shift; retry close setelah
  //     restart mengembalikan hasil asli tanpa penutupan tambahan.
  // -------------------------------------------------------------------------
  const openRetryClose = await call(base, "/shifts/open", { method: "POST", token: tokenA, body: { openingCashRp: 100000 }, label: "buka shift retry-close" });
  assertCall(openRetryClose, 200, "buka shift retry-close");
  const badClose = await call(base, `/shifts/${openRetryClose.data.id}/close`, {
    method: "POST", token: tokenA, body: { closeKey: key("close-bad"), declaredCashRp: -5 }, label: "close invalid",
  });
  assertCall(badClose, 422, "close invalid");
  const stillActive = await call(base, "/shifts/current", { token: tokenA, label: "shift tetap aktif setelah close invalid" });
  assertCall(stillActive, 200, "shift tetap aktif setelah close invalid");
  assert.equal(stillActive.data.id, openRetryClose.data.id);
  const goodCloseBody = { closeKey: key("close-retry"), declaredCashRp: null };
  const goodClose = await call(base, `/shifts/${openRetryClose.data.id}/close`, { method: "POST", token: tokenA, body: goodCloseBody, label: "close sah" });
  assertCall(goodClose, 200, "close sah");
  const closingsBeforeRestart = snapshot().counts.closings;
  await stopChild(false);
  port = await freeLoopbackPort();
  base = await startChild(port);
  tokenA = await login(base, cashierAUser, passA, "login untuk retry close setelah restart");
  const closeAfterRestart = await call(base, `/shifts/${openRetryClose.data.id}/close`, { method: "POST", token: tokenA, body: goodCloseBody, label: "retry close setelah restart" });
  assertCall(closeAfterRestart, 200, "retry close setelah restart");
  assert.equal(closeAfterRestart.data.closeKey, goodClose.data.closeKey);
  assert.equal(snapshot().counts.closings, closingsBeforeRestart, "retry tidak boleh menambah penutupan");
  pass("AC-06.03", "Close invalid 422 & shift tetap aktif; close sah; restart + retry closeKey sama → hasil asli, tanpa penutupan tambahan", {
    closeKey: goodClose.data.closeKey, closings: closingsBeforeRestart,
  });

  // -------------------------------------------------------------------------
  // 9. AC-06.02/06.03 — setelah shift tertutup, checkout baru ditolak;
  //    shift tidak bisa dibuka ulang secara ganda.
  // -------------------------------------------------------------------------
  const beforeFinal = snapshot();
  const closedShiftPrep = await prepare(base, tokenA, shiftA1, 1, "checkout-shift-tertutup");
  assertCall(closedShiftPrep.result, 409, "checkout shift tertutup");
  assert.equal(closedShiftPrep.result.errorCode, "SHIFT_NOT_ACTIVE");
  const finalSnap = snapshot();
  assert.deepEqual(core(finalSnap), core(beforeFinal));
  pass("REKONSILIASI", `Integritas akhir ok, FK 0, ${finalSnap.counts.sales} sale = ${finalSnap.counts.payments} payment, ${finalSnap.counts.closings} penutupan, stok ${finalSnap.stock}`, { final: finalSnap });
}

function writeEvidence(status) {
  if (!jsonOut) return;
  const read = (gitArgs) => {
    const r = spawnSync("git", gitArgs, { cwd: root, encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const evidence = {
    task: "TASK-024", status, generatedAtIso: new Date().toISOString(),
    environment: {
      os: `${process.platform} ${osRelease()} (${process.arch})`, node: process.version,
      commit: read(["rev-parse", "HEAD"]), branch: read(["rev-parse", "--abbrev-ref", "HEAD"]),
      dataMode: "DEMO/QA synthetic — SQLite temp; child CLI + in-process printer injection",
      dbPath, kept: keepTemp,
    },
    passes: passCount, tests, keys, calls,
  };
  writeFileSync(jsonOut, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`\nBukti JSON: ${jsonOut}`);
}

try {
  await main();
  finalStatus = "PASS";
  console.log(`\nPASS total ${passCount} pemeriksaan E2E TASK-024.`);
} catch (error) {
  finalStatus = "FAIL";
  console.error(`\nFAIL: ${error instanceof Error ? error.message : String(error)}`);
  console.error(error instanceof Error ? error.stack : "");
  process.exitCode = 1;
} finally {
  await stopChild();
  await stopInProcess();
  writeEvidence(finalStatus);
  if (!keepTemp) {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* kunci Windows */ }
  } else {
    console.log(`\nTemp disimpan (--keep-temp): ${tempDir}`);
  }
}
