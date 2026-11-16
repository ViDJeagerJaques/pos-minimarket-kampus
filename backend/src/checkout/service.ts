import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  canonicalCheckoutPayload,
  CHECKOUT_HASH_VERSION,
  type CheckoutPaymentMethod,
} from "../../../shared/checkoutHash.ts";
import { AuthRequiredError, ForbiddenError } from "../auth/errors.ts";
import type { SessionUser } from "../auth/session.ts";
import { getStockBalance } from "../inventory/ledger.ts";
import { writeCheckoutAudit } from "./audit.ts";
import {
  AttemptAbandonedError,
  CheckoutError,
  IdempotencyConflictError,
  InsufficientStockError,
  NotFoundError,
  PriceChangedError,
  ShiftNotActiveError,
  ValidationError,
} from "./errors.ts";
import type {
  CheckoutQuote,
  CheckoutQuoteItem,
  CheckoutStatusResult,
  CommitCheckoutInput,
  CommitCheckoutResult,
  CommittedPaymentSummary,
  PrepareCheckoutInput,
  PrepareCheckoutResult,
} from "./types.ts";

export type CheckoutService = {
  prepare(actor: SessionUser, input: PrepareCheckoutInput): PrepareCheckoutResult;
  commit(actor: SessionUser, input: CommitCheckoutInput): CommitCheckoutResult;
  getStatus(actor: SessionUser, attemptKey: unknown): CheckoutStatusResult;
};

type AttemptRow = {
  attempt_key: string;
  shift_id: number;
  cashier_id: number;
  request_hash: Uint8Array;
  prepared_at_ms: number;
  abandoned_at_ms: number | null;
};

type SaleRow = {
  id: number;
  sale_no: string;
  attempt_key: string;
  committed_at_ms: number;
  total_rp: number;
};

type PaymentRow = {
  method_code: string;
  amount_rp: number;
  verified_by: number | null;
  verified_at_ms: number | null;
};

const HEX_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_ATTEMPT_KEY_LENGTH = 128;

function assertAttemptKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new ValidationError("attemptKey wajib berupa teks.", "attemptKey");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ATTEMPT_KEY_LENGTH) {
    throw new ValidationError(
      `attemptKey harus 1-${MAX_ATTEMPT_KEY_LENGTH} karakter.`,
      "attemptKey",
    );
  }
  return trimmed;
}

function assertPositiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError(`${field} harus bilangan bulat positif.`, field);
  }
  return value;
}

function assertNonNegativeInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError(`${field} harus bilangan bulat non-negatif.`, field);
  }
  return value;
}

function assertRequestHash(value: unknown): string {
  if (typeof value !== "string" || !HEX_SHA256_PATTERN.test(value)) {
    throw new ValidationError("requestHash harus hex SHA-256 64 karakter huruf kecil.", "requestHash");
  }
  return value;
}

function assertPaymentMethod(value: unknown, field = "payment.method"): CheckoutPaymentMethod {
  if (value !== "CASH" && value !== "QRIS_MANUAL") {
    throw new ValidationError("Metode pembayaran hanya mendukung CASH atau QRIS_MANUAL.", field);
  }
  return value;
}

function parsePrepareItems(raw: unknown): Array<{ productId: number; quantity: number }> {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ValidationError("items wajib berisi minimal satu item.", "items");
  }
  const seen = new Set<number>();
  const parsed: Array<{ productId: number; quantity: number }> = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new ValidationError("Setiap item harus objek { productId, quantity }.", "items");
    }
    const obj = entry as Record<string, unknown>;
    const productId = assertPositiveInt(obj.productId, "items.productId");
    if (seen.has(productId)) {
      throw new ValidationError(`productId ganda di dalam keranjang: ${productId}.`, "items");
    }
    seen.add(productId);
    const quantity = assertPositiveInt(obj.quantity, "items.quantity");
    parsed.push({ productId, quantity });
  }
  parsed.sort((a, b) => a.productId - b.productId);
  return parsed;
}

