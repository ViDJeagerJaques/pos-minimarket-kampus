#!/usr/bin/env node
/**
 * TASK-031 — Smoke nyata melalui backend yang di-spawn kandidat Electron.
 *
 * Jalankan dari root repo saat kandidat Electron berjalan (default port 8787):
 *   POS_SPIKE_DB="<path userData>/pos-dev.sqlite" node scripts/task-031_electron_smoke.mjs
 *
 * Alur: login ADMIN → buat kasir → scan barcode → buka shift → prepare →
 * commit CASH → baca struk → cetak → cek SQLite. Data sintetis; tidak ada uang
 * sungguhan. Tidak mengubah DB operasional.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.POS_SPIKE_API_BASE ?? "http://127.0.0.1:8787/api/v1";
const dbPath = process.env.POS_SPIKE_DB;
assert.ok(dbPath, "POS_SPIKE_DB wajib diisi (path DB userData kandidat Electron)");

const tag = randomBytes(4).toString("hex");
const adminUser = `admin.t31.${tag}`;
const cashierUser = `kasir.t31.${tag}`;
const adminPass = `adm-${randomBytes(10).toString("hex")}`;
const cashierPass = `ksr-${randomBytes(10).toString("hex")}`;
let passCount = 0;
const checks = [];

function pass(label, detail = {}) {
  passCount += 1;
  console.log(`PASS ${passCount}. ${label}`);
  checks.push({ no: passCount, label, ...detail });
}

async function api(path, options = {}) {
  const headers = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const res = await fetch(`${base}${path}`, {
    method: options.method ?? "GET", headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* bukan JSON */ }
  return { status: res.status, json, data: json?.data ?? null, code: json?.error?.code ?? null, requestId: json?.requestId ?? json?.error?.requestId ?? null };
}

function expect(result, status, label) {
  assert.equal(result.status, status, `${label}: ${result.status} ${result.code ?? ""} ${JSON.stringify(result.json).slice(0, 200)}`);
}

