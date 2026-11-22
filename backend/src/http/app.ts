import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { backupRootFor, createBackup, verifyBackup, restoreBackupToTestCopy } from "../backup/service.ts";
import type { AuthService } from "../auth/service.ts";
import { AuthError, InvalidCredentialsError, ValidationError } from "../auth/errors.ts";
import type { Role, SessionStore, SessionUser } from "../auth/session.ts";
import { CatalogError } from "../catalog/errors.ts";
import type { CatalogService } from "../catalog/service.ts";
import type {
  Actor,
  CreateCategoryInput,
  CreateProductInput,
  CreateSupplierInput,
  UpdateProductInput,
} from "../catalog/types.ts";
import {
  createLoginRateLimiter,
  DEFAULT_LOGIN_IP_MAX_ATTEMPTS,
  LoginRateLimitError,
  type LoginRateLimiter,
} from "../security/loginRateLimiter.ts";
import type { SecurityLogger } from "../security/securityLog.ts";
import type { ShiftService } from "../shift/service.ts";
import { ShiftError } from "../shift/errors.ts";
import { CheckoutError } from "../checkout/errors.ts";
import type { CheckoutService } from "../checkout/service.ts";
import { PrintError } from "../print/errors.ts";
import type { PrintService } from "../print/service.ts";
import type { ReportService } from "../reports/service.ts";
import { InventoryError } from "../inventory/errors.ts";
import type { AdjustmentService } from "../inventory/adjustments.ts";
import { ReceivingError } from "../receiving/errors.ts";
import type { ReceivingService } from "../receiving/service.ts";

/**
 * Server HTTP loopback dengan dependensi nol. Ini adapter tipis, bukan
 * pengganti Express: TECH_STACK.md mencantumkan Express sebagai kandidat
 * (DEC-010) dan mengizinkan revisi. Adapter ini menjalankan aturan yang sama
 * (JSON, batas ukuran, Host/Origin loopback, sesi, RBAC per handler) agar
 * TASK-009 bisa diuji end-to-end tanpa dependensi native/CDN.
 */

export type HttpAppOptions = {
  backupDbPath?: string;
  backupEnv?: NodeJS.ProcessEnv;
  auth: AuthService;
  sessions: SessionStore;
  securityLog: SecurityLogger;
  /** Service katalog TASK-010; bila tidak diisi, route katalog tidak aktif. */
  catalog?: CatalogService;
  /** Service shift TASK-014; bila tidak diisi, route shift tidak aktif. */
  shift?: ShiftService;
  /** Service checkout TASK-016; bila tidak diisi, route checkout tidak aktif. */
  checkout?: CheckoutService;
  /** Laporan pembayaran: ADMIN semua, CASHIER transaksi sendiri. */
  reports?: ReportService;
  /** Service struk/cetak ulang TASK-021; POST hanya CASHIER pemilik sale. */
  print?: PrintService;
  /** Service penerimaan barang TASK-025; ADMIN saja. */
  receiving?: ReceivingService;
  /** Koreksi stok TASK-039; ADMIN, kunci retry dan audit atomik. */
  adjustments?: AdjustmentService;
  loginRateLimiter?: LoginRateLimiter;
  loginIpRateLimiter?: LoginRateLimiter;
  now?: () => number;
  maxBodyBytes?: number;
};

type RequestContext = {
  requestId: string;
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  headers: IncomingMessage["headers"];
  remoteAddress: string;
  token: string | null;
  actor: SessionUser | null;
  params: Record<string, string>;
  body: unknown;
};

type HandlerResult = { status?: number; data?: unknown };
type Handler = (ctx: RequestContext) => unknown;
type Route = {
  method: string;
  pattern: RegExp;
  roles: readonly Role[] | null;
  handler: Handler;
};

const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i;
const LOOPBACK_ORIGIN = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i;

function asObject(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Body harus objek JSON.", "body");
  }
  return value as Record<string, unknown>;
}

function extractBearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") {
    return null;
  }
  const [scheme, ...rest] = header.split(" ");
  const value = rest.join(" ");
  if (scheme !== "Bearer" || value.length === 0) {
    return null;
  }
  return value;
}

function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
    if (!contentType.includes("application/json")) {
      reject(new ValidationError("Content-Type harus application/json.", "contentType"));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        if (!settled) {
          settled = true;
          reject(new ValidationError("Permintaan terlalu besar.", "body"));
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) {
        return;
      }
      settled = true;
      if (tooLarge) {
        reject(new ValidationError("Permintaan terlalu besar.", "body"));
        return;
      }
      if (size === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
      } catch {
        reject(new ValidationError("JSON tidak valid.", "body"));
      }
    });
    req.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(payload));
}

function sendError(res: ServerResponse, requestId: string, error: unknown): void {
  if (error instanceof AuthError) {
    if (error.retryAfterSeconds !== null) {
      res.setHeader("Retry-After", String(error.retryAfterSeconds));
    }
    sendJson(res, error.httpStatus, {
      error: {
        code: error.code,
        message: error.message,
        requestId,
        retryable: error.retryable,
      },
    });
    return;
  }
  if (error instanceof CatalogError) {
    // Pesan domain katalog sudah aman (tanpa SQL/stack) dan dipakai UI untuk
    // menampilkan konflik SKU/barcode atau validasi input.
    sendJson(res, error.httpStatus, {
      error: {
        code: error.code,
        message: error.message,
        requestId,
        field: error.field,
        retryable: false,
      },
    });
    return;
  }
  if (error instanceof ShiftError) {
    sendJson(res, error.httpStatus, {
      error: {
        code: error.code,
        message: error.message,
        requestId,
        retryable: false,
      },
    });
    return;
  }
  if (error instanceof CheckoutError) {
    sendJson(res, error.httpStatus, {
      error: {
        code: error.code,
        message: error.message,
        requestId,
        field: error.field,
        retryable: false,
      },
    });
    return;
  }
  if (error instanceof ReceivingError || error instanceof InventoryError) {
    sendJson(res, error.httpStatus, {
      error: {
        code: error.code,
        message: error.message,
        requestId,
        field: error.field,
        retryable: false,
      },
    });
    return;
  }
  if (error instanceof PrintError) {
    sendJson(res, error.httpStatus, {
      error: {
        code: error.code,
        message: error.message,
        requestId,
        retryable: error.retryable,
      },
    });
    return;
  }
  // Detail internal tidak pernah dikirim ke renderer (ERROR_HANDLING.md §1).
  sendJson(res, 500, {
    error: {
      code: "INTERNAL_ERROR",
      message: "Ada gangguan sistem.",
      requestId,
      retryable: false,
    },
  });
}

function catalogQuery(ctx: RequestContext) {
  const rawLimit = ctx.searchParams.get("limit");
  const limit =
    rawLimit === null || rawLimit.trim() === "" ? undefined : Number(rawLimit);
  const includeInactiveRaw = ctx.searchParams.get("includeInactive");
  return {
    query: ctx.searchParams.get("query") ?? undefined,
    barcode: ctx.searchParams.get("barcode") ?? undefined,
    // Parser boolean eksplisit: nilai lain dianggap false, bukan truthy.
    includeInactive: includeInactiveRaw === "true" || includeInactiveRaw === "1",
    limit,
  };
}

/**
 * Route katalog tipis di atas service TASK-010. `Actor` diambil dari sesi
 * terverifikasi, bukan body. Endpoint kategori/supplier belum tercantum di
 * API_CONTRACT (TASK-001 K-12); statusnya usulan yang dicatat di laporan
 * TASK-012, bukan kontrak final.
 */