type ParsedPaymentConfirmation =
  | { method: "CASH"; cashReceivedRp: number }
  | { method: "QRIS_MANUAL"; merchantConfirmed: true; confirmedAmountRp: number; evidenceRef: string | null };

function parsePaymentConfirmation(raw: unknown): ParsedPaymentConfirmation {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ValidationError("paymentConfirmation wajib berupa objek.", "paymentConfirmation");
  }
  const obj = raw as Record<string, unknown>;
  const method = assertPaymentMethod(obj.method, "paymentConfirmation.method");
  if (method === "CASH") {
    const cashReceivedRp = assertNonNegativeInt(
      obj.cashReceivedRp,
      "paymentConfirmation.cashReceivedRp",
    );
    return { method: "CASH", cashReceivedRp };
  }
  if (obj.merchantConfirmed !== true) {
    throw new ValidationError(
      "QRIS manual memerlukan merchantConfirmed=true setelah kasir memeriksa aplikasi merchant.",
      "paymentConfirmation.merchantConfirmed",
    );
  }
  const confirmedAmountRp = assertNonNegativeInt(
    obj.confirmedAmountRp,
    "paymentConfirmation.confirmedAmountRp",
  );
  const evidenceRef =
    typeof obj.evidenceRef === "string" && obj.evidenceRef.trim().length > 0
      ? obj.evidenceRef.trim().slice(0, 120)
      : null;
  return {
    method: "QRIS_MANUAL",
    merchantConfirmed: true,
    confirmedAmountRp,
    evidenceRef,
  };
}

export function computeCheckoutHash(quote: CheckoutQuote): { hex: string; bytes: Buffer } {
  const canonical = canonicalCheckoutPayload({
    version: CHECKOUT_HASH_VERSION,
    cashierId: quote.cashierId,
    shiftId: quote.shiftId,
    items: quote.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPriceRp: item.unitPriceRp,
      lineTotalRp: item.lineTotalRp,
    })),
    totalRp: quote.totalRp,
    paymentMethod: quote.payment.method,
  });
  const bytes = createHash("sha256").update(canonical, "utf8").digest();
  return { hex: bytes.toString("hex"), bytes };
}

