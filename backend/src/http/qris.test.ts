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
import { createCatalogService } from "../catalog/service.ts";
import { createShiftService } from "../shift/service.ts";
import { createCheckoutService } from "../checkout/service.ts";
import { createReportService } from "../reports/service.ts";
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
  const text = await response.text();
  const json = text.length > 0 ? (JSON.parse(text) as Record<string, any>) : null;
  return { status: response.status, json };
}

function dataOf(result: { json: any }) {
  return result.json?.data;
}

function count(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number } | undefined;
  return Number(row?.total ?? 0);
}

test("TASK-037 HTTP QRIS: verifikasi manual, audit sesi, retry identik, laporan terpisah", async () => {
  const database = createTempDatabase("pos-http-qris-");
  try {
    const db = database.open();
    try {
      migrateFresh(database);
      insertBaseFixture(db);
  db.prepare(
    `INSERT INTO inventory_movements (product_id, kind, delta, opening_batch_ref, actor_id, created_at_ms)
     VALUES (1, 'OPENING', 5, 'QRIS-OPEN-1', 1, ?)`,
  ).run(FIXED_NOW);

  const securityLog = createSecurityLogger({ sink: () => {} });
  const sessions = createSessionStore(db, { secret: randomBytes(32), ttlMs: 60_000 });
  const auth = createAuthService(db, { sessions, securityLog });
  const shift = createShiftService(db, { now: () => FIXED_NOW });
  const checkout = createCheckoutService(db, { now: () => FIXED_NOW + 10 });
  const reports = createReportService(db);

  const adminActor = { userId: 1, username: "admin.fixture", role: "ADMIN" as const };
  auth.createUser(adminActor, { username: "admin.qris", password: ADMIN_PASS, role: "ADMIN" });
  auth.createUser(adminActor, { username: "kasir.qris", password: CASHIER_PASS, role: "CASHIER" });
  auth.createUser(adminActor, { username: "kasir.lain.qris", password: CASHIER_PASS, role: "CASHIER" });

      const running = await startHttpServer({
        auth,
        sessions,
        securityLog,
        catalog: createCatalogService(db),
        shift,
        checkout,
        reports,
      });
      try {
        async function login(username: string, password: string) {
      const result = await call(running.url, "/auth/login", {
        method: "POST",
        payload: { username, password },
      });
      assert.equal(result.status, 200);
      return dataOf(result).token as string;
    }
    const adminToken = await login("admin.qris", ADMIN_PASS);
    const cashierToken = await login("kasir.qris", CASHIER_PASS);
    const otherToken = await login("kasir.lain.qris", CASHIER_PASS);
    const cashierRow = db.prepare("SELECT id FROM users WHERE username = ?").get("kasir.qris") as { id: number };
    const cashierId = Number(cashierRow.id);

    const opened = await call(running.url, "/shifts/open", {
      method: "POST",
      token: cashierToken,
      payload: {},
    });
    assert.equal(opened.status, 200);
    const shiftId = dataOf(opened).id as number;
    const attemptKey = `qris-${randomBytes(6).toString("hex")}`;
    const prepareBody = {
      attemptKey,
      shiftId,
      items: [{ productId: 1, quantity: 1 }],
      payment: { method: "QRIS_MANUAL" },
    };
    const prepared = await call(running.url, "/checkouts/prepare", {
      method: "POST",
      token: cashierToken,
      payload: prepareBody,
    });
    assert.equal(prepared.status, 200);
    const requestHash = dataOf(prepared).requestHash as string;
    assert.equal(dataOf(prepared).quote.totalRp, 2500);
    assert.equal(dataOf(prepared).quote.payment.method, "QRIS_MANUAL");

    const pending = await call(running.url, `/checkouts/${attemptKey}`, { token: cashierToken });
    assert.equal(pending.status, 200);
    assert.equal(dataOf(pending).status, "PREPARED");
    assert.deepEqual(dataOf(pending).qrisVerification, { status: "pending" });
    assert.equal(count(db, "sales"), 0, "PREPARED tidak boleh membuat penjualan");

    const commit = (confirmation: Record<string, unknown>) =>
      call(running.url, "/checkouts/commit", {
        method: "POST",
        token: cashierToken,
        payload: { attemptKey, requestHash, paymentConfirmation: confirmation },
      });

    const noConfirm = await commit({ method: "QRIS_MANUAL", confirmedAmountRp: 2500 });
    assert.equal(noConfirm.status, 422);
    assert.equal(noConfirm.json?.error?.code, "VALIDATION_ERROR");

    const wrongAmount = await commit({
      method: "QRIS_MANUAL",
      merchantConfirmed: true,
      confirmedAmountRp: 1000,
    });
    assert.equal(wrongAmount.status, 422);
    assert.equal(wrongAmount.json?.error?.code, "VALIDATION_ERROR");
    assert.equal(count(db, "sales"), 0, "verifikasi gagal tidak boleh membuat sale/mutasi");
    assert.equal(count(db, "inventory_movements"), 1, "hanya mutasi OPENING fixture");

    const confirmed = await commit({
      method: "QRIS_MANUAL",
      merchantConfirmed: true,
      confirmedAmountRp: 2500,
      evidenceRef: "REF-QRIS-E2E-1",
    });
    assert.equal(confirmed.status, 200);
    const committed = dataOf(confirmed);
    assert.equal(committed.status, "COMMITTED");
    assert.equal(committed.qrisVerification.status, "verified");
    assert.equal(committed.qrisVerification.verifiedBy, cashierId, "verifiedBy dari sesi, bukan body");
    assert.equal(committed.qrisVerification.verifiedAtMs, FIXED_NOW + 10);
    assert.equal(committed.payment.changeRp, 0);
    assert.equal(committed.payment.evidenceRef, "REF-QRIS-E2E-1");

    const paymentRow = db
      .prepare("SELECT method_code, evidence_ref, verified_by, verified_at_ms FROM payments WHERE sale_id = ?")
      .get(committed.saleId) as any;
    assert.equal(paymentRow.method_code, "QRIS_MANUAL");
    assert.equal(paymentRow.verified_by, cashierId);
    assert.equal(paymentRow.verified_at_ms, FIXED_NOW + 10);
    assert.equal(paymentRow.evidence_ref, "REF-QRIS-E2E-1");

    const statuses = await call(running.url, `/checkouts/${attemptKey}`, { token: cashierToken });
    assert.equal(statuses.status, 200);
    assert.equal(dataOf(statuses).status, "COMMITTED");
    assert.equal(dataOf(statuses).qrisVerification.status, "verified");

    const retry = await commit({
      method: "QRIS_MANUAL",
      merchantConfirmed: true,
      confirmedAmountRp: 2500,
      evidenceRef: "REF-QRIS-E2E-1",
    });
    assert.equal(retry.status, 200);
    assert.equal(dataOf(retry).saleId, committed.saleId);
    assert.equal(count(db, "sales"), 1, "retry identik tidak boleh menambah sale");
    assert.equal(count(db, "payments"), 1);
    assert.equal(count(db, "inventory_movements"), 2);

    // Kasir dapat membaca laporan miliknya, ADMIN dapat membaca seluruhnya.
    const ownReport = await call(running.url, "/reports/payments", { token: cashierToken });
    assert.equal(ownReport.status, 200);
    assert.equal(dataOf(ownReport).qrisManual.totalRp, 2500);
    assert.equal(dataOf(ownReport).qrisSales[0].saleId, committed.saleId);
    const report = await call(running.url, "/reports/payments", { token: adminToken });
    assert.equal(report.status, 200);
    assert.equal(dataOf(report).qrisManual.totalRp, 2500);
    assert.equal(dataOf(report).qrisManual.count, 1);
    assert.equal(dataOf(report).qrisManual.verifiedCount, 1);
    assert.equal(dataOf(report).cash.totalRp, 0);
    assert.equal(dataOf(report).cash.count, 0);
    assert.equal(dataOf(report).qrisSales[0].cashierUsername, "kasir.qris");

    const otherId = Number((db.prepare("SELECT id FROM users WHERE username = ?").get("kasir.lain.qris") as { id: number }).id);
    db.prepare("INSERT INTO shifts (id, cashier_id, opened_at_ms, closed_at_ms, opening_cash_rp) VALUES (999, ?, ?, ?, 0)").run(otherId, FIXED_NOW - 100, FIXED_NOW - 50);
    db.prepare("INSERT INTO checkout_attempts (attempt_key, shift_id, cashier_id, request_hash, prepared_at_ms) VALUES ('other-qris', 999, ?, zeroblob(32), ?)").run(otherId, FIXED_NOW - 100);
    db.prepare("INSERT INTO sales (id, sale_no, attempt_key, committed_at_ms, total_rp) VALUES (999, 'S-OTHER', 'other-qris', ?, 7000)").run(FIXED_NOW - 60);
    db.prepare("INSERT INTO payments (sale_id, method_code, amount_rp, verified_by, verified_at_ms) VALUES (999, 'QRIS_MANUAL', 7000, ?, ?)").run(otherId, FIXED_NOW - 60);
    const ownerView = dataOf(await call(running.url, "/reports/payments", { token: cashierToken }));
    const otherView = dataOf(await call(running.url, "/reports/payments", { token: otherToken }));
    const adminView = dataOf(await call(running.url, "/reports/payments", { token: adminToken }));
    assert.equal(ownerView.qrisManual.totalRp, 2500);
    assert.deepEqual(ownerView.qrisSales.map((row: { saleId: number }) => row.saleId), [committed.saleId]);
    assert.equal(otherView.qrisManual.totalRp, 7000);
    assert.deepEqual(otherView.qrisSales.map((row: { saleId: number }) => row.saleId), [999]);
    assert.equal(adminView.qrisManual.totalRp, 9500);
    db.prepare("DELETE FROM payments WHERE sale_id = 999").run();
    db.prepare("DELETE FROM sales WHERE id = 999").run();
    db.prepare("DELETE FROM checkout_attempts WHERE attempt_key = 'other-qris'").run();
    db.prepare("DELETE FROM shifts WHERE id = 999").run();

    // Checkout CASH masuk laporan kas, bukan QRIS.
    const cashAttempt = `cash-${randomBytes(6).toString("hex")}`;
    const cashPrepare = await call(running.url, "/checkouts/prepare", {
      method: "POST",
      token: cashierToken,
      payload: {
        attemptKey: cashAttempt,
        shiftId,
        items: [{ productId: 1, quantity: 1 }],
        payment: { method: "CASH" },
      },
    });
    assert.equal(cashPrepare.status, 200);
    const cashCommit = await call(running.url, "/checkouts/commit", {
      method: "POST",
      token: cashierToken,
      payload: {
        attemptKey: cashAttempt,
        requestHash: dataOf(cashPrepare).requestHash,
        paymentConfirmation: { method: "CASH", cashReceivedRp: 5000 },
      },
    });
    assert.equal(cashCommit.status, 200);
    const report2 = await call(running.url, "/reports/payments", { token: adminToken });
    assert.equal(dataOf(report2).cash.totalRp, 2500);
    assert.equal(dataOf(report2).cash.count, 1);
    assert.equal(dataOf(report2).qrisManual.totalRp, 2500);
    assert.equal(dataOf(report2).qrisManual.count, 1);
    assert.equal(dataOf(report2).totalRp, 5000);

    const audits = db.prepare("SELECT action, details FROM audit_log ORDER BY id").all() as Array<{
      action: string;
      details: string;
    }>;
    const qrisAudits = audits.filter((row) => row.action === "QRIS_MANUAL_CONFIRMED");
    assert.equal(qrisAudits.length, 1, "audit verifikasi hanya satu meski retry");
    const details = JSON.parse(qrisAudits[0]!.details) as Record<string, unknown>;
    assert.equal(details.status, "verified");
    assert.equal(details.verifiedBy, cashierId);
    assert.equal(details.verifiedAtMs, FIXED_NOW + 10);
    assert.equal(JSON.stringify(details).includes("REF-QRIS-E2E-1"), false, "audit tidak menyimpan bukti mentah");
    assert.equal(JSON.stringify(audits).includes(ADMIN_PASS), false);
    assert.equal(JSON.stringify(audits).includes(CASHIER_PASS), false);
    } finally {
      try {
        await running.close();
      } catch {
        // Tutup server gagal; tetap bersihkan koneksi DB dan direktori temp.
      }
    }
    } finally {
      db.close();
    }
  } finally {
    database.cleanup();
  }
});