function createCatalogRoutes(catalog: CatalogService): Route[] {
  const actorOf = (ctx: RequestContext): Actor => ctx.actor as Actor;
  return [
    {
      method: "GET",
      pattern: /^\/categories$/,
      roles: ["ADMIN", "CASHIER"],
      handler: (ctx) => ({ data: catalog.listCategories(actorOf(ctx)) }),
    },
    {
      method: "POST",
      pattern: /^\/categories$/,
      roles: ["ADMIN"],
      handler: (ctx) => ({
        status: 201,
        data: catalog.createCategory(actorOf(ctx), asObject(ctx.body) as unknown as CreateCategoryInput),
      }),
    },
    {
      method: "GET",
      pattern: /^\/suppliers$/,
      roles: ["ADMIN", "CASHIER"],
      handler: (ctx) => ({ data: catalog.listSuppliers(actorOf(ctx)) }),
    },
    {
      method: "POST",
      pattern: /^\/suppliers$/,
      roles: ["ADMIN"],
      handler: (ctx) => ({
        status: 201,
        data: catalog.createSupplier(actorOf(ctx), asObject(ctx.body) as unknown as CreateSupplierInput),
      }),
    },
    {
      method: "GET",
      pattern: /^\/products$/,
      roles: ["ADMIN", "CASHIER"],
      handler: (ctx) => ({ data: catalog.listProducts(actorOf(ctx), catalogQuery(ctx)) }),
    },
    {
      method: "POST",
      pattern: /^\/products$/,
      roles: ["ADMIN"],
      handler: (ctx) => ({
        status: 201,
        data: catalog.createProduct(actorOf(ctx), asObject(ctx.body) as unknown as CreateProductInput),
      }),
    },
    {
      method: "PATCH",
      pattern: /^\/products\/(?<id>\d+)$/,
      roles: ["ADMIN"],
      handler: (ctx) => ({
        data: catalog.updateProduct(
          actorOf(ctx),
          Number(ctx.params.id),
          asObject(ctx.body) as unknown as UpdateProductInput,
        ),
      }),
    },
    {
      method: "POST",
      pattern: /^\/products\/(?<id>\d+)\/suppliers$/,
      roles: ["ADMIN"],
      handler: (ctx) => {
        const body = asObject(ctx.body);
        if (!Array.isArray(body.supplierIds)) {
          throw new ValidationError("supplierIds harus berupa daftar ID.", "supplierIds");
        }
        return {
          data: catalog.setProductSuppliers(
            actorOf(ctx),
            Number(ctx.params.id),
            body.supplierIds as number[],
          ),
        };
      },
    },
    {
      method: "POST",
      pattern: /^\/products\/(?<id>\d+)\/barcodes$/,
      roles: ["ADMIN"],
      handler: (ctx) => ({
        status: 201,
        data: catalog.addBarcode(
          actorOf(ctx),
          Number(ctx.params.id),
          asObject(ctx.body).barcode as string,
        ),
      }),
    },
    {
      method: "DELETE",
      pattern: /^\/products\/(?<id>\d+)\/barcodes\/(?<barcode>[^/]+)$/,
      roles: ["ADMIN"],
      handler: (ctx) => {
        let barcode: string;
        try {
          barcode = decodeURIComponent(ctx.params.barcode ?? "");
        } catch {
          throw new ValidationError("Barcode pada URL tidak valid.", "barcode");
        }
        return {
          data: catalog.removeBarcode(actorOf(ctx), Number(ctx.params.id), barcode),
        };
      },
    },
  ];
}

/**
 * Route shift TASK-014. `POST /shifts/open` khusus CASHIER (ADMIN ditolak 403,
 * baseline konservatif AUTHORIZATION.md §3/SECURITY.md §4). `GET
 * /shifts/current` mengembalikan shift aktif milik kasir; kasir lain null.
 */
