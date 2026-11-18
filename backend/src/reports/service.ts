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
      const rows = db
        .prepare(
          `SELECT s.id AS sale_id, s.sale_no AS sale_no, s.committed_at_ms AS committed_at_ms,
                  p.method_code AS method_code, p.amount_rp AS amount_rp,
                  p.verified_by AS verified_by, p.verified_at_ms AS verified_at_ms,
                  p.evidence_ref AS evidence_ref, u.username AS cashier_username
           FROM sales s
           JOIN payments p ON p.sale_id = s.id
           LEFT JOIN users u ON u.id = p.verified_by
           ORDER BY s.committed_at_ms DESC, s.id DESC`,
        )
        .all() as Row[];

      const report: PaymentReport = {
        cash: { totalRp: 0, count: 0 },
        qrisManual: { totalRp: 0, count: 0, verifiedCount: 0 },
        totalRp: 0,
        qrisSales: [],
      };

      for (const row of rows) {
        const amount = Number(row.amount_rp);
        report.totalRp += amount;
        if (row.method_code === "CASH") {
          report.cash.totalRp += amount;
          report.cash.count += 1;
          continue;
        }
        if (row.method_code !== "QRIS_MANUAL") {
          continue;
        }
        report.qrisManual.totalRp += amount;
        report.qrisManual.count += 1;
        // Baris QRIS yang valid selalu punya verifier dari sesi backend.
        if (row.verified_by !== null && row.verified_at_ms !== null) {
          report.qrisManual.verifiedCount += 1;
          report.qrisSales.push({
            saleId: Number(row.sale_id),
            saleNo: String(row.sale_no),
            committedAtMs: Number(row.committed_at_ms),
            totalRp: amount,
            cashierUsername: row.cashier_username,
            verifiedBy: Number(row.verified_by),
            verifiedAtMs: Number(row.verified_at_ms),
            evidenceRef: row.evidence_ref,
            status: "verified",
          });
        }
      }
      return report;
    },
  };
}
