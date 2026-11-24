import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../../db/src/db.ts";
import {
  createTempDatabase,
  FIXED_NOW,
  fixtureIds,
  insertBaseFixture,
  migrateFresh,
} from "../../db/test/helpers.ts";
import { hashPassword } from "../auth/password.ts";
import { createAuthService } from "../auth/service.ts";
import { createSessionStore } from "../auth/session.ts";
import { createCheckoutService } from "../checkout/service.ts";
import { startHttpServer } from "../http/app.ts";
import { createSecurityLogger } from "../security/securityLog.ts";
import { createShiftService } from "../shift/service.ts";
import { createSheetsSyncService, loadSheetsSyncConfig } from "./sheetsSync.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function makeSyntheticSecret(): string {
  return `test-secret-${randomBytes(8).toString("hex")}`;
}

function makeSyntheticPassword(): string {
  return `Pw-${randomBytes(8).toString("hex")}`;
}

async function setupCheckoutHttp(options: {
  writeConfig?: { webhookUrl: string; secret: string } | null;
  fetchImpl: typeof fetch;
}) {
  const database = createTempDatabase();
  migrateFresh(database);
  const db = openDatabase(database.dbPath);
  insertBaseFixture(db);
  const ids = { ...fixtureIds(), productId: 1 };
  const cashierPassword = makeSyntheticPassword();
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    hashPassword(cashierPassword),
    ids.cashierId,
  );
  // Tambah stok awal untuk produk fixture agar checkout bisa commit.
  db.prepare(
    `INSERT INTO inventory_movements (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
     VALUES (?, 'OPENING', 20, 'fixture-sync', ?, ?)`,
  ).run(ids.productId, ids.adminId, FIXED_NOW);

  const configPath = path.join(database.dir, "sheets-sync.json");
  const queuePath = path.join(database.dir, "sheets-sync-queue.json");
  if (options.writeConfig) {
    writeFileSync(configPath, JSON.stringify(options.writeConfig), "utf8");
  }

  const sessions = createSessionStore(db, { secret: randomBytes(32), ttlMs: 3_600_000 });
  const securityLog = createSecurityLogger({ sink: () => {} });
  const auth = createAuthService(db, { sessions, securityLog });
  const shift = createShiftService(db);
  const checkout = createCheckoutService(db);
  const sheetsSync = createSheetsSyncService({
    db,
    dbPath: database.dbPath,
    configPath,
    queuePath,
    fetchImpl: options.fetchImpl,
  });

  const server = await startHttpServer({
    auth,
    sessions,
    securityLog,
    shift,
    checkout,
    sheetsSync,
    port: 0,
  });

  const loginRes = await fetch(`${server.url}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "kasir.fixture", password: cashierPassword }),
  });
  const loginJson = (await loginRes.json()) as { data: { token: string } };
  const token = loginJson.data.token;

  const openShiftRes = await fetch(`${server.url}/api/v1/shifts/open`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ openingCashRp: 50_000 }),
  });
  const openShiftJson = (await openShiftRes.json()) as { data: { id: number } };
  const shiftId = openShiftJson.data.id;

  return {
    database,
    db,
    ids,
    token,
    shiftId,
    server,
    sheetsSync,
    configPath,
    queuePath,
    async cleanup() {
      await server.close();
      db.close();
      database.cleanup();
    },
  };
}

async function prepareAndCommit(
  url: string,
  token: string,
  shiftId: number,
  productId: number,
  attemptKey: string,
) {
  const prepRes = await fetch(`${url}/api/v1/checkouts/prepare`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      attemptKey,
      shiftId,
      items: [{ productId, quantity: 2 }],
      payment: { method: "CASH" },
    }),
  });
  assert.equal(prepRes.status, 200);
  const prepJson = (await prepRes.json()) as {
    data: { requestHash: string; quote: { totalRp: number } };
  };

  const commitRes = await fetch(`${url}/api/v1/checkouts/commit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      attemptKey,
      requestHash: prepJson.data.requestHash,
      paymentConfirmation: { method: "CASH", cashReceivedRp: prepJson.data.quote.totalRp },
    }),
  });
  assert.equal(commitRes.status, 200);
  const commitJson = (await commitRes.json()) as {
    data: { saleNo: string; totalRp: number; status: string; committedAtMs: number };
  };
  return {
    requestHash: prepJson.data.requestHash,
    totalRp: prepJson.data.quote.totalRp,
    committed: commitJson.data,
  };
}

