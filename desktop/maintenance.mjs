// Jalankan memakai resources/runtime/node.exe. Hanya membuat snapshot;
// tidak menimpa DB/config. Tutup aplikasi sebelum snapshot pra-upgrade.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createBackup } from "./backend/src/backup/service.ts";
const [command, dataDir] = process.argv.slice(2);
if (command !== "snapshot" || !dataDir || !path.isAbsolute(dataDir)) {
  throw new Error('Penggunaan: node maintenance.mjs snapshot "<direktori-data-absolut>"');
}
const configPath = path.join(dataDir, "config.json");
const configBytes = readFileSync(configPath);
const config = JSON.parse(configBytes);
if (config.mode !== "DEMO") throw new Error("Tool kandidat hanya untuk data DEMO");
const backup = createBackup({ dbPath: path.join(dataDir, "pos-dev.sqlite"), env: { POS_DATA_DIR: dataDir, POS_BACKUP_DIR: path.join(dataDir, "backups") } });
const snapshotConfig = `${backup.destinationPath}.config.json`;
writeFileSync(snapshotConfig, configBytes, { flag: "wx" });
const manifest = { database: backup, configFile: path.basename(snapshotConfig), configSha256: createHash("sha256").update(configBytes).digest("hex") };
const manifestPath = `${backup.destinationPath}.upgrade.json`;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { flag: "wx" });
console.log(JSON.stringify({ manifestPath, ...manifest }, null, 2));
