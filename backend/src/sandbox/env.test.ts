import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtempSync, mkdirSync, symlinkSync, unlinkSync, rmdirSync } from "node:fs";
import {
  applySandboxEnvironment,
  enforceSandboxPath,
  existingAppDataDirs,
  isSandboxEnabled,
  resolveSandboxRoot,
  type Env,
} from "./env.ts";

const LOCAL = path.join(os.tmpdir(), "pos-sandbox-env-test", "Local");
const ROAMING = path.join(os.tmpdir(), "pos-sandbox-env-test", "Roaming");

function syntheticEnv(extra: Record<string, string> = {}): Env {
  return { LOCALAPPDATA: LOCAL, APPDATA: ROAMING, ...extra };
}

test("sandbox tidak aktif tanpa POS_SANDBOX=1 dan tidak mengubah environment", () => {
  const env = syntheticEnv();
  const before = { ...env };
  assert.equal(isSandboxEnabled(env), false);
  assert.deepEqual(applySandboxEnvironment(env), { enabled: false });
  assert.deepEqual(env, before);
  enforceSandboxPath(path.join(ROAMING, "PosMinimarketKampus-DEMO", "pos.sqlite"), "db", env);
});

test("root sandbox default berada di LOCALAPPDATA dan di luar direktori existing", () => {
  const env = syntheticEnv({ POS_SANDBOX: "1" });
  assert.equal(
    resolveSandboxRoot(env),
    path.join(LOCAL, "PosMinimarketKampus-SANDBOX"),
  );
  const info = applySandboxEnvironment(env);
  assert.equal(info.enabled, true);
  assert.equal(info.root, path.join(LOCAL, "PosMinimarketKampus-SANDBOX"));
  assert.equal(info.dbPath, path.join(info.root!, "data", "pos-dev.sqlite"));
  assert.equal(info.sheetsConfigPath, path.join(info.root!, "config", "sheets-sync.json"));
  assert.equal(env.POS_DB_PROFILE, "development");
  assert.equal(env.POS_SHEETS_SYNC_CONFIG, info.sheetsConfigPath);
  for (const dir of existingAppDataDirs(env)) {
    assert.notEqual(info.root, dir);
  }
});

test("mode operasional dan root yang bertabrakan ditolak", () => {
  assert.throws(
    () => applySandboxEnvironment(syntheticEnv({ POS_SANDBOX: "1", POS_DB_PROFILE: "operational" })),
    /operasional ditolak/,
  );
  assert.throws(
    () =>
      applySandboxEnvironment(
        syntheticEnv({
          POS_SANDBOX: "1",
          POS_SANDBOX_ROOT: path.join(ROAMING, "PosMinimarketKampus-DEMO"),
        }),
      ),
    /bertabrakan/,
  );
});

test("path ke direktori aplikasi existing ditolak, path temporer diterima", () => {
  const env = syntheticEnv({ POS_SANDBOX: "1" });
  const productionDb = path.join(ROAMING, "PosMinimarketKampus-DEMO", "pos-dev.sqlite");
  assert.throws(() => enforceSandboxPath(productionDb, "database", env), /direktori aplikasi existing/);
  assert.throws(
    () => applySandboxEnvironment(syntheticEnv({ POS_SANDBOX: "1", POS_DB_PATH: productionDb })),
    /direktori aplikasi existing/,
  );
  const tempDb = path.join(os.tmpdir(), "pos-sandbox-env-test", "qa.sqlite");
  enforceSandboxPath(tempDb, "database", env);
  assert.equal(
    applySandboxEnvironment(syntheticEnv({ POS_SANDBOX: "1", POS_DB_PATH: tempDb })).dbPath,
    tempDb,
  );
});

test("konfigurasi Sheets dari environment induk selalu ditimpa", () => {
  const env = syntheticEnv({
    POS_SANDBOX: "1",
    POS_SHEETS_SYNC_CONFIG: path.join(ROAMING, "PosMinimarketKampus-DEMO", "sheets-sync.json"),
  });
  const info = applySandboxEnvironment(env);
  assert.equal(env.POS_SHEETS_SYNC_CONFIG, path.join(info.root!, "config", "sheets-sync.json"));
});

test("junction menuju direktori existing dan file baru di dalamnya ditolak", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "sandbox-alias-"));
  const protectedDir = path.join(root, "PosMinimarketKampus"); const alias = path.join(root, "alias");
  mkdirSync(protectedDir); symlinkSync(protectedDir, alias, "junction");
  try {
    const env = syntheticEnv({ POS_SANDBOX: "1", LOCALAPPDATA: root });
    assert.throws(() => enforceSandboxPath(path.join(alias, "new", "pos.sqlite"), "database", env), /existing/);
    assert.throws(() => applySandboxEnvironment({ ...env, POS_SANDBOX_ROOT: alias }), /bertabrakan/);
    assert.throws(() => enforceSandboxPath(path.join(os.homedir(), ".local", "share", "pos-minimarket-kampus", "data", "pos.sqlite"), "db", env), /existing/);
  } finally { unlinkSync(alias); rmdirSync(protectedDir); rmdirSync(root); }
});
