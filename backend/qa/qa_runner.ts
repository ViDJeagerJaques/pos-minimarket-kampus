#!/usr/bin/env node
/**
 * TASK-006 — QA Fixture Reset, Verifier & Evidence Formatter (DEVELOPMENT ONLY).
 *
 * Contoh:
 *   node backend/qa/qa_runner.ts reset --db <temp-qa-db-path> --confirm-dev-reset
 *   node backend/qa/qa_runner.ts verify --db <temp-qa-db-path>
 *   node backend/qa/qa_runner.ts evidence --db <temp-qa-db-path> --reviewer "Rahmat"
 */
import assert from "node:assert/strict";
import os from "node:os";
import { resolveDatabasePath } from "../db/src/paths.ts";
import {
  EXPECTED_QA_SNAPSHOT,
  QaFixtureError,
  resetAndSeedQaDatabase,
  snapshotSqliteState,
  type SqliteSnapshot,
} from "./qa_fixtures.ts";

export function parseArgs(argv: string[]) {
  const [command, ...rest] = argv;
  let dbPath: string | undefined;
  let confirmDevReset = false;
  let json = false;
  let reviewer = "PENDING_REVIEWER";

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--db" && rest[i + 1]) {
      dbPath = rest[++i];
    } else if (arg === "--confirm-dev-reset") {
      confirmDevReset = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--reviewer" && rest[i + 1]) {
      reviewer = rest[++i];
    }
  }
  return { command, dbPath, confirmDevReset, json, reviewer };
}

export function verifySnapshotAgainstExpected(snapshot: SqliteSnapshot): void {
  assert.equal(snapshot.userVersion, EXPECTED_QA_SNAPSHOT.userVersion);
  assert.equal(snapshot.integrity, "ok");
  assert.equal(snapshot.foreignKeyViolations, 0);
  assert.deepEqual(snapshot.counts, EXPECTED_QA_SNAPSHOT.counts);
  assert.deepEqual(snapshot.stockBalances, [...EXPECTED_QA_SNAPSHOT.stockBalances]);

  // Verifikasi NILAI shift, bukan sekadar jumlah baris.
  const closedShift = snapshot.shifts.find((s) => s.id === EXPECTED_QA_SNAPSHOT.shifts.closedShiftId);
  const activeShift = snapshot.shifts.find((s) => s.id === EXPECTED_QA_SNAPSHOT.shifts.activeShiftId);
  assert.ok(closedShift, `Shift ${EXPECTED_QA_SNAPSHOT.shifts.closedShiftId} tidak ada`);
  assert.equal(closedShift.openingCashRp, EXPECTED_QA_SNAPSHOT.shifts.closedShiftOpeningCashRp);
  assert.notEqual(closedShift.closedAtMs, null);
  assert.ok(activeShift, `Shift ${EXPECTED_QA_SNAPSHOT.shifts.activeShiftId} tidak ada`);
  assert.equal(activeShift.cashierId, EXPECTED_QA_SNAPSHOT.shifts.activeShiftCashierId);
  assert.equal(activeShift.closedAtMs, null);

  assert.deepEqual(snapshot.shiftClosingTotals, [...EXPECTED_QA_SNAPSHOT.shiftClosingTotals]);
  assert.deepEqual(snapshot.closedShiftSummary, [...EXPECTED_QA_SNAPSHOT.closedShiftSummary]);
  assert.deepEqual(
    snapshot.preparedAttemptsWithoutSale,
    [...EXPECTED_QA_SNAPSHOT.preparedAttemptsWithoutSale],
  );
  assert.deepEqual(snapshot.payments, [...EXPECTED_QA_SNAPSHOT.payments]);
}

