#!/usr/bin/env node
/**
 * TASK-017 E2E API nyata (tanpa mock):
 * SQLite sementara → shift paralel → prepare/commit → idempotensi →
 * perubahan harga → stok kurang → lookup status → restart backend.
 *
 * Jalankan dari root repo: `node scripts/task-017_checkout_e2e.mjs`
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
const tempDir = mkdtempSync(join(tmpdir(), "pos-task017-e2e-"));
const dbPath = join(tempDir, "task017.sqlite");

const adminPassword = `adm-${randomBytes(12).toString("hex")}`;
const cashierPassword = `ksr-${randomBytes(12).toString("hex")}`;
const otherPassword = `ksr-${randomBytes(12).toString("hex")}`;
const adminUsername = "admin.checkout.e2e";
const cashierUsername = "kasir.checkout.e2e";
const otherUsername = "kasir.lain.e2e";

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
    throw new Error(`Perintah gagal (${args[0]}): ${result.stderr || result.stdout}`);
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

async function startServer(port) {
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
  return waitForServerStart(server);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const exited = once(server, "exit").catch(() => undefined);
  server.kill();
  await Promise.race([exited, new Promise((resolveDelay) => setTimeout(resolveDelay, 3000))]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

async function call(baseUrl, path, options = {}) {
  const headers = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
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

function openDb(readOnly = true) {
  return new DatabaseSync(dbPath, readOnly ? { readOnly: true } : {});
}

function counts() {
  const db = openDb();
  try {
    const count = (table) => Number(db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total);
    const stock = db
      .prepare("SELECT on_hand FROM stock_balances WHERE product_id = ?")
      .get(productId);
    return {
      sales: count("sales"),
      payments: count("payments"),
      saleItems: count("sale_items"),
      movements: count("inventory_movements"),
      stock: Number(stock?.on_hand ?? 0),
    };
  } finally {
    db.close();
  }
}

let productId = 0;
let shiftId = 0;
const attemptKeys = [];

function nextAttempt(label) {
  const key = `co_e2e_${label}_${randomBytes(6).toString("hex")}`;
  attemptKeys.push(key);
  return key;
}

async function prepare(baseUrl, token, quantity, label) {
  return call(baseUrl, "/checkouts/prepare", {
    method: "POST",
    token,
    body: {
      attemptKey: nextAttempt(label),
      shiftId,
      items: [{ productId, quantity }],
      payment: { method: "CASH" },
    },
  });
}

async function commit(baseUrl, token, prepared, cashReceivedRp) {
  return call(baseUrl, "/checkouts/commit", {
    method: "POST",
    token,
    body: {
      attemptKey: dataOf(prepared).attemptKey,
      requestHash: dataOf(prepared).requestHash,
      paymentConfirmation: { method: "CASH", cashReceivedRp },
    },
  });
}

async function main() {
  runNode(["db/src/cli.ts", "migrate", "--db", dbPath]);
  runNode(
    ["src/auth/cli.ts", "bootstrap-admin", "--username", adminUsername, "--db", dbPath],
    { POS_BOOTSTRAP_PASSWORD: adminPassword },
  );

  const port = await freeLoopbackPort();
  let baseUrl = await startServer(port);
  pass(`Migrasi SQLite sementara dan server loopback ${baseUrl}`);

  const adminLogin = await call(baseUrl, "/auth/login", {
    method: "POST",
    body: { username: adminUsername, password: adminPassword },
  });
  assert.equal(adminLogin.status, 200);
  const adminToken = dataOf(adminLogin).token;

  for (const [username, password] of [
    [cashierUsername, cashierPassword],
    [otherUsername, otherPassword],
  ]) {
    const created = await call(baseUrl, "/users", {
      method: "POST",
      token: adminToken,
      body: { username, password, role: "CASHIER" },
    });
    assert.equal(created.status, 201);
  }

  async function loginCashier(username, password) {
    const result = await call(baseUrl, "/auth/login", {
      method: "POST",
      body: { username, password },
    });
    assert.equal(result.status, 200);
    return dataOf(result).token;
  }

  const cashierToken = await loginCashier(cashierUsername, cashierPassword);
  const otherToken = await loginCashier(otherUsername, otherPassword);
  pass("Login ADMIN dan dua CASHIER melalui backend nyata");

  const category = await call(baseUrl, "/categories", {
    method: "POST",
    token: adminToken,
    body: { name: "Kategori Checkout E2E" },
  });
  assert.equal(category.status, 201);
  const product = await call(baseUrl, "/products", {
    method: "POST",
    token: adminToken,
    body: {
      categoryId: dataOf(category).id,
      sku: "CO-E2E-001",
      name: "Produk Checkout E2E",
      priceRp: 5000,
      barcodes: ["000123"],
      supplierIds: [],
    },
  });
  assert.equal(product.status, 201);
  productId = dataOf(product).id;

  // Stok awal sintetis: 5 unit lewat mutasi OPENING di DB sementara.
  const db = openDb(false);
  try {
    db.prepare(
      `INSERT INTO inventory_movements
       (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
       VALUES (?, 'OPENING', 5, ?, 1, ?)`,
    ).run(productId, "E2E-OPEN-1", Date.now());
  } finally {
    db.close();
  }
  assert.deepEqual(
    { sales: counts().sales, movements: counts().movements, stock: counts().stock },
    { sales: 0, movements: 1, stock: 5 },
  );
  pass("Fixture stok sintetis 5 unit; barcode 000123 tersimpan sebagai string");

  // AC-05.01: dua buka shift bersamaan → tepat satu aktif.
  const [openA, openB] = await Promise.all([
    call(baseUrl, "/shifts/open", { method: "POST", token: cashierToken, body: {} }),
    call(baseUrl, "/shifts/open", { method: "POST", token: cashierToken, body: {} }),
  ]);
  assert.equal([openA.status, openB.status].filter((status) => status === 200).length, 1);
  assert.equal([openA.status, openB.status].filter((status) => status === 409).length, 1);
  assert.equal(errorCode(openA.status === 409 ? openA : openB), "SHIFT_ALREADY_OPEN");

  const current = await call(baseUrl, "/shifts/current", { token: cashierToken });
  assert.equal(current.status, 200);
  shiftId = dataOf(current).id;
  assert.equal(Number.isSafeInteger(shiftId), true);

  const otherCurrent = await call(baseUrl, "/shifts/current", { token: otherToken });
  assert.equal(dataOf(otherCurrent), null);

  const adminOpen = await call(baseUrl, "/shifts/open", {
    method: "POST",
    token: adminToken,
    body: {},
  });
  assert.equal(adminOpen.status, 403);
  pass("AC-05.01: satu shift aktif dari dua upaya paralel; kasir lain null; ADMIN 403");

  // AC-03.02: input invalid ditolak tanpa mutasi.
  const emptyItems = await call(baseUrl, "/checkouts/prepare", {
    method: "POST",
    token: cashierToken,
    body: { attemptKey: nextAttempt("empty"), shiftId, items: [], payment: { method: "CASH" } },
  });
  assert.equal(emptyItems.status, 422);
  assert.equal(errorCode(emptyItems), "VALIDATION_ERROR");

  const zeroQty = await call(baseUrl, "/checkouts/prepare", {
    method: "POST",
    token: cashierToken,
    body: {
      attemptKey: nextAttempt("zero"),
      shiftId,
      items: [{ productId, quantity: 0 }],
      payment: { method: "CASH" },
    },
  });
  assert.equal(zeroQty.status, 422);
  assert.deepEqual(
    { sales: counts().sales, payments: counts().payments, movements: counts().movements },
    { sales: 0, payments: 0, movements: 1 },
  );
  pass("AC-03.02: keranjang kosong dan qty nol ditolak tanpa sale/payment/mutasi");

  // AC-03.03/AC-03.05: prepare tidak menjual; commit atomic pertama.
  const firstPrepare = await prepare(baseUrl, cashierToken, 2, "first");
  assert.equal(firstPrepare.status, 200);
  assert.equal(dataOf(firstPrepare).status, "PREPARED");
  assert.equal(dataOf(firstPrepare).quote.totalRp, 10_000);
  assert.match(dataOf(firstPrepare).requestHash, /^[0-9a-f]{64}$/);
  assert.equal(dataOf(firstPrepare).quote.items[0]?.unitPriceRp, 5000, "harga berasal dari backend");
  assert.equal(counts().sales, 0, "prepare tidak boleh membuat penjualan");

  const firstCommit = await commit(baseUrl, cashierToken, firstPrepare, 20_000);
  assert.equal(firstCommit.status, 200);
  assert.equal(dataOf(firstCommit).status, "COMMITTED");
  assert.equal(dataOf(firstCommit).saleNo.length > 0, true);
  assert.equal(dataOf(firstCommit).payment.changeRp, 10_000);
  const afterFirst = counts();
  assert.deepEqual(
    { sales: afterFirst.sales, payments: afterFirst.payments, saleItems: afterFirst.saleItems, movements: afterFirst.movements, stock: afterFirst.stock },
    { sales: 1, payments: 1, saleItems: 1, movements: 2, stock: 3 },
  );
  pass("AC-03.05: prepare=PRA (tanpa sale); commit menghasilkan satu sale + payment + mutasi atomik, stok 3");

  // Idempotensi: retry identik mengembalikan sale yang sama.
  const replay = await commit(baseUrl, cashierToken, firstPrepare, 20_000);
  assert.equal(replay.status, 200);
  assert.equal(dataOf(replay).saleId, dataOf(firstCommit).saleId);
  assert.deepEqual(counts(), afterFirst);

  // Dua commit paralel dengan kunci sama hanya menambah satu sale.
  const parallelPrepare = await prepare(baseUrl, cashierToken, 1, "parallel");
  assert.equal(parallelPrepare.status, 200);
  const parallel = await Promise.all([
    commit(baseUrl, cashierToken, parallelPrepare, 10_000),
    commit(baseUrl, cashierToken, parallelPrepare, 10_000),
  ]);
  assert.equal(parallel.every((result) => result.status === 200), true);
  assert.equal(parallel[0].json.data.saleId, parallel[1].json.data.saleId);
  const afterParallel = counts();
  assert.equal(afterParallel.sales, 2);
  assert.equal(afterParallel.stock, 2);
  pass("AC-04.01: retry identik dan dua commit paralel menghasilkan satu penjualan per upaya");

  const status = await call(baseUrl, `/checkouts/${encodeURIComponent(dataOf(parallelPrepare).attemptKey)}`, {
    token: cashierToken,
  });
  assert.equal(status.status, 200);
  assert.equal(dataOf(status).status, "COMMITTED");
  assert.equal(dataOf(status).saleId, parallel[0].json.data.saleId);
  pass("AC-04.02: lookup status upaya mengembalikan COMMITTED tanpa transaksi baru");

  // AC-03.03: harga berubah setelah prepare → commit ditolak, perlu quote baru.
  const stalePrepare = await prepare(baseUrl, cashierToken, 1, "stale");
  assert.equal(stalePrepare.status, 200);
  const pricePatch = await call(baseUrl, `/products/${productId}`, {
    method: "PATCH",
    token: adminToken,
    body: { priceRp: 6000 },
  });
  assert.equal(pricePatch.status, 200);
  const staleCommit = await commit(baseUrl, cashierToken, stalePrepare, 10_000);
  assert.equal(staleCommit.status, 409);
  assert.equal(errorCode(staleCommit), "PRICE_CHANGED");
  assert.equal(counts().sales, afterParallel.sales);

  const revisedPrepare = await prepare(baseUrl, cashierToken, 1, "revised");
  assert.equal(dataOf(revisedPrepare).quote.totalRp, 6000);
  const revisedCommit = await commit(baseUrl, cashierToken, revisedPrepare, 6000);
  assert.equal(revisedCommit.status, 200);
  assert.equal(dataOf(revisedCommit).payment.changeRp, 0);
  assert.equal(counts().stock, 1);
  pass("AC-03.03: PRICE_CHANGED 409 tanpa commit; quote baru disetujui lalu commit sukses");

  // AC-03.06: stok kurang ditolak, koreksi qty sukses.
  const tooMany = await prepare(baseUrl, cashierToken, 5, "short");
  assert.equal(tooMany.status, 409);
  assert.equal(errorCode(tooMany), "INSUFFICIENT_STOCK");
  assert.equal(counts().stock, 1, "stok tidak berubah saat ditolak");

  const corrected = await prepare(baseUrl, cashierToken, 1, "corrected");
  assert.equal(corrected.status, 200);
  const correctedCommit = await commit(baseUrl, cashierToken, corrected, 6000);
  assert.equal(correctedCommit.status, 200);
  assert.equal(counts().stock, 0);
  pass("AC-03.06: stok 1 menolak qty 5 tanpa mutasi; qty 1 sukses dan stok 0");

  // Otorisasi backend: CASHIER tidak bisa memakai shift orang lain / ADMIN tidak bisa checkout.
  const foreignShift = await call(baseUrl, "/checkouts/prepare", {
    method: "POST",
    token: otherToken,
    body: {
      attemptKey: nextAttempt("foreign"),
      shiftId,
      items: [{ productId, quantity: 1 }],
      payment: { method: "CASH" },
    },
  });
  assert.equal(foreignShift.status, 409);
  assert.equal(errorCode(foreignShift), "SHIFT_NOT_ACTIVE");

  const adminPrepare = await call(baseUrl, "/checkouts/prepare", {
    method: "POST",
    token: adminToken,
    body: {
      attemptKey: nextAttempt("admin"),
      shiftId,
      items: [{ productId, quantity: 1 }],
      payment: { method: "CASH" },
    },
  });
  assert.equal(adminPrepare.status, 403);
  pass("Otorisasi backend: kasir lain SHIFT_NOT_ACTIVE 409; ADMIN 403 pada checkout");

  // AC-05.02: restart backend, shift tetap aktif dengan ID/waktu sama.
  const beforeRestart = dataOf(await call(baseUrl, "/shifts/current", { token: cashierToken }));
  await stopServer();
  baseUrl = await startServer(port);
  const cashierAfterRestart = await loginCashier(cashierUsername, cashierPassword);
  const afterRestart = await call(baseUrl, "/shifts/current", { token: cashierAfterRestart });
  assert.equal(afterRestart.status, 200);
  assert.equal(dataOf(afterRestart).id, beforeRestart.id);
  assert.equal(dataOf(afterRestart).openedAtMs, beforeRestart.openedAtMs);
  pass("AC-05.02: restart backend mempertahankan ID dan waktu buka shift milik kasir");

  // Konsistensi akhir SQLite.
  const finalCounts = counts();
  const dbFinal = openDb();
  let auditActions;
  try {
    auditActions = dbFinal
      .prepare("SELECT action FROM audit_log ORDER BY id")
      .all()
      .map((row) => row.action);
  } finally {
    dbFinal.close();
  }
  assert.ok(auditActions.includes("SHIFT_OPENED"));
  assert.ok(auditActions.includes("CHECKOUT_COMMITTED") || auditActions.includes("SALE_COMMITTED"));
  assert.equal(finalCounts.sales, 4);
  assert.equal(finalCounts.payments, 4);
  assert.equal(finalCounts.movements, 5);
  pass(`Konsistensi SQLite akhir: ${JSON.stringify(finalCounts)} dan audit shift/checkout tercatat`);
}

try {
  await main();
  console.log(`\nPASS total ${passCount} pemeriksaan E2E API nyata (TASK-017).`);
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