test("Ide #10: config tidak ada atau kosong menonaktifkan sync diam-diam tanpa error", () => {
  const database = createTempDatabase();
  migrateFresh(database);
  const db = openDatabase(database.dbPath);
  try {
    const missingPath = path.join(database.dir, "tidak-ada.json");
    assert.equal(loadSheetsSyncConfig(missingPath), null);

    const emptyPath = path.join(database.dir, "kosong.json");
    writeFileSync(emptyPath, JSON.stringify({ webhookUrl: "", secret: "" }), "utf8");
    assert.equal(loadSheetsSyncConfig(emptyPath), null);

    const svc = createSheetsSyncService({ db, dbPath: database.dbPath, configPath: missingPath });
    assert.equal(svc.enabled, false);
    assert.equal(svc.getPendingCount(), 0);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("Ide #10: commit sukses mengirim satu baris JSON ke webhook dan retry commit tidak mengirim dua kali", async () => {
  const secret = makeSyntheticSecret();
  const webhookUrl = "https://sheets.example.invalid/webhook";
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const ctx = await setupCheckoutHttp({
    writeConfig: { webhookUrl, secret },
    fetchImpl,
  });
  try {
    const { requestHash, totalRp, committed } = await prepareAndCommit(
      ctx.server.url,
      ctx.token,
      ctx.shiftId,
      ctx.ids.productId,
      "attempt-sync-1",
    );
    await ctx.sheetsSync.flush();

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, webhookUrl);
    assert.deepEqual(calls[0]?.body, {
      secret,
      saleNo: committed.saleNo,
      totalRp: committed.totalRp,
      method: "CASH",
      cashier: "kasir.fixture",
      committedAtMs: committed.committedAtMs,
      items: "Fixture Produk x 2",
    });
    assert.equal(ctx.sheetsSync.getPendingCount(), 0);

    // Retry commit identik tidak boleh mengirim baris kedua ke sheet.
    const retryRes = await fetch(`${ctx.server.url}/api/v1/checkouts/commit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.token}`,
      },
      body: JSON.stringify({
        attemptKey: "attempt-sync-1",
        requestHash,
        paymentConfirmation: { method: "CASH", cashReceivedRp: totalRp },
      }),
    });
    assert.equal(retryRes.status, 200);
    await ctx.sheetsSync.flush();
    assert.equal(calls.length, 1);
  } finally {
    await ctx.cleanup();
  }
});

test("Ide #10: offline/webhook gagal masuk antrean lokal tanpa gagal checkout lalu terkirim saat online kembali", async () => {
  const secret = makeSyntheticSecret();
  const webhookUrl = "https://sheets.example.invalid/webhook";
  let online = false;
  const delivered: Array<Record<string, unknown>> = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    if (!online) {
      throw new TypeError("network offline");
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    delivered.push(body);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const ctx = await setupCheckoutHttp({
    writeConfig: { webhookUrl, secret },
    fetchImpl,
  });
  try {
    const first = await prepareAndCommit(
      ctx.server.url,
      ctx.token,
      ctx.shiftId,
      ctx.ids.productId,
      "attempt-offline-1",
    );
    await ctx.sheetsSync.flush();

    assert.equal(first.committed.status, "COMMITTED");
    assert.equal(delivered.length, 0);
    assert.equal(ctx.sheetsSync.getPendingCount(), 1);

    // Pastikan token rahasia tidak pernah ditulis ke file antrean lokal.
    const queueRaw = readFileSync(ctx.queuePath, "utf8");
    assert.equal(queueRaw.includes(secret), false);
    assert.equal(queueRaw.includes(first.committed.saleNo), true);

    // Simulasi backend restart saat online kembali -> flush mengirim antrean lama.
    online = true;
    const restartedSync = createSheetsSyncService({
      db: ctx.db,
      dbPath: ctx.database.dbPath,
      configPath: ctx.configPath,
      queuePath: ctx.queuePath,
      fetchImpl,
    });
    assert.equal(restartedSync.getPendingCount(), 1);
    await restartedSync.flush();
    assert.equal(restartedSync.getPendingCount(), 0);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0]?.saleNo, first.committed.saleNo);
  } finally {
    await ctx.cleanup();
  }
});

test("Ide #10: secret salah ditolak webhook tanpa crash dan tidak mengganggu checkout", async () => {
  const secret = makeSyntheticSecret();
  const webhookUrl = "https://sheets.example.invalid/webhook";
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ ok: false, error: "secret salah" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const ctx = await setupCheckoutHttp({
    writeConfig: { webhookUrl, secret },
    fetchImpl,
  });
  try {
    const result = await prepareAndCommit(
      ctx.server.url,
      ctx.token,
      ctx.shiftId,
      ctx.ids.productId,
      "attempt-bad-secret-1",
    );
    await ctx.sheetsSync.flush();

    assert.equal(result.committed.status, "COMMITTED");
    assert.equal(ctx.sheetsSync.getPendingCount(), 1);
  } finally {
    await ctx.cleanup();
  }
});

test("Ide #10: .gitignore mengecualikan backend/config/sheets-sync.json", () => {
  const gitignore = readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8");
  assert.match(gitignore, /^backend\/config\/sheets-sync\.json$/m);
});