async function main() {
  // Pastikan DB userData siap dipakai SQLite reader/writer lokal.
  const probe = new DatabaseSync(dbPath, { readOnly: true });
  probe.close();
  pass("Electron userData DB dapat dibuka", { dbPath });

  const boot = spawnSync(process.execPath, ["backend/src/auth/cli.ts", "bootstrap-admin", "--username", adminUser, "--db", dbPath], {
    cwd: root,
    env: { ...process.env, POS_DB_PATH: dbPath, POS_BOOTSTRAP_PASSWORD: adminPass, POS_DB_PROFILE: "development" },
    encoding: "utf8",
  });
  assert.equal(boot.status, 0, `bootstrap ADMIN gagal: ${boot.stderr || boot.stdout}`);
  if (process.env.POS_SPIKE_CREDS_FILE) {
    writeFileSync(
      process.env.POS_SPIKE_CREDS_FILE,
      `${JSON.stringify({ adminUser, adminPass, cashierUser, cashierPass })}\n`,
      "utf8",
    );
  }
  pass("Bootstrap ADMIN sintetis di DB userData");

  const adminLogin = await api("/auth/login", { method: "POST", body: { username: adminUser, password: adminPass } });
  expect(adminLogin, 200, "login ADMIN");
  const adminToken = adminLogin.data.token;
  const cashierCreate = await api("/users", {
    method: "POST", token: adminToken,
    body: { username: cashierUser, password: cashierPass, role: "CASHIER" },
  });
  expect(cashierCreate, 201, "buat kasir");
  const cashierLogin = await api("/auth/login", { method: "POST", body: { username: cashierUser, password: cashierPass } });
  expect(cashierLogin, 200, "login kasir");
  const cashierToken = cashierLogin.data.token;
  pass("Login ADMIN & CASHIER lewat backend Electron", { adminRequestId: adminLogin.requestId, cashierRequestId: cashierLogin.requestId });

  const category = await api("/categories", { method: "POST", token: adminToken, body: { name: `T31 Kat ${tag}` } });
  expect(category, 201, "buat kategori");
  const product = await api("/products", {
    method: "POST", token: adminToken,
    body: {
      categoryId: category.data.id, sku: `T31-SKU-${tag}`, name: "Produk Dummy TASK-031",
      priceRp: 5000, barcodes: ["000321"], supplierIds: [],
    },
  });
  expect(product, 201, "buat produk");
  const productId = product.data.id;

  const seed = new DatabaseSync(dbPath);
  try {
    seed.prepare(`INSERT INTO inventory_movements (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
                  VALUES (?, 'OPENING', 5, ?, 1, ?)`).run(productId, `T31-OPEN-${tag}`, Date.now());
  } finally { seed.close(); }
  pass("Stok awal sintetis +5 ditulis ke DB userData");

  const scan = await api("/products?barcode=000321", { token: cashierToken });
  expect(scan, 200, "scan barcode");
  assert.equal(scan.data.length, 1);
  assert.equal(scan.data[0].priceRp, 5000);
  pass("Scan barcode 000321 menemukan produk & harga dari backend", { requestId: scan.requestId });

  const shift = await api("/shifts/open", { method: "POST", token: cashierToken, body: { openingCashRp: 100000 } });
  expect(shift, 200, "buka shift");
  const attemptKey = `t31_${tag}_dummy`;
  const prepared = await api("/checkouts/prepare", {
    method: "POST", token: cashierToken,
    body: { attemptKey, shiftId: shift.data.id, items: [{ productId, quantity: 1 }], payment: { method: "CASH" } },
  });
  expect(prepared, 200, "prepare checkout");
  const committed = await api("/checkouts/commit", {
    method: "POST", token: cashierToken,
    body: {
      attemptKey, requestHash: prepared.data.requestHash,
      paymentConfirmation: { method: "CASH", cashReceivedRp: 5000 },
    },
  });
  expect(committed, 200, "commit checkout");
  assert.equal(committed.data.status, "COMMITTED");
  assert.equal(committed.data.payment.changeRp, 0);
  pass("Checkout dummy CASH Rp5.000 COMMITTED via backend Electron", { saleNo: committed.data.saleNo, attemptKey, requestId: committed.requestId });

  const receipt = await api(`/sales/${committed.data.saleId}/receipt`, { token: cashierToken });
  expect(receipt, 200, "baca struk");
  assert.ok(receipt.data.text.includes(committed.data.saleNo));
  const printed = await api(`/sales/${committed.data.saleId}/print`, { method: "POST", token: cashierToken, body: {} });
  expect(printed, 200, "cetak struk");
  assert.equal(printed.data.saleNo, committed.data.saleNo);
  pass("Struk dibaca & dicetak (adapter VIRTUAL) dengan nomor yang sama", { saleNo: printed.data.saleNo, channel: printed.data.channel });

  const db = new DatabaseSync(dbPath, { readOnly: true });
  let final;
  try {
    const count = (t) => Number(db.prepare(`SELECT COUNT(*) AS total FROM ${t}`).get().total);
    final = {
      sales: count("sales"), payments: count("payments"), saleItems: count("sale_items"),
      movements: count("inventory_movements"),
      stock: Number(db.prepare("SELECT on_hand FROM stock_balances WHERE product_id = ?").get(productId).on_hand),
      integrity: db.prepare("PRAGMA integrity_check").all().map((r) => r.integrity_check).join("; "),
      fk: db.prepare("PRAGMA foreign_key_check").all().length,
    };
  } finally { db.close(); }
  assert.equal(final.sales, 1);
  assert.equal(final.payments, 1);
  assert.equal(final.movements, 2);
  assert.equal(final.stock, 4);
  assert.equal(final.integrity, "ok");
  assert.equal(final.fk, 0);
  pass("SQLite akhir: 1 sale, 1 payment, stok 4, integrity ok, FK 0", { final });
}

try {
  await main();
  console.log(`\nPASS total ${passCount} smoke Electron TASK-031.`);
} catch (error) {
  console.error(`\nFAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
