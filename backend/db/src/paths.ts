import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Akar repository dihitung dari lokasi file ini (backend/db/src -> root).
 * Dipakai untuk menolak database yang disimpan di dalam source tree.
 */
export const REPO_ROOT = path.resolve(
  fileURLToPath(new URL("../../../", import.meta.url)),
);

export const DEFAULT_DB_FILE_NAME = "pos-dev.sqlite";

/** Subset environment yang dipakai; menghindari ketergantungan @types/node. */
export type Env = Record<string, string | undefined>;

export function defaultDataDir(env: Env = process.env): string {
  if (env.POS_DATA_DIR) {
    return path.resolve(env.POS_DATA_DIR);
  }
  if (env.LOCALAPPDATA) {
    return path.join(env.LOCALAPPDATA, "PosMinimarketKampus", "data");
  }
  return path.join(homedir(), ".local", "share", "pos-minimarket-kampus", "data");
}

/**
 * Urutan penentuan lokasi database development:
 *   1. POS_DB_PATH (path file eksplisit)
 *   2. POS_DATA_DIR + pos-dev.sqlite
 *   3. %LOCALAPPDATA%\PosMinimarketKampus\data\pos-dev.sqlite
 *
 * Semua lokasi default berada di luar repository.
 */
export function resolveDatabasePath(env: Env = process.env): string {
  if (env.POS_DB_PATH) {
    return path.resolve(env.POS_DB_PATH);
  }
  return path.join(defaultDataDir(env), DEFAULT_DB_FILE_NAME);
}

export function isInsideSourceTree(
  targetPath: string,
  repoRoot: string = REPO_ROOT,
): boolean {
  const relative = path.relative(path.resolve(repoRoot), path.resolve(targetPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Database operasional/development tidak boleh berada di dalam source tree agar
 * tidak ikut ter-commit, tidak terbawa installer, dan tidak hilang saat rebuild.
 * Lihat docs/security/DATA_PROTECTION.md §2.
 */
export function assertOutsideSourceTree(
  dbPath: string,
  repoRoot: string = REPO_ROOT,
): void {
  if (isInsideSourceTree(dbPath, repoRoot)) {
    throw new Error(
      `Menolak database di dalam source tree: ${dbPath}. ` +
        "Gunakan POS_DB_PATH/POS_DATA_DIR di direktori data persisten di luar repository.",
    );
  }
}

export function ensureParentDirectory(dbPath: string): void {
  const dir = path.dirname(path.resolve(dbPath));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}