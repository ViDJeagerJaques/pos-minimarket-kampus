#!/usr/bin/env node
/**
 * TASK-018 E2E — bukti irisan pertama offline (login → shift → scan → tunai → DB).
 *
 * Jalankan dari root repo:
 *   node scripts/task-018_offline_slice_e2e.mjs [--json-out <file>] [--keep-db]
 *
 * ISOLASI & OFFLINE:
 * - SQLite sementara di %TEMP%/pos-task018-e2e-*, bukan DB development/operasional.
 * - Semua request klien lewat fetch yang DITOLAK bila host bukan 127.0.0.1/localhost.
 * - Proses backend menerima proxy dummy ke port mati 127.0.0.1:9 untuk mencegah
 *   jalur keluar bila ada pustaka yang menghormati env proxy.
 * - Ini SIMULASI offline logis. Kabel/Wi-Fi tidak diputus secara fisik; uji
 *   perangkat/PC tujuan tetap NOT RUN dan tidak diklaim di sini.
 *
 * BUKTI:
 * - Setiap tes merekam snapshot SQLite sebelum/sesudah (count, saldo, jumlah
 *   uang sale/item/payment, mutasi, integritas) dan requestId dari respons.
 * - attemptKey sintetis dibuat di sini; requestId dicatat apa adanya dari server.
 * - Kata sandi/token hanya di memori proses, tidak dicetak atau disimpan.
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
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = join(root, "backend");
const tempDir = mkdtempSync(join(tmpdir(), "pos-task018-e2e-"));
const dbPath = join(tempDir, "task018.sqlite");

const args = process.argv.slice(2);
const jsonOutIndex = args.indexOf("--json-out");
const jsonOut = jsonOutIndex >= 0 ? args[jsonOutIndex + 1] : null;
const keepDb = args.includes("--keep-db");

const runTag = randomBytes(5).toString("hex");
const adminUsername = "admin.t18.sintetis";
const cashierUsername = "kasir.t18.pemilik";
const otherUsername = "kasir.t18.bukanpemilik";
const adminPassword = `adm-${randomBytes(12).toString("hex")}`;
const cashierPassword = `ksr-${randomBytes(12).toString("hex")}`;
const otherPassword = `oth-${randomBytes(12).toString("hex")}`;

/** Proxy ke port mati: jalur keluar apa pun gagal, loopback dikecualikan. */
const offlineEnv = {
  HTTP_PROXY: "http://127.0.0.1:9",
  HTTPS_PROXY: "http://127.0.0.1:9",
  ALL_PROXY: "http://127.0.0.1:9",
  NO_PROXY: "127.0.0.1,localhost",
  POS_DB_PROFILE: "test",
};

const blockedExternalCalls = [];
const nativeFetch = globalThis.fetch;
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
globalThis.fetch = async (input, init) => {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const hostname = new URL(raw).hostname;
  if (!loopbackHosts.has(hostname)) {
    blockedExternalCalls.push({ hostname, url: raw, atIso: new Date().toISOString() });
    throw new Error(`OFFLINE_GUARD: koneksi eksternal ditolak (${hostname})`);
  }
  return nativeFetch(input, init);
};

let server = null;
let productId = 0;
let shiftId = 0;
let openedAtMs = 0;
let passCount = 0;
let lastCallIndex = 0;
let finalStatus = "RUNNING";
const calls = [];
const tests = [];
const attemptKeyLabels = [];

function nextAttempt(label) {
  const key = `t18_${runTag}_${label}_${attemptKeyLabels.length + 1}`;
  attemptKeyLabels.push({ attemptKey: key, label });
  return key;
}

