import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./errors";
import { createHttpDataSource } from "./httpDataSource";
import type { ProductSummary } from "./types";

type Call = { url: string; init: RequestInit | undefined };

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  } as Response;
}

const catalog = {
  findActiveProductByBarcode: async (): Promise<ProductSummary | null> => null,
  searchActiveProducts: async (): Promise<ProductSummary[]> => [],
  listProducts: async (): Promise<ProductSummary[]> => [],
};

const ADMIN_USER = { id: 1, username: "admin.lokal", role: "ADMIN", active: true };

function stubFetch(responses: Array<{ status: number; body: unknown }>): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) {
      throw new Error("fetch stub kehabisan respons");
    }
    return fakeResponse(next.status, next.body);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function loginEnvelope(token = "token-1"): { status: number; body: unknown } {
  return {
    status: 200,
    body: { data: { token, user: ADMIN_USER }, requestId: "r-login" },
  };
}

function meEnvelope(): { status: number; body: unknown } {
  return { status: 200, body: { data: ADMIN_USER, requestId: "r-me" } };
}

function authHeader(init: RequestInit | undefined): string | undefined {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.Authorization;
}

describe("TASK-011 klien API auth lokal", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("login hanya sukses setelah API mengembalikan token dan /auth/me memverifikasi profil", async () => {
    const { fetchImpl, calls } = stubFetch([loginEnvelope(), meEnvelope()]);
    const dataSource = createHttpDataSource({ baseUrl: "/api/v1", fetchImpl, catalog });

    const result = await dataSource.login("admin.lokal", "sandi-rahasia-uji");

    expect(result).toEqual({
      ok: true,
      user: { userId: 1, username: "admin.lokal", displayName: "admin.lokal", role: "ADMIN" },
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe("/api/v1/auth/login");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      username: "admin.lokal",
      password: "sandi-rahasia-uji",
    });
    expect(calls[1]?.url).toBe("/api/v1/auth/me");
    expect(authHeader(calls[1]?.init)).toBe("Bearer token-1");
    // Token tidak boleh dipersistensikan ke storage browser.
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("login salah/nonaktif memakai pesan generik dan tidak membuat sesi klien", async () => {
    const { fetchImpl, calls } = stubFetch([
      {
        status: 401,
        body: {
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Nama pengguna atau kata sandi salah, atau akun tidak dapat dipakai.",
            requestId: "r",
            retryable: false,
          },
        },
      },
    ]);
    const dataSource = createHttpDataSource({ baseUrl: "/api/v1", fetchImpl, catalog });

    const result = await dataSource.login("kasir.nonaktif", "sandi-salah");

    expect(result).toEqual({ ok: false, code: "INVALID_CREDENTIALS" });
    expect(calls).toHaveLength(1);
    await expect(dataSource.getProfile()).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(1);
  });

  it("token yang dibuat tetapi ditolak /auth/me tidak dianggap login sukses", async () => {
    const { fetchImpl } = stubFetch([
      loginEnvelope(),
      {
        status: 401,
        body: { error: { code: "AUTH_REQUIRED", message: "Sesi tidak valid.", retryable: false } },
      },
    ]);
    const dataSource = createHttpDataSource({ baseUrl: "/api/v1", fetchImpl, catalog });

    await expect(dataSource.login("admin.lokal", "sandi-rahasia-uji")).rejects.toMatchObject({
      status: 401,
      code: "AUTH_REQUIRED",
    });
  });

  it("rate limit login diteruskan sebagai error aman, bukan sukses palsu", async () => {
    const { fetchImpl } = stubFetch([
      {
        status: 429,
        body: {
          error: {
            code: "LOGIN_RATE_LIMITED",
            message: "Terlalu banyak percobaan login. Coba lagi nanti.",
            retryable: true,
          },
        },
      },
    ]);
    const dataSource = createHttpDataSource({ baseUrl: "/api/v1", fetchImpl, catalog });

    await expect(dataSource.login("admin.lokal", "sandi")).rejects.toMatchObject({
      status: 429,
      code: "LOGIN_RATE_LIMITED",
      retryable: true,
      message: "Terlalu banyak percobaan login. Coba lagi nanti.",
    });
  });

  it("logout mengirim Bearer lalu membuang token; permintaan sesudahnya tidak terkirim", async () => {
    const { fetchImpl, calls } = stubFetch([
      loginEnvelope(),
      meEnvelope(),
      { status: 200, body: { data: { loggedOut: true }, requestId: "r-out" } },
    ]);
    const dataSource = createHttpDataSource({ baseUrl: "/api/v1", fetchImpl, catalog });

    await dataSource.login("admin.lokal", "sandi-rahasia-uji");
    await dataSource.logout();

    expect(calls).toHaveLength(3);
    expect(calls[2]?.url).toBe("/api/v1/auth/logout");
    expect(calls[2]?.init?.method).toBe("POST");
    expect(authHeader(calls[2]?.init)).toBe("Bearer token-1");
    await expect(dataSource.getProfile()).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(3);
  });

  it("endpoint akun mengirim kontrak TASK-009 dan tidak mencatat kata sandi", async () => {
    const consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
    ];
    const created = { id: 2, username: "kasir.baru", role: "CASHIER", active: true };
    const { fetchImpl, calls } = stubFetch([
      loginEnvelope(),
      meEnvelope(),
      { status: 200, body: { data: [ADMIN_USER], requestId: "r-list" } },
      { status: 201, body: { data: created, requestId: "r-create" } },
      { status: 200, body: { data: { ...created, active: false }, requestId: "r-patch" } },
    ]);
    const dataSource = createHttpDataSource({ baseUrl: "/api/v1", fetchImpl, catalog });
    await dataSource.login("admin.lokal", "sandi-rahasia-uji");

    await expect(dataSource.listAccounts()).resolves.toEqual([
      { id: 1, username: "admin.lokal", role: "ADMIN", active: true },
    ]);
    await expect(
      dataSource.createAccount({ username: "kasir.baru", password: "sandi-baru-uji", role: "CASHIER" }),
    ).resolves.toEqual({ id: 2, username: "kasir.baru", role: "CASHIER", active: true });
    await expect(dataSource.setAccountActive(2, false)).resolves.toEqual({
      id: 2,
      username: "kasir.baru",
      role: "CASHIER",
      active: false,
    });

    expect(calls[3]?.url).toBe("/api/v1/users");
    expect(calls[3]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[3]?.init?.body))).toEqual({
      username: "kasir.baru",
      password: "sandi-baru-uji",
      role: "CASHIER",
    });
    expect(calls[4]?.url).toBe("/api/v1/users/2");
    expect(calls[4]?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(calls[4]?.init?.body))).toEqual({ active: false });

    for (const spy of consoleSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("403 dari endpoint ADMIN diteruskan ke UI sebagai FORBIDDEN tanpa mengubah sesi", async () => {
    const cashier = { id: 2, username: "kasir.lokal", role: "CASHIER", active: true };
    const { fetchImpl } = stubFetch([
      { status: 200, body: { data: { token: "token-2", user: cashier }, requestId: "r-login" } },
      { status: 200, body: { data: cashier, requestId: "r-me" } },
      {
        status: 403,
        body: {
          error: { code: "FORBIDDEN", message: "Akses hanya untuk petugas berwenang.", retryable: false },
        },
      },
    ]);
    const dataSource = createHttpDataSource({ baseUrl: "/api/v1", fetchImpl, catalog });
    await dataSource.login("kasir.lokal", "sandi-rahasia-uji");

    await expect(dataSource.listAccounts()).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("gangguan jaringan menghasilkan error yang dapat ditampilkan, bukan sukses", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const dataSource = createHttpDataSource({ baseUrl: "/api/v1", fetchImpl, catalog });

    const error = await dataSource.login("admin.lokal", "sandi-rahasia-uji").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });
});
