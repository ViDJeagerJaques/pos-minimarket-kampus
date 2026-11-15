#!/usr/bin/env node
/**
 * TASK-012 E2E API nyata (tanpa mock):
 * migrasi SQLite sementara → bootstrap ADMIN → server loopback →
 * katalog ADMIN/CASHIER, barcode nol awal, duplikat, SKU invalid, 403,
 * audit harga, nonaktif, dan bukti tidak ada sale/payment/mutasi stok.
 *
 * Jalankan dari root repo: `node scripts/task-012_catalog_e2e.mjs`
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
const tempDir = mkdtempSync(join(tmpdir(), "pos-task012-e2e-"));
const dbPath = join(tempDir, "task012.sqlite");

const adminPassword = `adm-${randomBytes(12).toString("hex")}`;
const cashierPassword = `ksr-${randomBytes(12).toString("hex")}`;
const cashierUsername = "kasir.katalog.e2e";
const adminUsername = "admin.katalog.e2e";

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

function countRows(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total);
}

function dbCount(table) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return countRows(db, table);
  } finally {
    db.close();
  }
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
    // Log keamanan backend tidak memuat kata sandi/token; tidak dicetak agar output ringkas.
  });
  const baseUrl = await waitForServerStart(server);
  pass(`Server lokal berjalan di ${baseUrl} (127.0.0.1)`);

  // 3. Login ADMIN dan buat akun CASHIER untuk uji otorisasi.
  const adminLogin = await call(baseUrl, "/auth/login", {
    method: "POST",
    body: { username: adminUsername, password: adminPassword },
  });
  assert.equal(adminLogin.status, 200, "login admin harus 200");
  const adminToken = dataOf(adminLogin)?.token;
  assert.equal(typeof adminToken, "string");

  const createdCashier = await call(baseUrl, "/users", {
    method: "POST",
    token: adminToken,
    body: { username: cashierUsername, password: cashierPassword, role: "CASHIER" },
  });
  assert.equal(createdCashier.status, 201);

  const cashierLogin = await call(baseUrl, "/auth/login", {
    method: "POST",
    body: { username: cashierUsername, password: cashierPassword },
  });
  assert.equal(cashierLogin.status, 200);
  const cashierToken = dataOf(cashierLogin)?.token;
  assert.equal(typeof cashierToken, "string");
  pass("Login ADMIN dan CASHIER nyata melalui backend loopback");

  // 4. ADMIN menyimpan kategori, supplier, produk dengan barcode "000123".
  const category = await call(baseUrl, "/categories", {
    method: "POST",
    token: adminToken,
    body: { name: "Minuman E2E" },
  });
  assert.equal(category.status, 201);
  const categoryId = dataOf(category)?.id;
  assert.equal(Number.isSafeInteger(categoryId), true);

  const supplier = await call(baseUrl, "/suppliers", {
    method: "POST",
    token: adminToken,
    body: { name: "Supplier E2E" },
  });
  assert.equal(supplier.status, 201);
  const supplierId = dataOf(supplier)?.id;
  assert.equal(Number.isSafeInteger(supplierId), true);

  const product = await call(baseUrl, "/products", {
    method: "POST",
    token: adminToken,
    body: {
      categoryId,
      sku: "E2E-001",
      name: "Produk E2E",
      priceRp: 5000,
      barcodes: ["000123"],
      supplierIds: [supplierId],
    },
  });
  assert.equal(product.status, 201);
  const productData = dataOf(product);
  assert.equal(productData?.sku, "E2E-001");
  assert.deepEqual(productData?.barcodes, ["000123"]);
  assert.deepEqual(productData?.supplierIds, [supplierId]);
  assert.equal(productData?.stockOnHand, 0);
  pass("AC-02.01 ADMIN membuat kategori, supplier, produk, dan relasi supplier");
  pass('AC-02.02 barcode "000123" tersimpan sebagai string dengan nol awal');

  // 5. Barcode duplikat ditolak; tidak menambah produk.
  const beforeDuplicate = dbCount("products");
  const duplicate = await call(baseUrl, "/products", {
    method: "POST",
    token: adminToken,
    body: {
      categoryId,
      sku: "E2E-002",
      name: "Produk Duplikat",
      priceRp: 1000,
      barcodes: ["000123"],
    },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(errorCode(duplicate), "DUPLICATE_BARCODE");
  const afterDuplicate = dbCount("products");
  assert.equal(afterDuplicate, beforeDuplicate, "barcode duplikat tidak boleh menambah produk");
  pass("AC-02.02 barcode duplikat ditolak 409 DUPLICATE_BARCODE tanpa baris produk baru");

  // 6. SKU invalid ditolak 422 dengan pesan server.
  const invalidSku = await call(baseUrl, "/products", {
    method: "POST",
    token: adminToken,
    body: {
      categoryId,
      sku: "SKU SALAH",
      name: "SKU Invalid",
      priceRp: 1000,
      barcodes: [],
    },
  });
  assert.equal(invalidSku.status, 422);
  assert.equal(errorCode(invalidSku), "VALIDATION_ERROR");
  assert.match(invalidSku.json?.error?.message ?? "", /SKU/i);
  pass("SKU invalid ditolak server 422 VALIDATION_ERROR dengan pesan yang dapat ditampilkan UI");

  // 7. CASHIER scan barcode nol awal; versi tanpa nol tidak cocok.
  const scanned = await call(baseUrl, "/products?barcode=000123", { token: cashierToken });
  assert.equal(scanned.status, 200);
  const scannedRows = dataOf(scanned);
  assert.equal(scannedRows.length, 1);
  assert.equal(scannedRows[0]?.id, productData?.id);

  const withoutLeadingZero = await call(baseUrl, "/products?barcode=123", {
    token: cashierToken,
  });
  assert.equal(withoutLeadingZero.status, 200);
  assert.equal(dataOf(withoutLeadingZero).length, 0);
  pass("AC-03.01 CASHIER scan barcode 000123 menemukan produk; 123 tidak cocok (nol awal akurat)");

  // 8. Barcode tambahan dapat ditambah/dihapus ADMIN.
  const addedBarcode = await call(baseUrl, `/products/${productData.id}/barcodes`, {
    method: "POST",
    token: adminToken,
    body: { barcode: "000124" },
  });
  assert.equal(addedBarcode.status, 201);
  assert.deepEqual(dataOf(addedBarcode)?.barcodes, ["000123", "000124"]);

  const removedBarcode = await call(
    baseUrl,
    `/products/${productData.id}/barcodes/${encodeURIComponent("000124")}`,
    { method: "DELETE", token: adminToken },
  );
  assert.equal(removedBarcode.status, 200);
  assert.deepEqual(dataOf(removedBarcode)?.barcodes, ["000123"]);
  pass("Pemeliharaan barcode ADMIN (tambah/hapus) mempertahankan teks nol awal");

  // 9. Otorisasi backend: CASHIER ditolak 403 pada operasi tulis dan includeInactive.
  const productsBeforeDenied = dbCount("products");
  const cashierCreate = await call(baseUrl, "/products", {
    method: "POST",
    token: cashierToken,
    body: {
      categoryId,
      sku: "CASHIER-001",
      name: "Dilarang",
      priceRp: 1000,
      barcodes: [],
    },
  });
  assert.equal(cashierCreate.status, 403);
  assert.equal(errorCode(cashierCreate), "FORBIDDEN");

  const cashierPatch = await call(baseUrl, `/products/${productData.id}`, {
    method: "PATCH",
    token: cashierToken,
    body: { priceRp: 1 },
  });
  assert.equal(cashierPatch.status, 403);

  const cashierIncludeInactive = await call(baseUrl, "/products?includeInactive=true", {
    token: cashierToken,
  });
  assert.equal(cashierIncludeInactive.status, 403);

  const productsAfterDenied = dbCount("products");
  assert.equal(productsAfterDenied, productsBeforeDenied, "403 tidak boleh menambah produk");
  pass("AC-02.03/otorisasi: CASHIER menerima 403 pada tulis katalog dan includeInactive tanpa perubahan data");

  // 10. Harga berubah + audit PRICE_CHANGED.
  const priceUpdate = await call(baseUrl, `/products/${productData.id}`, {
    method: "PATCH",
    token: adminToken,
    body: { priceRp: 6000 },
  });
  assert.equal(priceUpdate.status, 200);
  assert.equal(dataOf(priceUpdate)?.priceRp, 6000);

  const db = new DatabaseSync(dbPath, { readOnly: true });
  let auditDetails;
  try {
    const row = db
      .prepare("SELECT details FROM audit_log WHERE action = 'PRICE_CHANGED' ORDER BY id DESC LIMIT 1")
      .get();
    assert.ok(row, "audit PRICE_CHANGED harus ada");
    auditDetails = JSON.parse(row.details);
  } finally {
    db.close();
  }
  assert.equal(auditDetails.sku, "E2E-001");
  assert.equal(auditDetails.oldPriceRp, 5000);
  assert.equal(auditDetails.newPriceRp, 6000);
  pass("AC-02.03 perubahan harga tersimpan dan audit mencatat SKU, harga lama, dan harga baru");

  // 11. Produk nonaktif hilang dari CASHIER, tetap terlihat ADMIN.
  const deactivate = await call(baseUrl, `/products/${productData.id}`, {
    method: "PATCH",
    token: adminToken,
    body: { active: false },
  });
  assert.equal(deactivate.status, 200);
  assert.equal(dataOf(deactivate)?.active, false);

  const cashierAfterDisable = await call(baseUrl, "/products?barcode=000123", {
    token: cashierToken,
  });
  assert.equal(cashierAfterDisable.status, 200);
  assert.equal(dataOf(cashierAfterDisable).length, 0);

  const adminInactive = await call(baseUrl, "/products?includeInactive=true&barcode=000123", {
    token: adminToken,
  });
  assert.equal(adminInactive.status, 200);
  assert.equal(dataOf(adminInactive).length, 1);
  pass("Produk nonaktif tidak muncul untuk CASHIER; ADMIN masih dapat melihatnya");

  // 12. Bukti tidak ada penjualan/pembayaran/mutasi stok dari katalog/draft.
  const verify = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const counts = {
      sales: countRows(verify, "sales"),
      payments: countRows(verify, "payments"),
      inventoryMovements: countRows(verify, "inventory_movements"),
    };
    assert.deepEqual(counts, { sales: 0, payments: 0, inventoryMovements: 0 });

    const barcodeRow = verify
      .prepare("SELECT barcode, typeof(barcode) AS kind FROM product_barcodes WHERE barcode = ?")
      .get("000123");
    assert.ok(barcodeRow, "barcode 000123 harus tersimpan");
    assert.equal(barcodeRow.barcode, "000123");
    assert.equal(barcodeRow.kind, "text", "barcode harus disimpan sebagai TEXT");

    const stockRow = verify
      .prepare("SELECT on_hand FROM stock_balances WHERE product_id = ?")
      .get(productData.id);
    assert.equal(Number(stockRow?.on_hand ?? 0), 0);
  } finally {
    verify.close();
  }
  pass("AC-03.07 katalog dan draft tidak membuat sale, payment, atau inventory_movement; stok tetap 0");
}

try {
  await main();
  console.log(`\nPASS total ${passCount} pemeriksaan E2E API nyata (TASK-012).`);
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
