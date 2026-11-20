import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  constants as fsConstants,
} from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createSqliteSnapshot } from "../../db/src/backup.ts";
import { inspectDatabase, openDatabase } from "../../db/src/db.ts";
import {
  REPO_ROOT,
  assertOutsideSourceTree,
  defaultDataDir,
  ensureParentDirectory,
  resolveDatabasePath,
  type Env,
} from "../../db/src/paths.ts";

/**
 * TASK-028 (DEMO): backup SQLite konsisten memakai `VACUUM INTO`, diverifikasi
 * sebelum dipromosikan, dan restore HANYA ke salinan uji terpisah. Tidak ada
 * endpoint restore yang menimpa database operasional: itu tetap runbook
 * operator dengan persetujuan pengelola (BACKUP_RECOVERY.md §5).
 */
export const REQUIRED_BACKUP_TABLES = [
  "users",
  "products",
  "sales",
  "sale_items",
  "payments",
  "shifts",
  "checkout_attempts",
  "inventory_movements",
  "goods_receipts",
  "receipt_items",
  "audit_log",
] as const;

export type BackupCounts = Record<(typeof REQUIRED_BACKUP_TABLES)[number], number>;

export type BackupReport = {
  fileName: string;
  sizeBytes: number;
  sha256: string;
  createdAtMs: number;
  schemaVersion: number;
  integrity: string;
  foreignKeyViolations: number;
  tables: string[];
  counts: BackupCounts;
};

export type RestoreTestResult = {
  backupPath: string;
  destinationPath: string;
  report: BackupReport;
};

export type BackupServiceOptions = {
  dbPath: string;
  /** Direktorid tujuan; bila diisi harus berada di dalam root yang diizinkan. */
  destinationDir?: string;
  actorId?: number | null;
  now?: () => number;
  env?: Env;
};

export type RestoreTestOptions = {
  backupPath: string;
  destinationDir?: string;
  now?: () => number;
  env?: Env;
};

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Kanonicalisasi mengikuti symlink pada bagian path yang sudah ada; bagian
 * yang belum dibuat ditambahkan secara leksikal di atasnya. Ini mencegah
 * symlink di root cadangan mengarahkan tulisan ke dalam repository atau ke
 * direktori di luar root yang diizinkan.
 */
function canonicalizePath(pathname: string): string {
  let current = path.resolve(pathname);
  const missing: string[] = [];
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    missing.unshift(path.basename(current));
    current = parent;
  }
  try {
    current = realpathSync(current);
  } catch {
    // Path yang sudah ada tetapi gagal di-realpath tetap dipakai apa adanya.
  }
  return missing.length === 0 ? current : path.join(current, ...missing);
}

function assertNotInsideRepo(candidate: string): void {
  if (isInside(canonicalizePath(REPO_ROOT), candidate)) {
    throw new Error("Direktori ditolak: berada di dalam repository.");
  }
}

export function backupRootFor(dbPath: string, env: Env = process.env): string {
  const configured = env.POS_BACKUP_DIR;
  const root = canonicalizePath(
    configured && configured.trim().length > 0
      ? path.resolve(configured)
      : path.join(path.dirname(path.resolve(dbPath)), "backups"),
  );
  assertOutsideSourceTree(root);
  assertNotInsideRepo(root);
  return root;
}

export function restoreTestRootFor(env: Env = process.env): string {
  const configured = env.POS_RESTORE_TEST_DIR;
  const root = canonicalizePath(
    configured && configured.trim().length > 0
      ? path.resolve(configured)
      : path.join(defaultDataDir(env), "restore-test"),
  );
  assertOutsideSourceTree(root);
  assertNotInsideRepo(root);
  return root;
}

function resolveAllowedDirectory(candidate: string | undefined, root: string): string {
  const resolved = canonicalizePath(candidate === undefined ? root : path.resolve(candidate));
  assertOutsideSourceTree(resolved);
  assertNotInsideRepo(resolved);
  if (!isInside(root, resolved)) {
    throw new Error("Direktori ditolak: harus berada di root cadangan/pemulihan uji yang dikonfigurasi backend.");
  }
  return resolved;
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function readCounts(filePath: string): BackupCounts {
  const db = openDatabase(filePath, { readOnly: true });
  try {
    const counts = {} as BackupCounts;
    for (const table of REQUIRED_BACKUP_TABLES) {
      const row = db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number };
      counts[table] = Number(row.total);
    }
    return counts;
  } finally {
    db.close();
  }
}

