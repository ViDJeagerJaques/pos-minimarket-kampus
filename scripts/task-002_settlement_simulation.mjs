#!/usr/bin/env node
/**
 * TASK-002 — verifikasi perhitungan setoran dengan data SIMULASI.
 *
 * Batas penting:
 * - Ini bukan kode aplikasi POS dan bukan SOP produksi.
 * - Semua angka adalah fixture sintetis, bukan transaksi minimarket.
 * - Formula mengikuti usulan DEC-016/PRD, yang masih berstatus PROPOSED
 *   untuk SOP setoran. Script ini hanya membuktikan aritmetika fixture.
 * - QRIS tidak boleh menambah uang fisik laci.
 *
 * Jalankan: node scripts/task-002_settlement_simulation.mjs
 */

import assert from "node:assert/strict";

const ALLOWED_METHODS = ["CASH", "QRIS_MANUAL"];

function assertRupiah(name, value) {
  assert.ok(
    Number.isSafeInteger(value) && value >= 0,
    `${name} harus bilangan bulat rupiah >= 0 (diterima: ${value})`,
  );
}

function assertPaymentMethod(method) {
  if (!ALLOWED_METHODS.includes(method)) {
    throw new Error(
      `Metode "${method}" tidak ada pada fixture MVP (${ALLOWED_METHODS.join(", ")})`,
    );
  }
}

/**
 * Formula fixture:
 * kas_seharusnya = modal_awal + penjualan_tunai - pengembalian_tunai
 *                  - pengeluaran_kas - setoran_tengah_shift
 * selisih = uang_fisik_dihitung - kas_seharusnya
 *
 * qrisSalesRp hanya untuk rekap terpisah; tidak pernah masuk kas_seharusnya.
 */
function calculateSettlement({
  openingCashRp,
  cashSalesRp,
  qrisSalesRp,
  cashRefundsRp = 0,
  authorizedCashExpensesRp = 0,
  midShiftDepositRp = 0,
  countedCashRp,
  qrisMerchantTotalRp = qrisSalesRp,
}) {
  assertRupiah("openingCashRp", openingCashRp);
  assertRupiah("cashSalesRp", cashSalesRp);
  assertRupiah("qrisSalesRp", qrisSalesRp);
  assertRupiah("cashRefundsRp", cashRefundsRp);
  assertRupiah("authorizedCashExpensesRp", authorizedCashExpensesRp);
  assertRupiah("midShiftDepositRp", midShiftDepositRp);
  assertRupiah("countedCashRp", countedCashRp);
  assertRupiah("qrisMerchantTotalRp", qrisMerchantTotalRp);

  const expectedCashRp =
    openingCashRp +
    cashSalesRp -
    cashRefundsRp -
    authorizedCashExpensesRp -
    midShiftDepositRp;

  const varianceRp = countedCashRp - expectedCashRp;

  return {
    expectedCashRp,
    varianceRp,
    totalSalesRp: cashSalesRp + qrisSalesRp,
    qrisReportedSeparatelyRp: qrisSalesRp,
    qrisIncludedInExpectedCash: false,
    // Belum ada SOP selisih yang disahkan; jangan pernah auto-approve.
    varianceFollowsApprovedSop: false,
    varianceStatus:
      varianceRp === 0 ? "MATCH" : "REVIEW_REQUIRED_SOP_PENDING",
    qrisReconciliationStatus:
      qrisMerchantTotalRp === qrisSalesRp
        ? "MATCH"
        : "QRIS_RECONCILIATION_REQUIRED",
    midShiftDepositStatus:
      midShiftDepositRp > 0 ? "SIMULATION_ONLY_SOP_PENDING" : "NONE",
    cashExpenseStatus:
      authorizedCashExpensesRp > 0 ? "SIMULATION_ONLY_SOP_PENDING" : "NONE",
  };
}

let pass = 0;
let fail = 0;

function test(id, description, fn) {
  try {
    fn();
    console.log(`PASS ${id} — ${description}`);
    pass += 1;
  } catch (error) {
    console.log(`FAIL ${id} — ${description}`);
    console.log(`     ${error.message}`);
    fail += 1;
  }
}

const BASE = {
  openingCashRp: 100_000,
  cashSalesRp: 500_000,
  qrisSalesRp: 300_000,
  countedCashRp: 600_000,
};

