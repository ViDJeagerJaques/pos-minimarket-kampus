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

/**
 * TASK-019: bukti pemulihan hasil checkout. Endpoint GET dan persistensi
 * attempt sudah disediakan TASK-016; tes ini menguji skenario pemulihannya
 * (respons hilang, restart setelah prepare, akses lintas kasir) tanpa
 * mengubah perilaku yang sudah lulus tes.
 */
const PASSWORD = `ts019-${randomBytes(8).toString("hex")}`;

function setup() {
  const database = createTempDatabase("pos-recover-http-");
  const db = database.open();
  migrateFresh(database);
  insertBaseFixture(db);
  db.prepare(
    `INSERT INTO inventory_movements (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
     VALUES (1, 'OPENING', 5, 'RECOVER-OPEN-1', 1, ?)`,
  ).run(FIXED_NOW);
  const insertUser = db.prepare(
    `INSERT INTO users (username, password_hash, role, active, created_at_ms)
     VALUES (?, ?, ?, 1, ?)`,
  );
  const ownerId = Number(
    insertUser.run("kasir.recover", hashPassword(PASSWORD), "CASHIER", FIXED_NOW).lastInsertRowid,
  );
  const otherId = Number(
    insertUser.run("kasir.lain.recover", hashPassword(PASSWORD), "CASHIER", FIXED_NOW).lastInsertRowid,
  );
  const adminId = Number(
    insertUser.run("admin.recover", hashPassword(PASSWORD), "ADMIN", FIXED_NOW).lastInsertRowid,
  );
  return { database, db, ownerId, otherId, adminId };
}

type Server = {
  running: RunningServer;
  secret: Buffer;
};

async function start(db: DatabaseSync, secret: Buffer): Promise<Server> {
  const sessions = createSessionStore(db, { secret, ttlMs: 60 * 60 * 1000 });
  const securityLog = createSecurityLogger({ sink: () => {} });
  const auth = createAuthService(db, { sessions, securityLog });
  const shift = createShiftService(db, { now: () => FIXED_NOW });
  const checkout = createCheckoutService(db, { now: () => FIXED_NOW + 10 });
  const running = await startHttpServer({ auth, sessions, securityLog, shift, checkout });
  return { running, secret };
}

type CallOptions = {
  method?: string;
  token?: string;
  payload?: unknown;
  ignoreResponse?: boolean;
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
  if (options.ignoreResponse === true) {
    // Simulasi respons hilang: commit diproses server, klien membuang respons.
    await response.body?.cancel().catch(() => {});
    return { status: response.status, json: {} as Record<string, unknown> };
  }
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
  const result = await call(base, "/auth/login", {
    method: "POST",
    payload: { username, password: PASSWORD },
  });
  return ((result.json.data as { token: string }).token);
}

async function prepare(base: string, token: string, attemptKey: string, shiftId: number) {
  const result = await call(base, "/checkouts/prepare", {
    method: "POST",
    token,
    payload: {
      attemptKey,
      shiftId,
      items: [{ productId: 1, quantity: 2 }],
      payment: { method: "CASH" },
    },
  });
  assert.equal(result.status, 200);
  return result.json.data as {
    attemptKey: string;
    requestHash: string;
    status: string;
    quote: { totalRp: number };
  };
}

async function openShift(base: string, token: string): Promise<number> {
  const result = await call(base, "/shifts/open", {
    method: "POST",
    token,
    payload: { openingCashRp: 50000 },
  });
  assert.equal(result.status, 200);
  return (result.json.data as { id: number }).id;
}