function verifySnapshot(filePath: string, createdAtMs: number): BackupReport {
  if (!existsSync(filePath)) {
    throw new Error("File cadangan tidak ditemukan.");
  }
  const sizeBytes = statSync(filePath).size;
  let inspection: ReturnType<typeof inspectDatabase>;
  try {
    inspection = inspectDatabase(filePath, { readOnly: true });
  } catch (error) {
    throw new Error(
      `Cadangan gagal integrity_check: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (inspection.integrity !== "ok") {
    throw new Error(`Cadangan gagal integrity_check: ${inspection.integrity}`);
  }
  if (inspection.foreignKeyViolations > 0) {
    throw new Error(`Cadangan memiliki ${inspection.foreignKeyViolations} pelanggaran foreign key.`);
  }
  if (inspection.userVersion <= 0) {
    throw new Error("Cadangan memiliki user_version tidak valid.");
  }
  const missing = REQUIRED_BACKUP_TABLES.filter((table) => !inspection.tables.includes(table));
  if (missing.length > 0) {
    throw new Error(`Cadangan kehilangan tabel penting: ${missing.join(", ")}.`);
  }
  return {
    fileName: path.basename(filePath),
    sizeBytes,
    sha256: sha256File(filePath),
    createdAtMs,
    schemaVersion: inspection.userVersion,
    integrity: inspection.integrity,
    foreignKeyViolations: inspection.foreignKeyViolations,
    tables: inspection.tables,
    counts: readCounts(filePath),
  };
}

function stamp(nowMs: number): string {
  return new Date(nowMs).toISOString().replace(/[:.]/g, "-");
}

export function createBackup(options: BackupServiceOptions): BackupReport & { destinationPath: string; manifestPath: string | null } {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => Date.now());
  const root = backupRootFor(options.dbPath, env);
  const directory = resolveAllowedDirectory(options.destinationDir, root);
  ensureParentDirectory(directory);
  mkdirSync(directory, { recursive: true });

  const createdAtMs = now();
  const backupId = `${stamp(createdAtMs)}-${randomBytes(4).toString("hex")}`;
  const finalPath = path.join(directory, `pos_${backupId}.sqlite`);
  const tempPath = path.join(directory, `.pos_${backupId}.part`);
  if (existsSync(finalPath)) {
    throw new Error(`Target cadangan sudah ada, tidak ditimpa: ${finalPath}`);
  }

  let promoted = false;
  try {
    const db = openDatabase(options.dbPath);
    try {
      createSqliteSnapshot(db, tempPath);
    } finally {
      db.close();
    }
    const report = verifySnapshot(tempPath, createdAtMs);
    renameSync(tempPath, finalPath);
    promoted = true;
    // Laporan dan manifest memakai nama file publik, bukan nama sementara.
    report.fileName = path.basename(finalPath);

    let manifestPath: string | null = null;
    try {
      const manifestTarget = `${finalPath}.json`;
      const manifestTemp = `${manifestTarget}.part`;
      writeFileSync(
        manifestTemp,
        JSON.stringify(
          {
            schemaVersion: report.schemaVersion,
            createdAtMs: report.createdAtMs,
            sizeBytes: report.sizeBytes,
            sha256: report.sha256,
            actorId: options.actorId ?? null,
            sourceDbId: path.basename(options.dbPath),
            fileName: report.fileName,
          },
          null,
          2,
        ),
        { flag: "wx" },
      );
      renameSync(manifestTemp, manifestTarget);
      manifestPath = manifestTarget;
    } catch {
      // Manifest gagal ditulis; file cadangan valid tetap dipertahankan.
      try {
        unlinkSync(`${finalPath}.json.part`);
      } catch {
        // Abaikan.
      }
    }
    return { ...report, destinationPath: finalPath, manifestPath };
  } catch (error) {
    if (!promoted) {
      try {
        unlinkSync(tempPath);
      } catch {
        // Abaikan; file sementara mungkin tidak pernah dibuat.
      }
    }
    throw error;
  }
}

export function verifyBackup(
  backupPath: string,
  expectedSha256?: string,
  now: () => number = () => Date.now(),
): BackupReport {
  const report = verifySnapshot(path.resolve(backupPath), now());
  if (expectedSha256 !== undefined && report.sha256 !== expectedSha256) {
    throw new Error("Hash cadangan tidak cocok dengan manifest.");
  }
  return report;
}

export function restoreBackupToTestCopy(options: RestoreTestOptions): RestoreTestResult {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => Date.now());
  const backupPath = path.resolve(options.backupPath);
  const sourceReport = verifyBackup(backupPath, undefined, now);

  const root = restoreTestRootFor(env);
  const directory = resolveAllowedDirectory(options.destinationDir, root);
  mkdirSync(directory, { recursive: true });

  const operationalDb = path.resolve(resolveDatabasePath(env));
  const destinationPath = path.join(
    directory,
    `restored_${sourceReport.fileName.replace(/\.sqlite$/i, "")}_${stamp(now())}.sqlite`,
  );
  if (destinationPath === backupPath || destinationPath === operationalDb) {
    throw new Error("Tujuan restore ditolak: tidak boleh menimpa cadangan atau database operasional.");
  }
  if (existsSync(destinationPath)) {
    throw new Error(`Tujuan restore sudah ada, tidak ditimpa: ${destinationPath}`);
  }

  let copied = false;
  try {
    copyFileSync(backupPath, destinationPath, fsConstants.COPYFILE_EXCL);
    copied = true;
    const restoredReport = verifyBackup(destinationPath, sourceReport.sha256, now);
    for (const table of REQUIRED_BACKUP_TABLES) {
      if (restoredReport.counts[table] !== sourceReport.counts[table]) {
        throw new Error(
          `Salinan uji tidak cocok: tabel ${table} memiliki ${restoredReport.counts[table]} baris, ` +
            `sumber ${sourceReport.counts[table]} baris.`,
        );
      }
    }
    return { backupPath, destinationPath, report: restoredReport };
  } catch (error) {
    if (copied) {
      for (const candidate of [destinationPath, `${destinationPath}-wal`, `${destinationPath}-shm`]) {
        try {
          unlinkSync(candidate);
        } catch {
          // Abaikan berkas yang tidak pernah dibuat.
        }
      }
    }
    throw error;
  }
}