function createShiftRoutes(shift: ShiftService): Route[] {
  const actorOf = (ctx: RequestContext): SessionUser => ctx.actor as SessionUser;
  return [
    {
      method: "POST",
      pattern: /^\/shifts\/open$/,
      roles: ["CASHIER"],
      handler: (ctx) => ({ data: shift.openShift(actorOf(ctx), asObject(ctx.body)) }),
    },
    {
      method: "GET",
      pattern: /^\/shifts\/current$/,
      roles: ["ADMIN", "CASHIER"],
      handler: (ctx) => ({ data: shift.getCurrentShift(actorOf(ctx)) }),
    },
    {
      method: "GET",
      pattern: /^\/shifts\/(?<id>\d+)\/close\/preview$/,
      roles: ["CASHIER"],
      handler: (ctx) => ({ data: shift.getClosePreview(actorOf(ctx), Number(ctx.params.id)) }),
    },
    {
      method: "GET",
      pattern: /^\/shifts\/(?<id>\d+)\/close$/,
      roles: ["CASHIER"],
      handler: (ctx) => ({ data: shift.getClosing(actorOf(ctx), Number(ctx.params.id)) }),
    },
    {
      method: "POST",
      pattern: /^\/shifts\/(?<id>\d+)\/close$/,
      roles: ["CASHIER"],
      handler: (ctx) => ({
        data: shift.closeShift(actorOf(ctx), Number(ctx.params.id), asObject(ctx.body)),
      }),
    },
  ];
}

function createCheckoutRoutes(checkout: CheckoutService): Route[] {
  const actorOf = (ctx: RequestContext): SessionUser => ctx.actor as SessionUser;
  return [
    {
      method: "POST",
      pattern: /^\/checkouts\/prepare$/,
      roles: ["CASHIER"],
      handler: (ctx) => ({ data: checkout.prepare(actorOf(ctx), asObject(ctx.body)) }),
    },
    {
      method: "POST",
      pattern: /^\/checkouts\/commit$/,
      roles: ["CASHIER"],
      handler: (ctx) => ({ data: checkout.commit(actorOf(ctx), asObject(ctx.body)) }),
    },
    {
      method: "GET",
      pattern: /^\/checkouts\/([^/]+)$/,
      roles: ["ADMIN", "CASHIER"],
      handler: (ctx) => {
        let attemptKey: string;
        try {
          attemptKey = decodeURIComponent(ctx.params["1"] ?? "");
        } catch {
          throw new ValidationError("attemptKey pada URL tidak valid.", "attemptKey");
        }
        return { data: checkout.getStatus(actorOf(ctx), attemptKey) };
      },
    },
  ];
}

/** Route penerimaan barang TASK-025: ADMIN saja, receiptKey idempotent. */
function createReceivingRoutes(receiving: ReceivingService): Route[] {
  return [
    {
      method: "POST",
      pattern: /^\/goods-receipts$/,
      roles: ["ADMIN"],
      handler: (ctx) => ({
        status: 201,
        data: receiving.receiveGoods(ctx.actor as SessionUser, asObject(ctx.body)),
      }),
    },
  ];
}

/** Route laporan QRIS terpisah dari kas; ADMIN saja (DEC-014). */
function createReportRoutes(reports: ReportService): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/reports\/payments$/,
      roles: ["ADMIN", "CASHIER"],
      handler: (ctx) => ({ data: reports.getPaymentReport(ctx.actor as SessionUser) }),
    },
    {
      method: "GET",
      pattern: /^\/reports\/daily$/,
      roles: ["ADMIN"],
      handler: (ctx) => {
        const requiredBound = (raw: string | null, field: string): number | null => {
          if (raw === null) return null;
          if (raw.trim().length === 0) {
            throw new ValidationError(`${field} wajib diisi.`, field);
          }
          return Number(raw);
        };
        return {
          data: reports.getDailyReport(ctx.actor as SessionUser, {
            startMs: requiredBound(ctx.searchParams.get("start"), "start"),
            endMs: requiredBound(ctx.searchParams.get("end"), "end"),
            shiftId: ctx.searchParams.get("shiftId") ?? undefined,
          }),
        };
      },
    },
    {
      method: "GET",
      pattern: /^\/reports\/stock$/,
      roles: ["ADMIN"],
      handler: (ctx) => ({
        data: reports.getStockReport(ctx.actor as SessionUser, {
          lowStockThreshold: ctx.searchParams.get("lowStockThreshold") ?? undefined,
        }),
      }),
    },
  ];
}