function counts(db: DatabaseSync) {
  const count = (table: string): number =>
    Number((db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total);
  return {
    attempts: count("checkout_attempts"),
    sales: count("sales"),
    payments: count("payments"),
    movements: count("inventory_movements"),
    audit: count("audit_log"),
  };
}

test("AC-04.01/04.02: commit berhasil lalu respons dibuang, GET mengembalikan sale yang sama", async () => {
  const { database, db } = setup();
  const secret = randomBytes(32);
  const server = await start(db, secret);
  try {
    const base = server.running.url;
    const token = await login(base, "kasir.recover");
    const shiftId = await openShift(base, token);
    const prepared = await prepare(base, token, "recover-committed-1", shiftId);

    const discarded = await call(base, "/checkouts/commit", {
      method: "POST",
      token,
      payload: {
        attemptKey: prepared.attemptKey,
        requestHash: prepared.requestHash,
        paymentConfirmation: { method: "CASH", cashReceivedRp: prepared.quote.totalRp },
      },
      ignoreResponse: true,
    });
    assert.equal(discarded.status, 200);

    const stored = db.prepare("SELECT sale_no FROM sales WHERE attempt_key = ?").get(
      prepared.attemptKey,
    ) as { sale_no: string } | undefined;
    assert.ok(stored);

    const before = counts(db);
    const status = await call(base, `/checkouts/${prepared.attemptKey}`, { token });
    assert.equal(status.status, 200);
    const data = status.json.data as {
      status: string;
      attemptKey: string;
      saleNo: string;
      requestHash: string;
    };
    assert.equal(data.status, "COMMITTED");
    assert.equal(data.saleNo, stored.sale_no);
    assert.equal(data.requestHash, prepared.requestHash);
    assert.deepEqual(counts(db), before, "GET pemulihan tidak boleh menulis data");

    // Tetap tersedia setelah shift ditutup.
    db.prepare("UPDATE shifts SET closed_at_ms = ? WHERE id = ?").run(FIXED_NOW + 100, shiftId);
    const afterClose = await call(base, `/checkouts/${prepared.attemptKey}`, { token });
    assert.equal(afterClose.status, 200);
    assert.equal((afterClose.json.data as { saleNo: string }).saleNo, stored.sale_no);
  } finally {
    await server.running.close();
    db.close();
    database.cleanup();
  }
});

test("AC-04.02: restart setelah prepare sebelum commit mempertahankan status dan requestHash", async () => {
  const { database, db: initialDb } = setup();
  let db = initialDb;
  let server = await start(db, randomBytes(32));
  try {
    const token = await login(server.running.url, "kasir.recover");
    const shiftId = await openShift(server.running.url, token);
    const prepared = await prepare(server.running.url, token, "recover-prepared-1", shiftId);
    await server.running.close();
    // Simulasi restart proses: tutup koneksi lama, buka ulang file DB yang sama.
    db.close();
    db = database.open();
    server = await start(db, randomBytes(32));
    const relogin = await login(server.running.url, "kasir.recover");
    const before = counts(db);
    const status = await call(server.running.url, `/checkouts/${prepared.attemptKey}`, {
      token: relogin,
    });
    assert.equal(status.status, 200);
    const data = status.json.data as {
      status: string;
      requestHash: string;
      quote: { totalRp: number };
    };
    assert.equal(data.status, "PREPARED");
    assert.equal(data.requestHash, prepared.requestHash);
    assert.equal(data.quote.totalRp, prepared.quote.totalRp);
    assert.deepEqual(counts(db), before);

    const commit = await call(server.running.url, "/checkouts/commit", {
      method: "POST",
      token: relogin,
      payload: {
        attemptKey: prepared.attemptKey,
        requestHash: prepared.requestHash,
        paymentConfirmation: { method: "CASH", cashReceivedRp: prepared.quote.totalRp },
      },
    });
    assert.equal(commit.status, 200);
    const committed = (await call(server.running.url, `/checkouts/${prepared.attemptKey}`, {
      token: relogin,
    })).json.data as { status: string; requestHash: string };
    assert.equal(committed.status, "COMMITTED");
    assert.equal(committed.requestHash, prepared.requestHash);
  } finally {
    await server.running.close();
    db.close();
    database.cleanup();
  }
});

test("Kasir lain dan kunci tak dikenal ditolak tanpa membocorkan data", async () => {
  const { database, db } = setup();
  const server = await start(db, randomBytes(32));
  try {
    const base = server.running.url;
    const ownerToken = await login(base, "kasir.recover");
    const otherToken = await login(base, "kasir.lain.recover");
    const adminToken = await login(base, "admin.recover");
    const shiftId = await openShift(base, ownerToken);
    const prepared = await prepare(base, ownerToken, "recover-private-1", shiftId);

    const other = await call(base, `/checkouts/${prepared.attemptKey}`, { token: otherToken });
    assert.equal(other.status, 403);
    const otherBody = JSON.stringify(other.json);
    for (const secret of [prepared.requestHash, prepared.quote.totalRp, "saleNo", "quote"]) {
      assert.equal(otherBody.includes(String(secret)), false, `tidak boleh bocor: ${String(secret)}`);
    }
    assert.equal((other.json.error as { code: string }).code, "FORBIDDEN");

    const admin = await call(base, `/checkouts/${prepared.attemptKey}`, { token: adminToken });
    assert.equal(admin.status, 200);
    assert.equal((admin.json.data as { status: string }).status, "PREPARED");

    const unknown = await call(base, "/checkouts/tidak-ada", { token: ownerToken });
    assert.equal(unknown.status, 404);
    assert.equal((unknown.json.error as { code: string }).code, "NOT_FOUND");

    const anonymous = await call(base, `/checkouts/${prepared.attemptKey}`);
    assert.equal(anonymous.status, 401);
  } finally {
    await server.running.close();
    db.close();
    database.cleanup();
  }
});
