// Windows DEMO rehearsal. Selalu membuat direktori uji baru; tidak memakai DB pengguna.
// Usage: node scripts/task-033_installer_check.mjs <installer-lama> <installer-baru> <installer-gagal>
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, renameSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:net";
const installers = process.argv.slice(2).map(p => path.resolve(p));
assert.equal(installers.length, 3, "Berikan installer baseline, upgrade, dan failure-injection");
const root = mkdtempSync(path.join(tmpdir(), "task033-"));
const installDir = path.join(root, "application");
const dataDir = path.join(root, "data");
mkdirSync(dataDir);
const resources = path.join(installDir, "resources");
const node = path.join(resources, "runtime", "node.exe");
const dbPath = path.join(dataDir, "pos-dev.sqlite");
const evidence = [];
const log = (check, details = {}) => { evidence.push({ check, status: "PASS", ...details }); console.log(`PASS ${check}`); };
const sha = p => createHash("sha256").update(readFileSync(p)).digest("hex");
function run(exe, args, options = {}) {
  const result = spawnSync(exe, args, { windowsHide: true, encoding: "utf8", timeout: 180000, ...options });
  assert.equal(result.status, 0, `${exe}: ${result.error ?? result.stderr ?? result.stdout}`);
  return result.stdout;
}
function assertNoExistingDemoInstall() {
  const probe = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "$paths = @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); $hits = Get-ItemProperty $paths -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -eq 'id.kampus.pos.demo' -or $_.PSChildName -eq 'ce4a1bc9-e19c-5b8f-9604-68890df7f21a' -or $_.DisplayName -like '*POS Minimarket Kampus DEMO*' } | Select-Object -ExpandProperty DisplayName; if ($hits) { $hits | ForEach-Object { Write-Output $_ }; exit 10 }",
    ],
    { windowsHide: true, encoding: "utf8", timeout: 30000 },
  );
  if (probe.status === 10) {
    throw new Error(
      `Instalasi POS Minimarket Kampus DEMO sudah ada untuk user Windows ini (${probe.stdout.trim()}). Copot pemasangan dulu atau jalankan rehearsal di akun Windows/VM disposable.`,
    );
  }
  assert.equal(
    probe.status,
    0,
    `Deteksi instalasi DEMO gagal (${probe.error ?? probe.stderr}); jalankan rehearsal di akun Windows/VM disposable.`,
  );
  const localPrograms = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs") : null;
  if (localPrograms) {
    for (const dirName of ["POS Minimarket Kampus DEMO", "pos-minimarket-kampus-desktop"]) {
      const candidate = path.join(localPrograms, dirName);
      assert.equal(
        existsSync(candidate),
        false,
        `Direktori instalasi DEMO sudah ada di ${candidate}; copot pemasangan dulu atau pakai akun Windows/VM disposable.`,
      );
    }
  }
}

