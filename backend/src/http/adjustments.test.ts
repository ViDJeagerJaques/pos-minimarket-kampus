import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
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
import { InvalidBackupError, verifyBackup } from "../backup/service.ts";
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

async function start(db: DatabaseSync, backupDbPath?: string, backupEnv?: NodeJS.ProcessEnv, verifyBackupForListing?: typeof verifyBackup): Promise<RunningServer> {
  const sessions = createSessionStore(db, { secret: randomBytes(32), ttlMs: 60 * 60 * 1000 });
  const securityLog = createSecurityLogger({ sink: () => {} });
  const auth = createAuthService(db, { sessions, securityLog });
  const adjustments = createAdjustmentService(db, { now: () => FIXED_NOW });
  return startHttpServer({ auth, sessions, securityLog, adjustments, backupDbPath, backupEnv, verifyBackupForListing });
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


test("BUG-138 backup HTTP: ADMIN, verifikasi, restore salinan uji, dan tujuan gagal", async () => {
  const { database, db } = setup();
  const env = { ...process.env, POS_BACKUP_DIR: path.join(database.dir, "backups"), POS_RESTORE_TEST_DIR: path.join(database.dir, "restores"), POS_DB_PATH: database.dbPath };
  const running = await start(db, database.dbPath, env);
  try {
    const admin = await login(running.url, "admin.adjust");
    const cashier = await login(running.url, "kasir.adjust");
    assert.equal((await call(running.url, "/backups")).status, 401);
    assert.equal((await call(running.url, "/backups", { token: cashier })).status, 403);
    assert.equal((await call(running.url, "/backups", { token: cashier, payload: {} })).status, 403);
    const created = await call(running.url, "/backups", { token: admin, payload: {} });
    assert.equal(created.status, 200);
    const name = (created.json.data as { name: string }).name;
    const list = await call(running.url, "/backups", { token: admin });
    assert.equal((list.json.data as Array<{ name: string; valid: boolean }>)[0].name, name);
    assert.equal((list.json.data as Array<{ valid: boolean }>)[0].valid, true);
    const backupFile = path.join(env.POS_BACKUP_DIR, name);
    const original = readFileSync(backupFile);
    assert.equal((await call(running.url, "/backups", { token: admin })).status, 200);
    writeFileSync(backupFile, "rusak");
    const corrupted = await call(running.url, "/backups", { token: admin });
    assert.equal((corrupted.json.data as Array<{ valid: boolean }>)[0].valid, false);
    writeFileSync(backupFile, original);
    const restoredList = await call(running.url, "/backups", { token: admin });
    assert.equal((restoredList.json.data as Array<{ valid: boolean }>)[0].valid, true);
    assert.equal((await call(running.url, "/backups/restore-test", { token: cashier, payload: { name } })).status, 403);
    const restore = await call(running.url, "/backups/restore-test", { token: admin, payload: { name } });
    assert.equal(restore.status, 200);
    assert.notEqual((restore.json.data as { destinationPath: string }).destinationPath, database.dbPath);
    assert.equal((await call(running.url, "/backups/restore-test", { token: admin, payload: { name: "../bad.sqlite" } })).status, 422);
  } finally { await running.close(); db.close(); database.cleanup(); }
  const bad = setup();
  const blocked = path.join(bad.database.dir, "not-a-directory");
  writeFileSync(blocked, "fixture");
  const failed = await start(bad.db, bad.database.dbPath, { ...process.env, POS_BACKUP_DIR: blocked });
  try {
    const admin = await login(failed.url, "admin.adjust");
    const result = await call(failed.url, "/backups", { token: admin, payload: {} });
    assert.equal(result.status, 422);
    assert.match(String((result.json.error as { message: string }).message), /Cadangan gagal dibuat/);
  } finally { await failed.close(); bad.db.close(); bad.database.cleanup(); }
});


test("BUG-145 verifikasi sementara dicoba lagi, hasil definitif dan sukses di-cache", async () => {
  const { database, db } = setup();
  const env = { ...process.env, POS_BACKUP_DIR: path.join(database.dir, "backups"), POS_DB_PATH: database.dbPath };
  let calls = 0;
  let mode: "transient" | "valid" | "invalid" = "transient";
  const verify: typeof verifyBackup = (file, ...rest) => {
    calls++;
    if (mode === "transient") throw Object.assign(new Error("read denied"), { code: "EACCES" });
    if (mode === "invalid") throw new InvalidBackupError("user_version tidak valid");
    return verifyBackup(file, ...rest);
  };
  const running = await start(db, database.dbPath, env, verify);
  try {
    const admin = await login(running.url, "admin.adjust");
    const created = await call(running.url, "/backups", { token: admin, payload: {} });
    const name = (created.json.data as { name: string }).name;
    const list = async () => (await call(running.url, "/backups", { token: admin })).json.data as Array<{ valid: boolean }>;
    assert.equal((await list())[0]!.valid, false);
    assert.equal(calls, 1);
    mode = "valid";
    assert.equal((await list())[0]!.valid, true);
    assert.equal(calls, 2);
    assert.equal((await list())[0]!.valid, true);
    assert.equal(calls, 2);
    const backupFile = path.join(env.POS_BACKUP_DIR, name);
    const original = readFileSync(backupFile);
    writeFileSync(backupFile, Buffer.concat([original, Buffer.from([0])]));
    mode = "invalid";
    assert.equal((await list())[0]!.valid, false);
    assert.equal(calls, 3);
    assert.equal((await list())[0]!.valid, false);
    assert.equal(calls, 3);
  } finally { await running.close(); db.close(); database.cleanup(); }
});
