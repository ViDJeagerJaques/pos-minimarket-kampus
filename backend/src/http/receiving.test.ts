import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  createTempDatabase,
  FIXED_NOW,
  insertBaseFixture,
  migrateFresh,
} from "../../db/test/helpers.ts";
import { createAuthService } from "../auth/service.ts";
import { hashPassword } from "../auth/password.ts";
import { createSessionStore } from "../auth/session.ts";
import { createSecurityLogger } from "../security/securityLog.ts";
import { getStockBalance } from "../inventory/ledger.ts";
import { createReceivingService } from "../receiving/service.ts";
import { startHttpServer, type RunningServer } from "./app.ts";

const PASSWORD = `rcv-${randomBytes(8).toString("hex")}`;

function setup() {
  const database = createTempDatabase("pos-http-receive-");
  const db = database.open();
  migrateFresh(database);
  insertBaseFixture(db);
  db.prepare("INSERT INTO suppliers (id, name) VALUES (1, 'Supplier HTTP')").run();
  db.prepare(
    "INSERT INTO products (id, category_id, sku, name, price_rp, active) VALUES (2, 1, 'FX-002', 'Produk Dua', 1000, 1)",
  ).run();
  db.prepare(
    `INSERT INTO inventory_movements (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
     VALUES (1, 'OPENING', 2, 'RCV-HTTP-OPEN', 1, ?)`,
  ).run(FIXED_NOW);
  const insert = db.prepare(
    `INSERT INTO users (username, password_hash, role, active, created_at_ms)
     VALUES (?, ?, ?, 1, ?)`,
  );
  insert.run("admin.receive", hashPassword(PASSWORD), "ADMIN", FIXED_NOW);
  insert.run("kasir.receive", hashPassword(PASSWORD), "CASHIER", FIXED_NOW);
  return { database, db };
}

async function start(db: DatabaseSync): Promise<RunningServer> {
  const sessions = createSessionStore(db, { secret: randomBytes(32), ttlMs: 60 * 60 * 1000 });
  const securityLog = createSecurityLogger({ sink: () => {} });
  const auth = createAuthService(db, { sessions, securityLog });
  const receiving = createReceivingService(db, { now: () => FIXED_NOW });
  return startHttpServer({ auth, sessions, securityLog, receiving });
}

async function call(
  base: string,
  path: string,
  options: { method?: string; token?: string; payload?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (options.token !== undefined) headers.Authorization = `Bearer ${options.token}`;
  if (options.payload !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}/api/v1${path}`, {
    method: options.method ?? (options.payload === undefined ? "GET" : "POST"),
    headers,
    body: options.payload === undefined ? undefined : JSON.stringify(options.payload),
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }
  return { status: response.status, json };
}

async function login(base: string, username: string): Promise<string> {
  const result = await call(base, "/auth/login", {
    method: "POST",
    payload: { username, password: PASSWORD },
  });
  return ((result.json.data as { token: string }).token);
}

function count(db: DatabaseSync, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total);
}

test("TASK-025 HTTP: ADMIN terima +5, idempoten, CASHIER 403, invalid 422", async () => {
  const { database, db } = setup();
  const running = await start(db);
  try {
    const base = running.url;
    const adminToken = await login(base, "admin.receive");
    const cashierToken = await login(base, "kasir.receive");
    const payload = {
      receiptKey: "rcv-http-1",
      supplierId: 1,
      items: [{ productId: 1, quantity: 5 }],
      supplierRef: "SJ-HTTP-1",
    };

    const denied = await call(base, "/goods-receipts", {
      method: "POST",
      token: cashierToken,
      payload,
    });
    assert.equal(denied.status, 403);
    assert.equal(count(db, "goods_receipts"), 0);

    const invalid = await call(base, "/goods-receipts", {
      method: "POST",
      token: adminToken,
      payload: { ...payload, items: [{ productId: 1, quantity: 0 }] },
    });
    assert.equal(invalid.status, 422);
    assert.equal(count(db, "goods_receipts"), 0);

    const first = await call(base, "/goods-receipts", {
      method: "POST",
      token: adminToken,
      payload,
    });
    assert.equal(first.status, 201);
    const data = first.json.data as { receiptId: number; duplicate: boolean; totalQuantity: number };
    assert.equal(data.duplicate, false);
    assert.equal(data.totalQuantity, 5);
    assert.equal(getStockBalance(db, 1)?.onHand, 7);
    assert.equal(count(db, "goods_receipts"), 1);
    assert.equal(count(db, "receipt_items"), 1);
    assert.equal(count(db, "inventory_movements"), 2);
    assert.equal(count(db, "audit_log"), 1);

    const retry = await call(base, "/goods-receipts", {
      method: "POST",
      token: adminToken,
      payload,
    });
    assert.equal(retry.status, 201);
    const retryData = retry.json.data as { receiptId: number; duplicate: boolean };
    assert.equal(retryData.receiptId, data.receiptId);
    assert.equal(retryData.duplicate, true);
    assert.equal(getStockBalance(db, 1)?.onHand, 7);
    assert.equal(count(db, "goods_receipts"), 1);

    const conflict = await call(base, "/goods-receipts", {
      method: "POST",
      token: adminToken,
      payload: { ...payload, items: [{ productId: 1, quantity: 6 }] },
    });
    assert.equal(conflict.status, 409);
    assert.equal(
      (conflict.json.error as { code: string }).code,
      "IDEMPOTENCY_CONFLICT",
    );
    assert.equal(count(db, "goods_receipts"), 1);
    assert.equal(getStockBalance(db, 1)?.onHand, 7);
  } finally {
    await running.close();
    db.close();
    database.cleanup();
  }
});