function pass(ac, label, detail = {}) {
  passCount += 1;
  console.log(`PASS ${passCount}. [${ac}] ${label}`);
  tests.push({ no: passCount, ac, label, status: "PASS", ...detail });
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
    env: { ...process.env, ...offlineEnv, POS_DB_PATH: dbPath, ...extraEnv },
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
  server = spawn(process.execPath, ["src/http/cli.ts", "serve", "--db", dbPath, "--port", String(port)], {
    cwd: backendDir,
    env: { ...process.env, ...offlineEnv, POS_DB_PATH: dbPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.setEncoding("utf8");
  server.stderr.on("data", () => {
    // Log keamanan backend tidak memuat kata sandi/token; tidak dicetak.
  });
  return waitForServerStart(server);
}

async function stopServer(hard = false) {
  if (!server || server.exitCode !== null) return;
  const exited = once(server, "exit").catch(() => undefined);
  server.kill(hard ? "SIGKILL" : undefined);
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
  const rawText = await response.text();
  let json = null;
  try {
    json = rawText.length > 0 ? JSON.parse(rawText) : null;
  } catch {
    json = null;
  }
  const result = {
    status: response.status,
    json,
    rawText,
    requestId: json?.requestId ?? json?.error?.requestId ?? null,
    errorCode: json?.error?.code ?? null,
    data: json?.data ?? null,
  };
  calls.push({
    label: options.label ?? `${options.method ?? "GET"} ${path}`,
    method: options.method ?? "GET",
    path,
    status: result.status,
    requestId: result.requestId,
    errorCode: result.errorCode,
    attemptKey: options.body?.attemptKey ?? null,
  });
  return result;
}

function openDb(readOnly = true) {
  return new DatabaseSync(dbPath, readOnly ? { readOnly: true } : {});
}

/** Snapshot rekonsiliasi: jumlah baris, uang, saldo, mutasi, integritas. */
function snapshot() {
  const db = openDb();
  try {
    const count = (table) => Number(db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total);
    const saleTotalRp = Number(
      db.prepare("SELECT COALESCE(SUM(total_rp), 0) AS total FROM sales").get().total,
    );
    const itemTotalRp = Number(
      db.prepare("SELECT COALESCE(SUM(line_total_rp), 0) AS total FROM sale_items").get().total,
    );
    const paymentAmountRp = Number(
      db.prepare("SELECT COALESCE(SUM(amount_rp), 0) AS total FROM payments").get().total,
    );
    const movementByKind = {};
    for (const row of db
      .prepare("SELECT kind, COALESCE(SUM(delta), 0) AS total FROM inventory_movements GROUP BY kind")
      .all()) {
      movementByKind[row.kind] = Number(row.total);
    }
    const openingDelta = movementByKind.OPENING ?? 0;
    const saleDelta = movementByKind.SALE ?? 0;
    const adjustmentDelta = movementByKind.ADJUSTMENT ?? 0;
    const stockRow = db
      .prepare("SELECT on_hand FROM stock_balances WHERE product_id = ?")
      .get(productId);
    const stock = Number(stockRow?.on_hand ?? 0);
    const integrity = db
      .prepare("PRAGMA integrity_check")
      .all()
      .map((row) => row.integrity_check)
      .join("; ");
    const fkViolations = db.prepare("PRAGMA foreign_key_check").all().length;
    return {
      counts: {
        sales: count("sales"),
        saleItems: count("sale_items"),
        payments: count("payments"),
        movements: count("inventory_movements"),
        attempts: count("checkout_attempts"),
        activeShifts: Number(
          db.prepare("SELECT COUNT(*) AS total FROM shifts WHERE closed_at_ms IS NULL").get().total,
        ),
        saleWithoutPayment: Number(
          db
            .prepare(
              "SELECT COUNT(*) AS total FROM sales s WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.sale_id = s.id)",
            )
            .get().total,
        ),
        orphanSaleItems: Number(
          db
            .prepare(
              "SELECT COUNT(*) AS total FROM sale_items si WHERE NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = si.sale_id)",
            )
            .get().total,
        ),
      },
      money: { saleTotalRp, itemTotalRp, paymentAmountRp, openingDelta, saleDelta, adjustmentDelta },
      stock,
      movementByKind,
      saleNos: db
        .prepare("SELECT sale_no FROM sales ORDER BY id")
        .all()
        .map((row) => row.sale_no),
      paymentMethods: db
        .prepare("SELECT method_code FROM payments ORDER BY id")
        .all()
        .map((row) => row.method_code),
      integrity,
      fkViolations,
      reconciled:
        integrity === "ok" &&
        fkViolations === 0 &&
        saleTotalRp === itemTotalRp &&
        saleTotalRp === paymentAmountRp &&
        stock === openingDelta + saleDelta + adjustmentDelta &&
        stock >= 0,
    };
  } finally {
    db.close();
  }
}

function core(s) {
  return {
    sales: s.counts.sales,
    saleItems: s.counts.saleItems,
    payments: s.counts.payments,
    movements: s.counts.movements,
    stock: s.stock,
  };
}

function deltaOf(before, after) {
  const b = core(before);
  const a = core(after);
  const out = {};
  for (const key of Object.keys(b)) out[key] = a[key] - b[key];
  return out;
}

const NO_MUTATION = { sales: 0, saleItems: 0, payments: 0, movements: 0, stock: 0 };

function record(ac, label, before, after, expectedDelta, extra = {}) {
  assert.equal(before.reconciled, true, `rekonsiliasi SEBELUM gagal: ${JSON.stringify(before)}`);
  assert.equal(after.reconciled, true, `rekonsiliasi SESUDAH gagal: ${JSON.stringify(after)}`);
  const actual = deltaOf(before, after);
  assert.deepEqual(actual, expectedDelta, `delta tak terduga untuk "${label}"`);
  const usedCalls = calls.slice(lastCallIndex);
  lastCallIndex = calls.length;
  pass(ac, label, {
    before,
    after,
    delta: actual,
    requestIds: usedCalls.map((entry) => entry.requestId).filter(Boolean),
    attemptKeys: usedCalls.map((entry) => entry.attemptKey).filter(Boolean),
    calls: usedCalls,
    ...extra,
  });
}

async function login(baseUrl, username, password, label) {
  const result = await call(baseUrl, "/auth/login", {
    method: "POST",
    body: { username, password },
    label,
  });
  assertCall(result, 200, label);
  return result.data.token;
}

async function prepare(baseUrl, token, quantity, label, overrideAttemptKey = null) {
  return call(
    baseUrl,
    "/checkouts/prepare",
    {
      method: "POST",
      token,
      body: {
        attemptKey: overrideAttemptKey ?? nextAttempt(label),
        shiftId,
        items: [{ productId, quantity }],
        payment: { method: "CASH" },
      },
      label: `prepare:${label}`,
    },
  );
}

async function commit(baseUrl, token, prepared, cashReceivedRp, label, overrides = {}) {
  const data = prepared.data;
  return call(
    baseUrl,
    "/checkouts/commit",
    {
      method: "POST",
      token,
      body: {
        attemptKey: data.attemptKey,
        requestHash: data.requestHash,
        paymentConfirmation: {
          method: "CASH",
          cashReceivedRp,
          ...overrides,
        },
      },
      label: `commit:${label}`,
    },
  );
}

async function main() {
  // ---------------------------------------------------------------------------
  // 0. Lingkungan, guard offline, migrasi, fixture sintetis.
  // ---------------------------------------------------------------------------
  assert.equal(blockedExternalCalls.length, 0);
  pass(
    "SETUP",
    "Offline guard aktif: fetch non-loopback ditolak; proxy dummy 127.0.0.1:9 untuk child process",
    { offline: { blockedExternalCalls, proxyEnv: offlineEnv } },
  );

  runNode(["db/src/cli.ts", "migrate", "--db", dbPath]);
  runNode(["src/auth/cli.ts", "bootstrap-admin", "--username", adminUsername, "--db", dbPath], {
    POS_BOOTSTRAP_PASSWORD: adminPassword,
  });

  const port = await freeLoopbackPort();
  let baseUrl = await startServer(port);

  const adminToken = await login(baseUrl, adminUsername, adminPassword, "login ADMIN");
  for (const [username, password] of [
    [cashierUsername, cashierPassword],
    [otherUsername, otherPassword],
  ]) {
    const created = await call(baseUrl, "/users", {
      method: "POST",
      token: adminToken,
      body: { username, password, role: "CASHIER" },
      label: `buat akun ${username}`,
    });
    assertCall(created, 201, `buat akun ${username}`);
  }

  let cashierToken = await login(baseUrl, cashierUsername, cashierPassword, "login kasir pemilik");
  const otherToken = await login(baseUrl, otherUsername, otherPassword, "login kasir lain");

  const category = await call(baseUrl, "/categories", {
    method: "POST",
    token: adminToken,
    body: { name: "T18 Kategori Sintetis" },
    label: "buat kategori",
  });
  assertCall(category, 201, "buat kategori");
  const product = await call(baseUrl, "/products", {
    method: "POST",
    token: adminToken,
    body: {
      categoryId: category.data.id,
      sku: "T18-KAS-001",
      name: "Produk Uji TASK-018",
      priceRp: 5000,
      barcodes: ["000123"],
      supplierIds: [],
    },
    label: "buat produk",
  });
  assertCall(product, 201, "buat produk");
  productId = product.data.id;

  const inactiveProduct = await call(baseUrl, "/products", {
    method: "POST",
    token: adminToken,
    body: {
      categoryId: category.data.id,
      sku: "T18-NONAKTIF",
      name: "Produk Nonaktif TASK-018",
      priceRp: 4000,
      barcodes: [],
      supplierIds: [],
    },
    label: "buat produk nonaktif",
  });
  assertCall(inactiveProduct, 201, "buat produk nonaktif");
  const inactivePatch = await call(baseUrl, `/products/${inactiveProduct.data.id}`, {
    method: "PATCH",
    token: adminToken,
    body: { active: false },
    label: "nonaktifkan produk uji",
  });
  assertCall(inactivePatch, 200, "nonaktifkan produk uji");

  // Stok awal sintetis +5 lewat mutasi OPENING nyata di SQLite sementara.
  const seedDb = openDb(false);
  try {
    seedDb
      .prepare(
        `INSERT INTO inventory_movements
         (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
         VALUES (?, 'OPENING', 5, ?, 1, ?)`,
      )
      .run(productId, "T18-OPEN-SINTETIS-1", Date.now());
  } finally {
    seedDb.close();
  }

  const s0 = snapshot();
  assert.equal(s0.reconciled, true, `baseline tidak rekonsiliasi: ${JSON.stringify(s0)}`);
  assert.deepEqual(core(s0), {
    sales: 0,
    saleItems: 0,
    payments: 0,
    movements: 1,
    stock: 5,
  });
  lastCallIndex = calls.length;
  pass("SETUP", `SQLite sementara + server loopback ${baseUrl}; baseline ${JSON.stringify(core(s0))}`, {
    baseline: s0,
    dbPath,
  });

  // ---------------------------------------------------------------------------
  // 1. AC-05.01 — buka shift paralel, tepat satu aktif.
  // ---------------------------------------------------------------------------
  const before = snapshot();
  const [openA, openB] = await Promise.all([
    call(baseUrl, "/shifts/open", { method: "POST", token: cashierToken, body: {}, label: "buka shift A" }),
    call(baseUrl, "/shifts/open", { method: "POST", token: cashierToken, body: {}, label: "buka shift B paralel" }),
  ]);
  assert.equal([openA.status, openB.status].filter((status) => status === 200).length, 1);
  assert.equal([openA.status, openB.status].filter((status) => status === 409).length, 1);
  const rejected = openA.status === 409 ? openA : openB;
  assert.equal(rejected.errorCode, "SHIFT_ALREADY_OPEN");
  const current = await call(baseUrl, "/shifts/current", { token: cashierToken, label: "shift milik pemilik" });
  assertCall(current, 200, "shift milik pemilik");
  shiftId = current.data.id;
  openedAtMs = current.data.openedAtMs;
  assert.equal(Number.isSafeInteger(shiftId), true);
  const otherCurrent = await call(baseUrl, "/shifts/current", { token: otherToken, label: "shift kasir lain" });
  assertCall(otherCurrent, 200, "shift kasir lain");
  assert.equal(otherCurrent.data, null);
  const adminOpen = await call(baseUrl, "/shifts/open", {
    method: "POST",
    token: adminToken,
    body: {},
    label: "ADMIN coba buka shift",
  });
  assertCall(adminOpen, 403, "ADMIN coba buka shift");
  record("AC-05.01", "Dua buka shift paralel → tepat satu aktif; kasir lain null; ADMIN 403", before, snapshot(), NO_MUTATION, {
    shiftId,
    openedAtMs,
  });

  // ---------------------------------------------------------------------------
  // 2. Scan (barcode nol awal) — tidak boleh mengubah DB.
  // ---------------------------------------------------------------------------
  const beforeScan = snapshot();
  const scan = await call(baseUrl, "/products?barcode=000123", { token: cashierToken, label: "scan 000123" });
  assertCall(scan, 200, "scan 000123");
  assert.equal(scan.data.length, 1);
  assert.equal(scan.data[0].sku, "T18-KAS-001");
  assert.equal(scan.data[0].priceRp, 5000);
  assert.equal(scan.data[0].stockOnHand, 5);
  const unknown = await call(baseUrl, "/products?barcode=9999999999999", { token: cashierToken, label: "scan barcode asing" });
  assertCall(unknown, 200, "scan barcode asing");
  assert.deepEqual(unknown.data, []);
  record("AC-03.01", "Scan barcode 000123 ketemu harga/stok dari backend; barcode asing kosong", beforeScan, snapshot(), NO_MUTATION);

  // ---------------------------------------------------------------------------
  // 3. AC-03.02 — keranjang invalid & akses non-owner, tanpa mutasi.
  // ---------------------------------------------------------------------------
  const beforeInvalid = snapshot();
  const emptyItems = await call(baseUrl, "/checkouts/prepare", {
    method: "POST",
    token: cashierToken,
    body: { attemptKey: nextAttempt("empty"), shiftId, items: [], payment: { method: "CASH" } },
    label: "prepare keranjang kosong",
  });
  assertCall(emptyItems, 422, "prepare keranjang kosong");
  assert.equal(emptyItems.errorCode, "VALIDATION_ERROR");
  const zeroQty = await prepare(baseUrl, cashierToken, 0, "qty-nol");
  assertCall(zeroQty, 422, "prepare qty nol");
  assert.equal(zeroQty.errorCode, "VALIDATION_ERROR");
  const negativeQty = await prepare(baseUrl, cashierToken, -2, "qty-negatif");
  assertCall(negativeQty, 422, "prepare qty negatif");
  const inactive = await call(baseUrl, "/checkouts/prepare", {
    method: "POST",
    token: cashierToken,
    body: {
      attemptKey: nextAttempt("nonaktif"),
      shiftId,
      items: [{ productId: inactiveProduct.data.id, quantity: 1 }],
      payment: { method: "CASH" },
    },
    label: "prepare produk nonaktif",
  });
  assertCall(inactive, 422, "prepare produk nonaktif");
  const noShift = await call(baseUrl, "/checkouts/prepare", {
    method: "POST",
    token: cashierToken,
    body: {
      attemptKey: nextAttempt("tanpa-shift"),
      shiftId: shiftId + 9999,
      items: [{ productId, quantity: 1 }],
      payment: { method: "CASH" },
    },
    label: "prepare tanpa shift sendiri",
  });
  assertCall(noShift, 409, "prepare tanpa shift sendiri");
  assert.equal(noShift.errorCode, "SHIFT_NOT_ACTIVE");
  const foreignShift = await call(baseUrl, "/checkouts/prepare", {
    method: "POST",
    token: otherToken,
    body: {
      attemptKey: nextAttempt("bukan-owner"),
      shiftId,
      items: [{ productId, quantity: 1 }],
      payment: { method: "CASH" },
    },
    label: "kasir lain pakai shift pemilik",
  });
  assertCall(foreignShift, 409, "kasir lain pakai shift pemilik");
  assert.equal(foreignShift.errorCode, "SHIFT_NOT_ACTIVE");
  const adminPrepare = await call(baseUrl, "/checkouts/prepare", {
    method: "POST",
    token: adminToken,
    body: {
      attemptKey: nextAttempt("admin-checkout"),
      shiftId,
      items: [{ productId, quantity: 1 }],
      payment: { method: "CASH" },
    },
    label: "ADMIN coba checkout",
  });
  assertCall(adminPrepare, 403, "ADMIN coba checkout");
  const badMethod = await call(baseUrl, "/checkouts/prepare", {
    method: "POST",
    token: cashierToken,
    body: {
      attemptKey: nextAttempt("metode-asing"),
      shiftId,
      items: [{ productId, quantity: 1 }],
      payment: { method: "E_WALLET" },
    },
    label: "prepare metode belum disahkan",
  });
  assertCall(badMethod, 422, "prepare metode belum disahkan");
  assert.equal(badMethod.errorCode, "VALIDATION_ERROR");
  record("AC-03.02", "Keranjang kosong/qty 0/negatif/produk nonaktif/shift asing/metode asing ditolak; ADMIN 403; tanpa mutasi", beforeInvalid, snapshot(), NO_MUTATION);

  // ---------------------------------------------------------------------------
  // 4. AC-03.04 — konfirmasi pembayaran wajib (tunai).
  // ---------------------------------------------------------------------------
  const beforePayment = snapshot();
  const payPrepare = await prepare(baseUrl, cashierToken, 1, "bayar-invalid");
  assertCall(payPrepare, 200, "prepare pembayaran");
  assert.deepEqual(core(beforePayment), core(snapshot()));
  const missingCash = await call(baseUrl, "/checkouts/commit", {
    method: "POST",
    token: cashierToken,
    body: {
      attemptKey: payPrepare.data.attemptKey,
      requestHash: payPrepare.data.requestHash,
      paymentConfirmation: { method: "CASH" },
    },
    label: "commit tanpa nominal tunai",
  });
  assertCall(missingCash, 422, "commit tanpa nominal tunai");
  const shortCash = await call(baseUrl, "/checkouts/commit", {
    method: "POST",
    token: cashierToken,
    body: {
      attemptKey: payPrepare.data.attemptKey,
      requestHash: payPrepare.data.requestHash,
      paymentConfirmation: { method: "CASH", cashReceivedRp: 1000 },
    },
    label: "commit tunai kurang",
  });
  assertCall(shortCash, 422, "commit tunai kurang");
  record("AC-03.04", "Commit tanpa uang diterima / tunai kurang ditolak 422; tidak ada sale/payment/mutasi", beforePayment, snapshot(), NO_MUTATION);

  // ---------------------------------------------------------------------------
  // 5. AC-03.05 — transaksi tunai sukses, rekonsiliasi penuh.
  // ---------------------------------------------------------------------------
  const beforeHappy = snapshot();
  const happyPrepare = await prepare(baseUrl, cashierToken, 2, "tunai-sukses");
  assertCall(happyPrepare, 200, "prepare tunai sukses");
  assert.equal(happyPrepare.data.status, "PREPARED");
  assert.equal(happyPrepare.data.quote.totalRp, 10_000);
  assert.match(happyPrepare.data.requestHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(core(snapshot()), core(beforeHappy), "prepare tidak boleh membuat transaksi");
  const happyCommit = await commit(baseUrl, cashierToken, happyPrepare, 20_000, "tunai-sukses");
  assertCall(happyCommit, 200, "commit tunai sukses");
  assert.equal(happyCommit.data.status, "COMMITTED");
  assert.equal(happyCommit.data.payment.changeRp, 10_000);
  assert.equal(happyCommit.data.totalRp, 10_000);
  const afterHappy = snapshot();
  record("AC-03.05", "Prepare tanpa sale; commit 2×Rp5.000 → 1 sale + 1 payment + 1 mutasi; stok 5→3; kembalian Rp10.000", beforeHappy, afterHappy, {
    sales: 1,
    saleItems: 1,
    payments: 1,
    movements: 1,
    stock: -2,
  }, {
    saleNo: happyCommit.data.saleNo,
    saleId: happyCommit.data.saleId,
    receipt: {
      totalRp: happyCommit.data.totalRp,
      cashReceivedRp: happyCommit.data.payment.cashReceivedRp,
      changeRp: happyCommit.data.payment.changeRp,
      saleTotalRp: afterHappy.money.saleTotalRp,
      itemTotalRp: afterHappy.money.itemTotalRp,
      paymentAmountRp: afterHappy.money.paymentAmountRp,
    },
  });
  const happySaleId = happyCommit.data.saleId;

  // ---------------------------------------------------------------------------
  // 6. AC-04.01 — retry, klik bayar ganda (paralel), kunci sama isi beda.
  // ---------------------------------------------------------------------------
  const beforeIdem = snapshot();
  const replay = await commit(baseUrl, cashierToken, happyPrepare, 20_000, "retry-identik");
  assertCall(replay, 200, "retry identik");
  assert.equal(replay.data.saleId, happySaleId);
  assert.deepEqual(core(snapshot()), core(beforeIdem), "retry identik tidak boleh menambah transaksi");

  const doublePrepare = await prepare(baseUrl, cashierToken, 1, "klik-ganda");
  assertCall(doublePrepare, 200, "prepare klik ganda");
  const [doubleA, doubleB] = await Promise.all([
    commit(baseUrl, cashierToken, doublePrepare, 10_000, "klik-ganda-A"),
    commit(baseUrl, cashierToken, doublePrepare, 10_000, "klik-ganda-B"),
  ]);
  assert.equal(doubleA.status, 200);
  assert.equal(doubleB.status, 200);
  assert.equal(doubleA.data.saleId, doubleB.data.saleId, "dua klik harus merujuk sale yang sama");
  const conflict = await prepare(baseUrl, cashierToken, 3, "isi-berbeda", doublePrepare.data.attemptKey);
  assertCall(conflict, 409, "kunci sama isi berbeda");
  assert.equal(conflict.errorCode, "IDEMPOTENCY_CONFLICT");
  record("AC-04.01", "Retry identik & dua commit paralel → satu sale; attemptKey sama isi beda → 409 tanpa mutasi", beforeIdem, snapshot(), {
    sales: 1,
    saleItems: 1,
    payments: 1,
    movements: 1,
    stock: -1,
  }, {
    doubleClickSaleId: doubleA.data.saleId,
    conflictingAttemptKey: doublePrepare.data.attemptKey,
  });

  // ---------------------------------------------------------------------------
  // 7. AC-03.03 — harga berubah setelah prepare.
  // ---------------------------------------------------------------------------
  const beforePrice = snapshot();
  const stalePrepare = await prepare(baseUrl, cashierToken, 1, "harga-lama");
  assertCall(stalePrepare, 200, "prepare harga lama");
  assert.equal(stalePrepare.data.quote.totalRp, 5000);
  const pricePatch = await call(baseUrl, `/products/${productId}`, {
    method: "PATCH",
    token: adminToken,
    body: { priceRp: 6000 },
    label: "ubah harga jadi 6000",
  });
  assertCall(pricePatch, 200, "ubah harga jadi 6000");
  const staleCommit = await commit(baseUrl, cashierToken, stalePrepare, 10_000, "commit-harga-lama");
  assertCall(staleCommit, 409, "commit harga lama");
  assert.equal(staleCommit.errorCode, "PRICE_CHANGED");
  assert.deepEqual(core(snapshot()), core(beforePrice));
  const revisedPrepare = await prepare(baseUrl, cashierToken, 1, "harga-baru");
  assertCall(revisedPrepare, 200, "prepare harga baru");
  assert.equal(revisedPrepare.data.quote.totalRp, 6000);
  const revisedCommit = await commit(baseUrl, cashierToken, revisedPrepare, 6000, "commit-harga-baru");
  assertCall(revisedCommit, 200, "commit harga baru");
  assert.equal(revisedCommit.data.payment.changeRp, 0);
  const afterPrice = snapshot();
  record("AC-03.03", "PRICE_CHANGED 409 tanpa commit; quote baru Rp6.000 disetujui lalu sukses; snapshot lama tetap Rp5.000", beforePrice, afterPrice, {
    sales: 1,
    saleItems: 1,
    payments: 1,
    movements: 1,
    stock: -1,
  }, {
    staleAttemptKey: stalePrepare.data.attemptKey,
    revisedAttemptKey: revisedPrepare.data.attemptKey,
  });

  // ---------------------------------------------------------------------------
  // 8. AC-03.06 — stok satu, jual dua ditolak, koreksi jadi satu.
  // ---------------------------------------------------------------------------
  assert.equal(snapshot().stock, 1);
  const beforeStock = snapshot();
  const tooMany = await prepare(baseUrl, cashierToken, 5, "stok-kurang");
  assertCall(tooMany, 409, "prepare stok kurang");
  assert.equal(tooMany.errorCode, "INSUFFICIENT_STOCK");
  assert.deepEqual(core(snapshot()), core(beforeStock));
  const corrected = await prepare(baseUrl, cashierToken, 1, "stok-dikoreksi");
  assertCall(corrected, 200, "prepare stok dikoreksi");
  const correctedCommit = await commit(baseUrl, cashierToken, corrected, 6000, "commit-stok-dikoreksi");
  assertCall(correctedCommit, 200, "commit stok dikoreksi");
  const afterStock = snapshot();
  record("AC-03.06", "Stok 1 menolak qty 5 tanpa mutasi; koreksi qty 1 sukses, stok 0", beforeStock, afterStock, {
    sales: 1,
    saleItems: 1,
    payments: 1,
    movements: 1,
    stock: -1,
  });

  // Tambah stok sintetis untuk dua uji interupsi (bukan transaksi penjualan).
  // Schema hanya mengizinkan SATU OPENING per produk, jadi pakai ADJUSTMENT
  // dengan alasan sintetis; delta ini ikut direkonsiliasi di snapshot().
  const refillDb = openDb(false);
  try {
    refillDb
      .prepare(
        `INSERT INTO inventory_movements
         (product_id, kind, delta, adjustment_reason, actor_id, created_at_ms)
         VALUES (?, 'ADJUSTMENT', 5, ?, 1, ?)`,
      )
      .run(productId, "T18-SINTETIS-REPLENISH-2", Date.now());
  } finally {
    refillDb.close();
  }
  const afterRefill = snapshot();
  assert.equal(afterRefill.stock, 5);
  pass("SETUP", "Penyesuaian stok sintetis +5 (T18-SINTETIS-REPLENISH-2) untuk uji interupsi", {
    before: afterStock,
    after: afterRefill,
    delta: deltaOf(afterStock, afterRefill),
  });

  // ---------------------------------------------------------------------------
  // 9. AC-03.05/04.01 — matikan proses SEBELUM commit (SIGKILL nyata).
  // ---------------------------------------------------------------------------
  const beforeCrashA = snapshot();
  const pending = await prepare(baseUrl, cashierToken, 1, "mati-sebelum-commit");
  assertCall(pending, 200, "prepare sebelum mati");
  assert.deepEqual(core(snapshot()), core(beforeCrashA));
  await stopServer(true);
  const afterKillA = snapshot();
  assert.deepEqual(core(afterKillA), core(beforeCrashA), "SIGKILL sebelum commit tidak boleh menyisakan data parsial");
  let nextPort = await freeLoopbackPort();
  baseUrl = await startServer(nextPort);
  cashierToken = await login(baseUrl, cashierUsername, cashierPassword, "login ulang setelah mati A");
  const pendingStatus = await call(baseUrl, `/checkouts/${encodeURIComponent(pending.data.attemptKey)}`, {
    token: cashierToken,
    label: "cek status upaya PREPARED",
  });
  assertCall(pendingStatus, 200, "cek status upaya PREPARED");
  assert.equal(pendingStatus.data.status, "PREPARED");
  assert.deepEqual(core(snapshot()), core(beforeCrashA));
  const resumed = await commit(baseUrl, cashierToken, pending, 6000, "lanjut-setelah-mati");
  assertCall(resumed, 200, "lanjut commit setelah mati");
  record("AC-03.05", "SIGKILL sebelum commit: nol data parsial; upaya PREPARED tetap ada; commit ulang niat sama → 1 sale", beforeCrashA, snapshot(), {
    sales: 1,
    saleItems: 1,
    payments: 1,
    movements: 1,
    stock: -1,
  }, {
    attemptKey: pending.data.attemptKey,
    statusAfterRestart: pendingStatus.data.status,
  });

  // ---------------------------------------------------------------------------
  // 10. AC-03.05/04.02 — matikan proses SESUDAH commit, sebelum hasil tampil.
  // ---------------------------------------------------------------------------
  const beforeCrashB = snapshot();
  const afterCommitPrep = await prepare(baseUrl, cashierToken, 1, "mati-sesudah-commit");
  assertCall(afterCommitPrep, 200, "prepare sebelum mati sesudah commit");
  const done = await commit(baseUrl, cashierToken, afterCommitPrep, 6000, "commit-lalu-mati");
  assertCall(done, 200, "commit lalu mati");
  const afterDone = snapshot();
  await stopServer(true);
  nextPort = await freeLoopbackPort();
  baseUrl = await startServer(nextPort);
  cashierToken = await login(baseUrl, cashierUsername, cashierPassword, "login ulang setelah mati B");
  const storedStatus = await call(baseUrl, `/checkouts/${encodeURIComponent(afterCommitPrep.data.attemptKey)}`, {
    token: cashierToken,
    label: "cek status COMMITTED setelah restart",
  });
  assertCall(storedStatus, 200, "cek status COMMITTED setelah restart");
  assert.equal(storedStatus.data.status, "COMMITTED");
  assert.equal(storedStatus.data.saleId, done.data.saleId);
  assert.deepEqual(core(snapshot()), core(afterDone), "restart tidak boleh menambah sale/mutasi");
  record("AC-04.01", "SIGKILL setelah commit: hasil COMMITTED ditemukan dengan saleId sama; tanpa penagihan/penjualan ulang", beforeCrashB, snapshot(), {
    sales: 1,
    saleItems: 1,
    payments: 1,
    movements: 1,
    stock: -1,
  }, {
    attemptKey: afterCommitPrep.data.attemptKey,
    saleId: done.data.saleId,
    saleNo: done.data.saleNo,
  });

  // ---------------------------------------------------------------------------
  // 11. AC-05.02 — shift persisten & tidak bisa diambil kasir lain setelah restart.
  // ---------------------------------------------------------------------------
  const beforeOwnership = snapshot();
  // Token dari proses backend lama sengaja tidak valid setelah restart;
  // sesi tersimpan di SQLite, jadi kasir login ulang (bukan sesi baru hack).
  const otherTokenAfter = await login(baseUrl, otherUsername, otherPassword, "login ulang kasir lain setelah restart");
  const currentAfter = await call(baseUrl, "/shifts/current", { token: cashierToken, label: "shift setelah restart" });
  assertCall(currentAfter, 200, "shift setelah restart");
  assert.equal(currentAfter.data.id, shiftId);
  assert.equal(currentAfter.data.openedAtMs, openedAtMs);
  const otherAfter = await call(baseUrl, "/shifts/current", { token: otherTokenAfter, label: "shift kasir lain setelah restart" });
  assertCall(otherAfter, 200, "shift kasir lain setelah restart");
  assert.equal(otherAfter.data, null);
  const takeover = await call(baseUrl, "/shifts/open", {
    method: "POST",
    token: otherTokenAfter,
    body: {},
    label: "kasir lain buka shift kedua",
  });
  assertCall(takeover, 409, "kasir lain buka shift kedua");
  assert.equal(takeover.errorCode, "SHIFT_ALREADY_OPEN");
  const foreignAfterRestart = await call(baseUrl, "/checkouts/prepare", {
    method: "POST",
    token: otherTokenAfter,
    body: {
      attemptKey: nextAttempt("owner-setelah-restart"),
      shiftId,
      items: [{ productId, quantity: 1 }],
      payment: { method: "CASH" },
    },
    label: "kasir lain checkout shift pemilik",
  });
  assertCall(foreignAfterRestart, 409, "kasir lain checkout shift pemilik");
  assert.equal(foreignAfterRestart.errorCode, "SHIFT_NOT_ACTIVE");
  record("AC-05.02", "Restart mempertahankan ID/waktu shift; pemilik lanjut, kasir lain null/409 dan tidak bisa checkout", beforeOwnership, snapshot(), NO_MUTATION, {
    shiftId,
    openedAtMs,
  });

  // ---------------------------------------------------------------------------
  // 12. AC-03.08 — riwayat tersimpan tidak bisa diedit lewat API.
  // ---------------------------------------------------------------------------
  const beforeImmutable = snapshot();
  const firstSaleId = happySaleId;
  const adminTokenAfter = await login(baseUrl, adminUsername, adminPassword, "login ulang ADMIN setelah restart");
  const deleteSale = await call(baseUrl, `/sales/${firstSaleId}`, { method: "DELETE", token: adminTokenAfter, label: "hapus sale lewat API" });
  const patchSale = await call(baseUrl, `/sales/${firstSaleId}`, {
    method: "PATCH",
    token: adminTokenAfter,
    body: { totalRp: 1 },
    label: "ubah sale lewat API",
  });
  assert.equal(deleteSale.status, 404);
  assert.equal(patchSale.status, 404);
  const dbCheck = openDb();
  let triggerCount = 0;
  try {
    triggerCount = Number(
      dbCheck.prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN ('sales','payments','sale_items')").get().total,
    );
  } finally {
    dbCheck.close();
  }
  record("AC-03.08", "Tidak ada endpoint edit/hapus sale (404); snapshot sale/payment/stok utuh", beforeImmutable, snapshot(), NO_MUTATION, {
    deleteStatus: deleteSale.status,
    patchStatus: patchSale.status,
    dbTriggersOnSalePayment: triggerCount,
    note: triggerCount === 0 ? "Imutabilitas bergantung pada tidak adanya endpoint/akses DB, bukan trigger DB" : "Ada trigger DB",
  });

  // ---------------------------------------------------------------------------
  // 13. Rekonsiliasi akhir & integritas.
  // ---------------------------------------------------------------------------
  assert.equal(blockedExternalCalls.length, 0, "ada upaya akses eksternal selama uji");
  const finalSnap = snapshot();
  assert.equal(finalSnap.integrity, "ok");
  assert.equal(finalSnap.fkViolations, 0);
  assert.equal(finalSnap.counts.saleWithoutPayment, 0);
  assert.equal(finalSnap.counts.orphanSaleItems, 0);
  assert.equal(finalSnap.counts.sales, finalSnap.counts.payments);
  assert.equal(finalSnap.counts.sales, finalSnap.counts.saleItems);
  assert.equal(finalSnap.counts.sales, 6, "enam commit sukses yang direncanakan");
  assert.equal(finalSnap.stock, 3, "saldo akhir = 5 + 5 - 7 unit terjual");
  assert.ok(finalSnap.paymentMethods.every((method) => method === "CASH"));
  pass("REKONSILIASI", `Integritas ok, FK 0, 6 sale = 6 payment = 6 item, saldo 3, semua CASH`, {
    final: finalSnap,
  });
}

function writeEvidence(status) {
  if (!jsonOut) return;
  const gitRead = (gitArgs) => {
    const result = spawnSync("git", gitArgs, { cwd: root, encoding: "utf8" });
    return result.status === 0 ? result.stdout.trim() : null;
  };
  const evidence = {
    task: "TASK-018",
    status,
    generatedAtIso: new Date().toISOString(),
    environment: {
      os: `${process.platform} ${osRelease()} (${process.arch})`,
      node: process.version,
      commit: gitRead(["rev-parse", "HEAD"]),
      branch: gitRead(["rev-parse", "--abbrev-ref", "HEAD"]),
      dataMode: "DEMO/QA synthetic — offline LOGICAL simulation, SQLite temp",
      offline: {
        clientFetchGuard: "hanya 127.0.0.1/localhost",
        proxyEnvForChildren: offlineEnv,
        blockedExternalCalls,
        physicalNetworkDisconnect: "NOT RUN",
      },
      dbPath,
      kept: keepDb,
    },
    passes: passCount,
    tests,
    attemptKeyLabels,
    calls,
  };
  writeFileSync(jsonOut, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`\nBukti JSON: ${jsonOut}`);
}

try {
  await main();
  finalStatus = "PASS";
  console.log(`\nPASS total ${passCount} pemeriksaan E2E TASK-018 (irisan offline).`);
} catch (error) {
  finalStatus = "FAIL";
  console.error(`\nFAIL: ${error instanceof Error ? error.message : String(error)}`);
  console.error(error instanceof Error ? error.stack : "");
  process.exitCode = 1;
} finally {
  await stopServer();
  writeEvidence(finalStatus);
  if (!keepDb) {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Folder temp bisa terkunci sebentar di Windows; tidak memengaruhi hasil.
    }
  } else {
    console.log(`\nDB sementara disimpan (--keep-db): ${dbPath}`);
  }
}
