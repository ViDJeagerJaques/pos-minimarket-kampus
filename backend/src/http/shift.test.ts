import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  createTempDatabase,
  FIXED_NOW,
  migrateFresh,
} from "../../db/test/helpers.ts";
import { createAuthService } from "../auth/service.ts";
import { createSessionStore } from "../auth/session.ts";
import { hashPassword } from "../auth/password.ts";
import { createSecurityLogger } from "../security/securityLog.ts";
import { startHttpServer, type RunningServer } from "./app.ts";
import { createShiftService } from "../shift/service.ts";

const ADMIN_PASSWORD = "rahasia.admin.shift";
const CASHIER_PASSWORD = "rahasia.kasir.shift";
const OTHER_PASSWORD = "rahasia.lain.shift";

function createDatabase() {
  const database = createTempDatabase("pos-shift-http-");
  const db = database.open();
  migrateFresh(database);
  const insert = db.prepare(
    `INSERT INTO users (id, username, password_hash, role, active, created_at_ms)
     VALUES (?, ?, ?, ?, 1, ?)`,
  );
  insert.run(1, "admin.shift", hashPassword(ADMIN_PASSWORD), "ADMIN", FIXED_NOW);
  insert.run(2, "kasir.shift", hashPassword(CASHIER_PASSWORD), "CASHIER", FIXED_NOW);
  insert.run(3, "kasir.lain", hashPassword(OTHER_PASSWORD), "CASHIER", FIXED_NOW);
  return { database, db };
}

type Handle = {
  running: RunningServer;
  db: DatabaseSync;
};

function startHandle(db: DatabaseSync, secret?: Buffer): Promise<Handle> {
  const sessions = createSessionStore(db, {
    secret: secret ?? Buffer.from("shift-http-secret-0123456789abcdef0123"),
    ttlMs: 12 * 60 * 60 * 1000,
  });
  const securityLog = createSecurityLogger();
  const auth = createAuthService(db, { sessions, securityLog });
  const shift = createShiftService(db);
  return startHttpServer({ auth, sessions, securityLog, shift, port: 0 }).then((running) => ({
    running,
    db,
  }));
}

