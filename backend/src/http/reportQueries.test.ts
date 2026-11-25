import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  createTempDatabase,
  insertBaseFixture,
  migrateFresh,
} from "../../db/test/helpers.ts";
import { createAuthService } from "../auth/service.ts";
import { hashPassword } from "../auth/password.ts";
import { createSessionStore } from "../auth/session.ts";
import { createSecurityLogger } from "../security/securityLog.ts";
import { createReportService } from "../reports/service.ts";
import { createExcelSync } from "../reports/excelSync.ts";
import path from "node:path";
import { readFileSync } from "node:fs";
import { startHttpServer, type RunningServer } from "./app.ts";

const PASSWORD = `rpt-${randomBytes(8).toString("hex")}`;
const MIDNIGHT = Date.UTC(2026, 10, 16);
const HOUR = 3_600_000;

function setup() {
  const database = createTempDatabase("pos-http-report-");
  const db = database.open();
  migrateFresh(database);
  insertBaseFixture(db);
  db.prepare("INSERT INTO suppliers (id, name) VALUES (1, 'Supplier HTTP')").run();
  const insertUser = db.prepare(
    `INSERT INTO users (username, password_hash, role, active, created_at_ms)
     VALUES (?, ?, ?, 1, ?)`,
  );
  const adminId = Number(
    insertUser.run("admin.report", hashPassword(PASSWORD), "ADMIN", MIDNIGHT).lastInsertRowid,
  );
  const cashierId = Number(
    insertUser.run("kasir.report", hashPassword(PASSWORD), "CASHIER", MIDNIGHT).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO shifts (id, cashier_id, opened_at_ms, closed_at_ms, opening_cash_rp)
     VALUES (20, ?, ?, ?, 50000)`,
  ).run(cashierId, MIDNIGHT - HOUR, MIDNIGHT + HOUR);
  db.prepare(
    `INSERT INTO checkout_attempts (attempt_key, shift_id, cashier_id, request_hash, prepared_at_ms)
     VALUES ('co-http-rpt', 20, ?, zeroblob(32), ?)`,
  ).run(cashierId, MIDNIGHT);
  db.prepare(
    `INSERT INTO sales (id, sale_no, attempt_key, committed_at_ms, total_rp)
     VALUES (1, 'S-HTTP-1', 'co-http-rpt', ?, 5000)`,
  ).run(MIDNIGHT);
  db.prepare(
    `INSERT INTO sale_items (sale_id, product_id, sku_snapshot, name_snapshot, quantity, unit_price_rp, line_total_rp)
     VALUES (1, 1, 'FX-001', 'Fixture Produk', 2, 2500, 5000)`,
  ).run();
  db.prepare(
    `INSERT INTO payments (sale_id, method_code, amount_rp, verified_by, verified_at_ms)
     VALUES (1, 'QRIS_MANUAL', 5000, ?, ?)`,
  ).run(cashierId, MIDNIGHT);
  db.prepare(
    `INSERT INTO inventory_movements (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
     VALUES (1, 'OPENING', 5, 'HTTP-RPT-OPEN', ?, ?)`,
  ).run(adminId, MIDNIGHT - HOUR);
  db.prepare(
    `INSERT INTO inventory_movements (product_id, kind, delta, sale_item_id, actor_id, created_at_ms)
     VALUES (1, 'SALE', -2, 1, ?, ?)`,
  ).run(cashierId, MIDNIGHT);
  return { database, db };
}

async function start(db: DatabaseSync, excelConfig?: string): Promise<RunningServer> {
  const sessions = createSessionStore(db, { secret: randomBytes(32), ttlMs: 60 * 60 * 1000 });
  const securityLog = createSecurityLogger({ sink: () => {} });
  const auth = createAuthService(db, { sessions, securityLog });
  const reports = createReportService(db);
  return startHttpServer({ auth, sessions, securityLog, reports, excelSync: excelConfig ? createExcelSync(reports, excelConfig) : undefined });
}

async function call(base: string, path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${base}/api/v1${path}`, { headers });
  const text = await response.text();
  return { status: response.status, json: text.length > 0 ? (JSON.parse(text) as any) : {} };
}

async function login(base: string, username: string): Promise<string> {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const body = (await response.json()) as { data: { token: string } };
  assert.equal(response.status, 200);
  return body.data.token;
}

test("Excel sales memakai penjualan tersimpan satu kali dan hanya ADMIN", async () => {
  const { database, db } = setup();
  db.prepare("INSERT INTO payments (sale_id, method_code, amount_rp) VALUES (1, 'CASH', 5000)").run();
  db.prepare("INSERT INTO checkout_attempts (attempt_key, shift_id, cashier_id, request_hash, prepared_at_ms) SELECT 'co-cash', shift_id, cashier_id, zeroblob(32), prepared_at_ms FROM checkout_attempts WHERE attempt_key = 'co-http-rpt'").run();
  db.prepare("INSERT INTO sales (id, sale_no, attempt_key, committed_at_ms, total_rp) VALUES (2, 'S-CASH', 'co-cash', ?, 2500)").run(MIDNIGHT + 1);
  db.prepare("INSERT INTO sale_items (sale_id, product_id, sku_snapshot, name_snapshot, quantity, unit_price_rp, line_total_rp) VALUES (2, 1, 'FX-001', 'Air', 1, 2500, 2500)").run();
  db.prepare("INSERT INTO payments (sale_id, method_code, amount_rp) VALUES (2, 'CASH', 2500)").run();
  const running = await start(db, path.join(database.dir, "excel-config.json"));
  try {
    const admin = await login(running.url, "admin.report");
    const cashier = await login(running.url, "kasir.report");
    assert.equal((await call(running.url, "/reports/excel-sales", cashier)).status, 403);
    assert.equal((await call(running.url, "/sync/excel", cashier)).status, 403);
    for (const route of ["config", "run"]) {
      const denied = await fetch(`${running.url}/api/v1/sync/excel/${route}`, { method: "POST", headers: { Authorization: `Bearer ${cashier}`, "Content-Type": "application/json" }, body: JSON.stringify({ file: path.join(database.dir, "output.xlsx") }) });
      assert.equal(denied.status, 403);
    }
    const response = await call(running.url, "/reports/excel-sales", admin);
    assert.equal(response.status, 200);
    assert.deepEqual(response.json.data, [{ saleNo: "S-HTTP-1", committedAtMs: MIDNIGHT, cashier: "kasir.report", totalRp: 5000, method: "QRIS_MANUAL", items: "Fixture Produk x 2" }, { saleNo: "S-CASH", committedAtMs: MIDNIGHT + 1, cashier: "kasir.report", totalRp: 2500, method: "CASH", items: "Air x 1" }]);
    const output = path.join(database.dir, "output.xlsx");
    const post = (route: string, payload: object) => fetch(`${running.url}/api/v1/sync/excel/${route}`, { method: "POST", headers: { Authorization: `Bearer ${admin}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    assert.equal((await post("config", { file: output })).status, 200);
    assert.equal((await post("run", {})).status, 200);
    const first = readFileSync(output); assert.ok(first.includes(Buffer.from("S-HTTP-1"))); assert.ok(first.includes(Buffer.from("S-CASH")));
    assert.equal((await post("run", {})).status, 200); assert.ok(readFileSync(output).equals(first));
  } finally { await running.close(); db.close(); database.cleanup(); }
});

test("TASK-026 HTTP: GET /reports/daily & /reports/stock hanya ADMIN, filter divalidasi", async () => {
  const { database, db } = setup();
  const running = await start(db);
  try {
    const base = running.url;
    const adminToken = await login(base, "admin.report");
    const cashierToken = await login(base, "kasir.report");
    const range = `start=${MIDNIGHT - HOUR}&end=${MIDNIGHT + HOUR}`;

    const denied = await call(base, `/reports/daily?${range}`, cashierToken);
    assert.equal(denied.status, 403);
    const deniedStock = await call(base, "/reports/stock", cashierToken);
    assert.equal(deniedStock.status, 403);

    const daily = await call(base, `/reports/daily?${range}`, adminToken);
    assert.equal(daily.status, 200);
    const data = daily.json.data as {
      totalRp: number;
      saleCount: number;
      qrisManual: { totalRp: number };
      cash: { totalRp: number };
    };
    assert.equal(data.totalRp, 5000);
    assert.equal(data.saleCount, 1);
    assert.equal(data.qrisManual.totalRp, 5000);
    assert.equal(data.cash.totalRp, 0);

    const byShift = await call(
      base,
      `/reports/daily?${range}&shiftId=20`,
      adminToken,
    );
    assert.equal(byShift.status, 200);
    assert.equal((byShift.json.data as { saleCount: number }).saleCount, 1);
    const wrongShift = await call(
      base,
      `/reports/daily?${range}&shiftId=999`,
      adminToken,
    );
    assert.equal((wrongShift.json.data as { saleCount: number }).saleCount, 0);

    const invalid = await call(base, "/reports/daily", adminToken);
    assert.equal(invalid.status, 422);
    const emptyStart = await call(
      base,
      `/reports/daily?start=&end=${MIDNIGHT + HOUR}`,
      adminToken,
    );
    assert.equal(emptyStart.status, 422);
    const blankEnd = await call(
      base,
      `/reports/daily?start=${MIDNIGHT - HOUR}&end=%20%20`,
      adminToken,
    );
    assert.equal(blankEnd.status, 422);
    const explicitZero = await call(
      base,
      `/reports/daily?start=0&end=${MIDNIGHT + HOUR}`,
      adminToken,
    );
    assert.equal(explicitZero.status, 200, "start=0 tetap valid");
    const reversed = await call(
      base,
      `/reports/daily?start=${MIDNIGHT + HOUR}&end=${MIDNIGHT}`,
      adminToken,
    );
    assert.equal(reversed.status, 422);

    const stock = await call(base, "/reports/stock?lowStockThreshold=3", adminToken);
    assert.equal(stock.status, 200);
    const products = (stock.json.data as { products: Array<{ productId: number; onHand: number }> })
      .products;
    assert.equal(products.find((row) => row.productId === 1)?.onHand, 3);
  } finally {
    await running.close();
    db.close();
    database.cleanup();
  }
});