/**
 * Route struk TASK-021. `GET` (baca/repratinjau) boleh ADMIN dan CASHIER,
 * tetapi `POST /print` HANYA CASHIER — sesuai AUTHORIZATION §3/AUTH-07 dan
 * audit TASK-001 K-03. Izin cetak ADMIN masih menunggu keputusan David;
 * jangan dibuka lewat route ini.
 */
function createPrintRoutes(print: PrintService): Route[] {
  const actorOf = (ctx: RequestContext): SessionUser => ctx.actor as SessionUser;
  return [
    {
      method: "GET",
      pattern: /^\/sales\/recent$/,
      roles: ["ADMIN", "CASHIER"],
      handler: (ctx) => ({ data: print.getRecentSales(actorOf(ctx)) }),
    },
    {
      method: "GET",
      pattern: /^\/sales\/(?<id>\d+)\/receipt$/,
      roles: ["ADMIN", "CASHIER"],
      handler: (ctx) => ({ data: print.getReceipt(actorOf(ctx), Number(ctx.params.id)) }),
    },
    {
      method: "POST",
      pattern: /^\/sales\/(?<id>\d+)\/print$/,
      roles: ["CASHIER"],
      handler: (ctx) => ({ data: print.print(actorOf(ctx), Number(ctx.params.id), ctx.body) }),
    },
  ];
}