test("T1", "modal 100.000 + tunai 500.000 + QRIS 300.000; laci cocok 600.000", () => {
  const result = calculateSettlement(BASE);
  assert.equal(result.expectedCashRp, 600_000);
  assert.equal(result.varianceRp, 0);
  assert.equal(result.varianceStatus, "MATCH");
  assert.equal(result.totalSalesRp, 800_000);
  assert.equal(result.qrisReportedSeparatelyRp, 300_000);
  assert.notEqual(result.expectedCashRp, result.totalSalesRp);
});

test("T2", "QRIS 0 / 300.000 / 999.000 tidak mengubah kas seharusnya", () => {
  for (const qrisSalesRp of [0, 300_000, 999_000]) {
    const result = calculateSettlement({ ...BASE, qrisSalesRp });
    assert.equal(result.expectedCashRp, 600_000);
    assert.equal(result.qrisIncludedInExpectedCash, false);
  }
});

test("T3", "uang laci kurang 10.000 dicatat, tidak auto-disetujui", () => {
  const result = calculateSettlement({ ...BASE, countedCashRp: 590_000 });
  assert.equal(result.varianceRp, -10_000);
  assert.equal(result.varianceStatus, "REVIEW_REQUIRED_SOP_PENDING");
  assert.equal(result.varianceFollowsApprovedSop, false);
});

test("T4", "uang laci lebih 10.000 dicatat, tidak auto-disetujui", () => {
  const result = calculateSettlement({ ...BASE, countedCashRp: 610_000 });
  assert.equal(result.varianceRp, 10_000);
  assert.equal(result.varianceStatus, "REVIEW_REQUIRED_SOP_PENDING");
  assert.equal(result.varianceFollowsApprovedSop, false);
});

test("T5", "simulasi setoran tengah shift 200.000 (kebijakan BELUM disahkan)", () => {
  const result = calculateSettlement({
    ...BASE,
    midShiftDepositRp: 200_000,
    countedCashRp: 400_000,
  });
  assert.equal(result.expectedCashRp, 400_000);
  assert.equal(result.varianceRp, 0);
  assert.equal(result.midShiftDepositStatus, "SIMULATION_ONLY_SOP_PENDING");
});

test("T6", "simulasi pengeluaran kas 50.000 (kebijakan BELUM disahkan)", () => {
  const result = calculateSettlement({
    ...BASE,
    authorizedCashExpensesRp: 50_000,
    countedCashRp: 550_000,
  });
  assert.equal(result.expectedCashRp, 550_000);
  assert.equal(result.varianceRp, 0);
  assert.equal(result.cashExpenseStatus, "SIMULATION_ONLY_SOP_PENDING");
});

test("T7", "nominal negatif ditolak oleh fixture", () => {
  assert.throws(
    () => calculateSettlement({ ...BASE, openingCashRp: -1 }),
    /openingCashRp/,
  );
  assert.throws(
    () => calculateSettlement({ ...BASE, countedCashRp: 600_000.5 }),
    /countedCashRp/,
  );
});

test("T8", "hanya CASH dan QRIS_MANUAL yang masuk allowlist fixture", () => {
  assert.doesNotThrow(() => assertPaymentMethod("CASH"));
  assert.doesNotThrow(() => assertPaymentMethod("QRIS_MANUAL"));
  assert.throws(() => assertPaymentMethod("QRIS"), /tidak ada pada fixture/);
  assert.throws(() => assertPaymentMethod("DEBIT"), /tidak ada pada fixture/);
});

test("T9", "QRIS merchant 290.000 vs rekap POS 300.000 perlu rekonsiliasi", () => {
  const result = calculateSettlement({ ...BASE, qrisMerchantTotalRp: 290_000 });
  assert.equal(result.expectedCashRp, 600_000);
  assert.equal(result.qrisReconciliationStatus, "QRIS_RECONCILIATION_REQUIRED");
});

console.log("");
console.log(`Ringkasan: ${pass}/${pass + fail} PASS, ${fail} FAIL`);
console.log("Catatan: hasil ini hanya membuktikan aritmetika fixture, bukan SOP produksi.");

if (fail > 0) {
  process.exitCode = 1;
}
