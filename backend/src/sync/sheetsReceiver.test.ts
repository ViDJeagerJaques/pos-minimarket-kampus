import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { buildDemoSalePayload, sendDemoPayload } from "./sheetsProtocol.ts";

const fixtureSecret = randomBytes(24).toString("hex");

function receiver(options: { formattingFails?: boolean; existingFilter?: boolean } = {}) {
  const rows: Array<Array<string | number | Date>> = [["Waktu", "No Struk", "Kasir", "Total Rp", "Metode", "Barang"]];
  let locked = false;
  const properties: Record<string, string> = { WEBHOOK_SECRET: fixtureSecret };
  const formats: string[] = [];
  const sheet = { getLastRow: () => rows.length, getMaxRows: () => 100, getFilter: () => options.existingFilter ? {} : null, setFrozenRows: (n: number) => formats.push(`freeze:${n}`), autoResizeColumns: () => formats.push("resize"), getColumnWidth: () => 400, setColumnWidth: (_c: number, w: number) => formats.push(`width:${w}`), getRange: (r: number, c: number, n: number) => ({ getValues: () => rows.slice(r - 1, r - 1 + n).map(row => row.slice(0, 6)), setBackground(value: string) { if (options.formattingFails) throw new Error("format failure"); formats.push(`background:${value}`); return this; }, setFontColor(value: string) { formats.push(`font:${value}`); return this; }, setFontWeight(value: string) { formats.push(`weight:${value}`); return this; }, setBackgrounds() { formats.push("stripes"); return this; }, setNumberFormat(value: string) { formats.push(`format:${c}:${value}`); return this; }, setWrap(value: boolean) { formats.push(`wrap:${c}:${value}`); return this; }, createFilter() { formats.push("filter"); return this; } }), appendRow: (row: Array<string | number | Date>) => rows.push(row) };
  const context: Record<string, any> = {
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text: string) => ({ text, setMimeType() { return this; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => properties[key], setProperty: (key: string, value: string) => { properties[key] = value; } }) },
    LockService: { getScriptLock: () => ({ waitLock() { assert.equal(locked, false); locked = true; }, releaseLock() { locked = false; } }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }), flush() {} },
  };
  runInNewContext(readFileSync(new URL("./sheetsReceiver.gs", import.meta.url), "utf8"), context);
  return { rows, formats, send: (payload: unknown) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(payload) } }).text) };
}

test("format laporan diterapkan tanpa mengubah enam kolom, dan ping tidak memformat", () => {
 const { rows, formats, send } = receiver();
 assert.equal(send({ operation: "ping", secret: fixtureSecret }).ok, true); assert.equal(formats.length, 0);
 const sale = { secret: fixtureSecret, saleNo: "S-1", totalRp: 5000, method: "CASH", cashier: "kasir", committedAtMs: 123, items: "Barang x 1" };
 assert.equal(send(sale).ok, true); assert.equal(rows[1].length, 6); assert.equal(typeof rows[1][3], "number");
 for (const expected of ["background:#267349", "font:#ffffff", "weight:bold", "freeze:1", "stripes", "format:1:dd/MM/yyyy HH:mm:ss", 'format:4:"Rp" #,##0', "wrap:6:true", "filter", "resize", "width:360"]) assert.ok(formats.includes(expected), expected);
});

test("filter existing dipertahankan dan kegagalan format tidak mengubah acknowledgement", () => {
 const sale = { secret: fixtureSecret, saleNo: "S-1", totalRp: 5000, method: "CASH", cashier: "kasir", committedAtMs: 123, items: "Barang x 1" };
 const existing = receiver({ existingFilter: true }); assert.equal(existing.send(sale).ok, true); assert.equal(existing.formats.includes("filter"), false);
 const failing = receiver({ formattingFails: true }); assert.equal(failing.send(sale).ok, true); assert.equal(failing.send(sale).duplicate, true); assert.equal(failing.rows.length, 2);
});

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

test("retry setelah Sheets menghilangkan milidetik diterima tanpa menambah baris; konflik tetap ditolak", () => {
 const { rows, send } = receiver();
 const sale = { operation: "sale", secret: fixtureSecret, databaseNamespace: "db_fixture_123456", attemptKey: "co_1", saleNo: "S-206", totalRp: 105000, method: "CASH", cashier: "kasir", committedAtMs: 1795624809948, items: "Produk x 1" };
 assert.equal(send(sale).ok, true);
 rows[1][0] = new Date(1795624809000);
 assert.deepEqual(send(sale), { ok: true, duplicate: true });
 assert.equal(rows.length, 2);
 assert.equal(send({ ...sale, totalRp: 105001 }).ok, false);
 assert.equal(send({ ...sale, committedAtMs: 1795624810000 }).ok, false);
});

test("antrean empat transaksi pulih saat transaksi pertama sudah ada tanpa milidetik", async () => {
 const { rows, send } = receiver(); const ns = randomBytes(16).toString("hex");
 const mock: typeof fetch = async (_url, init) => new Response(JSON.stringify(send(JSON.parse(String(init?.body)))), { status: 200 });
 const items = Array.from({ length: 4 }, (_, i) => ({ attemptKey: `co_${i}`, saleNo: `S-${i}`, totalRp: 5000, method: i === 2 ? "QRIS_MANUAL" : "CASH", cashier: "kasir", committedAtMs: 1795624809948 + i * 1000, items: "Produk x 1" }));
 assert.equal(send(buildDemoSalePayload(fixtureSecret, ns, items[0]!)).ok, true);
 rows[1][0] = new Date(1795624809000);
 for (const item of items) assert.equal(await sendDemoPayload("https://script.google.com/macros/s/fixture/exec", buildDemoSalePayload(fixtureSecret, ns, item), mock), true);
 assert.equal(rows.length, 5);
});