export function formatEvidenceMarkdown(params: {
  command: string;
  actualResult: "PASS" | "FAIL" | "BLOCKED";
  snapshot: SqliteSnapshot;
  reviewer: string;
  dateIso?: string;
}): string {
  const dateIso = params.dateIso ?? new Date().toISOString();
  const machine = `${os.platform()} ${os.release()} (${os.arch()}), Node ${process.version}`;
  const stockRows = params.snapshot.stockBalances
    .map(
      (r) =>
        `| ${r.productId} | ${r.sku} | \`${r.barcode}\` | Rp${r.priceRp} | ${r.onHand} |`,
    )
    .join("\n");

  return [
    "# Bukti Uji QA — TASK-006 (Sintetis / Development)",
    "",
    "| Atribut | Nilai |",
    "|---|---|",
    `| Tanggal | ${dateIso} |`,
    `| Mesin / Runtime | ${machine} |`,
    `| Reviewer | ${params.reviewer} |`,
    `| Perintah / Aksi | \`${params.command}\` |`,
    `| Hasil Nyata | **${params.actualResult}** |`,
    `| DB Path | \`${params.snapshot.dbPath}\` |`,
    `| Schema user_version | ${params.snapshot.userVersion} |`,
    `| PRAGMA integrity_check | \`${params.snapshot.integrity}\` |`,
    `| PRAGMA foreign_key_check | ${params.snapshot.foreignKeyViolations} pelanggaran |`,
    "",
    "## Snapshot Jumlah Baris SQLite",
    "```json",
    JSON.stringify(params.snapshot.counts, null, 2),
    "```",
    "",
    "## Snapshot Saldo Stok & Barcode Nol Awal",
    "| ID | SKU | Barcode | Harga | On Hand |",
    "|---|---|---|---|---|",
    stockRows,
    "",
    "## Snapshot Shift (Nilai)",
    "| shiftId | cashierId | closedAtMs | openingCashRp |",
    "|---|---|---|---|",
    ...params.snapshot.shifts.map(
      (s) => `| ${s.id} | ${s.cashierId} | ${s.closedAtMs ?? "(aktif)"} | ${s.openingCashRp ?? "-"} |`,
    ),
    "",
    "## Penutupan Shift (declared/variance)",
    "| shiftId | declaredCashRp | varianceRp |",
    "|---|---|---|",
    ...params.snapshot.closedShiftSummary.map(
      (c) => `| ${c.shiftId} | ${c.declaredCashRp ?? "-"} | ${c.varianceRp ?? "-"} |`,
    ),
    "",
    "## Rekap per Metode Pembayaran (shift closing)",
    "| shiftId | methodCode | amountRp |",
    "|---|---|---|",
    ...params.snapshot.shiftClosingTotals.map(
      (t) => `| ${t.shiftId} | ${t.methodCode} | Rp${t.amountRp} |`,
    ),
    "",
    "## Checkout Attempt Belum Tersimpan (PREPARED)",
    "| attemptKey | shiftId | hasSale |",
    "|---|---|---|",
    ...params.snapshot.preparedAttemptsWithoutSale.map(
      (a) => `| ${a.attemptKey} | ${a.shiftId} | ${a.hasSale} |`,
    ),
    "",
    "## Pembayaran (metode, nominal, verifikasi QRIS)",
    "| id | saleId | methodCode | amountRp | evidenceRef | verifiedBy |",
    "|---|---|---|---|---|---|",
    ...params.snapshot.payments.map(
      (p) =>
        `| ${p.id} | ${p.saleId} | ${p.methodCode} | Rp${p.amountRp} | ${p.evidenceRef ?? "-"} | ${p.verifiedBy ?? "-"} |`,
    ),
    "",
    "## Expected Values (Acuan Oracle)",
    "```json",
    JSON.stringify(EXPECTED_QA_SNAPSHOT, null, 2),
    "```",
  ].join("\n");
}

export function runQaCli(argv: string[]): void {
  const args = parseArgs(argv);
  if (args.command === "reset") {
    if (!args.dbPath || args.dbPath.trim().length === 0) {
      throw new QaFixtureError(
        "Reset QA ditolak: perintah `reset` wajib menyertakan argumen `--db <path>` secara eksplisit (tidak boleh memakai lokasi default).",
      );
    }
    const result = resetAndSeedQaDatabase({
      dbPath: args.dbPath,
      confirmDevReset: args.confirmDevReset,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const targetDbPath = args.dbPath ?? resolveDatabasePath(process.env);
  if (args.command === "verify") {
    const snapshot = snapshotSqliteState(targetDbPath);
    verifySnapshotAgainstExpected(snapshot);
    console.log(args.json ? JSON.stringify(snapshot, null, 2) : `PASS: snapshot ${targetDbPath} cocok dengan EXPECTED_QA_SNAPSHOT.`);
    return;
  }
  if (args.command === "evidence") {
    const snapshot = snapshotSqliteState(targetDbPath);
    verifySnapshotAgainstExpected(snapshot);
    console.log(
      formatEvidenceMarkdown({
        command: `node backend/qa/qa_runner.ts evidence --db ${targetDbPath}`,
        actualResult: "PASS",
        snapshot,
        reviewer: args.reviewer,
      }),
    );
    return;
  }
  console.error("Gunakan: reset --db <path> --confirm-dev-reset | verify [--db <path>] | evidence [--db <path>] [--reviewer <nama>]");
  process.exitCode = 1;
}

function main(): void {
  try {
    runQaCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` ||
    process.argv[1].endsWith("qa_runner.ts"));

if (invokedDirectly) {
  main();
}

