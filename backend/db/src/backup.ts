import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { checkIntegrity, inspectDatabase, openDatabase, readUserVersion } from "./db.ts";

export const BACKUP_DIRECTORY_NAME = "backups";

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function timestampForFileName(now: () => number): string {
  return new Date(now()).toISOString().replace(/[:.]/g, "-");
}

export function backupDirectoryFor(dbPath: string): string {
  return path.join(path.dirname(path.resolve(dbPath)), BACKUP_DIRECTORY_NAME);
}

/**
 * Snapshot konsisten memakai `VACUUM INTO` pada koneksi penulis yang tenang.
 * Untuk operasi produksi, mekanisme backup mengikuti
 * docs/security/BACKUP_RECOVERY.md dan harus diuji terpisah (DEC-015).
 * `VACUUM INTO` tidak boleh dipanggil di dalam transaksi.
 */
export function createSqliteSnapshot(db: DatabaseSync, targetPath: string): string {
  if (existsSync(targetPath)) {
    throw new Error(`Target snapshot sudah ada, tidak ditimpa: ${targetPath}`);
  }
  mkdirSync(path.dirname(targetPath), { recursive: true });
  db.exec(`VACUUM INTO ${sqlString(targetPath)}`);
  return targetPath;
}

/**
 * Cadangan otomatis sebelum migrasi mengubah database yang sudah berisi skema.
 * Snapshot diverifikasi (integritas + user_version) sebelum migrasi dijalankan.
 */
export function createPreMigrationBackup(
  db: DatabaseSync,
  dbPath: string,
  fromSchemaVersion: number,
  now: () => number = () => Date.now(),
): string {
  const baseName = path.basename(dbPath, path.extname(dbPath));
  const directory = backupDirectoryFor(dbPath);
  const stamp = timestampForFileName(now);
  let targetPath = path.join(
    directory,
    `${baseName}-pre-v${fromSchemaVersion}-${stamp}.sqlite`,
  );
  let counter = 1;
  while (existsSync(targetPath)) {
    targetPath = path.join(
      directory,
      `${baseName}-pre-v${fromSchemaVersion}-${stamp}-${counter}.sqlite`,
    );
    counter += 1;
  }

  createSqliteSnapshot(db, targetPath);
  const snapshot = inspectDatabase(targetPath, { readOnly: true });
  if (snapshot.integrity !== "ok" || snapshot.foreignKeyViolations > 0) {
    throw new Error(
      `Snapshot pramigrasi tidak lulus pemeriksaan integritas (${snapshot.integrity}); ` +
        `migrasi dibatalkan. Hapus snapshot rusak ${targetPath} setelah diperiksa.`,
    );
  }
  if (snapshot.userVersion !== fromSchemaVersion) {
    throw new Error(
      `Snapshot pramigrasi memiliki user_version=${snapshot.userVersion}, ` +
        `diharapkan ${fromSchemaVersion}. Migrasi dibatalkan.`,
    );
  }
  return targetPath;
}

export type RestoreCheck = {
  backupPath: string;
  userVersion: number;
  integrity: string;
  foreignKeyViolations: number;
};

/**
 * Memeriksa cadangan pada salinan terpisah tanpa menyentuh database operasional.
 * Pemulihan ke database operasional tetap manual sesuai runbook di README.
 */
export function inspectBackup(backupPath: string): RestoreCheck {
  const db = openDatabase(backupPath, { readOnly: true });
  try {
    const integrity = checkIntegrity(db);
    return {
      backupPath,
      userVersion: readUserVersion(db),
      integrity: integrity.integrity,
      foreignKeyViolations: integrity.foreignKeyViolations,
    };
  } finally {
    db.close();
  }
}