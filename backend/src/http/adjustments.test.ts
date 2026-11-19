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
import { createAdjustmentService } from "../inventory/adjustments.ts";
import { startHttpServer, type RunningServer } from "./app.ts";

const PASSWORD = `adj-${randomBytes(8).toString("hex")}`;

function setup() {
  const database = createTempDatabase("pos-http-adjust-");
  const db = database.open();
  migrateFresh(database);
  insertBaseFixture(db);
  db.prepare(
    `INSERT INTO inventory_movements (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
     VALUES (1, 'OPENING', 5, 'DEMO-ADJUST-HTTP', 1, ?)`,
  ).run(FIXED_NOW);
  const insert = db.prepare(
    `INSERT INTO users (username, password_hash, role, active, created_at_ms)
     VALUES (?, ?, ?, 1, ?)`,
  );
  insert.run("admin.adjust", hashPassword(PASSWORD), "ADMIN", FIXED_NOW);
  insert.run("kasir.adjust", hashPassword(PASSWORD), "CASHIER", FIXED_NOW);
  return { database, db };
}

async function start(db: DatabaseSync): Promise<RunningServer> {
  const sessions = createSessionStore(db, { secret: randomBytes(32), ttlMs: 60 * 60 * 1000 });
  const securityLog = createSecurityLogger({ sink: () => {} });
  const auth = createAuthService(db, { sessions, securityLog });
  const adjustments = createAdjustmentService(db, { now: () => FIXED_NOW });
  return startHttpServer({ auth, sessions, securityLog, adjustments });
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

test("TASK-039 HTTP: auth, input, actor/waktu server, dua request identik satu koreksi", async () => {
  const { database, db } = setup();
  const running = await start(db);
  try {
    const token = await login(running.url, "admin.adjust");
    const cashierToken = await login(running.url, "kasir.adjust");
    const payload = { adjustmentKey: "adj-http", productId: 1, expectedOnHand: 5,
      targetOnHand: 3, reason: "DEMO selisih fisik", actorId: 2, committedAtMs: 0 };
    const adjust = (body: unknown, auth = token) => call(running.url, "/inventory/adjustments",
      { token: auth, payload: body });
    assert.equal((await call(running.url, "/inventory/adjustments", { payload })).status, 401);
    assert.equal((await adjust(payload, cashierToken)).status, 403);
    assert.equal(count(db, "inventory_movements"), 1);
    assert.equal(count(db, "audit_log"), 0);
    for (const patch of [{ reason: "" }, { targetOnHand: -1 }, { targetOnHand: 1.5 }, { adjustmentKey: null }]) {
      assert.equal((await adjust({ ...payload, ...patch })).status, 422);
    }
    assert.equal((await adjust({ ...payload, expectedOnHand: 4 })).status, 409);
    assert.equal((await adjust({ ...payload, productId: 999 })).status, 404);
    assert.equal(getStockBalance(db, 1)?.onHand, 5);
    assert.equal(count(db, "inventory_adjustments"), 0);
    assert.equal(count(db, "audit_log"), 0);

    const results = await Promise.all([adjust(payload), adjust(payload)]);
    assert.deepEqual(results.map((r) => r.status), [201, 201]);
    const data = results.map((r) => r.json.data as {
      duplicate: boolean; movementId: number; delta: number; onHand: number;
      actorId: number; committedAtMs: number;
    });
    assert.deepEqual(data.map((r) => r.duplicate).sort(), [false, true]);
    assert.equal(data[0]!.movementId, data[1]!.movementId);
    assert.equal(data[0]!.delta, -2);
    assert.equal(data[0]!.onHand, 3);
    const actor = db.prepare("SELECT id FROM users WHERE username = 'admin.adjust'").get()!;
    assert.equal(data[0]!.actorId, actor.id);
    assert.equal(data[0]!.committedAtMs, FIXED_NOW);
    assert.equal(count(db, "inventory_movements"), 2);
    assert.equal(count(db, "inventory_adjustments"), 1);
    assert.equal(count(db, "audit_log"), 1);
    assert.equal(getStockBalance(db, 1)?.onHand, 3);
    const conflict = await adjust({ ...payload, targetOnHand: 2 });
    assert.equal(conflict.status, 409);
    assert.equal((conflict.json.error as { code: string }).code, "IDEMPOTENCY_CONFLICT");
    assert.equal((await adjust(payload, cashierToken)).status, 403);
    assert.equal(getStockBalance(db, 1)?.onHand, 3);
    db.prepare("UPDATE users SET active = 0 WHERE username = 'admin.adjust'").run();
    assert.equal((await adjust(payload)).status, 401);
    assert.equal(count(db, "audit_log"), 1);
  } finally {
    await running.close();
    db.close();
    database.cleanup();
  }
});
