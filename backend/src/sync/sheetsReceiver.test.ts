import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { buildDemoSalePayload, sendDemoPayload } from "./sheetsProtocol.ts";

const fixtureSecret = randomBytes(24).toString("hex");

function receiver() {
  const rows: Array<Array<string | number | Date>> = [["Waktu", "No Struk", "Kasir", "Total Rp", "Metode", "Barang"]];
  let locked = false;
  const properties: Record<string, string> = { WEBHOOK_SECRET: fixtureSecret };
  const sheet = { getLastRow: () => rows.length, getRange: (r: number, _c: number, n: number) => ({ getValues: () => rows.slice(r - 1, r - 1 + n).map(row => row.slice(0, 6)) }), appendRow: (row: Array<string | number | Date>) => rows.push(row) };
  const context: Record<string, any> = {
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text: string) => ({ text, setMimeType() { return this; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => properties[key], setProperty: (key: string, value: string) => { properties[key] = value; } }) },
    LockService: { getScriptLock: () => ({ waitLock() { assert.equal(locked, false); locked = true; }, releaseLock() { locked = false; } }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }), flush() {} },
  };
  runInNewContext(readFileSync(new URL("./sheetsReceiver.gs", import.meta.url), "utf8"), context);
  return { rows, send: (payload: unknown) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(payload) } }).text) };
}

test("receiver DEMO validasi, ping, retry identik, konflik dan formula", () => {
  const { rows, send } = receiver();
  const sale = { operation: "sale", secret: fixtureSecret, databaseNamespace: "db_fixture_123456", attemptKey: "co_1", saleNo: "=FORMULA", totalRp: 5000, method: "CASH", cashier: "kasir", committedAtMs: 123, items: "@FORMULA" };
  assert.equal(send({ operation: "ping", secret: fixtureSecret }).ok, true);
  assert.equal(send({ ...sale, secret: "salah" }).ok, false);
  assert.equal(send({ ...sale, totalRp: -1 }).ok, false);
  assert.equal(send({ ...sale, attemptKey: undefined }).ok, false);
  assert.equal(send(sale).ok, true);
  assert.equal(send(sale).ok, true);
  assert.equal(send({ ...sale, totalRp: 6000 }).ok, false);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][1], "'=FORMULA");
  assert.equal(rows[1][5], "'@FORMULA");
  rows[1][5] = "@FORMULA";
  assert.equal(send(sale).ok, true);
  assert.equal(send({ ...sale, attemptKey: "co_2", saleNo: "S-2", method: "QRIS_MANUAL" }).ok, true);
  assert.equal(rows.length, 3);
});

test("sender DEMO kompatibel receiver, tunai dan QRIS retry tetap satu baris", async () => {
 const { rows, send } = receiver(); const ns = randomBytes(16).toString("hex");
 const mock: typeof fetch = async (_url, init) => new Response(JSON.stringify(send(JSON.parse(String(init?.body)))), { status: 200 });
 for (const [index, method] of ["CASH", "QRIS_MANUAL"].entries()) {
  const item = { attemptKey: `co_${index}`, saleNo: `S-${index}`, totalRp: 5000, method, cashier: "demo", committedAtMs: 123, items: "Produk x 1" };
  const payload = buildDemoSalePayload(fixtureSecret, ns, item);
  assert.equal(await sendDemoPayload("https://script.google.com/macros/s/fixture/exec", payload, mock), true);
  assert.equal(await sendDemoPayload("https://script.google.com/macros/s/fixture/exec", payload, mock), true);
  assert.equal(await sendDemoPayload("https://script.google.com/macros/s/fixture/exec", { ...payload, totalRp: 9000 }, mock), false);
 }
 assert.equal(rows.length, 3);
});

test("payload PR57 lama menulis enam kolom dan deduplikasi saleNo tanpa mengubah histori", () => {
 const { rows, send } = receiver();
 const legacy = { secret: fixtureSecret, saleNo: "S-LEGACY", totalRp: 5000, method: "CASH", cashier: "kasir", committedAtMs: 123, items: "Produk x 1" };
 assert.equal(send(legacy).ok, true); assert.equal(rows[1].length, 6);
 assert.equal(send(legacy).duplicate, true); assert.equal(rows.length, 2);
 assert.equal(send({ ...legacy, operation: "sale", databaseNamespace: "db_fixture_123456", attemptKey: "co_1" }).ok, true);
 assert.equal(send({ ...legacy, operation: "sale", databaseNamespace: "db_other_123456789", attemptKey: "co_2" }).ok, false);
 assert.equal(rows.length, 2);
});

test("receiver menolak header Penjualan yang berbeda tanpa mengubah histori", () => {
 const { rows, send } = receiver(); rows[0][3] = "Bukan Total";
 assert.equal(send({ operation: "ping", secret: fixtureSecret }).ok, false);
 assert.equal(send({ secret: fixtureSecret, saleNo: "S-1", totalRp: 5, method: "CASH", cashier: "kasir", committedAtMs: 1, items: "Barang" }).ok, false);
 assert.equal(rows.length, 1);
});
