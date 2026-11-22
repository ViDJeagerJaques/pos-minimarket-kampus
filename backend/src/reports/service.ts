import type { DatabaseSync } from "node:sqlite";
import { ForbiddenError, ValidationError } from "../auth/errors.ts";
import type { SessionUser } from "../auth/session.ts";
import { listStockMovements, reconcileAll } from "../inventory/ledger.ts";

/**
 * Laporan pembayaran TASK-037: memisahkan CASH dan QRIS_MANUAL dari data yang
 * benar-benar tersimpan (`sales` + `payments`). Upaya gagal/PREPARED tidak
 * pernah masuk laporan karena tidak ada baris sale.
 *
 * Status QRIS yang dilaporkan adalah `verified` karena commit QRIS hanya bisa
 * sukses bawa kasir mengirim merchantConfirmed=true dari sesi yang sah dan
 * backend mengisi verified_by/verified_at_ms dari sesi/jam lokal. Status
 * `pending`/`failed` ditampilkan UI, bukan agregat omzet.
 */
export type QrisSaleReport = {
  saleId: number;
  saleNo: string;
  committedAtMs: number;
  totalRp: number;
  cashierUsername: string | null;
  verifiedBy: number;
  verifiedAtMs: number;
  evidenceRef: string | null;
  status: "verified";
};

export type PaymentReport = {
  cash: { totalRp: number; count: number };
  qrisManual: { totalRp: number; count: number; verifiedCount: number };
  totalRp: number;
  qrisSales: QrisSaleReport[];
};

export type ReportService = {
  getPaymentReport(actor: SessionUser): PaymentReport;
  getDailyReport(actor: SessionUser, filter: DailyReportFilter): DailyReport;
  getStockReport(actor: SessionUser, filter: StockReportFilter): StockReport;
};

export type DailyReportFilter = {
  startMs?: unknown;
  endMs?: unknown;
  shiftId?: unknown;
};

export type DailySaleRow = {
  saleId: number;
  saleNo: string;
  committedAtMs: number;
  shiftId: number;
  cashierUsername: string | null;
  method: "CASH" | "QRIS_MANUAL";
  amountRp: number;
};

export type DailyReport = {
  startMs: number;
  endMs: number;
  shiftId: number | null;
  cash: { totalRp: number; count: number };
  qrisManual: { totalRp: number; count: number; verifiedCount: number };
  totalRp: number;
  saleCount: number;
  sales: DailySaleRow[];
  salesTruncated: boolean;
  generatedAtMs: number;
};

export type StockReportFilter = {
  lowStockThreshold?: unknown;
};

export type StockMovementEntry = {
  id: number;
  kind: "OPENING" | "SALE" | "RECEIPT" | "ADJUSTMENT";
  delta: number;
  createdAtMs: number;
  actorId: number;
  sourceType: string | null;
  sourceId: number | null;
  sourceRef: string | null;
  sourceQuantity: number | null;
  adjustmentReason: string | null;
};

export type ProductStockReport = {
  productId: number;
  sku: string;
  name: string;
  onHand: number;
  opening: number;
  receipt: number;
  sale: number;
  adjustment: number;
  matched: boolean;
  low: boolean;
  zero: boolean;
  movements: StockMovementEntry[];
  movementsTruncated: boolean;
};

export type StockReport = {
  generatedAtMs: number;
  lowStockThreshold: number;
  products: ProductStockReport[];
};

type Row = {
  sale_id: number;
  sale_no: string;
  committed_at_ms: number;
  method_code: string;
  amount_rp: number;
  verified_by: number | null;
  verified_at_ms: number | null;
  evidence_ref: string | null;
  cashier_username: string | null;
};

type DailyRow = {
  sale_id: number;
  sale_no: string;
  committed_at_ms: number;
  shift_id: number;
  cashier_username: string | null;
  method_code: string;
  amount_rp: number;
};

function assertNonNegativeInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError(`${field} harus epoch ms bilangan bulat non-negatif.`, field);
  }
  return value;
}

