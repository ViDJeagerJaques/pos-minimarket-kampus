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
  queuePath?: string;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
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
  const queuePath = options.queuePath ?? path.join(database.dir, "sheets-sync-queue.json");
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
    retryBaseDelayMs: options.retryBaseDelayMs,
    retryMaxDelayMs: options.retryMaxDelayMs,
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
      sheetsSync.stop();
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

test("BUG-247: menolak URL http: dan redirect HTTPS ke HTTP, tetapi tetap mengikuti redirect HTTPS ke HTTPS", async () => {
  const database = createTempDatabase();
  try {
    const httpConfigPath = path.join(database.dir, "http-config.json");
    writeFileSync(
      httpConfigPath,
      JSON.stringify({ webhookUrl: "http://sheets.example.invalid/webhook", secret: makeSyntheticSecret() }),
      "utf8",
    );
    assert.equal(loadSheetsSyncConfig(httpConfigPath), null);
  } finally {
    database.cleanup();
  }

  const secret = makeSyntheticSecret();
  const downgradeUrls: string[] = [];
  const downgradeFetch: typeof fetch = async (input) => {
    const url = String(input);
    downgradeUrls.push(url);
    return new Response(null, {
      status: 307,
      headers: { location: "http://insecure.example.invalid/steal" },
    });
  };
  const downgradeCtx = await setupCheckoutHttp({
    writeConfig: { webhookUrl: "https://script.google.com/macros/s/test/exec", secret },
    fetchImpl: downgradeFetch,
    retryBaseDelayMs: 60_000,
  });
  try {
    await prepareAndCommit(
      downgradeCtx.server.url,
      downgradeCtx.token,
      downgradeCtx.shiftId,
      downgradeCtx.ids.productId,
      "attempt-downgrade-1",
    );
    await downgradeCtx.sheetsSync.flush();
    assert.ok(downgradeUrls.length >= 1);
    assert.equal(
      downgradeUrls.every((u) => u === "https://script.google.com/macros/s/test/exec"),
      true,
    );
    assert.equal(downgradeCtx.sheetsSync.getPendingCount(), 1);
  } finally {
    await downgradeCtx.cleanup();
  }

  const httpsCalls: Array<{ url: string; method: string; hasBody: boolean }> = [];
  const httpsRedirectFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    httpsCalls.push({ url, method: init?.method ?? "GET", hasBody: init?.body !== undefined });
    if (httpsCalls.length === 1) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://script.googleusercontent.com/macros/echo?key=1" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const httpsCtx = await setupCheckoutHttp({
    writeConfig: { webhookUrl: "https://script.google.com/macros/s/test/exec", secret },
    fetchImpl: httpsRedirectFetch,
  });
  try {
    await prepareAndCommit(
      httpsCtx.server.url,
      httpsCtx.token,
      httpsCtx.shiftId,
      httpsCtx.ids.productId,
      "attempt-https-redirect-1",
    );
    await httpsCtx.sheetsSync.flush();
    assert.equal(httpsCalls.length, 2);
    assert.deepEqual(httpsCalls[0], {
      url: "https://script.google.com/macros/s/test/exec",
      method: "POST",
      hasBody: true,
    });
    assert.deepEqual(httpsCalls[1], {
      url: "https://script.googleusercontent.com/macros/echo?key=1",
      method: "GET",
      hasBody: false,
    });
    assert.equal(httpsCtx.sheetsSync.getPendingCount(), 0);
  } finally {
    await httpsCtx.cleanup();
  }
});

test("BUG-248: ringkasan barang memakai sale_items.name_snapshot walau produk sudah diganti nama", async () => {
  const secret = makeSyntheticSecret();
  let online = false;
  const delivered: Array<Record<string, unknown>> = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    if (!online) throw new TypeError("offline");
    delivered.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const ctx = await setupCheckoutHttp({
    writeConfig: { webhookUrl: "https://sheets.example.invalid/webhook", secret },
    fetchImpl,
    retryBaseDelayMs: 60_000,
  });
  try {
    await prepareAndCommit(
      ctx.server.url,
      ctx.token,
      ctx.shiftId,
      ctx.ids.productId,
      "attempt-snapshot-1",
    );
    await ctx.sheetsSync.flush();

    // Ubah nama produk live setelah commit, lalu rekonsiliasi ulang dari SQLite.
    ctx.db.prepare("UPDATE products SET name = ? WHERE id = ?").run("Nama Baru Setelah Commit", ctx.ids.productId);
    online = true;
    const freshQueue = path.join(ctx.database.dir, "reconciled-snapshot-queue.json");
    const restarted = createSheetsSyncService({
      db: ctx.db,
      dbPath: ctx.database.dbPath,
      configPath: ctx.configPath,
      queuePath: freshQueue,
      fetchImpl,
    });
    try {
      await restarted.flush();
      assert.equal(delivered.length, 1);
      assert.equal(delivered[0]?.items, "Fixture Produk x 2");
    } finally {
      restarted.stop();
    }
  } finally {
    await ctx.cleanup();
  }
});

