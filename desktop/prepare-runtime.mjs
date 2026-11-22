// Runtime resmi dipin dan diperiksa SHA-256; jaringan hanya diperlukan saat build.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const version = "24.18.0";
const base = `https://nodejs.org/dist/v${version}/`;
const dir = fileURLToPath(new URL("./runtime/", import.meta.url));
mkdirSync(dir, { recursive: true });
async function download(name) {
  const response = await fetch(base + name);
  if (!response.ok) throw new Error(`Download ${name}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const sums = (await download("SHASUMS256.txt")).toString();
const expected = sums.split(/\r?\n/).find(line => line.endsWith("  win-x64/node.exe"))?.split(" ")[0];
if (!/^[a-f0-9]{64}$/.test(expected ?? "")) throw new Error("Checksum Node tidak tersedia");
let binary;
try { binary = readFileSync(dir + "node.exe"); } catch { /* download below */ }
const hash = data => createHash("sha256").update(data).digest("hex");
if (!binary || hash(binary) !== expected) binary = await download("win-x64/node.exe");
if (hash(binary) !== expected) throw new Error("Checksum Node tidak cocok");
writeFileSync(dir + "node.exe", binary);
const license = await fetch(`https://raw.githubusercontent.com/nodejs/node/v${version}/LICENSE`);
if (!license.ok) throw new Error(`Lisensi Node: HTTP ${license.status}`);
writeFileSync(dir + "LICENSE", await license.text());
const probe = spawnSync(dir + "node.exe", ["-e", "const {DatabaseSync}=require('node:sqlite'); const d=new DatabaseSync(':memory:'); d.close(); console.log(process.version)"], { encoding: "utf8", windowsHide: true });
if (probe.status !== 0 || probe.stdout.trim() !== `v${version}`) throw new Error(`Runtime probe gagal: ${probe.stderr}`);
writeFileSync(dir + "manifest.json", JSON.stringify({ version, platform: "win-x64", sha256: expected, source: base, sqliteProbe: "PASS" }, null, 2));
console.log(`Node ${version} win-x64 SHA-256 verified; node:sqlite PASS`);
