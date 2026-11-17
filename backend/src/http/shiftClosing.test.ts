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
import { createCheckoutService } from "../checkout/service.ts";
import { createShiftService } from "../shift/service.ts";
import { startHttpServer, type RunningServer } from "./app.ts";

const PASSWORD = `ts022-${randomBytes(8).toString("hex")}`;
const OPENING_CASH_RP = 50_000;
const SALE_TOTAL_RP = 5_000;

function setup() {
  const database = createTempDatabase("pos-close-http-");
  const db = database.open();
  migrateFresh(database);
  insertBaseFixture(db);
  db.prepare(
    `INSERT INTO inventory_movements (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
     VALUES (1, 'OPENING', 400, 'OPEN-CLOSE-HTTP', 1, ?)`,
  ).run(FIXED_NOW);
  const insert = db.prepare(
    `INSERT INTO users (username, password_hash, role, active, created_at_ms)
     VALUES (?, ?, ?, 1, ?)`,
  );
  insert.run("kasir.close", hashPassword(PASSWORD), "CASHIER", FIXED_NOW);
  insert.run("kasir.lain.close", hashPassword(PASSWORD), "CASHIER", FIXED_NOW);
  insert.run("admin.close", hashPassword(PASSWORD), "ADMIN", FIXED_NOW);
  return { database, db };
}

async function start(db: DatabaseSync, secret: Buffer) {
  const sessions = createSessionStore(db, { secret, ttlMs: 60 * 60 * 1000 });
  const securityLog = createSecurityLogger({ sink: () => {} });
  const auth = createAuthService(db, { sessions, securityLog });
  const shift = createShiftService(db, { now: () => FIXED_NOW });
  const checkout = createCheckoutService(db, { now: () => FIXED_NOW + 10 });
  const running = await startHttpServer({ auth, sessions, securityLog, shift, checkout });
  return running;
}

type CallOptions = {
  method?: string;
  token?: string;
  payload?: unknown;
};

async function call(base: string, path: string, options: CallOptions = {}) {
  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.payload !== undefined) {
    headers["Content-Type"] = "application/json";
  }
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

async function login(base: string, username: string) {
  const res = await call(base, "/auth/login", {
    method: "POST",
    payload: { username, password: PASSWORD },
  });
  return ((res.json.data as { token: string }).token);
}

async function prepareAndCommit(base: string, token: string, shiftId: number) {
  const prepared = await call(base, "/checkouts/prepare", {
    method: "POST",
    token,
    payload: {
      attemptKey: "http-close-co-1",
      shiftId,
      items: [{ productId: 1, quantity: 2 }],
      payment: { method: "CASH" },
    },
  });
  const data = prepared.json.data as { requestHash: string; quote: { totalRp: number } };
  const committed = await call(base, "/checkouts/commit", {
    method: "POST",
    token,
    payload: {
      attemptKey: "http-close-co-1",
      requestHash: data.requestHash,
      paymentConfirmation: { method: "CASH", cashReceivedRp: data.quote.totalRp },
    },
  });
  assert.equal(committed.status, 200);
}

