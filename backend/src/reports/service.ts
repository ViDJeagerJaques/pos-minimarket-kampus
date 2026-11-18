import type { DatabaseSync } from "node:sqlite";
import { ForbiddenError } from "../auth/errors.ts";
import type { SessionUser } from "../auth/session.ts";

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

export function createReportService(db: DatabaseSync): ReportService {
  return {
    getPaymentReport(actor) {
      if (actor.role !== "ADMIN") {
        throw new ForbiddenError("Laporan pembayaran hanya untuk ADMIN.");
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
             FROM sales s JOIN payments p ON p.sale_id = s.id`,
          )
          .get() as {
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
             LEFT JOIN users u ON u.id = p.verified_by
             WHERE p.method_code = 'QRIS_MANUAL'
               AND p.verified_by IS NOT NULL AND p.verified_at_ms IS NOT NULL
             ORDER BY s.committed_at_ms DESC, s.id DESC
             LIMIT 100`,
          )
          .all() as Row[];

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
  };
}