export function createCheckoutService(
  db: DatabaseSync,
  deps: { now?: () => number } = {},
): CheckoutService {
  const now = deps.now ?? (() => Date.now());

  function withImmediateTransaction<T>(fn: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // abaikan error rollback sekunder
      }
      throw error;
    }
  }

  function assertActiveUser(actor: SessionUser): { id: number; role: string } {
    const row = db
      .prepare("SELECT id, role, active FROM users WHERE id = ?")
      .get(actor.userId) as { id: number; role: string; active: number } | undefined;
    if (!row || Number(row.active) !== 1) {
      throw new AuthRequiredError("Sesi pengguna tidak lagi valid.");
    }
    return { id: Number(row.id), role: String(row.role) };
  }

  function assertActiveCashier(actor: SessionUser): void {
    const row = assertActiveUser(actor);
    if (row.role !== "CASHIER") {
      throw new ForbiddenError("Hanya CASHIER yang boleh memproses checkout.");
    }
  }

  function loadCommittedResult(attempt: AttemptRow): CommitCheckoutResult | null {
    const sale = db
      .prepare(
        "SELECT id, sale_no, attempt_key, committed_at_ms, total_rp FROM sales WHERE attempt_key = ?",
      )
      .get(attempt.attempt_key) as SaleRow | undefined;
    if (!sale) {
      return null;
    }
    const paymentRow = db
      .prepare(
        "SELECT method_code, amount_rp, verified_by, verified_at_ms FROM payments WHERE sale_id = ? LIMIT 1",
      )
      .get(sale.id) as PaymentRow | undefined;
    if (!paymentRow) {
      throw new CheckoutError("CONFLICT", 500, "Data pembayaran untuk penjualan tersimpan tidak lengkap.");
    }
    const quoteSummaryRow = db
      .prepare(
        "SELECT cash_received_rp, change_rp FROM checkout_attempt_quotes WHERE attempt_key = ?",
      )
      .get(attempt.attempt_key) as
      | { cash_received_rp: number | null; change_rp: number | null }
      | undefined;
    const method = paymentRow.method_code as CheckoutPaymentMethod;
    const cashReceivedRp =
      quoteSummaryRow?.cash_received_rp === null || quoteSummaryRow?.cash_received_rp === undefined
        ? null
        : Number(quoteSummaryRow.cash_received_rp);
    const changeRp =
      quoteSummaryRow?.change_rp === null || quoteSummaryRow?.change_rp === undefined
        ? method === "QRIS_MANUAL"
          ? 0
          : null
        : Number(quoteSummaryRow.change_rp);
    const payment: CommittedPaymentSummary = {
      method,
      amountRp: Number(paymentRow.amount_rp),
      cashReceivedRp,
      changeRp,
      verifiedBy: paymentRow.verified_by === null ? null : Number(paymentRow.verified_by),
      verifiedAtMs: paymentRow.verified_at_ms === null ? null : Number(paymentRow.verified_at_ms),
    };
    return {
      saleId: Number(sale.id),
      saleNo: String(sale.sale_no),
      attemptKey: String(sale.attempt_key),
      requestHash: Buffer.from(attempt.request_hash).toString("hex"),
      status: "COMMITTED",
      totalRp: Number(sale.total_rp),
      committedAtMs: Number(sale.committed_at_ms),
      payment,
    };
  }

  function loadStoredQuote(attemptKey: string): CheckoutQuote | null {
    const row = db
      .prepare("SELECT quote_json FROM checkout_attempt_quotes WHERE attempt_key = ?")
      .get(attemptKey) as { quote_json: string } | undefined;
    if (!row) {
      return null;
    }
    return JSON.parse(row.quote_json) as CheckoutQuote;
  }

  return {
    prepare(actor, input) {
      if (actor.role !== "CASHIER") {
        throw new ForbiddenError("Hanya CASHIER yang boleh menyiapkan checkout.");
      }
      const attemptKey = assertAttemptKey(input?.attemptKey);
      const shiftId = assertPositiveInt(input?.shiftId, "shiftId");
      const requestedItems = parsePrepareItems(input?.items);
      const paymentObj =
        typeof input?.payment === "object" && input.payment !== null && !Array.isArray(input.payment)
          ? (input.payment as Record<string, unknown>)
          : null;
      if (!paymentObj) {
        throw new ValidationError("payment wajib berupa objek { method }.", "payment");
      }
      const paymentMethod = assertPaymentMethod(paymentObj.method, "payment.method");

      return withImmediateTransaction(() => {
        assertActiveCashier(actor);

        const existingAttempt = db
          .prepare(
            `SELECT attempt_key, shift_id, cashier_id, request_hash, prepared_at_ms, abandoned_at_ms
             FROM checkout_attempts WHERE attempt_key = ?`,
          )
          .get(attemptKey) as AttemptRow | undefined;

        if (existingAttempt) {
          if (Number(existingAttempt.cashier_id) !== actor.userId) {
            throw new ForbiddenError("Akses attemptKey ditolak.");
          }
          if (existingAttempt.abandoned_at_ms !== null) {
            throw new AttemptAbandonedError();
          }
          const committed = loadCommittedResult(existingAttempt);
          if (committed) {
            throw new IdempotencyConflictError(
              "attemptKey sudah di-commit. Gunakan GET /checkouts/:attemptKey untuk memeriksa hasil.",
            );
          }
          const storedQuote = loadStoredQuote(attemptKey);
          const intentMatches =
            storedQuote !== null &&
            storedQuote.shiftId === shiftId &&
            storedQuote.payment.method === paymentMethod &&
            storedQuote.items.length === requestedItems.length &&
            storedQuote.items.every(
              (item, index) =>
                item.productId === requestedItems[index]!.productId &&
                item.quantity === requestedItems[index]!.quantity,
            );
          if (!intentMatches || storedQuote === null) {
            throw new IdempotencyConflictError();
          }
          return {
            attemptKey,
            requestHash: Buffer.from(existingAttempt.request_hash).toString("hex"),
            status: "PREPARED",
            quote: storedQuote,
          };
        }

        const shift = db
          .prepare("SELECT id, cashier_id, closed_at_ms FROM shifts WHERE id = ?")
          .get(shiftId) as { id: number; cashier_id: number; closed_at_ms: number | null } | undefined;
        if (!shift || Number(shift.cashier_id) !== actor.userId || shift.closed_at_ms !== null) {
          throw new ShiftNotActiveError();
        }

        const quoteItems: CheckoutQuoteItem[] = [];
        let totalRp = 0;

        for (const item of requestedItems) {
          const product = db
            .prepare("SELECT id, sku, name, price_rp, active FROM products WHERE id = ?")
            .get(item.productId) as
            | { id: number; sku: string; name: string; price_rp: number; active: number }
            | undefined;
          if (!product) {
            throw new NotFoundError(`Produk ${item.productId} tidak ditemukan.`);
          }
          if (Number(product.active) !== 1) {
            throw new ValidationError(`Produk "${product.sku}" tidak aktif.`, "items");
          }
          const balance = getStockBalance(db, item.productId);
          const onHand = balance?.onHand ?? 0;
          if (onHand < item.quantity) {
            throw new InsufficientStockError(
              `Stok "${product.sku}" tidak cukup: saldo ${onHand}, diminta ${item.quantity}.`,
            );
          }
          const unitPriceRp = Number(product.price_rp);
          const lineTotalRp = item.quantity * unitPriceRp;
          if (!Number.isSafeInteger(lineTotalRp)) {
            throw new ValidationError("Subtotal melebihi batas integer aman.", "items");
          }
          totalRp += lineTotalRp;
          if (!Number.isSafeInteger(totalRp)) {
            throw new ValidationError("Total belanja melebihi batas integer aman.", "items");
          }
          quoteItems.push({
            productId: Number(product.id),
            sku: String(product.sku),
            name: String(product.name),
            quantity: item.quantity,
            unitPriceRp,
            lineTotalRp,
          });
        }

        const quote: CheckoutQuote = {
          shiftId,
          cashierId: actor.userId,
          items: quoteItems,
          totalRp,
          payment: { method: paymentMethod },
        };
        const { hex: requestHash, bytes: hashBytes } = computeCheckoutHash(quote);

        const preparedAtMs = now();
        db.prepare(
          `INSERT INTO checkout_attempts (attempt_key, shift_id, cashier_id, request_hash, prepared_at_ms)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(attemptKey, shiftId, actor.userId, hashBytes, preparedAtMs);

        db.prepare(
          `INSERT INTO checkout_attempt_quotes (attempt_key, quote_json)
           VALUES (?, ?)`,
        ).run(attemptKey, JSON.stringify(quote));

        return {
          attemptKey,
          requestHash,
          status: "PREPARED",
          quote,
        };
      });
    },

    commit(actor, input) {
      if (actor.role !== "CASHIER") {
        throw new ForbiddenError("Hanya CASHIER yang boleh mengonfirmasi checkout.");
      }
      const attemptKey = assertAttemptKey(input?.attemptKey);
      const requestHash = assertRequestHash(input?.requestHash);
      const paymentConf = parsePaymentConfirmation(input?.paymentConfirmation);
      const requestHashBytes = Buffer.from(requestHash, "hex");

      return withImmediateTransaction(() => {
        assertActiveCashier(actor);

        const attempt = db
          .prepare(
            `SELECT attempt_key, shift_id, cashier_id, request_hash, prepared_at_ms, abandoned_at_ms
             FROM checkout_attempts WHERE attempt_key = ?`,
          )
          .get(attemptKey) as AttemptRow | undefined;
        if (!attempt) {
          throw new NotFoundError("attemptKey checkout tidak ditemukan.");
        }
        if (Number(attempt.cashier_id) !== actor.userId) {
          throw new ForbiddenError("Akses attemptKey ditolak.");
        }
        if (Buffer.compare(Buffer.from(attempt.request_hash), requestHashBytes) !== 0) {
          throw new IdempotencyConflictError();
        }

        // Idempotency retry: jika sudah COMMITTED, kembalikan hasil asli
        // meskipun shift sudah ditutup (POS-04.01 / AGENTS.md §7).
        const committed = loadCommittedResult(attempt);
        if (committed) {
          if (committed.payment.method !== paymentConf.method) {
            throw new IdempotencyConflictError(
              "Metode pembayaran berbeda dengan transaksi yang sudah tersimpan.",
            );
          }
          return committed;
        }

        if (attempt.abandoned_at_ms !== null) {
          throw new AttemptAbandonedError();
        }

        const shift = db
          .prepare("SELECT id, cashier_id, closed_at_ms FROM shifts WHERE id = ?")
          .get(attempt.shift_id) as
          | { id: number; cashier_id: number; closed_at_ms: number | null }
          | undefined;
        if (
          !shift ||
          Number(shift.cashier_id) !== actor.userId ||
          shift.closed_at_ms !== null
        ) {
          throw new ShiftNotActiveError();
        }

        const quote = loadStoredQuote(attemptKey);
        if (!quote) {
          throw new CheckoutError(
            "CONFLICT",
            409,
            "Snapshot quote checkout tidak ditemukan; lakukan prepare ulang.",
          );
        }
        if (quote.payment.method !== paymentConf.method) {
          throw new IdempotencyConflictError(
            "Metode pembayaran tidak sesuai dengan quote yang disiapkan.",
          );
        }
        const recomputed = computeCheckoutHash(quote);
        if (Buffer.compare(recomputed.bytes, Buffer.from(attempt.request_hash)) !== 0) {
          throw new IdempotencyConflictError();
        }

        // Validasi ulang setiap item: aktif, harga belum berubah, stok cukup.
        for (const item of quote.items) {
          const product = db
            .prepare("SELECT id, sku, name, price_rp, active FROM products WHERE id = ?")
            .get(item.productId) as
            | { id: number; sku: string; name: string; price_rp: number; active: number }
            | undefined;
          if (!product) {
            throw new NotFoundError(`Produk ${item.productId} tidak ditemukan.`);
          }
          if (Number(product.active) !== 1) {
            throw new CheckoutError("CONFLICT", 409, `Produk "${product.sku}" sudah dinonaktifkan.`);
          }
          if (Number(product.price_rp) !== item.unitPriceRp) {
            throw new PriceChangedError(
              `Harga "${product.sku}" berubah dari Rp${item.unitPriceRp} menjadi Rp${Number(product.price_rp)}. Buat quote baru.`,
            );
          }
          const balance = getStockBalance(db, item.productId);
          const onHand = balance?.onHand ?? 0;
          if (onHand < item.quantity) {
            throw new InsufficientStockError(
              `Stok "${product.sku}" tidak cukup: saldo ${onHand}, diminta ${item.quantity}.`,
            );
          }
        }

        // Validasi nominal pembayaran.
        let cashReceivedRp: number | null = null;
        let changeRp: number | null = null;
        let verifiedBy: number | null = null;
        let verifiedAtMs: number | null = null;
        const committedAtMs = now();

        if (paymentConf.method === "CASH") {
          if (paymentConf.cashReceivedRp < quote.totalRp) {
            throw new ValidationError(
              `Nominal tunai (${paymentConf.cashReceivedRp}) kurang dari total belanja (${quote.totalRp}).`,
              "paymentConfirmation.cashReceivedRp",
            );
          }
          cashReceivedRp = paymentConf.cashReceivedRp;
          changeRp = paymentConf.cashReceivedRp - quote.totalRp;
        } else {
          if (paymentConf.confirmedAmountRp !== quote.totalRp) {
            throw new ValidationError(
              `Nominal konfirmasi QRIS (${paymentConf.confirmedAmountRp}) tidak sama dengan total belanja (${quote.totalRp}).`,
              "paymentConfirmation.confirmedAmountRp",
            );
          }
          changeRp = 0;
          verifiedBy = actor.userId;
          verifiedAtMs = committedAtMs;
        }

        const nextSeqRow = db
          .prepare("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM sales")
          .get() as { next_id: number };
        const saleNo = `S-${String(Number(nextSeqRow.next_id)).padStart(6, "0")}`;

        const saleInsert = db
          .prepare(
            `INSERT INTO sales (sale_no, attempt_key, committed_at_ms, total_rp)
             VALUES (?, ?, ?, ?)`,
          )
          .run(saleNo, attemptKey, committedAtMs, quote.totalRp);
        const saleId = Number(saleInsert.lastInsertRowid);

        const insertItem = db.prepare(
          `INSERT INTO sale_items
             (sale_id, product_id, sku_snapshot, name_snapshot, quantity, unit_price_rp, line_total_rp)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        const insertMovement = db.prepare(
          `INSERT INTO inventory_movements
             (product_id, kind, delta, sale_item_id, actor_id, created_at_ms)
           VALUES (?, 'SALE', ?, ?, ?, ?)`,
        );

        for (const item of quote.items) {
          const itemInsert = insertItem.run(
            saleId,
            item.productId,
            item.sku,
            item.name,
            item.quantity,
            item.unitPriceRp,
            item.lineTotalRp,
          );
          const saleItemId = Number(itemInsert.lastInsertRowid);
          insertMovement.run(
            item.productId,
            -item.quantity,
            saleItemId,
            actor.userId,
            committedAtMs,
          );
        }

        db.prepare(
          `INSERT INTO payments
             (sale_id, method_code, amount_rp, evidence_ref, verified_by, verified_at_ms)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          saleId,
          paymentConf.method,
          quote.totalRp,
          paymentConf.method === "QRIS_MANUAL" ? paymentConf.evidenceRef : null,
          verifiedBy,
          verifiedAtMs,
        );

        db.prepare(
          `UPDATE checkout_attempt_quotes
           SET cash_received_rp = ?, change_rp = ?
           WHERE attempt_key = ?`,
        ).run(cashReceivedRp, changeRp, attemptKey);

        writeCheckoutAudit(db, {
          actorId: actor.userId,
          action: "CHECKOUT_COMMITTED",
          entityType: "sales",
          entityId: saleId,
          details: {
            saleNo,
            attemptKey,
            shiftId: quote.shiftId,
            totalRp: quote.totalRp,
            paymentMethod: paymentConf.method,
            itemCount: quote.items.length,
          },
          nowMs: committedAtMs,
        });

        return {
          saleId,
          saleNo,
          attemptKey,
          requestHash,
          status: "COMMITTED",
          totalRp: quote.totalRp,
          committedAtMs,
          payment: {
            method: paymentConf.method,
            amountRp: quote.totalRp,
            cashReceivedRp,
            changeRp,
            verifiedBy,
            verifiedAtMs,
          },
        };
      });
    },

    getStatus(actor, attemptKeyInput) {
      assertActiveUser(actor);
      const attemptKey = assertAttemptKey(attemptKeyInput);
      const attempt = db
        .prepare(
          `SELECT attempt_key, shift_id, cashier_id, request_hash, prepared_at_ms, abandoned_at_ms
           FROM checkout_attempts WHERE attempt_key = ?`,
        )
        .get(attemptKey) as AttemptRow | undefined;
      if (!attempt) {
        throw new NotFoundError("attemptKey checkout tidak ditemukan.");
      }
      if (actor.role === "CASHIER" && Number(attempt.cashier_id) !== actor.userId) {
        throw new ForbiddenError("Akses attemptKey ditolak.");
      }

      const committed = loadCommittedResult(attempt);
      if (committed) {
        return committed;
      }
      if (attempt.abandoned_at_ms !== null) {
        return {
          attemptKey: String(attempt.attempt_key),
          requestHash: Buffer.from(attempt.request_hash).toString("hex"),
          status: "ABANDONED",
          abandonedAtMs: Number(attempt.abandoned_at_ms),
        };
      }
      return {
        attemptKey: String(attempt.attempt_key),
        requestHash: Buffer.from(attempt.request_hash).toString("hex"),
        status: "PREPARED",
        quote: loadStoredQuote(attemptKey),
      };
    },
  };
}

