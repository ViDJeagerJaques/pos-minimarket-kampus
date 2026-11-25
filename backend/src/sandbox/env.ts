import { homedir } from "node:os";
import path from "node:path";
import { assertOutsideSourceTree } from "../../db/src/paths.ts";

/**
 * Isolasi lingkungan SANDBOX — konfigurasi khusus branch
 * `sandbox/production-redesign`. Tidak mengubah skema, aturan bisnis, atau
 * kontrak API. Modul ini hanya aktif bila POS_SANDBOX=1.
 *
 * Semua jalur data diturunkan dari satu akar:
 *   %LOCALAPPDATA%\PosMinimarketKampus-SANDBOX
 */
export type Env = Record<string, string | undefined>;

export const SANDBOX_DATA_DIR_NAME = "PosMinimarketKampus-SANDBOX";
export const SANDBOX_FLAG_VALUE = "1";

export type SandboxInfo = {
  enabled: boolean;
  root?: string;
  dataDir?: string;
  dbPath?: string;
  backupDir?: string;
  restoreTestDir?: string;
  sheetsConfigPath?: string;
  backendLogPath?: string;
};

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function roamingAppData(env: Env): string {
  return env.APPDATA?.trim() || path.join(homedir(), "AppData", "Roaming");
}

function localAppData(env: Env): string {
  return env.LOCALAPPDATA?.trim() || path.join(homedir(), "AppData", "Local");
}

/** Direktori data aplikasi existing yang tidak boleh disentuh sandbox. */
export function existingAppDataDirs(env: Env = process.env): string[] {
  const appData = roamingAppData(env);
  const local = localAppData(env);
  return [
    path.join(appData, "PosMinimarketKampus-DEMO"),
    path.join(local, "PosMinimarketKampus"),
    path.join(appData, "pos-minimarket-kampus-desktop"),
    path.join(local, "Programs", "POS Minimarket Kampus DEMO"),
  ];
}

export function isSandboxEnabled(env: Env = process.env): boolean {
  return (env.POS_SANDBOX ?? "").trim() === SANDBOX_FLAG_VALUE;
}

export function resolveSandboxRoot(env: Env = process.env): string {
  const configured = env.POS_SANDBOX_ROOT?.trim();
  if (configured) {
    if (!path.isAbsolute(configured)) {
      throw new Error("POS_SANDBOX_ROOT harus berupa path absolut.");
    }
    return path.resolve(configured);
  }
  return path.resolve(localAppData(env), SANDBOX_DATA_DIR_NAME);
}

export function assertSandboxRoot(root: string, env: Env = process.env): void {
  const absolute = path.resolve(root);
  if (!path.isAbsolute(absolute)) {
    throw new Error("Root sandbox harus absolut.");
  }
  assertOutsideSourceTree(absolute);
  for (const dir of existingAppDataDirs(env)) {
    if (isInside(dir, absolute) || isInside(absolute, dir)) {
      throw new Error(
        `Root sandbox ${absolute} bertabrakan dengan direktori aplikasi existing: ${dir}.`,
      );
    }
  }
}

/**
 * Validasi jalur sebelum migrasi, seed, backup, atau operasi tulis lainnya.
 * Tidak beroperasi bila sandbox tidak aktif, sehingga perilaku normal tidak
 * berubah.
 */
export function enforceSandboxPath(
  candidate: string,
  label: string,
  env: Env = process.env,
): void {
  if (!isSandboxEnabled(env)) return;
  const absolute = path.resolve(candidate);
  assertOutsideSourceTree(absolute);
  for (const dir of existingAppDataDirs(env)) {
    if (isInside(dir, absolute)) {
      throw new Error(
        `${label} sandbox ditolak: mengarah ke direktori aplikasi existing (${dir}).`,
      );
    }
  }
}

/**
 * Terapkan default sandbox ke environment proses. Environment induk tidak
 * dipakai sebagai sumber konfigurasi Sheets/DB: nilai tersebut ditimpa.
 * POS_DB_PATH eksplisit tetap dihormati selama lulus validasi, supaya skrip QA
 * yang memakai DB temporer tetap dapat berjalan di bawah profil sandbox.
 */
export function applySandboxEnvironment(env: Env = process.env): SandboxInfo {
  if (!isSandboxEnabled(env)) return { enabled: false };

  const root = resolveSandboxRoot(env);
  assertSandboxRoot(root, env);

  if ((env.POS_DB_PROFILE ?? "").trim() === "operational") {
    throw new Error("Profil operasional ditolak pada lingkungan sandbox.");
  }

  const dataDir = path.join(root, "data");
  const dbPath = path.join(dataDir, "pos-dev.sqlite");
  const backupDir = path.join(root, "backups");
  const restoreTestDir = path.join(root, "restore-test");
  const sheetsConfigPath = path.join(root, "config", "sheets-sync.json");
  const backendLogPath = path.join(root, "artifacts", "backend.log");

  env.POS_SANDBOX_ROOT = root;
  // Nilai yang sudah disetel oleh launcher sandbox dihormati selama lulus
  // validasi; default ini dipakai untuk perintah backend langsung.
  if (!env.POS_DATA_DIR?.trim()) env.POS_DATA_DIR = dataDir;
  if (!env.POS_DB_PATH?.trim()) env.POS_DB_PATH = dbPath;
  env.POS_DB_PROFILE = env.POS_DB_PROFILE?.trim() || "development";
  if (!env.POS_BACKUP_DIR?.trim()) env.POS_BACKUP_DIR = backupDir;
  if (!env.POS_RESTORE_TEST_DIR?.trim()) env.POS_RESTORE_TEST_DIR = restoreTestDir;
  // Sheets dan log selalu ditimpa: tidak boleh mewarisi konfigurasi existing.
  env.POS_SHEETS_SYNC_CONFIG = sheetsConfigPath;
  env.POS_SPIKE_BACKEND_LOG = backendLogPath;

  const targets: ReadonlyArray<readonly [string, string | undefined]> = [
    ["database", env.POS_DB_PATH],
    ["data", env.POS_DATA_DIR],
    ["backup", env.POS_BACKUP_DIR],
    ["restore-test", env.POS_RESTORE_TEST_DIR],
    ["sheets config", env.POS_SHEETS_SYNC_CONFIG],
    ["backend log", env.POS_SPIKE_BACKEND_LOG],
  ];
  for (const [label, value] of targets) {
    if (value) enforceSandboxPath(value, label, env);
  }

  return {
    enabled: true,
    root,
    dataDir,
    dbPath: env.POS_DB_PATH,
    backupDir,
    restoreTestDir,
    sheetsConfigPath,
    backendLogPath,
  };
}