function countRows(db: DatabaseSync, table: string): number {
  return Number(
    (db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total,
  );
}

test("AC-06.01/06.02/06.03 via HTTP: tutup shift, idempotensi, otorisasi, restart", async () => {
  const { database, db } = setup();
  let running: RunningServer | null = await start(db, randomBytes(32));
  try {
    const base = running.url;
    const cashierToken = await login(base, "kasir.close");
    const opened = await call(base, "/shifts/open", {
      method: "POST",
      token: cashierToken,
      payload: { openingCashRp: OPENING_CASH_RP },
    });
    assert.equal(opened.status, 200);
    const shiftId = (opened.json.data as { id: number }).id;

    await prepareAndCommit(base, cashierToken, shiftId);
    const payload = {
      closeKey: "http-close-key-1",
      declaredCashRp: OPENING_CASH_RP + SALE_TOTAL_RP,
    };
    const closing = await call(base, `/shifts/${shiftId}/close`, {
      method: "POST",
      token: cashierToken,
      payload,
    });
    assert.equal(closing.status, 200);
    const data = closing.json.data as {
      shiftId: number;
      closeKey: string;
      closedAtMs: number;
      varianceRp: number;
      totals: { cashRp: number; qrisManualRp: number; saleCount: number };
    };
    assert.equal(data.shiftId, shiftId);
    assert.equal(data.closeKey, payload.closeKey);
    assert.equal(data.varianceRp, 0);
    assert.equal(data.totals.cashRp, SALE_TOTAL_RP);
    assert.equal(data.totals.qrisManualRp, 0);
    assert.equal(data.totals.saleCount, 1);

    const totals = db
      .prepare("SELECT method_code, amount_rp FROM shift_closing_totals WHERE shift_id = ? ORDER BY method_code")
      .all(shiftId) as Array<{ method_code: string; amount_rp: number }>;
    assert.equal(totals.length, 2);
    assert.equal(totals[0]?.method_code, "CASH");
    assert.equal(totals[0]?.amount_rp, SALE_TOTAL_RP);
    assert.equal(totals[1]?.method_code, "QRIS_MANUAL");
    assert.equal(totals[1]?.amount_rp, 0);

    const current = await call(base, "/shifts/current", { token: cashierToken });
    assert.equal(current.status, 200);
    assert.equal((current.json.data as unknown), null);

    const before = {
      closings: countRows(db, "shift_closings"),
      totals: countRows(db, "shift_closing_totals"),
    };
    const retry = await call(base, `/shifts/${shiftId}/close`, {
      method: "POST",
      token: cashierToken,
      payload,
    });
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.json.data, closing.json.data);
    assert.equal(countRows(db, "shift_closings"), before.closings);
    assert.equal(countRows(db, "shift_closing_totals"), before.totals);

    const conflict = await call(base, `/shifts/${shiftId}/close`, {
      method: "POST",
      token: cashierToken,
      payload: { ...payload, declaredCashRp: payload.declaredCashRp + 1 },
    });
    assert.equal(conflict.status, 409);
    assert.equal((conflict.json.error as { code: string }).code, "IDEMPOTENCY_CONFLICT");

    const invalid = await call(base, `/shifts/${shiftId}/close`, {
      method: "POST",
      token: cashierToken,
      payload: { closeKey: payload.closeKey, declaredCashRp: -1 },
    });
    assert.equal(invalid.status, 422);

    // Simulasi restart: secret sesi baru, DB dibuka ulang.
    await running.close();
    db.close();
    const reopened = database.open();
    running = await start(reopened, randomBytes(32));
    const relogin = await login(running.url, "kasir.close");
    const afterRestart = await call(running.url, `/shifts/${shiftId}/close`, {
      method: "POST",
      token: relogin,
      payload,
    });
    assert.equal(afterRestart.status, 200);
    assert.deepEqual(afterRestart.json.data, closing.json.data);
    assert.equal(countRows(reopened, "shift_closings"), 1);
    await running.close();
    reopened.close();
    return;
  } finally {
    if (running !== null) {
      try {
        await running.close();
      } catch {
        // server sudah ditutup pada jalur normal.
      }
    }
    try {
      db.close();
    } catch {
      // koneksi sudah ditutup pada jalur normal.
    }
    database.cleanup();
  }
});

test("AC-01.03: kasir lain dan ADMIN ditolak 403 pada penutupan shift", async () => {
  const { database, db } = setup();
  const running = await start(db, randomBytes(32));
  try {
    const base = running.url;
    const cashierToken = await login(base, "kasir.close");
    const otherToken = await login(base, "kasir.lain.close");
    const adminToken = await login(base, "admin.close");
    const opened = await call(base, "/shifts/open", {
      method: "POST",
      token: cashierToken,
      payload: { openingCashRp: OPENING_CASH_RP },
    });
    const shiftId = (opened.json.data as { id: number }).id;

    const other = await call(base, `/shifts/${shiftId}/close`, {
      method: "POST",
      token: otherToken,
      payload: { closeKey: "http-close-denied-other" },
    });
    assert.equal(other.status, 403);
    assert.equal((other.json.error as { code: string }).code, "FORBIDDEN");
    const admin = await call(base, `/shifts/${shiftId}/close`, {
      method: "POST",
      token: adminToken,
      payload: { closeKey: "http-close-denied-admin" },
    });
    assert.equal(admin.status, 403);
    assert.equal(countRows(db, "shift_closings"), 0);
    const current = await call(base, "/shifts/current", { token: cashierToken });
    assert.equal((current.json.data as { id: number }).id, shiftId);
  } finally {
    await running.close();
    db.close();
    database.cleanup();
  }
});