function optionalPositiveInt(value: unknown, field: string): number | null {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${field} harus ID positif.`, field);
  }
  return parsed;
}

function parseDailyFilter(filter: DailyReportFilter): {
  startMs: number;
  endMs: number;
  shiftId: number | null;
} {
  const startMs = assertNonNegativeInt(filter?.startMs, "start");
  const endMs = assertNonNegativeInt(filter?.endMs, "end");
  if (startMs >= endMs) {
    throw new ValidationError("Rentang harus memakai start < end.", "end");
  }
  return { startMs, endMs, shiftId: optionalPositiveInt(filter?.shiftId, "shiftId") };
}

function parseStockFilter(filter: StockReportFilter): number {
  const raw = filter?.lowStockThreshold;
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) {
    return 0;
  }
  const parsed = typeof raw === "string" ? Number(raw) : raw;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ValidationError("lowStockThreshold harus bilangan bulat non-negatif.", "lowStockThreshold");
  }
  return parsed;
}

export function createReportService(db: DatabaseSync): ReportService {
  return {
    getPaymentReport(actor) {
      if (actor.role !== "ADMIN" && actor.role !== "CASHIER") {
        throw new ForbiddenError("Akses laporan pembayaran ditolak.");
      }
      // Agregat dihitung SQL; rincian QRIS diambil terpisah dengan batas.
      // Keduanya dibaca dalam satu snapshot SQLite yang sama.
      db.exec("BEGIN");
      try {
        const summary = db
          .prepare(
            `SELECT
               COALESCE(SUM(CASE WHEN p.method_code = 'CASH' THEN p.amount_rp ELSE 0 END), 0) AS cash_total,
               SUM(CASE WHEN p.method_code = 'CASH' THEN 1 ELSE 0 END) AS cash_count,
               COALESCE(SUM(CASE WHEN p.method_code = 'QRIS_MANUAL' THEN p.amount_rp ELSE 0 END), 0) AS qris_total,
               SUM(CASE WHEN p.method_code = 'QRIS_MANUAL' THEN 1 ELSE 0 END) AS qris_count,
               SUM(CASE WHEN p.method_code = 'QRIS_MANUAL'
                             AND p.verified_by IS NOT NULL AND p.verified_at_ms IS NOT NULL
                        THEN 1 ELSE 0 END) AS verified_count,
               COALESCE(SUM(p.amount_rp), 0) AS total
             FROM sales s JOIN payments p ON p.sale_id = s.id
             JOIN checkout_attempts a ON a.attempt_key = s.attempt_key
             WHERE (? = 'ADMIN' OR a.cashier_id = ?)`,
          )
          .get(actor.role, actor.userId) as {
          cash_total: number;
          cash_count: number;
          qris_total: number;
          qris_count: number;
          verified_count: number;
          total: number;
        };
        const rows = db
          .prepare(
            `SELECT s.id AS sale_id, s.sale_no AS sale_no, s.committed_at_ms AS committed_at_ms,
                    p.amount_rp AS amount_rp, p.verified_by AS verified_by,
                    p.verified_at_ms AS verified_at_ms, p.evidence_ref AS evidence_ref,
                    u.username AS cashier_username
             FROM sales s
             JOIN payments p ON p.sale_id = s.id
             JOIN checkout_attempts a ON a.attempt_key = s.attempt_key
             LEFT JOIN users u ON u.id = p.verified_by
             WHERE (? = 'ADMIN' OR a.cashier_id = ?) AND p.method_code = 'QRIS_MANUAL'
               AND p.verified_by IS NOT NULL AND p.verified_at_ms IS NOT NULL
             ORDER BY s.committed_at_ms DESC, s.id DESC
             LIMIT 100`,
          )
          .all(actor.role, actor.userId) as Row[];

        const report: PaymentReport = {
          cash: {
            totalRp: Number(summary.cash_total),
            count: Number(summary.cash_count),
          },
          qrisManual: {
            totalRp: Number(summary.qris_total),
            count: Number(summary.qris_count),
            verifiedCount: Number(summary.verified_count),
          },
          totalRp: Number(summary.total),
          qrisSales: rows.map((row) => ({
            saleId: Number(row.sale_id),
            saleNo: String(row.sale_no),
            committedAtMs: Number(row.committed_at_ms),
            totalRp: Number(row.amount_rp),
            cashierUsername: row.cashier_username,
            verifiedBy: Number(row.verified_by),
            verifiedAtMs: Number(row.verified_at_ms),
            evidenceRef: row.evidence_ref,
            status: "verified",
          })),
        };
        db.exec("COMMIT");
        return report;
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // Error asli tetap dilempar.
        }
        throw error;
      }
    },

    getDailyReport(actor, filter) {
      if (actor.role !== "ADMIN") {
        throw new ForbiddenError("Laporan harian hanya untuk ADMIN.");
      }
      const { startMs, endMs, shiftId } = parseDailyFilter(filter);
      const conditions = ["s.committed_at_ms >= ?", "s.committed_at_ms < ?"];
      const params: number[] = [startMs, endMs];
      if (shiftId !== null) {
        conditions.push("ca.shift_id = ?");
        params.push(shiftId);
      }
      // payment_id terpilih satu per sale (split tender bukan P0), sehingga
      // setiap penjualan dihitung tepat satu kali.
      const from = `FROM sales s
        JOIN checkout_attempts ca ON ca.attempt_key = s.attempt_key
        JOIN (SELECT sale_id, MIN(id) AS payment_id FROM payments GROUP BY sale_id) pp
          ON pp.sale_id = s.id
        JOIN payments p ON p.id = pp.payment_id
        LEFT JOIN users u ON u.id = ca.cashier_id
        WHERE ${conditions.join(" AND ")}`;

      db.exec("BEGIN");
      try {
        const summary = db
          .prepare(
            `SELECT
               COALESCE(SUM(CASE WHEN p.method_code = 'CASH' THEN p.amount_rp ELSE 0 END), 0) AS cash_total,
               SUM(CASE WHEN p.method_code = 'CASH' THEN 1 ELSE 0 END) AS cash_count,
               COALESCE(SUM(CASE WHEN p.method_code = 'QRIS_MANUAL' THEN p.amount_rp ELSE 0 END), 0) AS qris_total,
               SUM(CASE WHEN p.method_code = 'QRIS_MANUAL' THEN 1 ELSE 0 END) AS qris_count,
               SUM(CASE WHEN p.method_code = 'QRIS_MANUAL' AND p.verified_by IS NOT NULL
                        AND p.verified_at_ms IS NOT NULL THEN 1 ELSE 0 END) AS verified_count,
               COALESCE(SUM(p.amount_rp), 0) AS total,
               COUNT(*) AS sale_count
             ${from}`,
          )
          .get(...params) as {
          cash_total: number;
          cash_count: number;
          qris_total: number;
          qris_count: number;
          verified_count: number;
          total: number;
          sale_count: number;
        };
        const detailRows = db
          .prepare(
            `SELECT s.id AS sale_id, s.sale_no AS sale_no, s.committed_at_ms AS committed_at_ms,
                    ca.shift_id AS shift_id, u.username AS cashier_username,
                    p.method_code AS method_code, p.amount_rp AS amount_rp
             ${from}
             ORDER BY s.committed_at_ms DESC, s.id DESC
             LIMIT 101`,
          )
          .all(...params) as DailyRow[];
        const salesTruncated = detailRows.length > 100;
        const report: DailyReport = {
          startMs,
          endMs,
          shiftId,
          cash: {
            totalRp: Number(summary.cash_total),
            count: Number(summary.cash_count),
          },
          qrisManual: {
            totalRp: Number(summary.qris_total),
            count: Number(summary.qris_count),
            verifiedCount: Number(summary.verified_count),
          },
          totalRp: Number(summary.total),
          saleCount: Number(summary.sale_count),
          sales: detailRows.slice(0, 100).map((row) => ({
            saleId: Number(row.sale_id),
            saleNo: String(row.sale_no),
            committedAtMs: Number(row.committed_at_ms),
            shiftId: Number(row.shift_id),
            cashierUsername: row.cashier_username,
            method: row.method_code === "QRIS_MANUAL" ? "QRIS_MANUAL" : "CASH",
            amountRp: Number(row.amount_rp),
          })),
          salesTruncated,
          generatedAtMs: Date.now(),
        };
        db.exec("COMMIT");
        return report;
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // Error asli tetap dilempar.
        }
        throw error;
      }
    },

    getStockReport(actor, filter) {
      if (actor.role !== "ADMIN") {
        throw new ForbiddenError("Laporan stok hanya untuk ADMIN.");
      }
      const lowStockThreshold = parseStockFilter(filter);
      db.exec("BEGIN");
      try {
        const nameStmt = db.prepare("SELECT name FROM products WHERE id = ?");
        const products: ProductStockReport[] = reconcileAll(db).map((reconciled) => {
          const nameRow = nameStmt.get(reconciled.productId) as { name: string } | undefined;
          // Ambil 21 entri terbaru; entri ke-21 hanya penanda pemotongan.
          const movements = listStockMovements(db, reconciled.productId, { limit: 21 });
          return {
            productId: reconciled.productId,
            sku: reconciled.sku,
            name: nameRow === undefined ? reconciled.sku : String(nameRow.name),
            onHand: reconciled.ledgerOnHand,
            opening: reconciled.opening,
            receipt: reconciled.receipt,
            sale: reconciled.sale,
            adjustment: reconciled.adjustment,
            matched: reconciled.matched,
            low:
              lowStockThreshold > 0 &&
              reconciled.ledgerOnHand > 0 &&
              reconciled.ledgerOnHand <= lowStockThreshold,
            zero: reconciled.ledgerOnHand === 0,
            movements: movements.slice(-20).map((movement) => ({
              id: movement.id,
              kind: movement.kind,
              delta: movement.delta,
              createdAtMs: movement.createdAtMs,
              actorId: movement.actorId,
              sourceType: movement.sourceType,
              sourceId: movement.sourceId,
              sourceRef: movement.sourceRef,
              sourceQuantity: movement.sourceQuantity,
              adjustmentReason: movement.adjustmentReason,
            })),
            movementsTruncated: movements.length > 20,
          };
        });
        const report: StockReport = {
          generatedAtMs: Date.now(),
          lowStockThreshold,
          products,
        };
        db.exec("COMMIT");
        return report;
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // Error asli tetap dilempar.
        }
        throw error;
      }
    },
  };
}
