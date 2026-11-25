import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { buildDemoSalePayload, sendDemoPayload } from "./sheetsProtocol.ts";
import { databaseBinding, readDemoConfig } from "./sheetsDemoConfig.ts";
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

export type SheetsSyncFlushResult = {
  enabled: boolean;
  sentCount: number;
  pendingCount: number;
};

export type SheetsSyncFlushOptions = {
  maxItems?: number;
};

export type SheetsSyncService = {
  readonly enabled: boolean;
  notifySaleCommitted(result: CommitCheckoutResult, cashierUsername: string): void;
  flush(): Promise<void>;
  syncNow(options?: SheetsSyncFlushOptions): Promise<SheetsSyncFlushResult>;
  stop(): void;
  getPendingCount(): number;
};

export type SheetsSyncOptions = {
  db: DatabaseSync;
  dbPath?: string;
  configPath?: string;
  demoOnly?: boolean;
  queuePath?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
};

const MAX_SENT_KEYS = 5000;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const DEFAULT_RETRY_BASE_DELAY_MS = 5_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 300_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
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
    if (url.protocol !== "https:") {
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
        `SELECT name_snapshot AS name, quantity
         FROM sale_items
         WHERE sale_id = ?
         ORDER BY id ASC`,
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

function readDurableAckKeys(ackPath: string): Set<string> {
  const keys = new Set<string>();
  try {
    if (!existsSync(ackPath)) {
      return keys;
    }
    const raw = readFileSync(ackPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        keys.add(trimmed);
      }
    }
  } catch {
    return keys;
  }
  return keys;
}

function appendDurableAckKey(ackPath: string, attemptKey: string): void {
  mkdirSync(path.dirname(ackPath), { recursive: true });
  appendFileSync(ackPath, `${attemptKey}\n`, "utf8");
}

function reconcileCommittedSales(
  db: DatabaseSync,
  current: QueueState,
  durableAckKeys: Set<string>,
  afterSaleId = 0,
): { state: QueueState; recovered: boolean } {
  try {
    const rows = db
      .prepare(
        `SELECT s.id AS sale_id, s.sale_no, s.attempt_key, s.total_rp, s.committed_at_ms,
                p.method_code AS method, u.username AS cashier
         FROM sales s
         JOIN payments p ON p.sale_id = s.id
         JOIN checkout_attempts ca ON ca.attempt_key = s.attempt_key
         JOIN users u ON u.id = ca.cashier_id
         WHERE s.id > ?
         GROUP BY s.id
         ORDER BY s.committed_at_ms ASC, s.id ASC`,
      )
      .all(afterSaleId) as Array<{
      sale_id: number;
      sale_no: string;
      attempt_key: string;
      total_rp: number;
      committed_at_ms: number;
      method: string;
      cashier: string;
    }>;

    const knownKeys = new Set<string>([
      ...durableAckKeys,
      ...current.sentKeys,
      ...current.pending.map((item) => item.attemptKey),
    ]);
    const missing: QueuedSaleSync[] = [];
    for (const row of rows) {
      const attemptKey = String(row.attempt_key);
      if (knownKeys.has(attemptKey)) {
        continue;
      }
      knownKeys.add(attemptKey);
      missing.push({
        attemptKey,
        saleNo: String(row.sale_no),
        totalRp: Number(row.total_rp),
        method: String(row.method),
        cashier: String(row.cashier),
        committedAtMs: Number(row.committed_at_ms),
        items: formatItemsSummary(db, Number(row.sale_id), attemptKey),
      });
    }
    if (missing.length === 0) {
      return { state: current, recovered: false };
    }
    return {
      state: {
        pending: [...current.pending, ...missing],
        sentKeys: current.sentKeys,
      },
      recovered: true,
    };
  } catch {
    return { state: current, recovered: false };
  }
}

