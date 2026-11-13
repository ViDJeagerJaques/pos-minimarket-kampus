#!/usr/bin/env node
/**
 * TASK-006 — QA Fixture Reset, Verifier & Evidence Formatter (DEVELOPMENT ONLY).
 *
 * Contoh:
 *   node backend/qa/qa_runner.ts reset --confirm-dev-reset
 *   node backend/qa/qa_runner.ts verify
 *   node backend/qa/qa_runner.ts evidence --reviewer "Rahmat"
 */
import assert from "node:assert/strict";
import os from "node:os";
import { resolveDatabasePath } from "../db/src/paths.ts";
import {
  EXPECTED_QA_SNAPSHOT,
  resetAndSeedQaDatabase,
  snapshotSqliteState,
  type SqliteSnapshot,
} from "./qa_fixtures.ts";

function parseArgs(argv: string[]) {
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
  return { command, dbPath: dbPath ?? resolveDatabasePath(process.env), confirmDevReset, json, reviewer };
}

export function verifySnapshotAgainstExpected(snapshot: SqliteSnapshot): void {
  assert.equal(snapshot.userVersion, EXPECTED_QA_SNAPSHOT.userVersion);
  assert.equal(snapshot.integrity, "ok");
  assert.equal(snapshot.foreignKeyViolations, 0);
  assert.deepEqual(snapshot.counts, EXPECTED_QA_SNAPSHOT.counts);
  assert.deepEqual(snapshot.stockBalances, [...EXPECTED_QA_SNAPSHOT.stockBalances]);
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
    "## Expected Values (Acuan Oracle)",
    "```json",
    JSON.stringify(EXPECTED_QA_SNAPSHOT, null, 2),
    "```",
  ].join("\n");
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "reset") {
    const result = resetAndSeedQaDatabase({
      dbPath: args.dbPath,
      confirmDevReset: args.confirmDevReset,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (args.command === "verify") {
    const snapshot = snapshotSqliteState(args.dbPath);
    verifySnapshotAgainstExpected(snapshot);
    console.log(args.json ? JSON.stringify(snapshot, null, 2) : `PASS: snapshot ${args.dbPath} cocok dengan EXPECTED_QA_SNAPSHOT.`);
    return;
  }
  if (args.command === "evidence") {
    const snapshot = snapshotSqliteState(args.dbPath);
    verifySnapshotAgainstExpected(snapshot);
    console.log(
      formatEvidenceMarkdown({
        command: `node backend/qa/qa_runner.ts evidence --db ${args.dbPath}`,
        actualResult: "PASS",
        snapshot,
        reviewer: args.reviewer,
      }),
    );
    return;
  }
  console.error("Gunakan: reset --confirm-dev-reset | verify | evidence [--db <path>] [--reviewer <nama>]");
  process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` ||
    process.argv[1].endsWith("qa_runner.ts"));

if (invokedDirectly) {
  main();
}

