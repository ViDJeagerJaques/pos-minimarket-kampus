/**
 * Isolasi lingkungan SANDBOX untuk Electron main process.
 * Aktif hanya bila POS_SANDBOX=1. Menggunakan env var yang sama dengan
 * backend (backend/src/sandbox/env.ts) agar satu akar data dipakai bersama.
 */
"use strict";

const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const SANDBOX_DATA_DIR_NAME = "PosMinimarketKampus-SANDBOX";
const FLAG_VALUE = "1";

// Hanya variabel sistem dan penanda sandbox yang diwariskan ke child backend.
// Konfigurasi DB, backup, restore, dan Sheets ditetapkan eksplisit oleh main.
const SAFE_ENV_KEYS = [
  "PATH",
  "Path",
  "SystemRoot",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "ComSpec",
  "PATHEXT",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OS",
  "HOME",
];

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function canonicalPath(target) {
  let current = path.resolve(target);
  const suffix = [];
  for (;;) {
    try { fs.lstatSync(current); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(current); if (parent === current) throw error;
      suffix.unshift(path.basename(current)); current = parent;
      continue;
    }
    return path.join(fs.realpathSync(current), ...suffix);
  }
}

function roamingAppData(env) {
  return env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
}

function localAppData(env) {
  return env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
}

function existingAppDataDirs(env) {
  const appData = roamingAppData(env);
  const local = localAppData(env);
  return [
    path.join(appData, "PosMinimarketKampus-DEMO"),
    path.join(local, "PosMinimarketKampus"),
    path.join(appData, "pos-minimarket-kampus-desktop"),
    path.join(local, "Programs", "POS Minimarket Kampus DEMO"),
    path.join(os.homedir(), ".local", "share", "pos-minimarket-kampus", "data"),
  ];
}

function isSandboxEnabled(env = process.env) {
  return String(env.POS_SANDBOX ?? "").trim() === FLAG_VALUE;
}

function resolveSandboxRoot(env = process.env) {
  const configured = String(env.POS_SANDBOX_ROOT ?? "").trim();
  if (configured) {
    if (!path.isAbsolute(configured)) {
      throw new Error("POS_SANDBOX_ROOT harus berupa path absolut.");
    }
    return path.resolve(configured);
  }
  return path.resolve(localAppData(env), SANDBOX_DATA_DIR_NAME);
}

function assertSandboxRoot(root, env = process.env) {
  const absolute = path.resolve(root);
  if (!path.isAbsolute(absolute)) throw new Error("Root sandbox harus absolut.");
  const canonical = canonicalPath(absolute);
  for (const dir of existingAppDataDirs(env)) {
    const protectedPath = canonicalPath(dir);
    if (isInside(dir, absolute) || isInside(absolute, dir) || isInside(protectedPath, canonical) || isInside(canonical, protectedPath)) {
      throw new Error(
        `Root sandbox ${absolute} bertabrakan dengan direktori aplikasi existing: ${dir}.`,
      );
    }
  }
}

function enforceSandboxPath(candidate, label, env = process.env) {
  if (!isSandboxEnabled(env)) return;
  const absolute = path.resolve(candidate);
  const canonical = canonicalPath(absolute);
  for (const dir of existingAppDataDirs(env)) {
    if (isInside(dir, absolute) || isInside(canonicalPath(dir), canonical)) {
      throw new Error(
        `${label} sandbox ditolak: mengarah ke direktori aplikasi existing (${dir}).`,
      );
    }
  }
}

function appendBackendLog(logPath, chunk, fileSystem = fs) {
  if (!logPath) return false;
  try {
    fileSystem.mkdirSync(path.dirname(logPath), { recursive: true });
    fileSystem.appendFileSync(logPath, String(chunk));
    return true;
  } catch {
    return false;
  }
}

function requireSandboxLaunch({ packaged, sandboxPackage, env }) {
  if ((!packaged || sandboxPackage) && !isSandboxEnabled(env)) {
    throw new Error("Launcher sandbox wajib: jalankan npm run start:sandbox atau paket SANDBOX.");
  }
}

function applySandboxEnvironment(env = process.env) {
  if (!isSandboxEnabled(env)) return { enabled: false };

  const root = resolveSandboxRoot(env);
  assertSandboxRoot(root, env);

  const info = {
    enabled: true,
    root,
    userDataDir: path.join(root, "userData"),
    dataDir: path.join(root, "data"),
    dbPath: path.join(root, "data", "pos-dev.sqlite"),
    backupDir: path.join(root, "backups"),
    restoreTestDir: path.join(root, "restore-test"),
    sheetsConfigPath: path.join(root, "config", "sheets-sync.json"),
    backendLogPath: path.join(root, "artifacts", "backend.log"),
  };

  env.POS_SANDBOX_ROOT = root;
  env.POS_DATA_DIR = info.dataDir;
  env.POS_BACKUP_DIR = info.backupDir;
  env.POS_RESTORE_TEST_DIR = info.restoreTestDir;
  env.POS_SHEETS_SYNC_CONFIG = info.sheetsConfigPath;
  env.POS_SPIKE_BACKEND_LOG = info.backendLogPath;

  for (const [label, value] of [
    ["userData", info.userDataDir],
    ["database", info.dbPath],
    ["backup", info.backupDir],
    ["restore-test", info.restoreTestDir],
    ["sheets config", info.sheetsConfigPath],
    ["backend log", info.backendLogPath],
  ]) {
    enforceSandboxPath(value, label, env);
  }
  return info;
}

/** Environment minimal untuk child process backend pada mode sandbox. */
function backendEnvironment(env, info) {
  const child = {};
  for (const key of SAFE_ENV_KEYS) {
    if (env[key] !== undefined) child[key] = env[key];
  }
  child.POS_SANDBOX = FLAG_VALUE;
  child.POS_SANDBOX_ROOT = info.root;
  child.POS_DB_PROFILE = "development";
  child.POS_DB_PATH = info.dbPath;
  child.POS_DATA_DIR = info.dataDir;
  child.POS_BACKUP_DIR = info.backupDir;
  child.POS_RESTORE_TEST_DIR = info.restoreTestDir;
  child.POS_SHEETS_SYNC_CONFIG = info.sheetsConfigPath;
  child.POS_SPIKE_BACKEND_LOG = info.backendLogPath;
  return child;
}

module.exports = {
  SANDBOX_DATA_DIR_NAME,
  appendBackendLog,
  requireSandboxLaunch,
  applySandboxEnvironment,
  backendEnvironment,
  enforceSandboxPath,
  existingAppDataDirs,
  isSandboxEnabled,
  resolveSandboxRoot,
};
