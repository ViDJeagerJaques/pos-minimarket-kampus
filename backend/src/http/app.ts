import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AuthService } from "../auth/service.ts";
import { AuthError, InvalidCredentialsError, ValidationError } from "../auth/errors.ts";
import type { Role, SessionStore, SessionUser } from "../auth/session.ts";
import {
  createLoginRateLimiter,
  DEFAULT_LOGIN_IP_MAX_ATTEMPTS,
  LoginRateLimitError,
  type LoginRateLimiter,
} from "../security/loginRateLimiter.ts";
import type { SecurityLogger } from "../security/securityLog.ts";

/**
 * Server HTTP loopback dengan dependensi nol. Ini adapter tipis, bukan
 * pengganti Express: TECH_STACK.md mencantumkan Express sebagai kandidat
 * (DEC-010) dan mengizinkan revisi. Adapter ini menjalankan aturan yang sama
 * (JSON, batas ukuran, Host/Origin loopback, sesi, RBAC per handler) agar
 * TASK-009 bisa diuji end-to-end tanpa dependensi native/CDN.
 */

export type HttpAppOptions = {
  auth: AuthService;
  sessions: SessionStore;
  securityLog: SecurityLogger;
  loginRateLimiter?: LoginRateLimiter;
  loginIpRateLimiter?: LoginRateLimiter;
  now?: () => number;
  maxBodyBytes?: number;
};

type RequestContext = {
  requestId: string;
  method: string;
  pathname: string;
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