async function call(
  base: string,
  path: string,
  options: { method?: string; token?: string; payload?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers.authorization = `Bearer ${options.token}`;
  }
  if (options.payload !== undefined) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(`${base}/api/v1${path}`, {
    method: options.method ?? (options.payload !== undefined ? "POST" : "GET"),
    headers,
    body: options.payload,
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text.length > 0 ? (JSON.parse(text) as unknown) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
}

async function login(base: string, username: string, password: string) {
  const result = await call(base, "/auth/login", {
    method: "POST",
    payload: JSON.stringify({ username, password }),
  });
  return (result.json as { data: { token: string } }).data.token;
}

function activeShiftCount(db: DatabaseSync): number {
  return Number(
    (db.prepare("SELECT COUNT(*) AS total FROM shifts WHERE closed_at_ms IS NULL").get() as {
      total: number;
    }).total,
  );
}

test("AC-05.01/AC-05.02 via HTTP: buka shift, pemilik melihat, kasir lain null, upaya kedua 409", async () => {
  const { database, db } = createDatabase();
  const handle = await startHandle(db);
  try {
    const base = handle.running.url;
    const cashierToken = await login(base, "kasir.shift", CASHIER_PASSWORD);

    const opened = await call(base, "/shifts/open", {
      method: "POST",
      token: cashierToken,
      payload: JSON.stringify({ openingCashRp: 50000 }),
    });
    assert.equal(opened.status, 200);
    const shift = (opened.json as { data: { id: number; cashierId: number } }).data;
    assert.equal(shift.cashierId, 2);

    const current = await call(base, "/shifts/current", { token: cashierToken });
    assert.equal(current.status, 200);
    assert.deepEqual((current.json as { data: unknown }).data, shift);

    const otherToken = await login(base, "kasir.lain", OTHER_PASSWORD);
    const otherCurrent = await call(base, "/shifts/current", { token: otherToken });
    assert.equal(otherCurrent.status, 200);
    assert.equal((otherCurrent.json as { data: unknown }).data, null);

    const second = await call(base, "/shifts/open", {
      method: "POST",
      token: cashierToken,
      payload: JSON.stringify({ openingCashRp: 1 }),
    });
    assert.equal(second.status, 409);
    assert.equal((second.json as { error: { code: string } }).error.code, "SHIFT_ALREADY_OPEN");
    const otherOpen = await call(base, "/shifts/open", {
      method: "POST",
      token: otherToken,
      payload: JSON.stringify({}),
    });
    assert.equal(otherOpen.status, 409);
    assert.equal(activeShiftCount(db), 1);

    const invalid = await call(base, "/shifts/open", {
      method: "POST",
      token: cashierToken,
      payload: JSON.stringify({ openingCashRp: -5 }),
    });
    assert.equal(invalid.status, 422);
    assert.equal(activeShiftCount(db), 1);
  } finally {
    await handle.running.close();
    db.close();
    database.cleanup();
  }
});

test("AC-05.01 baseline: ADMIN ditolak 403 pada POST /shifts/open", async () => {
  const { database, db } = createDatabase();
  const handle = await startHandle(db);
  try {
    const adminToken = await login(handle.running.url, "admin.shift", ADMIN_PASSWORD);
    const denied = await call(handle.running.url, "/shifts/open", {
      method: "POST",
      token: adminToken,
      payload: JSON.stringify({ openingCashRp: 0 }),
    });
    assert.equal(denied.status, 403);
    assert.equal((denied.json as { error: { code: string } }).error.code, "FORBIDDEN");
    assert.equal(activeShiftCount(db), 0);
    const unauthenticated = await call(handle.running.url, "/shifts/open", {
      method: "POST",
      payload: JSON.stringify({}),
    });
    assert.equal(unauthenticated.status, 401);
  } finally {
    await handle.running.close();
    db.close();
    database.cleanup();
  }
});

test("AC-05.01: dua request buka paralel hanya menghasilkan satu shift aktif", async () => {
  const { database, db } = createDatabase();
  const handle = await startHandle(db);
  try {
    const base = handle.running.url;
    const first = await login(base, "kasir.shift", CASHIER_PASSWORD);
    const second = await login(base, "kasir.lain", OTHER_PASSWORD);
    const results = await Promise.all([
      call(base, "/shifts/open", {
        method: "POST",
        token: first,
        payload: JSON.stringify({ openingCashRp: 1000 }),
      }),
      call(base, "/shifts/open", {
        method: "POST",
        token: second,
        payload: JSON.stringify({ openingCashRp: 2000 }),
      }),
    ]);
    const statuses = results.map((result) => result.status).sort();
    assert.deepEqual(statuses, [200, 409]);
    assert.equal(activeShiftCount(db), 1);
  } finally {
    await handle.running.close();
    db.close();
    database.cleanup();
  }
});

test("AC-05.02: logout + restart backend, pemilik login ulang dengan shift ID dan waktu sama", async () => {
  const { database, db } = createDatabase();
  let handle = await startHandle(db, Buffer.from("shift-secret-pertama-0123456789abcd"));
  try {
    const base = handle.running.url;
    const cashierToken = await login(base, "kasir.shift", CASHIER_PASSWORD);
    const opened = await call(base, "/shifts/open", {
      method: "POST",
      token: cashierToken,
      payload: JSON.stringify({ openingCashRp: 30000 }),
    });
    const shift = (opened.json as { data: { id: number; openedAtMs: number } }).data;
    const logout = await call(base, "/auth/logout", { method: "POST", token: cashierToken });
    assert.equal(logout.status, 200);
    await handle.running.close();

    handle = await startHandle(db, Buffer.from("shift-secret-kedua-0123456789abcdef"));
    const newToken = await login(handle.running.url, "kasir.shift", CASHIER_PASSWORD);
    const current = await call(handle.running.url, "/shifts/current", { token: newToken });
    assert.equal(current.status, 200);
    assert.deepEqual((current.json as { data: unknown }).data, shift);
    assert.equal(activeShiftCount(db), 1);
  } finally {
    await handle.running.close();
    db.close();
    database.cleanup();
  }
});
