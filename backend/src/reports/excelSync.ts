import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { buildExcelWorkbook } from "../../../shared/excel.ts";
import { assertOutsideSourceTree } from "../../db/src/paths.ts";
import { ValidationError } from "../auth/errors.ts";
import { enforceSandboxPath } from "../sandbox/env.ts";
import type { ReportService } from "./service.ts";
import type { SessionUser } from "../auth/session.ts";

type Config = { file: string; marker: string; lastSync: number | null };

// Read only the worksheet from a normal (non-ZIP64) workbook. Refuse unknown formats.
function ownsWorkbook(file: string, marker: string): boolean {
  try {
    const b = readFileSync(file); let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return false;
    const count = b.readUInt16LE(eocd + 10); let off = b.readUInt32LE(eocd + 16);
    for (let i = 0; i < count; i++) {
      if (b.readUInt32LE(off) !== 0x02014b50) return false;
      const method = b.readUInt16LE(off + 10), size = b.readUInt32LE(off + 20), unpacked = b.readUInt32LE(off + 24), n = b.readUInt16LE(off + 28), extra = b.readUInt16LE(off + 30), comment = b.readUInt16LE(off + 32), local = b.readUInt32LE(off + 42);
      const name = b.subarray(off + 46, off + 46 + n).toString(); off += 46 + n + extra + comment;
      if (name !== "xl/worksheets/sheet1.xml" && name !== "xl/sharedStrings.xml") continue;
      if (unpacked > 100_000_000 || b.readUInt32LE(local) !== 0x04034b50) return false;
      const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
      const data = b.subarray(start, start + size); const text = (method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: 100_000_000 }) : Buffer.alloc(0)).toString();
      if (text.includes(marker)) return true;
    }
  } catch { /* fail closed */ }
  return false;
}

export function createExcelSync(reports: Pick<ReportService, "getExcelSales">, configPath: string, beforeReplace: () => void = () => {}) {
  function load(): Config | null { try { const c = JSON.parse(readFileSync(configPath, "utf8")) as Config; return typeof c.file === "string" && /^[a-f0-9]{32}$/.test(c.marker) && (c.lastSync === null || Number.isSafeInteger(c.lastSync)) ? c : null; } catch { return null; } }
  function atomic(file: string, data: string | Buffer) {
    const temp = path.join(path.dirname(file), `.pos-${randomBytes(16).toString("hex")}.tmp`);
    try { writeFileSync(temp, data, { flag: "wx", mode: 0o600 }); beforeReplace(); renameSync(temp, file); } finally { try { unlinkSync(temp); } catch {} }
  }
  function checked(file: string) {
    if (!path.isAbsolute(file) || path.extname(file).toLowerCase() !== ".xlsx") throw new ValidationError("Pilih file .xlsx dengan lokasi absolut.", "file");
    const target = path.resolve(file); assertOutsideSourceTree(target); enforceSandboxPath(target, "Excel");
    const dir = realpathSync(path.dirname(target)); assertOutsideSourceTree(dir); enforceSandboxPath(dir, "Excel");
    if (existsSync(target) && (!lstatSync(target).isFile() || lstatSync(target).isSymbolicLink())) throw new ValidationError("File tujuan tidak valid.", "file");
    return path.join(dir, path.basename(target));
  }
  function store(config: Config) { mkdirSync(path.dirname(configPath), { recursive: true }); atomic(configPath, JSON.stringify(config)); }
  return {
    status() { const c = load(); return { file: c?.file ?? null, lastSync: c?.lastSync ?? null }; },
    configure(input: Record<string, unknown>) {
      if (typeof input.file !== "string") throw new ValidationError("Pilih file Excel.", "file");
      const file = checked(input.file); const prev = load();
      if (!prev && existsSync(configPath)) throw new ValidationError("Konfigurasi Excel tidak dapat dibaca; jangan menimpa file sebelum diperiksa.", "file");
      if (existsSync(file) && (!prev || prev.file !== file || !ownsWorkbook(file, prev.marker))) throw new ValidationError("File bukan workbook laporan POS ini. Pilih nama file baru.", "file");
      store(prev?.file === file ? prev : { file, marker: randomBytes(16).toString("hex"), lastSync: null });
      return this.status();
    },
    sync(actor: SessionUser) {
      const c = load(); if (!c) throw new ValidationError("Pilih file Excel terlebih dahulu.", "file");
      const file = checked(c.file);
      if (existsSync(file) && !ownsWorkbook(file, c.marker)) throw new ValidationError("File bukan workbook laporan POS ini. Pilih nama file baru.", "file");
      const rows = reports.getExcelSales(actor).map(s => [new Date(s.committedAtMs), s.saleNo, s.cashier, s.totalRp, s.method, s.items]);
      const content = Buffer.from(buildExcelWorkbook(`Laporan Penjualan POS ${c.marker}`, ["Waktu", "No Struk", "Kasir", "Total Rp", "Metode", "Barang"], rows));
      atomic(file, content); c.lastSync = Date.now(); store(c); return this.status();
    },
  };
}
