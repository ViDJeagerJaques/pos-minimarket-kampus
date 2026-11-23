import type { DatabaseSync } from "node:sqlite";
import type { CheckoutPaymentMethod } from "../../../shared/checkoutHash.ts";
import { AuthRequiredError, ForbiddenError } from "../auth/errors.ts";
import type { SessionUser } from "../auth/session.ts";
import { PrintError, PrintValidationError, PrinterUnavailableError, SaleNotFoundError } from "./errors.ts";
import { createVirtualPrinterAdapter } from "./printer.ts";
import { formatReceiptText } from "./receipt.ts";
import type { PrintResult, PrinterAdapter, Receipt, ReceiptView } from "./types.ts";

export type RecentSale = { saleId: number; saleNo: string; committedAtMs: number; totalRp: number; method: CheckoutPaymentMethod };

export type PrintService = {
  getRecentSales(
    actor: SessionUser,
    options?: { startMs?: number; endMs?: number; limit?: number; offset?: number },
  ): RecentSale[];
  /** Membaca struk dari sale COMMITTED (ADMIN boleh membaca, tidak boleh mencetak). */
  getReceipt(actor: SessionUser, saleId: unknown): ReceiptView;
  /** Mencetak/cetak ulang. Hanya CASHIER pemilik sale. Tidak menulis DB. */
  print(actor: SessionUser, saleId: unknown, body?: unknown): PrintResult;
};

type SaleRow = {
  id: number;
  sale_no: string;
  committed_at_ms: number;
  total_rp: number;
  attempt_key: string;
  cashier_id: number;
  shift_id: number;
  cashier_username: string | null;
};

type ItemRow = {
  sku: string;
  name: string;
  quantity: number;
  unit_price_rp: number;
  line_total_rp: number;
};

type PaymentRow = {
  method_code: string;
  amount_rp: number;
  evidence_ref: string | null;
  verified_at_ms: number | null;
  cash_received_rp: number | null;
  change_rp: number | null;
};

function assertSaleId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new PrintValidationError("ID transaksi tidak valid.");
  }
  return value;
}

function asPaymentMethod(value: string): CheckoutPaymentMethod {
  if (value !== "CASH" && value !== "QRIS_MANUAL") {
    throw new PrintError("CONFLICT", 500, "Metode pembayaran pada transaksi tersimpan tidak dikenal.");
  }
  return value;
}

/**
 * Service cetak TASK-021. Membangun struk HANYA dari baris tersimpan
 * (sales → sale_items → payments), memeriksa kepemilikan lewat
 * `sales.attempt_key → checkout_attempts.cashier_id` (AUTHORIZATION §4.3),
 * lalu menyerahkan teks ke adapter printer yang terpisah dari SQLite.
 */
