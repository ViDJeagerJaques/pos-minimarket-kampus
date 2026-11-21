#!/usr/bin/env node
/**
 * TASK-031 — Benchmark katalog besar (1.000 SKU sintetis) lewat backend yang
 * di-spawn kandidat Electron. Jalankan saat Electron hidup di port 8787.
 *
 *   POS_SPIKE_DB="<userData>/pos-dev.sqlite" node scripts/task-031_catalog_bench.mjs
 *
 * Tidak memakai data pelanggan; hanya produk sintetis dengan prefiks T31B-.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.POS_SPIKE_API_BASE ?? "http://127.0.0.1:8787/api/v1";
const dbPath = process.env.POS_SPIKE_DB;
assert.ok(dbPath, "POS_SPIKE_DB wajib diisi");
const SKU_COUNT = Number(process.env.POS_SPIKE_SKU_COUNT ?? 1000);
const SCAN_COUNT = Number(process.env.POS_SPIKE_SCAN_COUNT ?? 100);

const html = readFileSync(resolve(root, "frontend/dist/index.html"), "utf8");
const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
/** BUG-123: bandingkan hostname persis; URL relatif & protocol-relative ditangani. */
function isExternalAsset(ref) {
  try {
    const candidate = ref.startsWith("//") ? `https:${ref}` : ref;
    const parsed = new URL(candidate, "file:///");
    const host = parsed.hostname.toLowerCase();
    return host.length > 0 && !ALLOWED_HOSTS.has(host);
  } catch {
    return false;
  }
}
const externalRefs = assets.filter(isExternalAsset);
assert.deepEqual(externalRefs, [], "tidak boleh ada referensi CDN/eksternal di index.html");

let verifiedFixtureCount = 0;
const db = new DatabaseSync(dbPath);
try {
  const categoryId = Number(
    db.prepare("SELECT id FROM categories ORDER BY id LIMIT 1").get()?.id ?? 0,
  );
  assert.ok(categoryId > 0, "harus ada kategori dari smoke sebelumnya");
  const insertProduct = db.prepare(
    `INSERT INTO products (category_id, sku, name, price_rp, active)
     VALUES (?, ?, ?, ?, 1)`,
  );
  const insertBarcode = db.prepare(
    "INSERT INTO product_barcodes (barcode, product_id) VALUES (?, ?)",
  );
  const existing = Number(
    db.prepare("SELECT COUNT(*) AS total FROM products WHERE sku LIKE 'T31B-%'").get().total,
  );
  // BUG-124: hanya pakai ulang fixture bila jumlahnya benar-benar sesuai.
  assert.ok(
    existing === 0 || existing === SKU_COUNT,
    `fixture T31B ada ${existing} baris, diharapkan 0 atau ${SKU_COUNT}`,
  );
  if (existing === 0) {
    db.exec("BEGIN");
    try {
      for (let i = 0; i < SKU_COUNT; i += 1) {
        const sku = `T31B-${String(i).padStart(6, "0")}`;
        const barcode = `T31B${String(i).padStart(10, "0")}`;
        const info = insertProduct.run(categoryId, sku, `Produk sintetis ${i}`, 2500);
        insertBarcode.run(barcode, Number(info.lastInsertRowid));
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  verifiedFixtureCount = Number(
    db.prepare("SELECT COUNT(*) AS total FROM products WHERE sku LIKE 'T31B-%'").get().total,
  );
  assert.equal(verifiedFixtureCount, SKU_COUNT, "jumlah fixture terverifikasi harus sama dengan yang diminta");
} finally {
  db.close();
}

// Perlu token: login sebagai admin dari smoke? Gunakan endpoint login dengan
// akun yang dibuat smoke lewat env (atau bootstrap baru bila tidak ada).
let adminToken;
const credsFile = process.env.POS_SPIKE_CREDS_FILE;
assert.ok(credsFile, "POS_SPIKE_CREDS_FILE wajib diisi (dari smoke)");
const creds = JSON.parse(readFileSync(credsFile, "utf8"));
const login = await fetch(`${base}/auth/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: creds.adminUser, password: creds.adminPass }),
});
assert.equal(login.status, 200, "login ADMIN dari kredensial smoke");
adminToken = (await login.json()).data.token;

const durations = [];
for (let i = 0; i < SCAN_COUNT; i += 1) {
  const idx = i % verifiedFixtureCount;
  const barcode = `T31B${String(idx).padStart(10, "0")}`;
  const t0 = process.hrtime.bigint();
  const res = await fetch(`${base}/products?barcode=${barcode}`, {
    headers: { accept: "application/json", authorization: `Bearer ${adminToken}` },
  });
  const payload = await res.json();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(res.status, 200);
  assert.equal(payload.data.length, 1, `barcode ${barcode} harus ketemu`);
  durations.push(ms);
}
durations.sort((a, b) => a - b);
const pct = (p) => durations[Math.ceil(durations.length * p) - 1];
const summary = {
  skuCount: verifiedFixtureCount,
  scanCount: SCAN_COUNT,
  success: durations.length,
  failed: 0,
  minMs: Number(durations[0].toFixed(2)),
  medianMs: Number(pct(0.5).toFixed(2)),
  p95Ms: Number(pct(0.95).toFixed(2)),
  maxMs: Number(durations[durations.length - 1].toFixed(2)),
  externalRefs,
};
console.log(JSON.stringify(summary, null, 2));
