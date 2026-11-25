import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createExcelSync } from "./excelSync.ts";
import type { ReportService } from "./service.ts";
import type { SessionUser } from "../auth/session.ts";

test("Excel sinkronisasi membuat file POS, restart, retry, dan menolak workbook asing", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pos-excel-test-")); const file = path.join(root, "report.xlsx"); const config = path.join(root, "config", "excel.json");
  const actor = { role: "ADMIN", userId: 1 } as SessionUser;
  const reports = { getExcelSales: () => [
    { saleNo: "S-1", committedAtMs: 1, cashier: "=kasir", totalRp: 5000, method: "CASH", items: "+produk x 1" },
    { saleNo: "S-2", committedAtMs: 2, cashier: "kasir", totalRp: 10000, method: "QRIS_MANUAL", items: "produk x 2" },
  ] } satisfies Pick<ReportService, "getExcelSales">;
  const service = createExcelSync(reports, config);
  service.configure({ file }); assert.equal(service.status().lastSync, null);
  service.sync(actor); const first = readFileSync(file); assert.ok(first.includes(Buffer.from('t="inlineStr"'))); assert.ok(!first.includes(Buffer.from("<f>")));
  const xml = first.toString("utf8");
  assert.match(xml, /FF267349/); assert.match(xml, /FFFFFFFF/); assert.match(xml, /dd\/mm\/yyyy hh:mm:ss/);
  assert.match(xml, /<c r="A3" s="4" t="n"><v>/); assert.match(xml, /<c r="D3" s="6" t="n"><v>5000<\/v>/);
  assert.match(xml, /wrapText="1"/); assert.match(xml, /<pane ySplit="2"/); assert.match(xml, /<autoFilter/);
  assert.match(xml, /FFF1F8F3/); assert.match(xml, /width="\d+" customWidth="1"/);
  const restarted = createExcelSync(reports, config); assert.equal(restarted.status().file, file);
  restarted.sync(actor); const second = readFileSync(file); assert.equal(second.equals(first), true);
  const failed = createExcelSync(reports, config, () => { throw new Error("file terkunci"); });
  assert.throws(() => failed.sync(actor)); assert.equal(readFileSync(file).equals(second), true);
  const foreign = path.join(root, "foreign.xlsx"); writeFileSync(foreign, "user data");
  assert.throws(() => restarted.configure({ file: foreign })); assert.equal(readFileSync(foreign, "utf8"), "user data");
  writeFileSync(file, "replaced externally"); assert.throws(() => restarted.sync(actor)); assert.equal(readFileSync(file, "utf8"), "replaced externally");
  mkdirSync(path.join(root, "directory.xlsx")); assert.throws(() => restarted.configure({ file: path.join(root, "directory.xlsx") }));
});
