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
import { createPrintService } from "../print/service.ts";
import { createVirtualPrinterAdapter } from "../print/printer.ts";
import type { PrinterAdapter } from "../print/types.ts";
import { startHttpServer } from "./app.ts";

const ADMIN_PASS = `adm-${randomBytes(8).toString("hex")}`;
const CASHIER_PASS = `kas-${randomBytes(8).toString("hex")}`;

async function call(
  base: string,
  path: string,
  options: { method?: string; token?: string; payload?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.payload !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}/api/v1${path}`, {
    method: options.method ?? (options.payload === undefined ? "GET" : "POST"),
    headers,
    body: options.payload === undefined ? undefined : JSON.stringify(options.payload),
  });
  const json = (await response.json()) as {
    data?: unknown;
    error?: { code?: string; message?: string; retryable?: boolean };
  };
  return { status: response.status, json };
}

function counts(db: DatabaseSync): Record<string, number> {
  const result: Record<string, number> = {};
  for (const table of ["sales", "sale_items", "payments", "inventory_movements"]) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
    result[table] = Number(row.n);
  }
  return result;
}

test("TASK-021 HTTP AC-04.03: cetak dari sale committed, gagal cetak, reprint, dan izin", async () => {
  const database = createTempDatabase("pos-http-print-");
  const db = database.open();
  migrateFresh(database);
  insertBaseFixture(db);
  db.prepare(
    `INSERT INTO inventory_movements (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
     VALUES (1, 'OPENING', 10, 'PRINT-OPEN-1', 1, ?)`,
  ).run(FIXED_NOW);

  const securityLog = createSecurityLogger({ sink: () => {} });
  const sessions = createSessionStore(db, { secret: randomBytes(32), ttlMs: 60_000 });
  const auth = createAuthService(db, { sessions, securityLog });
  const shift = createShiftService(db, { now: () => FIXED_NOW });
  const checkout = createCheckoutService(db, { now: () => FIXED_NOW + 10 });
  const virtual = createVirtualPrinterAdapter({ now: () => FIXED_NOW + 200 });
  let printerOff = false;
  const adapter: PrinterAdapter = {
    channel: virtual.channel,
    print(receipt) {
      if (printerOff) {
        return { ok: false, reason: "printer dimatikan setelah commit (simulasi)" };
      }
      return virtual.print(receipt);
    },
  };
  const print = createPrintService(db, { printer: adapter });

  const adminActor = { userId: 1, username: "admin.fixture", role: "ADMIN" as const };
  auth.createUser(adminActor, { username: "kasir.print", password: CASHIER_PASS, role: "CASHIER" });
  auth.createUser(adminActor, { username: "kasir.print.lain", password: CASHIER_PASS, role: "CASHIER" });
  auth.createUser(adminActor, { username: "admin.print", password: ADMIN_PASS, role: "ADMIN" });

  const running = await startHttpServer({ auth, sessions, securityLog, shift, checkout, print });
  try {
    async function login(username: string, password: string): Promise<string> {
      const res = await call(running.url, "/auth/login", { payload: { username, password } });
      assert.equal(res.status, 200);
      return (res.json.data as { token: string }).token;
    }
    const ownerToken = await login("kasir.print", CASHIER_PASS);
    const otherToken = await login("kasir.print.lain", CASHIER_PASS);
    const adminToken = await login("admin.print", ADMIN_PASS);

    const opened = await call(running.url, "/shifts/open", {
      token: ownerToken,
      payload: { openingCashRp: 50_000 },
    });
    assert.equal(opened.status, 200);
    const shiftId = (opened.json.data as { id: number }).id;

    const prepared = await call(running.url, "/checkouts/prepare", {
      token: ownerToken,
      payload: {
        attemptKey: "co-print-1",
        shiftId,
        items: [{ productId: 1, quantity: 2 }],
        payment: { method: "CASH" },
      },
    });
    assert.equal(prepared.status, 200);
    const quote = prepared.json.data as { requestHash: string; quote: { totalRp: number } };
    assert.equal(quote.quote.totalRp, 5000);

    const committed = await call(running.url, "/checkouts/commit", {
      token: ownerToken,
      payload: {
        attemptKey: "co-print-1",
        requestHash: quote.requestHash,
        paymentConfirmation: { method: "CASH", cashReceivedRp: 10_000 },
      },
    });
    assert.equal(committed.status, 200);
    const sale = committed.json.data as { saleId: number; saleNo: string };
    const before = counts(db);

    // Pratinjau: pemilik boleh, ADMIN boleh membaca, kasir lain tidak.
    const receiptRes = await call(running.url, `/sales/${sale.saleId}/receipt`, { token: ownerToken });
    assert.equal(receiptRes.status, 200);
    const view = receiptRes.json.data as { receipt: { saleNo: string }; text: string; demo: boolean };
    assert.equal(view.receipt.saleNo, sale.saleNo);
    assert.equal(view.demo, true);
    assert.match(view.text, /STRUK DEMO/);
    assert.match(view.text, new RegExp(sale.saleNo));
    assert.equal((await call(running.url, `/sales/${sale.saleId}/receipt`, { token: otherToken })).status, 403);
    assert.equal((await call(running.url, `/sales/${sale.saleId}/receipt`, { token: adminToken })).status, 200);

    // ADMIN tidak mendapat izin cetak (K-03/AUTH-07 masih terbuka).
    const adminPrint = await call(running.url, `/sales/${sale.saleId}/print`, { token: adminToken, payload: {} });
    assert.equal(adminPrint.status, 403);
    assert.equal((await call(running.url, `/sales/${sale.saleId}/print`, { token: otherToken, payload: {} })).status, 403);
    assert.deepEqual(counts(db), before);

    // Printer mati sesudah commit: error 503, transaksi tetap utuh.
    printerOff = true;
    const failed = await call(running.url, `/sales/${sale.saleId}/print`, { token: ownerToken, payload: {} });
    assert.equal(failed.status, 503);
    assert.equal(failed.json.error?.code, "PRINTER_UNAVAILABLE");
    assert.equal(failed.json.error?.retryable, true);
    assert.deepEqual(counts(db), before);
    assert.equal((await call(running.url, `/sales/${sale.saleId}/receipt`, { token: ownerToken })).status, 200);

    // Reprint 2x setelah printer siap: nomor/isi sama, tanpa sale/mutasi baru.
    printerOff = false;
    const p1 = await call(running.url, `/sales/${sale.saleId}/print`, { token: ownerToken, payload: {} });
    const p2 = await call(running.url, `/sales/${sale.saleId}/print`, { token: ownerToken, payload: {} });
    assert.equal(p1.status, 200);
    assert.equal(p2.status, 200);
    const first = p1.json.data as { saleId: number; saleNo: string; text: string; status: string; channel: string };
    const second = p2.json.data as { saleId: number; saleNo: string; text: string };
    assert.equal(first.status, "PRINTED");
    assert.equal(first.channel, "VIRTUAL");
    assert.equal(first.saleNo, sale.saleNo);
    assert.equal(first.text, second.text);
    assert.equal(first.saleNo, second.saleNo);
    assert.deepEqual(counts(db), before);

    // Sale/ID tidak ditemukan tidak membocorkan data lain.
    assert.equal((await call(running.url, "/sales/999999/receipt", { token: ownerToken })).status, 404);
    assert.equal((await call(running.url, "/sales/999999/print", { token: ownerToken, payload: {} })).status, 404);
  } finally {
    await running.close();
    db.close();
    database.cleanup();
  }
});
