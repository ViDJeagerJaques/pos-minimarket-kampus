import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { assertOutsideSourceTree } from "../../db/src/paths.ts";
import { ValidationError } from "../auth/errors.ts";
import { sendDemoPayload, validateDemoWebhookUrl } from "./sheetsProtocol.ts";

export type DemoConfig = { version: 2; webhookUrl: string; secret: string; databaseNamespace: string; dbBinding: string; targetId: string; afterSaleId: number };
export function databaseBinding(dbPath: string): string {
  const stat = statSync(dbPath, { bigint: true });
  if (stat.ino === 0n) throw new Error("Identitas file database tidak dapat diverifikasi.");
  return createHash("sha256").update(`${path.resolve(dbPath)}|${stat.dev}|${stat.ino}|${stat.birthtimeNs}`).digest("hex");
}
export function readDemoConfig(configPath: string): DemoConfig | null {
  try { const value = JSON.parse(readFileSync(configPath, "utf8")) as DemoConfig;
    if (value.version !== 2 || !/^[a-f0-9]{32}$/.test(value.databaseNamespace) || !/^[a-f0-9]{64}$/.test(value.dbBinding) || !/^[a-f0-9]{64}$/.test(value.targetId) || !Number.isSafeInteger(value.afterSaleId) || value.afterSaleId < 0 || typeof value.secret !== "string" || !value.secret || validateDemoWebhookUrl(value.webhookUrl) !== value.webhookUrl || createHash("sha256").update(value.webhookUrl).digest("hex") !== value.targetId) return null;
    return value;
  } catch { return null; }
}
export function createDemoConfigManager(db: DatabaseSync, dbPath: string, configPath: string, activeFingerprint: string | null, fetchImpl: typeof fetch = fetch) {
  function inputs(input: Record<string, unknown>) {
    try {
      if (typeof input.webhookUrl !== "string" || typeof input.secret !== "string" || input.secret.length < 1 || input.secret.length > 1024 || input.secret.trim() !== input.secret) throw new Error();
      return { webhookUrl: validateDemoWebhookUrl(input.webhookUrl.trim()), secret: input.secret };
    } catch { throw new ValidationError("URL Apps Script atau secret tidak valid. Secret wajib diisi.", "configuration"); }
  }
  return {
    status() { const config = readDemoConfig(configPath); return { configured: config !== null, restartRequired: config !== null && createHash("sha256").update(JSON.stringify(config)).digest("hex") !== activeFingerprint, ...(config === null && existsSync(configPath) ? { legacy: true } : {}) }; },
    async ping(input: Record<string, unknown>) { const config = inputs(input); return { connected: await sendDemoPayload(config.webhookUrl, { operation: "ping", secret: config.secret }, fetchImpl) }; },
    save(input: Record<string, unknown>) {
      const proposed = inputs(input); const previous = readDemoConfig(configPath);
      if (existsSync(configPath) && !previous) throw new ValidationError("Konfigurasi lama perlu direkonsiliasi secara manual; tidak ditimpa.", "configuration");
      const binding = databaseBinding(dbPath); const target = createHash("sha256").update(proposed.webhookUrl).digest("hex");
      if (previous && (previous.dbBinding !== binding || previous.targetId !== target)) throw new ValidationError("Database atau tujuan berbeda; konfigurasi lama perlu direkonsiliasi secara manual.", "configuration");
      if (!previous && input.futureSalesOnly !== true) throw new ValidationError("Konfirmasi pengiriman hanya transaksi baru diperlukan.", "futureSalesOnly");
      const row = db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM sales").get() as { id: number };
      const next: DemoConfig = { version: 2, ...proposed, databaseNamespace: previous?.databaseNamespace ?? randomBytes(16).toString("hex"), dbBinding: binding, targetId: target, afterSaleId: previous?.afterSaleId ?? Number(row.id) };
      assertOutsideSourceTree(configPath);
      const dir = path.dirname(configPath); mkdirSync(dir, { recursive: true }); const temp = path.join(dir, `.sheets-${randomBytes(12).toString("hex")}.tmp`);
      try { writeFileSync(temp, JSON.stringify(next), { encoding: "utf8", mode: 0o600, flag: "wx" }); renameSync(temp, configPath); } catch { try { unlinkSync(temp); } catch {} throw new Error("Konfigurasi tidak dapat disimpan."); }
      return { saved: true, restartRequired: true };
    },
  };
}
