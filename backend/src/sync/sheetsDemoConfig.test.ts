import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { createTempDatabase, migrateFresh, insertBaseFixture, insertSaleFixture } from "../../db/test/helpers.ts";
import { createDemoConfigManager, readDemoConfig } from "./sheetsDemoConfig.ts";
import { createSheetsSyncService } from "./sheetsSync.ts";

const secret = randomBytes(24).toString("hex");
const endpoint = "https://script.google.com/macros/s/synthetic_demo/exec";

test("DEMO konfigurasi, ping, secret, watermark dan antrean pulih setelah restart", async () => {
 const temp = createTempDatabase("sheets-v2-"); migrateFresh(temp); const db = temp.open();
 const configPath = path.join(temp.dir, "config", "sheets-sync.json");
 const seen: Array<Record<string, unknown>> = [];
 let online = false;
 const mock: typeof fetch = async (_url, init) => { const payload = JSON.parse(String(init?.body)) as Record<string, unknown>; seen.push(payload); if (payload.operation === "ping") return new Response(JSON.stringify({ ok: true, operation: "ping" }), { status: 200 }); if (!online) throw new Error("offline"); return new Response(JSON.stringify({ ok: true }), { status: 200 }); };
 try {
  const manager = createDemoConfigManager(db, temp.dbPath, configPath, null, mock);
  assert.deepEqual(manager.status(), { configured: false, restartRequired: false });
  assert.throws(() => manager.save({ webhookUrl: "https://evil.invalid/", secret, futureSalesOnly: true }));
  assert.throws(() => manager.save({ webhookUrl: endpoint, secret }));
  assert.equal((await manager.ping({ webhookUrl: endpoint, secret })).connected, true);
  assert.deepEqual(manager.save({ webhookUrl: endpoint, secret, futureSalesOnly: true }), { saved: true, restartRequired: true });
  assert.deepEqual(manager.status(), { configured: true, restartRequired: true });
  assert.equal(JSON.stringify(manager.status()).includes(secret), false);
  const config = readDemoConfig(configPath)!; assert.equal(config.afterSaleId, 0);
  assert.throws(() => manager.save({ webhookUrl: "https://script.google.com/macros/s/other/exec", secret, futureSalesOnly: true }));
  const source = createSheetsSyncService({ db, dbPath: temp.dbPath, configPath, demoOnly: true, fetchImpl: mock, retryBaseDelayMs: 60000 });
  source.notifySaleCommitted({ saleId: 1, saleNo: "DEMO-001", attemptKey: "co_demo", requestHash: "a".repeat(64), status: "COMMITTED", totalRp: 5000, committedAtMs: 1, payment: { method: "CASH", amountRp: 5000, cashReceivedRp: 5000, changeRp: 0, evidenceRef: null, verifiedAtMs: null, verifiedBy: null } }, "kasir");
  await source.flush(); assert.equal(source.getPendingCount(), 1); source.stop();
  online = true;
  const restarted = createSheetsSyncService({ db, dbPath: temp.dbPath, configPath, demoOnly: true, fetchImpl: mock });
  await restarted.flush(); assert.equal(restarted.getPendingCount(), 0); restarted.stop();
  const sales = seen.filter(row => row.operation === "sale"); assert.ok(sales.length >= 2); assert.ok(sales.every(row => row.attemptKey === "co_demo")); assert.equal(sales[0].attemptKey, "co_demo"); assert.equal(sales[0].databaseNamespace, config.databaseNamespace);
 } finally { db.close(); temp.cleanup(); }
});


test("DEMO tidak mengirim histori atau antrean lama yang asalnya tidak diketahui", async () => {
 const temp = createTempDatabase("sheets-old-"); migrateFresh(temp); const db = temp.open();
 const configPath = path.join(temp.dir, "sheets.json"); let deliveries = 0;
 const fetchImpl: typeof fetch = async () => { deliveries++; return new Response(JSON.stringify({ ok: true }), { status: 200 }); };
 try {
  insertBaseFixture(db); const sale = insertSaleFixture(db);
  db.prepare("INSERT INTO payments (sale_id, method_code, amount_rp) VALUES (?, 'CASH', 5000)").run(sale.saleId);
  const legacyPath = path.join(temp.dir, "sheets-sync-queue.json");
  const legacy = JSON.stringify({ pending: [{ attemptKey: "untrusted" }], sentKeys: [] });
  writeFileSync(legacyPath, legacy);
  const manager = createDemoConfigManager(db, temp.dbPath, configPath, null, fetchImpl);
  manager.save({ webhookUrl: endpoint, secret, futureSalesOnly: true });
  const source = createSheetsSyncService({ db, dbPath: temp.dbPath, configPath, demoOnly: true, fetchImpl });
  source.notifySaleCommitted({ saleId: sale.saleId, saleNo: "SALE-FX-0001", attemptKey: "attempt-fixture-1", requestHash: "a".repeat(64), status: "COMMITTED", totalRp: 5000, committedAtMs: 1, payment: { method: "CASH", amountRp: 5000, cashReceivedRp: 5000, changeRp: 0, evidenceRef: null, verifiedAtMs: null, verifiedBy: null } }, "kasir");
  await source.flush(); assert.equal(deliveries, 0); assert.equal(source.getPendingCount(), 0); assert.equal(readFileSync(legacyPath, "utf8"), legacy); source.stop();
 } finally { db.close(); temp.cleanup(); }
});
