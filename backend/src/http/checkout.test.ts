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
import { createSessionStore } from "../auth/session.ts";
import { createSecurityLogger } from "../security/securityLog.ts";
import { createShiftService } from "../shift/service.ts";
import { createCheckoutService } from "../checkout/service.ts";
import { startHttpServer } from "./app.ts";

const ADMIN_PASS = `adm-${randomBytes(8).toString("hex")}`;
const CASHIER_PASS = `kas-${randomBytes(8).toString("hex")}`;

async function call(
  base: string,
  path: string,
  options: { method?: string; token?: string; payload?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (options.token) {
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
  const json = (await response.json()) as { data?: unknown; error?: { code?: string } };
  return { status: response.status, json };
}

function seedUsersAndStock(db: DatabaseSync) {
  // Gunakan auth.createUser atau fixture langsung; lebih bersih lewat API admin di tes
  db.prepare(
    `INSERT INTO inventory_movements (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
     VALUES (1, 'OPENING', 5, 'HTTP-OPEN-1', 1, ?)`,
  ).run(FIXED_NOW);
}

test("TASK-016 HTTP: prepare, commit paralel, konflik harga/stok/hash, dan GET status lookup", async () => {
  const database = createTempDatabase("pos-http-co-");
  const db = database.open();
  migrateFresh(database);
  insertBaseFixture(db);
  seedUsersAndStock(db);

  const securityLog = createSecurityLogger({ sink: () => {} });
  const sessions = createSessionStore(db, { secret: randomBytes(32), ttlMs: 60_000 });
  const auth = createAuthService(db, { sessions, securityLog });
  const shift = createShiftService(db, { now: () => FIXED_NOW });
  const checkout = createCheckoutService(db, { now: () => FIXED_NOW + 10 });

  const adminActor = { userId: 1, username: "admin.fixture", role: "ADMIN" as const };
  auth.createUser(adminActor, {
    username: "kasir.co.http",
    password: CASHIER_PASS,
    role: "CASHIER",
  });
  auth.createUser(adminActor, {
    username: "kasir.lain.http",
    password: CASHIER_PASS,
    role: "CASHIER",
  });
  auth.createUser(adminActor, {
    username: "admin.co.http",
    password: ADMIN_PASS,
    role: "ADMIN",
  });

  const running = await startHttpServer({ auth, sessions, securityLog, shift, checkout });
  try {
    const cashierRes = await call(running.url, "/auth/login", {
      payload: { username: "kasir.co.http", password: CASHIER_PASS },
    });
    const otherRes = await call(running.url, "/auth/login", {
      payload: { username: "kasir.lain.http", password: CASHIER_PASS },
    });
    const adminRes = await call(running.url, "/auth/login", {
      payload: { username: "admin.co.http", password: ADMIN_PASS },
    });
    const cashierToken = (cashierRes.json.data as { token: string }).token;
    const otherToken = (otherRes.json.data as { token: string }).token;
    const adminToken = (adminRes.json.data as { token: string }).token;

    // Buka shift
    const shiftRes = await call(running.url, "/shifts/open", {
      token: cashierToken,
      payload: { openingCashRp: 50000 },
    });
    assert.equal(shiftRes.status, 200);
    const shiftId = (shiftRes.json.data as { id: number }).id;

    // ADMIN ditolak 403 untuk prepare
    const adminPrep = await call(running.url, "/checkouts/prepare", {
      token: adminToken,
      payload: {
        attemptKey: "http-admin",
        shiftId,
        items: [{ productId: 1, quantity: 1 }],
        payment: { method: "CASH" },
      },
    });
    assert.equal(adminPrep.status, 403);

    // Prepare valid
    const prep = await call(running.url, "/checkouts/prepare", {
      token: cashierToken,
      payload: {
        attemptKey: "http-co-1",
        shiftId,
        items: [{ productId: 1, quantity: 2 }],
        payment: { method: "CASH" },
      },
    });
    assert.equal(prep.status, 200);
    const prepData = prep.json.data as {
      attemptKey: string;
      requestHash: string;
      status: string;
      quote: { totalRp: number };
    };
    assert.equal(prepData.status, "PREPARED");
    assert.equal(prepData.quote.totalRp, 5000);

    // Commit paralel identik -> 200 dengan saleId sama
    const [c1, c2] = await Promise.all([
      call(running.url, "/checkouts/commit", {
        token: cashierToken,
        payload: {
          attemptKey: prepData.attemptKey,
          requestHash: prepData.requestHash,
          paymentConfirmation: { method: "CASH", cashReceivedRp: 5000 },
        },
      }),
      call(running.url, "/checkouts/commit", {
        token: cashierToken,
        payload: {
          attemptKey: prepData.attemptKey,
          requestHash: prepData.requestHash,
          paymentConfirmation: { method: "CASH", cashReceivedRp: 5000 },
        },
      }),
    ]);
    assert.equal(c1.status, 200);
    assert.equal(c2.status, 200);
    assert.equal(
      (c1.json.data as { saleId: number }).saleId,
      (c2.json.data as { saleId: number }).saleId,
    );

    // Hash berbeda pada key sama -> 409 IDEMPOTENCY_CONFLICT
    const conflict = await call(running.url, "/checkouts/commit", {
      token: cashierToken,
      payload: {
        attemptKey: prepData.attemptKey,
        requestHash: "a".repeat(64),
        paymentConfirmation: { method: "CASH", cashReceivedRp: 5000 },
      },
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.json.error?.code, "IDEMPOTENCY_CONFLICT");

    // GET /checkouts/:attemptKey -> owner 200, ADMIN 200, kasir lain 403
    const statusOwner = await call(running.url, `/checkouts/${prepData.attemptKey}`, {
      token: cashierToken,
    });
    assert.equal(statusOwner.status, 200);
    assert.equal((statusOwner.json.data as { status: string }).status, "COMMITTED");

    const statusAdmin = await call(running.url, `/checkouts/${prepData.attemptKey}`, {
      token: adminToken,
    });
    assert.equal(statusAdmin.status, 200);

    const statusOther = await call(running.url, `/checkouts/${prepData.attemptKey}`, {
      token: otherToken,
    });
    assert.equal(statusOther.status, 403);
  } finally {
    await running.close();
    db.close();
    database.cleanup();
  }
});