test("BUG-250: penjualan gagal saat offline terkirim otomatis lewat backoff retry tanpa checkout baru", async () => {
  const secret = makeSyntheticSecret();
  let online = false;
  const delivered: Array<Record<string, unknown>> = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    if (!online) throw new TypeError("offline");
    delivered.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const ctx = await setupCheckoutHttp({
    writeConfig: { webhookUrl: "https://sheets.example.invalid/webhook", secret },
    fetchImpl,
    retryBaseDelayMs: 25,
    retryMaxDelayMs: 50,
  });
  try {
    await prepareAndCommit(
      ctx.server.url,
      ctx.token,
      ctx.shiftId,
      ctx.ids.productId,
      "attempt-backoff-1",
    );
    await ctx.sheetsSync.flush();
    assert.equal(ctx.sheetsSync.getPendingCount(), 1);

    online = true;
    // Tunggu timer backoff mengeksekusi retry otomatis tanpa memanggil flush atau checkout baru.
    const deadline = Date.now() + 2000;
    while (delivered.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(delivered.length, 1);
    assert.equal(ctx.sheetsSync.getPendingCount(), 0);
  } finally {
    await ctx.cleanup();
  }
});

test("BUG-251: penjualan yang gagal ditulis ke antrean tetap pulih dan terkirim setelah restart lewat rekonsiliasi SQLite", async () => {
  const secret = makeSyntheticSecret();
  let online = false;
  const delivered: Array<Record<string, unknown>> = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    if (!online) throw new TypeError("offline");
    delivered.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  // Simulasi tulis antrean gagal: arahkan queuePath ke direktori yang sudah ada.
  const tempRoot = createTempDatabase();
  const unwritableQueuePath = tempRoot.dir;
  const ctx = await setupCheckoutHttp({
    writeConfig: { webhookUrl: "https://sheets.example.invalid/webhook", secret },
    fetchImpl,
    queuePath: unwritableQueuePath,
    retryBaseDelayMs: 60_000,
  });
  try {
    const first = await prepareAndCommit(
      ctx.server.url,
      ctx.token,
      ctx.shiftId,
      ctx.ids.productId,
      "attempt-reconcile-1",
    );
    await ctx.sheetsSync.flush();
    assert.equal(first.committed.status, "COMMITTED");
    assert.equal(delivered.length, 0);

    // Restart dengan file antrean kosong/baru: rekonsiliasi dari SQLite harus menemukan penjualan yang hilang.
    online = true;
    const recoveredQueuePath = path.join(ctx.database.dir, "recovered-queue.json");
    const restarted = createSheetsSyncService({
      db: ctx.db,
      dbPath: ctx.database.dbPath,
      configPath: ctx.configPath,
      queuePath: recoveredQueuePath,
      fetchImpl,
    });
    try {
      assert.equal(restarted.getPendingCount(), 1);
      await restarted.flush();
      assert.equal(restarted.getPendingCount(), 0);
      assert.equal(delivered.length, 1);
      assert.equal(delivered[0]?.saleNo, first.committed.saleNo);
    } finally {
      restarted.stop();
    }
  } finally {
    await ctx.cleanup();
    tempRoot.cleanup();
  }
});

test("BUG-252: ack pengiriman permanen mencegah replay setelah lebih dari 5.000 pengiriman sukses", async () => {
  const secret = makeSyntheticSecret();
  const delivered: Array<Record<string, unknown>> = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    delivered.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const ctx = await setupCheckoutHttp({
    writeConfig: { webhookUrl: "https://sheets.example.invalid/webhook", secret },
    fetchImpl,
  });
  try {
    await prepareAndCommit(
      ctx.server.url,
      ctx.token,
      ctx.shiftId,
      ctx.ids.productId,
      "attempt-durable-ack-1",
    );
    await ctx.sheetsSync.flush();
    assert.equal(delivered.length, 1);

    const overflowKeys = Array.from({ length: 5005 }, (_, i) => `other-attempt-${i}`);
    writeFileSync(
      ctx.queuePath,
      JSON.stringify({ pending: [], sentKeys: overflowKeys }),
      "utf8",
    );

    const restarted = createSheetsSyncService({
      db: ctx.db,
      dbPath: ctx.database.dbPath,
      configPath: ctx.configPath,
      queuePath: ctx.queuePath,
      fetchImpl,
    });
    try {
      assert.equal(restarted.getPendingCount(), 0);
      await restarted.flush();
      assert.equal(delivered.length, 1);
    } finally {
      restarted.stop();
    }
  } finally {
    await ctx.cleanup();
  }
});

test("BUG-253: retry otomatis terus berjalan melewati 11 kali kegagalan selama antrean tidak kosong", async () => {
  const secret = makeSyntheticSecret();
  let attempts = 0;
  const delivered: Array<Record<string, unknown>> = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    attempts += 1;
    if (attempts <= 12) {
      throw new TypeError("offline");
    }
    delivered.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const ctx = await setupCheckoutHttp({
    writeConfig: { webhookUrl: "https://sheets.example.invalid/webhook", secret },
    fetchImpl,
    retryBaseDelayMs: 5,
    retryMaxDelayMs: 10,
  });
  try {
    await prepareAndCommit(
      ctx.server.url,
      ctx.token,
      ctx.shiftId,
      ctx.ids.productId,
      "attempt-many-retries-1",
    );

    const deadline = Date.now() + 3000;
    while (delivered.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    assert.ok(attempts >= 13);
    assert.equal(delivered.length, 1);
    assert.equal(ctx.sheetsSync.getPendingCount(), 0);
  } finally {
    await ctx.cleanup();
  }
});

test("BUG-254: startup menghapus pending yang sudah di-ack permanen dan mempertahankan pending yang belum di-ack", async () => {
  const secret = makeSyntheticSecret();
  const delivered: Array<Record<string, unknown>> = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    delivered.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const ctx = await setupCheckoutHttp({
    writeConfig: { webhookUrl: "https://sheets.example.invalid/webhook", secret },
    fetchImpl,
  });
  try {
    const ackedEntry = {
      attemptKey: "attempt-already-acked",
      saleNo: "S-ACK-1",
      totalRp: 5000,
      method: "CASH",
      cashier: "kasir.fixture",
      committedAtMs: FIXED_NOW,
      items: "Barang A x 1",
    };
    const unackedEntry = {
      attemptKey: "attempt-still-pending",
      saleNo: "S-PEND-2",
      totalRp: 7500,
      method: "CASH",
      cashier: "kasir.fixture",
      committedAtMs: FIXED_NOW + 1000,
      items: "Barang B x 1",
    };
    const staleQueuePath = path.join(ctx.database.dir, "stale-queue.json");
    writeFileSync(
      staleQueuePath,
      JSON.stringify({ pending: [ackedEntry, unackedEntry], sentKeys: [] }),
      "utf8",
    );
    writeFileSync(`${staleQueuePath}.ack.ndjson`, `${ackedEntry.attemptKey}\n`, "utf8");

    const restarted = createSheetsSyncService({
      db: ctx.db,
      dbPath: ctx.database.dbPath,
      configPath: ctx.configPath,
      queuePath: staleQueuePath,
      fetchImpl,
    });
    try {
      assert.equal(restarted.getPendingCount(), 1);
      await restarted.flush();
      assert.equal(restarted.getPendingCount(), 0);
      assert.equal(delivered.length, 1);
      assert.equal(delivered[0]?.saleNo, "S-PEND-2");
    } finally {
      restarted.stop();
    }
  } finally {
    await ctx.cleanup();
  }
});

test("BUG-257: endpoint status dan flush hanya untuk ADMIN dan tidak membocorkan webhook atau secret", async () => {
  const secret = makeSyntheticSecret();
  const webhookUrl = "https://sheets.example.invalid/webhook-secret-path";
  let online = false;
  const delivered: Array<Record<string, unknown>> = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    if (!online) throw new TypeError("offline");
    delivered.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const ctx = await setupCheckoutHttp({
    writeConfig: { webhookUrl, secret },
    fetchImpl,
    retryBaseDelayMs: 60_000,
  });
  try {
    const adminPassword = makeSyntheticPassword();
    ctx.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      hashPassword(adminPassword),
      ctx.ids.adminId,
    );
    const adminLoginRes = await fetch(`${ctx.server.url}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin.fixture", password: adminPassword }),
    });
    const adminToken = ((await adminLoginRes.json()) as { data: { token: string } }).data.token;

    const cashierStatus = await fetch(`${ctx.server.url}/api/v1/sync/sheets/status`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
    });
    assert.equal(cashierStatus.status, 403);

    const cashierFlush = await fetch(`${ctx.server.url}/api/v1/sync/sheets/flush`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.token}` },
    });
    assert.equal(cashierFlush.status, 403);

    await prepareAndCommit(
      ctx.server.url,
      ctx.token,
      ctx.shiftId,
      ctx.ids.productId,
      "attempt-manual-flush-1",
    );
    await ctx.sheetsSync.flush();

    const statusRes = await fetch(`${ctx.server.url}/api/v1/sync/sheets/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(statusRes.status, 200);
    const statusText = await statusRes.text();
    assert.equal(statusText.includes(secret), false);
    assert.equal(statusText.includes(webhookUrl), false);
    const statusJson = JSON.parse(statusText) as { data: { enabled: boolean; pendingCount: number } };
    assert.deepEqual(statusJson.data, { enabled: true, pendingCount: 1 });

    online = true;
    const flushRes = await fetch(`${ctx.server.url}/api/v1/sync/sheets/flush`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(flushRes.status, 200);
    const flushText = await flushRes.text();
    assert.equal(flushText.includes(secret), false);
    assert.equal(flushText.includes(webhookUrl), false);
    const flushJson = JSON.parse(flushText) as {
      data: { enabled: boolean; sentCount: number; pendingCount: number };
    };
    assert.deepEqual(flushJson.data, { enabled: true, sentCount: 1, pendingCount: 0 });
    assert.equal(delivered.length, 1);
  } finally {
    await ctx.cleanup();
  }
});

test("BUG-260: POST /sync/sheets/flush dengan maxItems memproses antrean per batch berbatas", async () => {
  const secret = makeSyntheticSecret();
  let online = false;
  const delivered: Array<Record<string, unknown>> = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    if (!online) throw new TypeError("offline");
    delivered.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const ctx = await setupCheckoutHttp({
    writeConfig: { webhookUrl: "https://sheets.example.invalid/webhook", secret },
    fetchImpl,
    retryBaseDelayMs: 60_000,
  });
  try {
    const adminPassword = makeSyntheticPassword();
    ctx.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      hashPassword(adminPassword),
      ctx.ids.adminId,
    );
    const adminLoginRes = await fetch(`${ctx.server.url}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin.fixture", password: adminPassword }),
    });
    const adminToken = ((await adminLoginRes.json()) as { data: { token: string } }).data.token;

    await prepareAndCommit(ctx.server.url, ctx.token, ctx.shiftId, ctx.ids.productId, "attempt-batch-1");
    await prepareAndCommit(ctx.server.url, ctx.token, ctx.shiftId, ctx.ids.productId, "attempt-batch-2");
    await ctx.sheetsSync.flush();
    assert.equal(ctx.sheetsSync.getPendingCount(), 2);

    online = true;
    const step1Res = await fetch(`${ctx.server.url}/api/v1/sync/sheets/flush`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ maxItems: 1 }),
    });
    assert.equal(step1Res.status, 200);
    const step1 = (await step1Res.json()) as {
      data: { enabled: boolean; sentCount: number; pendingCount: number };
    };
    assert.deepEqual(step1.data, { enabled: true, sentCount: 1, pendingCount: 1 });

    const step2Res = await fetch(`${ctx.server.url}/api/v1/sync/sheets/flush`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ maxItems: 1 }),
    });
    assert.equal(step2Res.status, 200);
    const step2 = (await step2Res.json()) as {
      data: { enabled: boolean; sentCount: number; pendingCount: number };
    };
    assert.deepEqual(step2.data, { enabled: true, sentCount: 1, pendingCount: 0 });
    assert.equal(delivered.length, 2);
  } finally {
    await ctx.cleanup();
  }
});