export function createHttpApp(options: HttpAppOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const maxBodyBytes = options.maxBodyBytes ?? 64 * 1024;
  const { auth, sessions, securityLog } = options;
  const loginRateLimiter =
    options.loginRateLimiter ?? createLoginRateLimiter({ now: options.now });
  const loginIpRateLimiter =
    options.loginIpRateLimiter ??
    createLoginRateLimiter({
      maxAttempts: DEFAULT_LOGIN_IP_MAX_ATTEMPTS,
      now: options.now,
    });

  const routes: Route[] = [
    {
      method: "POST",
      pattern: /^\/auth\/login$/,
      roles: null,
      handler: (ctx) => {
        const payload = asObject(ctx.body) as { username?: unknown; password?: unknown };
        const normalizedUsername =
          typeof payload.username === "string" ? payload.username.trim().toLowerCase() : "";
        const ipKey = `ip:${ctx.remoteAddress}`;
        const rateLimitKey = `${ctx.remoteAddress}:${normalizedUsername}`;

        try {
          loginIpRateLimiter.assertAllowed(ipKey);
          loginRateLimiter.assertAllowed(rateLimitKey);
        } catch (error) {
          if (error instanceof LoginRateLimitError) {
            securityLog.log({
              action: "ACCESS_DENIED",
              requestId: ctx.requestId,
              username: normalizedUsername.length > 0 ? normalizedUsername : undefined,
              result: "DENIED",
            });
          }
          throw error;
        }

        try {
          const result = auth.login(payload);
          loginRateLimiter.reset(rateLimitKey);
          return { data: result };
        } catch (error) {
          if (error instanceof InvalidCredentialsError || error instanceof ValidationError) {
            loginRateLimiter.recordFailure(rateLimitKey);
            loginIpRateLimiter.recordFailure(ipKey);
          }
          throw error;
        }
      },
    },
    {
      method: "POST",
      pattern: /^\/auth\/logout$/,
      roles: ["ADMIN", "CASHIER"],
      handler: (ctx) => ({ data: auth.logout(ctx.actor as SessionUser, ctx.token as string) }),
    },
    {
      method: "GET",
      pattern: /^\/auth\/me$/,
      roles: ["ADMIN", "CASHIER"],
      handler: (ctx) => ({ data: auth.me(ctx.actor as SessionUser) }),
    },
    {
      method: "GET",
      pattern: /^\/users$/,
      roles: ["ADMIN"],
      handler: (ctx) => ({ data: auth.listUsers(ctx.actor as SessionUser) }),
    },
    {
      method: "POST",
      pattern: /^\/users$/,
      roles: ["ADMIN"],
      handler: (ctx) => ({
        status: 201,
        data: auth.createUser(
          ctx.actor as SessionUser,
          asObject(ctx.body) as Parameters<AuthService["createUser"]>[1],
        ),
      }),
    },
    {
      method: "PATCH",
      pattern: /^\/users\/(?<id>\d+)$/,
      roles: ["ADMIN"],
      handler: (ctx) => ({
        data: auth.updateUser(
          ctx.actor as SessionUser,
          Number(ctx.params.id),
          asObject(ctx.body),
        ),
      }),
    },
  ];

  if (options.catalog) {
    routes.push(...createCatalogRoutes(options.catalog));
  }
  if (options.shift) {
    routes.push(...createShiftRoutes(options.shift));
  }
  if (options.checkout) {
    routes.push(...createCheckoutRoutes(options.checkout));
  }
  if (options.reports) {
    routes.push(...createReportRoutes(options.reports));
  }
  if (options.print) {
    routes.push(...createPrintRoutes(options.print));
  }
  if (options.adjustments) {
    const adjustments = options.adjustments;
    routes.push({
      method: "POST",
      pattern: /^\/inventory\/adjustments$/,
      roles: ["ADMIN"],
      handler: (ctx) => ({
        status: 201,
        data: adjustments.adjustStock(ctx.actor as SessionUser, asObject(ctx.body)),
      }),
    });
  }
  if (options.backupDbPath) {
    const dbPath = options.backupDbPath;
    const env = options.backupEnv ?? process.env;
    const verificationCache = new Map<string, { size: number; mtimeMs: number; valid: boolean }>();
    function backupPath(name: unknown): string {
      if (typeof name !== "string" || !/^pos_[a-zA-Z0-9_-]+\.sqlite$/.test(name)) throw new ValidationError("Nama cadangan tidak valid.", "name");
      const root = backupRootFor(dbPath, env);
      const candidate = path.join(root, name);
      if (!existsSync(candidate) || path.dirname(realpathSync(candidate)) !== realpathSync(root)) throw new ValidationError("Cadangan tidak ditemukan.", "name");
      return candidate;
    }
    routes.push({ method: "GET", pattern: /^\/backups$/, roles: ["ADMIN"], handler: () => {
      const root = backupRootFor(dbPath, env);
      if (!existsSync(root)) return { data: [] };
      return { data: readdirSync(root).filter(name => /^pos_[a-zA-Z0-9_-]+\.sqlite$/.test(name)).sort().reverse().map(name => {
        try {
          const file = backupPath(name);
          const stat = statSync(file);
          let cached = verificationCache.get(name);
          if (!cached || cached.size !== stat.size || cached.mtimeMs !== stat.mtimeMs) {
            let valid = true;
            try { verifyBackup(file); } catch { valid = false; }
            cached = { size: stat.size, mtimeMs: stat.mtimeMs, valid };
            verificationCache.set(name, cached);
          }
          return { name, valid: cached.valid, createdAtMs: cached.valid ? Math.trunc(stat.mtimeMs) : null };
        } catch { verificationCache.delete(name); return { name, valid: false, createdAtMs: null }; }
      }) };
    } });
    routes.push({ method: "POST", pattern: /^\/backups$/, roles: ["ADMIN"], handler: ctx => {
      try { const report = createBackup({ dbPath, env, actorId: (ctx.actor as SessionUser).userId }); return { data: { name: report.fileName, valid: true, createdAtMs: report.createdAtMs } }; }
      catch { throw new ValidationError("Cadangan gagal dibuat. Periksa tujuan dan izin penulisan.", "backup"); }
    } });
    routes.push({ method: "POST", pattern: /^\/backups\/restore-test$/, roles: ["ADMIN"], handler: ctx => {
      const input = asObject(ctx.body);
      try { const result = restoreBackupToTestCopy({ backupPath: backupPath(input.name), env }); return { data: { destinationPath: result.destinationPath } }; }
      catch { throw new ValidationError("Pemulihan salinan uji gagal. Periksa cadangan dan tujuan.", "backup"); }
    } });
  }
  if (options.receiving) {
    routes.push(...createReceivingRoutes(options.receiving));
  }

  return async (req, res) => {
    const requestId = randomUUID();
    try {
      const host = String(req.headers.host ?? "");
      if (!LOOPBACK_HOST.test(host)) {
        sendJson(res, 403, {
          error: { code: "FORBIDDEN", message: "Asal permintaan tidak diizinkan.", requestId, retryable: false },
        });
        return;
      }
      const origin = req.headers.origin;
      if (typeof origin === "string" && !LOOPBACK_ORIGIN.test(origin)) {
        sendJson(res, 403, {
          error: { code: "FORBIDDEN", message: "Asal permintaan tidak diizinkan.", requestId, retryable: false },
        });
        return;
      }

      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      let pathname = url.pathname;
      if (pathname.startsWith("/api/v1/")) {
        pathname = pathname.slice("/api/v1".length);
      } else if (pathname !== "/api/v1") {
        sendJson(res, 404, {
          error: { code: "NOT_FOUND", message: "Endpoint tidak ditemukan.", requestId, retryable: false },
        });
        return;
      }
      if (pathname === "") {
        pathname = "/";
      }

      const token = extractBearer(req);
      const actor = token === null ? null : sessions.verify(token);

      let route: Route | undefined;
      let params: Record<string, string> = {};
      for (const candidate of routes) {
        if (candidate.method !== req.method) {
          continue;
        }
        const match = candidate.pattern.exec(pathname);
        if (!match) {
          continue;
        }
        route = candidate;
        if (match.groups) {
          params = { ...match.groups };
        }
        for (let index = 1; index < match.length; index += 1) {
          params[`${index}`] = match[index] ?? "";
        }
        break;
      }

      if (!route) {
        sendJson(res, 404, {
          error: { code: "NOT_FOUND", message: "Endpoint tidak ditemukan.", requestId, retryable: false },
        });
        return;
      }

      if (route.roles !== null) {
        if (!actor) {
          sendJson(res, 401, {
            error: { code: "AUTH_REQUIRED", message: "Sesi tidak valid atau sudah berakhir.", requestId, retryable: false },
          });
          return;
        }
        if (!route.roles.includes(actor.role)) {
          securityLog.log({
            action: "ACCESS_DENIED",
            requestId,
            username: actor.username,
            userId: actor.userId,
            result: "DENIED",
          });
          sendJson(res, 403, {
            error: { code: "FORBIDDEN", message: "Akses hanya untuk petugas berwenang.", requestId, retryable: false },
          });
          return;
        }
      }

      const contentLength = Number(req.headers["content-length"] ?? 0);
      const chunked = req.headers["transfer-encoding"] !== undefined;
      const hasBody = chunked || contentLength > 0;
      const body =
        (req.method === "POST" || req.method === "PATCH") && hasBody
          ? await readJsonBody(req, maxBodyBytes)
          : undefined;

      const result = (await route.handler({
        requestId,
        method: req.method ?? "GET",
        pathname,
        searchParams: url.searchParams,
        headers: req.headers,
        remoteAddress: req.socket?.remoteAddress ?? "127.0.0.1",
        token,
        actor,
        params,
        body,
      })) as HandlerResult | undefined;

      sendJson(res, result?.status ?? 200, {
        data: result?.data ?? null,
        requestId,
      });
    } catch (error) {
      sendError(res, requestId, error);
    }
  };
}

export type RunningServer = {
  server: Server;
  port: number;
  url: string;
  close: () => Promise<void>;
};

/** Bind hanya 127.0.0.1; jangan 0.0.0.0 (SECURITY.md §2). */
export function startHttpServer(
  options: HttpAppOptions & { port?: number },
): Promise<RunningServer> {
  const handler = createHttpApp(options);
  const server = createServer(handler);
  const envPort = Number(process.env.POS_HTTP_PORT ?? 0);
  const port = options.port ?? (Number.isFinite(envPort) && envPort > 0 ? envPort : 0);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address !== null ? address.port : port;
      resolve({
        server,
        port: actualPort,
        url: `http://127.0.0.1:${actualPort}`,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
            server.closeAllConnections?.();
          }),
      });
    });
  });
}
