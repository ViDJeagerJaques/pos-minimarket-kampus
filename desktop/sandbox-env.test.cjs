"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  appendBackendLog,
  requireSandboxLaunch,
  applySandboxEnvironment,
  backendEnvironment,
  existingAppDataDirs,
  isSandboxEnabled,
  resolveSandboxRoot,
  enforceSandboxPath,
} = require("./sandbox-env.cjs");

const LOCAL = path.join(os.tmpdir(), "pos-desktop-sandbox-test", "Local");
const ROAMING = path.join(os.tmpdir(), "pos-desktop-sandbox-test", "Roaming");

function env(extra = {}) {
  return { LOCALAPPDATA: LOCAL, APPDATA: ROAMING, ...extra };
}

test("nonaktif tanpa flag dan root mengikuti LOCALAPPDATA", () => {
  assert.equal(isSandboxEnabled(env()), false);
  assert.equal(
    resolveSandboxRoot(env({ POS_SANDBOX: "1" })),
    path.join(LOCAL, "PosMinimarketKampus-SANDBOX"),
  );
});

test("info sandbox memuat userData, backup, restore, dan Sheets di dalam root", () => {
  const info = applySandboxEnvironment(env({ POS_SANDBOX: "1" }));
  assert.equal(info.enabled, true);
  assert.equal(info.userDataDir, path.join(info.root, "userData"));
  assert.equal(info.backupDir, path.join(info.root, "backups"));
  assert.equal(info.restoreTestDir, path.join(info.root, "restore-test"));
  assert.equal(info.sheetsConfigPath, path.join(info.root, "config", "sheets-sync.json"));
  for (const dir of existingAppDataDirs(env())) {
    assert.notEqual(info.root, dir);
  }
});

test("tabrakan dengan direktori existing ditolak", () => {
  assert.throws(
    () =>
      applySandboxEnvironment(
        env({ POS_SANDBOX: "1", POS_SANDBOX_ROOT: path.join(LOCAL, "PosMinimarketKampus") }),
      ),
    /bertabrakan/,
  );
});

test("child backend tidak mewarisi konfigurasi Sheets dari induk", () => {
  const parent = env({
    POS_SANDBOX: "1",
    PATH: "C:\\Windows",
    POS_SHEETS_SYNC_CONFIG: path.join(ROAMING, "PosMinimarketKampus-DEMO", "sheets-sync.json"),
    POS_DB_PATH: path.join(ROAMING, "PosMinimarketKampus-DEMO", "pos.sqlite"),
  });
  const info = applySandboxEnvironment(parent);
  const child = backendEnvironment(parent, info);
  assert.equal(child.PATH, "C:\\Windows");
  assert.equal(child.POS_SHEETS_SYNC_CONFIG, info.sheetsConfigPath);
  assert.equal(child.POS_DB_PATH, info.dbPath);
  assert.equal(child.POS_DB_PROFILE, "development");
  assert.equal(child.POS_SHEETS_SYNC_CONFIG.includes("PosMinimarketKampus-DEMO"), false);
  assert.equal("POS_BOOTSTRAP_PASSWORD" in child, false);
});

test("launcher salah ditolak dan paket sandbox wajib memakai isolasi", () => {
  assert.throws(() => requireSandboxLaunch({ packaged: false, sandboxPackage: false, env: env() }), /Launcher sandbox/);
  assert.throws(() => requireSandboxLaunch({ packaged: true, sandboxPackage: true, env: env() }), /Launcher sandbox/);
  assert.doesNotThrow(() => requireSandboxLaunch({ packaged: false, sandboxPackage: false, env: env({ POS_SANDBOX: "1" }) }));
  assert.doesNotThrow(() => requireSandboxLaunch({ packaged: true, sandboxPackage: false, env: env() }));
});

test("log backend membuat direktori hilang dan pulih bila dihapus", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pos-log-test-"));
  const dir = path.join(root, "artifacts");
  const log = path.join(dir, "backend.log");
  try {
    assert.equal(appendBackendLog(log, "pertama\n"), true);
    assert.equal(fs.readFileSync(log, "utf8"), "pertama\n");
    fs.unlinkSync(log); fs.rmdirSync(dir);
    assert.equal(appendBackendLog(log, "kedua\n"), true);
    assert.equal(fs.readFileSync(log, "utf8"), "kedua\n");
  } finally { if (fs.existsSync(log)) fs.unlinkSync(log); if (fs.existsSync(dir)) fs.rmdirSync(dir); fs.rmdirSync(root); }
});

test("kegagalan membuat direktori atau menulis log tidak dilempar", () => {
  assert.equal(appendBackendLog("", "teks"), false);
  assert.equal(appendBackendLog("log/backend.log", "teks", { mkdirSync() { throw new Error("akses ditolak"); } }), false);
  assert.equal(appendBackendLog("log/backend.log", "teks", { mkdirSync() {}, appendFileSync() { throw new Error("disk penuh"); } }), false);
});

test("junction ke direktori aplikasi existing ditolak sebelum path dibuat", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-alias-"));
  const protectedDir = path.join(root, "PosMinimarketKampus"); const alias = path.join(root, "alias");
  fs.mkdirSync(protectedDir); fs.symlinkSync(protectedDir, alias, "junction");
  try {
    const e = env({ POS_SANDBOX: "1", LOCALAPPDATA: root });
    assert.throws(() => enforceSandboxPath(path.join(alias, "new", "db.sqlite"), "db", e), /existing/);
    assert.throws(() => applySandboxEnvironment({ ...e, POS_SANDBOX_ROOT: alias }), /bertabrakan/);
  } finally { fs.unlinkSync(alias); fs.rmdirSync(protectedDir); fs.rmdirSync(root); }
});