export function createSheetsSyncService(options: SheetsSyncOptions): SheetsSyncService {
  const demo = options.demoOnly ? readDemoConfig(options.configPath ?? resolveDefaultSheetsConfigPath()) : null;
  let bindingMatches = false;
  try { bindingMatches = !!demo && !!options.dbPath && demo.dbBinding === databaseBinding(options.dbPath); } catch { bindingMatches = false; }
  const activeDemo = demo && bindingMatches ? demo : null;
  const config = options.demoOnly ? activeDemo : loadSheetsSyncConfig(options.configPath);
  const queuePath = activeDemo && options.dbPath ? path.join(path.dirname(path.resolve(options.dbPath)), `sheets-sync-${activeDemo.databaseNamespace}-${activeDemo.targetId}.json`) : options.demoOnly ? null :
    options.queuePath ??
    (options.dbPath ? path.join(path.dirname(path.resolve(options.dbPath)), "sheets-sync-queue.json") : null);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const retryMaxDelayMs = options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;

  if (!config || !queuePath) {
    return {
      enabled: false,
      notifySaleCommitted() {},
      async flush() {},
      async syncNow() {
        return { enabled: false, sentCount: 0, pendingCount: 0 };
      },
      stop() {},
      getPendingCount() {
        return 0;
      },
    };
  }

  const ackPath = `${queuePath}.ack.ndjson`;
  const durableAckKeys = readDurableAckKeys(ackPath);
  const loadedState = readQueueState(queuePath);
  for (const key of loadedState.sentKeys) {
    durableAckKeys.add(key);
  }
  const filteredPending = loadedState.pending.filter(
    (item) => !durableAckKeys.has(item.attemptKey),
  );
  const prunedPending = filteredPending.length !== loadedState.pending.length;
  let state: QueueState = prunedPending
    ? { pending: filteredPending, sentKeys: loadedState.sentKeys }
    : loadedState;
  const reconciled = reconcileCommittedSales(options.db, state, durableAckKeys, activeDemo?.afterSaleId ?? 0);
  if (reconciled.recovered || prunedPending) {
    state = reconciled.state;
    try {
      writeQueueState(queuePath, state);
    } catch {
    }
  }

  let activeFlush: Promise<void> | null = null;
  let inFlightItem: Promise<void> | null = null;
  let flushRequestedAgain = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let consecutiveFailures = 0;
  let stopped = false;

  function clearRetryTimer(): void {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleRetry(): void {
    if (stopped || state.pending.length === 0) {
      return;
    }
    clearRetryTimer();
    const exp = Math.min(20, Math.max(0, consecutiveFailures - 1));
    const delayMs = Math.min(retryMaxDelayMs, retryBaseDelayMs * 2 ** exp);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!stopped && state.pending.length > 0) {
        void flush();
      }
    }, delayMs);
    retryTimer.unref?.();
  }

  async function postOne(item: QueuedSaleSync): Promise<boolean> {
    if (!config) return false;
    if (activeDemo) return sendDemoPayload(activeDemo.webhookUrl, buildDemoSalePayload(activeDemo.secret, activeDemo.databaseNamespace, item), fetchImpl);
    try {
      let currentUrl = config.webhookUrl;
      let method: "POST" | "GET" = "POST";
      const payload = JSON.stringify({
        secret: config.secret,
        saleNo: item.saleNo,
        totalRp: item.totalRp,
        method: item.method,
        cashier: item.cashier,
        committedAtMs: item.committedAtMs,
        items: item.items,
      });

      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        const parsedCurrent = new URL(currentUrl);
        if (parsedCurrent.protocol !== "https:") {
          return false;
        }
        const response = await fetchImpl(currentUrl, {
          method,
          ...(method === "POST"
            ? {
                headers: { "Content-Type": "application/json" },
                body: payload,
              }
            : {}),
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (REDIRECT_STATUSES.has(response.status)) {
          if (hop === MAX_REDIRECTS) {
            return false;
          }
          const location = response.headers.get("location");
          if (!location) {
            return false;
          }
          const nextUrl = new URL(location, currentUrl);
          if (nextUrl.protocol !== "https:") {
            return false;
          }
          if (response.status === 301 || response.status === 302 || response.status === 303) {
            method = "GET";
          }
          currentUrl = nextUrl.toString();
          continue;
        }

        if (!response.ok) {
          return false;
        }
        const data = (await response.json()) as unknown;
        return Boolean(data && typeof data === "object" && (data as { ok?: unknown }).ok === true);
      }
      return false;
    } catch {
      return false;
    }
  }

  async function drainQueue(maxItems?: number): Promise<void> {
    let processed = 0;
    while (!stopped && state.pending.length > 0) {
      if (maxItems !== undefined && processed >= maxItems) {
        scheduleRetry();
        break;
      }
      const next = state.pending[0]!;
      let delivered = false;
      const attempt = (async () => {
        delivered = await postOne(next);
      })();
      inFlightItem = attempt;
      try {
        await attempt;
      } finally {
        if (inFlightItem === attempt) {
          inFlightItem = null;
        }
      }
      processed += 1;
      if (!delivered) {
        consecutiveFailures += 1;
        scheduleRetry();
        break;
      }
      consecutiveFailures = 0;
      clearRetryTimer();
      durableAckKeys.add(next.attemptKey);
      try {
        appendDurableAckKey(ackPath, next.attemptKey);
      } catch {
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
    if (state.pending.length === 0) {
      consecutiveFailures = 0;
      clearRetryTimer();
    }
  }

  function flush(maxItems?: number): Promise<void> {
    if (stopped) {
      return Promise.resolve();
    }
    if (activeFlush) {
      flushRequestedAgain = true;
      return activeFlush;
    }
    activeFlush = (async () => {
      try {
        do {
          flushRequestedAgain = false;
          await drainQueue(maxItems);
        } while (!stopped && flushRequestedAgain && state.pending.length > 0 && maxItems === undefined);
      } finally {
        const shouldContinueBackground =
          !stopped && flushRequestedAgain && state.pending.length > 0 && maxItems !== undefined;
        activeFlush = null;
        if (shouldContinueBackground) {
          flushRequestedAgain = false;
          void flush();
        }
      }
    })();
    return activeFlush;
  }

  function notifySaleCommitted(result: CommitCheckoutResult, cashierUsername: string): void {
    if (activeDemo && result.saleId <= activeDemo.afterSaleId) return;
    const alreadySent =
      durableAckKeys.has(result.attemptKey) || state.sentKeys.includes(result.attemptKey);
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
        // Jangan pernah melempar error ke jalur checkout; rekonsiliasi startup memulihkan dari SQLite.
      }
    }
    consecutiveFailures = 0;
    clearRetryTimer();
    void flush();
  }

  async function syncNow(syncOptions?: SheetsSyncFlushOptions): Promise<SheetsSyncFlushResult> {
    const beforeAckCount = durableAckKeys.size;
    const maxItems = syncOptions?.maxItems;
    if (maxItems !== undefined && activeFlush) {
      if (inFlightItem) {
        await inFlightItem;
      } else {
        await activeFlush;
      }
    } else {
      await flush(maxItems);
    }
    return {
      enabled: true,
      sentCount: Math.max(0, durableAckKeys.size - beforeAckCount),
      pendingCount: state.pending.length,
    };
  }

  function stop(): void {
    stopped = true;
    clearRetryTimer();
  }

  return {
    enabled: true,
    notifySaleCommitted,
    flush,
    syncNow,
    stop,
    getPendingCount() {
      return state.pending.length;
    },
  };
}