export function createPrintService(
  db: DatabaseSync,
  deps: { printer?: PrinterAdapter; now?: () => number } = {},
): PrintService {
  const printer = deps.printer ?? createVirtualPrinterAdapter({ now: deps.now });

  function assertActiveActor(actor: SessionUser): void {
    const row = db
      .prepare("SELECT role, active FROM users WHERE id = ?")
      .get(actor.userId) as { role: string; active: number } | undefined;
    if (!row || Number(row.active) !== 1) {
      throw new AuthRequiredError("Sesi pengguna tidak lagi valid.");
    }
  }

  function loadCommittedReceipt(actor: SessionUser, saleIdInput: unknown): Receipt {
    const saleId = assertSaleId(saleIdInput);
    assertActiveActor(actor);

    const sale = db
      .prepare(
        `SELECT s.id, s.sale_no, s.committed_at_ms, s.total_rp, s.attempt_key,
                a.cashier_id, a.shift_id, u.username AS cashier_username
         FROM sales s
         JOIN checkout_attempts a ON a.attempt_key = s.attempt_key
         LEFT JOIN users u ON u.id = a.cashier_id
         WHERE s.id = ?`,
      )
      .get(saleId) as SaleRow | undefined;
    if (!sale) {
      throw new SaleNotFoundError();
    }
    // Akses kasir terhadap sale ditentukan oleh pemilik attempt, bukan saleId
    // yang dapat ditebak. ADMIN hanya membaca (K-03/AUTH-07: belum ada izin cetak).
    if (actor.role === "CASHIER" && Number(sale.cashier_id) !== actor.userId) {
      throw new ForbiddenError("Akses transaksi ditolak.");
    }
    if (actor.role !== "CASHIER" && actor.role !== "ADMIN") {
      throw new ForbiddenError("Akses transaksi ditolak.");
    }

    const items = db
      .prepare(
        `SELECT sku_snapshot AS sku, name_snapshot AS name, quantity,
                unit_price_rp, line_total_rp
         FROM sale_items WHERE sale_id = ? ORDER BY id`,
      )
      .all(saleId) as ItemRow[];
    if (items.length === 0) {
      throw new PrintError("CONFLICT", 500, "Item transaksi tersimpan tidak lengkap.");
    }

    const payment = db
      .prepare(
        `SELECT p.method_code, p.amount_rp, p.evidence_ref, p.verified_at_ms,
                q.cash_received_rp, q.change_rp
         FROM payments p
         LEFT JOIN checkout_attempt_quotes q ON q.attempt_key = ?
         WHERE p.sale_id = ?
         ORDER BY p.id
         LIMIT 1`,
      )
      .get(sale.attempt_key, saleId) as PaymentRow | undefined;
    if (!payment) {
      throw new PrintError("CONFLICT", 500, "Data pembayaran transaksi tersimpan tidak lengkap.");
    }

    return {
      saleId: Number(sale.id),
      saleNo: String(sale.sale_no),
      committedAtMs: Number(sale.committed_at_ms),
      totalRp: Number(sale.total_rp),
      shiftId: Number(sale.shift_id),
      cashierUsername: sale.cashier_username ?? undefined,
      items: items.map((item) => ({
        sku: String(item.sku),
        name: String(item.name),
        quantity: Number(item.quantity),
        unitPriceRp: Number(item.unit_price_rp),
        lineTotalRp: Number(item.line_total_rp),
      })),
      payment: {
        method: asPaymentMethod(String(payment.method_code)),
        amountRp: Number(payment.amount_rp),
        cashReceivedRp:
          payment.cash_received_rp === null ? null : Number(payment.cash_received_rp),
        changeRp: payment.change_rp === null ? null : Number(payment.change_rp),
        evidenceRef: payment.evidence_ref,
        verifiedAtMs:
          payment.verified_at_ms === null ? null : Number(payment.verified_at_ms),
      },
    };
  }

  return {
    getRecentSales(actor, options = {}) {
      assertActiveActor(actor);
      if (actor.role !== "ADMIN" && actor.role !== "CASHIER") throw new ForbiddenError("Akses transaksi ditolak.");
      const rawLimit = options.limit;
      const limit = rawLimit === undefined ? 20 : rawLimit;
      if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
        throw new PrintValidationError("limit tidak valid.");
      }
      const rawOffset = options.offset;
      const offset = rawOffset === undefined ? 0 : rawOffset;
      if (!Number.isSafeInteger(offset) || offset < 0) {
        throw new PrintValidationError("offset tidak valid.");
      }
      const startMs = options.startMs === undefined ? null : options.startMs;
      const endMs = options.endMs === undefined ? null : options.endMs;
      if (startMs !== null && (!Number.isSafeInteger(startMs) || startMs < 0)) {
        throw new PrintValidationError("startMs tidak valid.");
      }
      if (endMs !== null && (!Number.isSafeInteger(endMs) || endMs < 0)) {
        throw new PrintValidationError("endMs tidak valid.");
      }
      if (startMs !== null && endMs !== null && endMs <= startMs) {
        throw new PrintValidationError("Rentang tanggal tidak valid.");
      }
      const rows = db.prepare(`SELECT s.id, s.sale_no, s.committed_at_ms, s.total_rp, p.method_code
        FROM sales s JOIN checkout_attempts a ON a.attempt_key = s.attempt_key
        JOIN payments p ON p.id = (
          SELECT first_payment.id FROM payments first_payment
          WHERE first_payment.sale_id = s.id ORDER BY first_payment.id ASC LIMIT 1
        )
        WHERE (? = 'ADMIN' OR a.cashier_id = ?)
          AND (? IS NULL OR s.committed_at_ms >= ?)
          AND (? IS NULL OR s.committed_at_ms < ?)
        ORDER BY s.committed_at_ms DESC, s.id DESC LIMIT ? OFFSET ?`).all(
          actor.role,
          actor.userId,
          startMs,
          startMs,
          endMs,
          endMs,
          limit,
          offset,
        );
      return rows.map(row => ({ saleId: Number(row.id), saleNo: String(row.sale_no), committedAtMs: Number(row.committed_at_ms), totalRp: Number(row.total_rp), method: asPaymentMethod(String(row.method_code)) }));
    },
    getReceipt(actor, saleIdInput) {
      const receipt = loadCommittedReceipt(actor, saleIdInput);
      return { receipt, text: formatReceiptText(receipt), demo: true };
    },

    print(actor, saleIdInput, body) {
      // Lapisan pertahanan kedua: route sudah membatasi POST ke CASHIER.
      if (actor.role !== "CASHIER") {
        throw new ForbiddenError("Hanya CASHIER pemilik transaksi yang boleh mencetak struk.");
      }
      if (body !== undefined && (typeof body !== "object" || body === null || Array.isArray(body))) {
        throw new PrintValidationError("Body cetak belum sesuai.");
      }
      const receipt = loadCommittedReceipt(actor, saleIdInput);
      const attempt = printer.print(receipt);
      if (!attempt.ok) {
        // Tidak ada write sama sekali: sale/payment/stok mengikuti commit awal.
        throw new PrinterUnavailableError(attempt.reason);
      }
      return {
        saleId: receipt.saleId,
        saleNo: receipt.saleNo,
        status: "PRINTED",
        channel: printer.channel,
        printedAtMs: attempt.printedAtMs,
        text: attempt.text,
        demo: true,
      };
    },
  };
}
