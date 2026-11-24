import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { CommitCheckoutResult } from "../checkout/types.ts";

export type SheetsSyncConfig = {
  webhookUrl: string;
  secret: string;
};

export type QueuedSaleSync = {
  attemptKey: string;
  saleNo: string;
  totalRp: number;
  method: string;
  cashier: string;
  committedAtMs: number;
  items: string;
};

type QueueState = {
  pending: QueuedSaleSync[];
  sentKeys: string[];
};

export type SheetsSyncService = {
  readonly enabled: boolean;
  notifySaleCommitted(result: CommitCheckoutResult, cashierUsername: string): void;
  flush(): Promise<void>;
  getPendingCount(): number;
};

export type SheetsSyncOptions = {
  db: DatabaseSync;
  dbPath?: string;
  configPath?: string;
  queuePath?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const MAX_SENT_KEYS = 5000;
const DEFAULT_TIMEOUT_MS = 10_000;
const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function resolveDefaultSheetsConfigPath(): string {
  const override = process.env.POS_SHEETS_SYNC_CONFIG?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(BACKEND_ROOT, "config", "sheets-sync.json");
}

export function loadSheetsSyncConfig(configPath = resolveDefaultSheetsConfigPath()): SheetsSyncConfig | null {
  try {
    if (!existsSync(configPath)) {
      return null;
    }
    const raw = readFileSync(configPath, "utf8").trim();
    if (raw.length === 0) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const webhookUrl = typeof record.webhookUrl === "string" ? record.webhookUrl.trim() : "";
    const secret = typeof record.secret === "string" ? record.secret.trim() : "";
    if (webhookUrl.length === 0 || secret.length === 0) {
      return null;
    }
    let url: URL;
    try {
      url = new URL(webhookUrl);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    return { webhookUrl: url.toString(), secret };
  } catch {
    return null;
  }
}

function readQueueState(queuePath: string): QueueState {
  try {
    if (!existsSync(queuePath)) {
      return { pending: [], sentKeys: [] };
    }
    const raw = readFileSync(queuePath, "utf8").trim();
    if (raw.length === 0) {
      return { pending: [], sentKeys: [] };
    }
    const parsed = JSON.parse(raw) as Partial<QueueState>;
    const pending = Array.isArray(parsed.pending)
      ? parsed.pending.filter(
          (item): item is QueuedSaleSync =>
            Boolean(item) &&
            typeof item === "object" &&
            typeof item.attemptKey === "string" &&
            item.attemptKey.length > 0 &&
            typeof item.saleNo === "string" &&
            typeof item.totalRp === "number" &&
            typeof item.method === "string" &&
            typeof item.cashier === "string" &&
            typeof item.committedAtMs === "number" &&
            typeof item.items === "string",
        )
      : [];
    const sentKeys = Array.isArray(parsed.sentKeys)
      ? parsed.sentKeys.filter((key): key is string => typeof key === "string" && key.length > 0)
      : [];
    return { pending, sentKeys: sentKeys.slice(-MAX_SENT_KEYS) };
  } catch {
    return { pending: [], sentKeys: [] };
  }
}

function writeQueueState(queuePath: string, state: QueueState): void {
  const dir = path.dirname(queuePath);
  mkdirSync(dir, { recursive: true });
  const tempPath = `${queuePath}.tmp`;
  writeFileSync(
    tempPath,
    JSON.stringify({
      pending: state.pending,
      sentKeys: state.sentKeys.slice(-MAX_SENT_KEYS),
    }),
    "utf8",
  );
  renameSync(tempPath, queuePath);
}

function formatItemsSummary(db: DatabaseSync, saleId: number, attemptKey: string): string {
  try {
    const rows = db
      .prepare(
        `SELECT p.name AS name, si.quantity AS quantity
         FROM sale_items si
         JOIN products p ON p.id = si.product_id
         WHERE si.sale_id = ?
         ORDER BY si.id ASC`,
      )
      .all(saleId) as Array<{ name: string; quantity: number }>;
    if (rows.length > 0) {
      return rows.map((row) => `${String(row.name)} x ${Number(row.quantity)}`).join(", ");
    }
  } catch {
    // Fallback ke quote tersimpan jika query sale_items gagal.
  }
  try {
    const quoteRow = db
      .prepare("SELECT quote_json FROM checkout_attempt_quotes WHERE attempt_key = ?")
      .get(attemptKey) as { quote_json: string } | undefined;
    if (quoteRow) {
      const parsed = JSON.parse(quoteRow.quote_json) as {
        items?: Array<{ name?: string; quantity?: number }>;
      };
      if (Array.isArray(parsed.items)) {
        return parsed.items
          .filter((item) => typeof item.name === "string" && typeof item.quantity === "number")
          .map((item) => `${item.name} x ${item.quantity}`)
          .join(", ");
      }
    }
  } catch {
    // Abaikan jika quote tidak tersedia.
  }
  return "";
}

export function createSheetsSyncService(options: SheetsSyncOptions): SheetsSyncService {
  const config = loadSheetsSyncConfig(options.configPath);
  const queuePath =
    options.queuePath ??
    (options.dbPath ? path.join(path.dirname(path.resolve(options.dbPath)), "sheets-sync-queue.json") : null);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!config || !queuePath) {
    return {
      enabled: false,
      notifySaleCommitted() {},
      async flush() {},
      getPendingCount() {
        return 0;
      },
    };
  }

  let state = readQueueState(queuePath);
  let activeFlush: Promise<void> | null = null;
  let flushRequestedAgain = false;

  async function postOne(item: QueuedSaleSync): Promise<boolean> {
    if (!config) return false;
    try {
      const response = await fetchImpl(config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: config.secret,
          saleNo: item.saleNo,
          totalRp: item.totalRp,
          method: item.method,
          cashier: item.cashier,
          committedAtMs: item.committedAtMs,
          items: item.items,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        return false;
      }
      const data = (await response.json()) as unknown;
      return Boolean(data && typeof data === "object" && (data as { ok?: unknown }).ok === true);
    } catch {
      return false;
    }
  }

  async function drainQueue(): Promise<void> {
    while (state.pending.length > 0) {
      const next = state.pending[0]!;
      const delivered = await postOne(next);
      if (!delivered) {
        break;
      }
      state = {
        pending: state.pending.slice(1),
        sentKeys: [...state.sentKeys, next.attemptKey].slice(-MAX_SENT_KEYS),
      };
      try {
        writeQueueState(queuePath!, state);
      } catch {
        // Kegagalan tulis antrean tidak boleh membatalkan transaksi yang sudah selesai.
      }
    }
  }

  function flush(): Promise<void> {
    if (activeFlush) {
      flushRequestedAgain = true;
      return activeFlush;
    }
    activeFlush = (async () => {
      try {
        do {
          flushRequestedAgain = false;
          await drainQueue();
        } while (flushRequestedAgain && state.pending.length > 0);
      } finally {
        activeFlush = null;
      }
    })();
    return activeFlush;
  }

  function notifySaleCommitted(result: CommitCheckoutResult, cashierUsername: string): void {
    const alreadySent = state.sentKeys.includes(result.attemptKey);
    const alreadyPending = state.pending.some((item) => item.attemptKey === result.attemptKey);
    if (!alreadySent && !alreadyPending) {
      const entry: QueuedSaleSync = {
        attemptKey: result.attemptKey,
        saleNo: result.saleNo,
        totalRp: result.totalRp,
        method: result.payment.method,
        cashier: cashierUsername,
        committedAtMs: result.committedAtMs,
        items: formatItemsSummary(options.db, result.saleId, result.attemptKey),
      };
      state = {
        pending: [...state.pending, entry],
        sentKeys: state.sentKeys,
      };
      try {
        writeQueueState(queuePath!, state);
      } catch {
        // Jangan pernah melempar error ke jalur checkout.
      }
    }
    void flush();
  }

  return {
    enabled: true,
    notifySaleCommitted,
    flush,
    getPendingCount() {
      return state.pending.length;
    },
  };
}