async function install(file, failure = false) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(file, ["/S", `/D=${installDir}`], { windowsHide: true });
    child.once("error", reject);
    const timer = setTimeout(() => { child.kill(); reject(new Error("Installer timeout")); }, 180000);
    child.once("exit", code => { clearTimeout(timer); resolve(code); });
  });
  if (failure) assert.equal(code, 42, "Installer fixture harus gagal dengan exit code 42"); else assert.equal(code, 0);
  return code;
}
let app;
async function start(extraEnv = {}, waitToken = "POS_SPIKE window_ready", targetDataDir = dataDir) {
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  // Port sintetis eksplisit; konfigurasi lain dipertahankan.
  const config = existsSync(path.join(targetDataDir, "config.json")) ? JSON.parse(readFileSync(path.join(targetDataDir, "config.json"))) : { mode: "DEMO", marker: "TASK033-synthetic" };
  config.apiPort = port;
  writeFileSync(path.join(targetDataDir, "config.json"), JSON.stringify(config, null, 2));
  app = spawn(path.join(installDir, "POS Minimarket Kampus DEMO.exe"), [`--user-data-dir=${targetDataDir}`], {
    windowsHide: true,
    env: {
      ...process.env,
      PATH: process.env.SystemRoot,
      POS_ELECTRON_BENCH: "1",
      POS_NODE_BIN: "missing-node.exe",
      NODE_OPTIONS: "",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  app.stdout.on("data", b => { output += b; });
  app.stderr.on("data", b => { output += b; });
  const until = Date.now() + 30000;
  while (!output.includes(waitToken) && Date.now() < until && app.exitCode === null) await new Promise(r => setTimeout(r, 200));
  assert.ok(output.includes(waitToken), output);
  writeFileSync(path.join(root, `startup-${evidence.length}.log`), output);
  return `http://127.0.0.1:${port}/api/v1`;
}
async function stop() {
  if (!app || app.exitCode !== null) return;
  const pid = app.pid;
  spawnSync("taskkill", ["/PID", String(pid)], { windowsHide: true, encoding: "utf8" });
  const until = Date.now() + 5000;
  while (app.exitCode === null && Date.now() < until) await new Promise(r => setTimeout(r, 100));
  if (app.exitCode === null) {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, encoding: "utf8" });
    const forceUntil = Date.now() + 10000;
    while (app.exitCode === null && Date.now() < forceUntil) await new Promise(r => setTimeout(r, 100));
  }
  assert.notEqual(app.exitCode, null, "Aplikasi harus berhenti sebelum upgrade/restore");
  app = null;
}
function state() {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    const tables = ["users", "products", "sales", "sale_items", "payments", "inventory_movements", "shifts", "shift_closings", "checkout_attempts"];
    return Object.fromEntries(tables.map(t => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
  } finally { db.close(); }
}
try {
  assertNoExistingDemoInstall();
  await install(installers[0]);
  const demoCredsPath = path.join(root, "demo-creds.json");
  await start({ POS_INSTALLER_DEMO_CREDS_FILE: demoCredsPath }, "POS_SPIKE window_ready");
  await stop();
  const { demoPassword } = JSON.parse(readFileSync(demoCredsPath, "utf8"));
  assert.ok(typeof demoPassword === "string" && demoPassword.length >= 12, "Sandi DEMO acak wajib dibuat");
  const seededState = state();
  assert.ok(seededState.users.some(u => u.username === "demo.admin"), "Akun demo.admin harus ter-seed");
  assert.ok(seededState.users.some(u => u.username === "demo.kasir.pagi"), "Akun demo.kasir.pagi harus ter-seed");
  assert.ok(seededState.products.length > 0 && seededState.sales.length > 0 && seededState.shifts.length > 0, "Data DEMO (produk, shift, penjualan) harus ter-seed");
  const demoLoginCredsPath = path.join(root, "demo-login-creds.json");
  writeFileSync(demoLoginCredsPath, JSON.stringify({ cashierUser: "demo.admin", cashierPass: demoPassword }));
  let base = await start(
    { POS_INSTALLER_RENDERER_TEST: "1", POS_SPIKE_CREDS_FILE: demoLoginCredsPath },
    "POS_SPIKE renderer_login=PASS",
  );
  log("fresh DEMO install seeds accounts/data and logs in via packaged renderer", { nodeVersion: run(node, ["--version"]).trim() });
  await stop();

  // Verifikasi mode REAL (pos.sqlite) tetap menampilkan layar SetupAdminPage, tidak men-seed akun DEMO, dan lolos smoke 8/8.
  const realDataDir = path.join(root, "real-data");
  mkdirSync(realDataDir);
  writeFileSync(path.join(realDataDir, "config.json"), JSON.stringify({ mode: "REAL", apiPort: 0 }, null, 2));
  const setupCredsPath = path.join(root, "setup-creds.json");
  const setupAdminUser = "admin.setup";
  const setupAdminPass = `Adm-${randomBytes(8).toString("hex")}`;
  writeFileSync(setupCredsPath, JSON.stringify({ adminUser: setupAdminUser, adminPass: setupAdminPass }));
  const realBase = await start(
    { POS_INSTALLER_RENDERER_TEST: "1", POS_INSTALLER_SETUP_FIRST: "1", POS_SPIKE_CREDS_FILE: setupCredsPath },
    "POS_SPIKE renderer_setup_and_login=PASS",
    realDataDir,
  );
  const realDbPath = path.join(realDataDir, "pos.sqlite");
  let smoke = readFileSync("scripts/task-031_electron_smoke.mjs", "utf8")
    .replace('const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");', `const root = ${JSON.stringify(resources)};`)
    .replace(/const adminUser = .*;/, `const adminUser = ${JSON.stringify(setupAdminUser)};`)
    .replace(/const adminPass = .*;/, `const adminPass = ${JSON.stringify(setupAdminPass)};`)
    .replace(/const boot = spawnSync\([\s\S]*?assert\.equal\(boot\.status, 0,[^;]*\);/, "// Admin pertama sudah dibuat lewat layar setup UI.");
  const smokePath = path.join(root, "smoke.mjs");
  writeFileSync(smokePath, smoke);
  const credsPath = path.join(root, "creds.json");
  const smokeOutput = run(node, [smokePath], { env: { ...process.env, POS_SPIKE_DB: realDbPath, POS_SPIKE_API_BASE: realBase, POS_SPIKE_CREDS_FILE: credsPath } });
  writeFileSync(path.join(root, "smoke.log"), smokeOutput);
  assert.match(smokeOutput, /PASS total 8 smoke/);
  await stop();
  const realDb = new DatabaseSync(realDbPath, { readOnly: true });
  try {
    const realUsers = realDb.prepare("SELECT username FROM users").all().map(u => u.username);
    assert.ok(realUsers.includes(setupAdminUser), "Admin REAL harus dibuat lewat SetupAdminPage");
    assert.equal(realUsers.includes("demo.admin"), false, "Mode REAL tidak boleh men-seed demo.admin");
  } finally { realDb.close(); }
  log("REAL mode (pos.sqlite) SetupAdminPage + API smoke 8/8 PASS");
  const original = state();
  const originalConfig = readFileSync(path.join(dataDir, "config.json"));
  const snapshot = JSON.parse(run(node, [path.join(resources, "maintenance.mjs"), "snapshot", dataDir]));
  log("snapshot database + configuration", { dbSha256: snapshot.database.sha256, configSha256: snapshot.configSha256 });
  await install(installers[1]);
  assert.deepEqual(state(), original);
  assert.deepEqual(readFileSync(path.join(dataDir, "config.json")), originalConfig);
  base = await start();
  assert.deepEqual(state(), original);
  await stop();
  log("upgrade keeps transactions, active shift, config; integrity=ok, FK=0");
  const failureCode = await install(installers[2], true);
  log("controlled installer abort after extraction", { exitCode: failureCode });
  // Pulihkan versi di instalasi SAMA. Data lama dikarantina, tidak dihapus.
  await install(installers[0]);
  const backup = snapshot.database.destinationPath;
  assert.equal(sha(backup), snapshot.database.sha256);
  const configBackup = path.join(path.dirname(backup), snapshot.configFile);
  assert.equal(sha(configBackup), snapshot.configSha256);
  const quarantine = path.join(root, "before-restore");
  mkdirSync(quarantine);
  for (const name of ["pos-dev.sqlite", "pos-dev.sqlite-wal", "pos-dev.sqlite-shm", "config.json"]) {
    const source = path.join(dataDir, name);
    if (existsSync(source)) renameSync(source, path.join(quarantine, name));
  }
  copyFileSync(backup, dbPath);
  copyFileSync(configBackup, path.join(dataDir, "config.json"));
  assert.deepEqual(state(), original);
  assert.deepEqual(readFileSync(path.join(dataDir, "config.json")), originalConfig);
  const rollbackCredsPath = path.join(root, "rollback-cashier-creds.json");
  writeFileSync(rollbackCredsPath, JSON.stringify({ cashierUser: "demo.kasir.pagi", cashierPass: demoPassword }));
  base = await start({ POS_INSTALLER_RENDERER_TEST: "1", POS_SPIKE_CREDS_FILE: rollbackCredsPath }, "POS_SPIKE renderer_login=PASS");
  const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo.kasir.pagi", password: demoPassword }) });
  assert.equal(response.status, 200);
  await stop();
  log("rollback restores database + config on same installation; packaged renderer CASHIER login PASS");
} finally {
  if (app && app.exitCode === null) {
    try {
      await stop();
    } catch {
      app.kill();
    }
  }
  const report = { root, installers: installers.map(p => ({ file: path.basename(p), sha256: sha(p) })), checks: evidence, limitations: ["Internet Windows tidak diputus", "Scanner API dan printer VIRTUAL; hardware belum diuji", "Upgrade fixture versi memakai kode/skema sama", "Kegagalan installer disuntikkan lewat NSIS Abort; bukan listrik mati"] };
  mkdirSync("docs/laporan/evidence/TASK-033", { recursive: true });
  writeFileSync("docs/laporan/evidence/TASK-033/installer-check.json", JSON.stringify(report, null, 2));
  console.log(`Evidence: ${root}`);
}
