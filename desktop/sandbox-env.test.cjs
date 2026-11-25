"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  requireSandboxLaunch,
  applySandboxEnvironment,
  backendEnvironment,
  existingAppDataDirs,
  isSandboxEnabled,
  resolveSandboxRoot,
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
