import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./errors";
import { createHttpDataSource } from "./httpDataSource";

type Call = { url: string; init: RequestInit | undefined };

function makeTestPassword(prefix = "pw"): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  } as Response;
}

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
    const dataSource = createHttpDataSource({ baseUrl: "/api/v1", fetchImpl });

    const testPassword = makeTestPassword("admin");
    const result = await dataSource.login("admin.lokal", testPassword);

    expect(result).toEqual({
      ok: true,
      user: { userId: 1, username: "admin.lokal", displayName: "admin.lokal", role: "ADMIN" },
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe("/api/v1/auth/login");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      username: "admin.lokal",
      password: testPassword,
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
    const dataSource = createHttpDataSource({ baseUrl: "/api/v1", fetchImpl });

    const result = await dataSource.login("kasir.nonaktif", makeTestPassword("wrong"));

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
    const dataSource = createHttpDataSource({ baseUrl: "/api/v1", fetchImpl });

    await expect(dataSource.login("admin.lokal", makeTestPassword("admin"))).rejects.toMatchObject({
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
    const dataSource = createHttpDataSource({ baseUrl: "/api/v1", fetchImpl });

    await expect(dataSource.login("admin.lokal", makeTestPassword("rate"))).rejects.toMatchObject({
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
    const dataSource = createHttpDataSource({ baseUrl: "/api/v1", fetchImpl });

    await dataSource.login("admin.lokal", makeTestPassword("logout"));
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
    const dataSource = createHttpDataSource({ baseUrl: "/api/v1", fetchImpl });
    const createdPw = makeTestPassword("ksr");
    await dataSource.login("admin.lokal", makeTestPassword("adm"));

    await expect(dataSource.listAccounts()).resolves.toEqual([
      { id: 1, username: "admin.lokal", role: "ADMIN", active: true },
    ]);
    await expect(
      dataSource.createAccount({ username: "kasir.baru", password: createdPw, role: "CASHIER" }),
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
      password: createdPw,
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
    const dataSource = createHttpDataSource({ baseUrl: "/api/v1", fetchImpl });
    await dataSource.login("kasir.lokal", makeTestPassword("ksr"));

    await expect(dataSource.listAccounts()).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("gangguan jaringan menghasilkan error yang dapat ditampilkan, bukan sukses", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const dataSource = createHttpDataSource({ baseUrl: "/api/v1", fetchImpl });

    const error = await dataSource.login("admin.lokal", makeTestPassword("net")).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });

  it("permintaan HTTP yang menggantung dibatalkan oleh timeout dan menghasilkan NETWORK_ERROR", async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }) as unknown as typeof fetch;

    const dataSource = createHttpDataSource({ baseUrl: "/api/v1", fetchImpl, timeoutMs: 25 });
    const error = await dataSource.login("admin.lokal", makeTestPassword("timeout")).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: "NETWORK_ERROR", retryable: true });
  });

  it("respons gagal dari upaya login lama tidak mengakhiri sesi baru", async () => {
    let rejectStaleMe!: (reason?: unknown) => void;
    let callIndex = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      callIndex += 1;
      if (callIndex === 1 && url.endsWith("/auth/login")) {
        return fakeResponse(200, { data: { token: "token-lama", user: ADMIN_USER } });
      }
      if (callIndex === 2 && url.endsWith("/auth/me")) {
        return new Promise<Response>((_resolve, reject) => {
          rejectStaleMe = reject;
        });
      }
      if (url.endsWith("/auth/login")) {
        return fakeResponse(200, { data: { token: "token-baru", user: ADMIN_USER } });
      }
      if (url.endsWith("/auth/me")) {
        return fakeResponse(200, { data: ADMIN_USER });
      }
      throw new Error(`Unexpected url: ${url}`);
    }) as unknown as typeof fetch;

    const dataSource = createHttpDataSource({ baseUrl: "/api/v1", fetchImpl });
    const staleLogin = dataSource.login("admin.lokal", makeTestPassword("lama"));
    // Tunggu hingga staleLogin masuk ke /auth/me
    await new Promise((r) => setTimeout(r, 10));

    // Login baru dimulai dan berhasil sebelum /auth/me lama gagal
    const freshResult = await dataSource.login("admin.lokal", makeTestPassword("baru"));
    expect(freshResult.ok).toBe(true);

    // /auth/me milik sesi lama gagal -> tidak boleh menghapus token-baru
    rejectStaleMe(new Error("stale failure"));
    await expect(staleLogin).rejects.toBeInstanceOf(ApiError);

    const profile = await dataSource.getProfile();
    expect(profile.username).toBe("admin.lokal");
  });
});

const CATALOG_PRODUCT = {
  id: 10,
  categoryId: 1,
  categoryName: "Minuman (DEMO)",
  sku: "DEMO-010",
  name: "Produk Uji",
  priceRp: 5000,
  active: true,
  barcodes: ["000123"],
  supplierIds: [1],
  stockOnHand: 0,
};

async function loginAdmin(fetchImpl: typeof fetch) {
  const dataSource = createHttpDataSource({ baseUrl: "/api/v1", fetchImpl });
  await dataSource.login("admin.lokal", makeTestPassword("admin"));
  return dataSource;
}

describe("TASK-012 klien katalog lokal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /products mengirim barcode string dan mempertahankan nol awal", async () => {
    const { fetchImpl, calls } = stubFetch([
      loginEnvelope(),
      meEnvelope(),
      { status: 201, body: { data: CATALOG_PRODUCT, requestId: "r-prod" } },
    ]);
    const dataSource = await loginAdmin(fetchImpl);

    const created = await dataSource.createProduct({
      categoryId: 1,
      sku: "DEMO-010",
      name: "Produk Uji",
      priceRp: 5000,
      barcodes: ["000123"],
      supplierIds: [1],
    });

    expect(created.barcodes).toEqual(["000123"]);
    const body = JSON.parse(String(calls[2]?.init?.body)) as { barcodes: unknown[] };
    expect(body.barcodes).toEqual(["000123"]);
    expect(typeof body.barcodes[0]).toBe("string");
    expect(calls[2]?.url).toBe("/api/v1/products");
    expect(calls[2]?.init?.method).toBe("POST");
  });

  it("barcode duplikat dari server ditampilkan sebagai DUPLICATE_BARCODE", async () => {
    const { fetchImpl } = stubFetch([
      loginEnvelope(),
      meEnvelope(),
      {
        status: 409,
        body: {
          error: {
            code: "DUPLICATE_BARCODE",
            message: "Barcode sudah dipakai produk lain.",
            field: "barcodes",
            retryable: false,
          },
        },
      },
    ]);
    const dataSource = await loginAdmin(fetchImpl);

    await expect(
      dataSource.createProduct({
        categoryId: 1,
        sku: "DEMO-011",
        name: "Duplikat",
        priceRp: 1000,
        barcodes: ["000123"],
        supplierIds: [],
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "DUPLICATE_BARCODE",
      message: "Barcode sudah dipakai produk lain.",
    });
  });

  it("SKU invalid dari server diteruskan sebagai VALIDATION_ERROR", async () => {
    const { fetchImpl } = stubFetch([
      loginEnvelope(),
      meEnvelope(),
      {
        status: 422,
        body: {
          error: {
            code: "VALIDATION_ERROR",
            message: "SKU tidak boleh mengandung spasi.",
            field: "sku",
            retryable: false,
          },
        },
      },
    ]);
    const dataSource = await loginAdmin(fetchImpl);

    await expect(
      dataSource.createProduct({
        categoryId: 1,
        sku: "SKU SALAH",
        name: "SKU Salah",
        priceRp: 1000,
        barcodes: [],
        supplierIds: [],
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
      message: "SKU tidak boleh mengandung spasi.",
    });
  });

  it("lookup kasir mengirim barcode apa adanya dan barcode kosong tidak memanggil API", async () => {
    const { fetchImpl, calls } = stubFetch([
      loginEnvelope(),
      meEnvelope(),
      { status: 200, body: { data: [CATALOG_PRODUCT], requestId: "r-scan" } },
    ]);
    const dataSource = await loginAdmin(fetchImpl);

    const found = await dataSource.findActiveProductByBarcode("000123");
    expect(found).toMatchObject({ id: 10, sku: "DEMO-010", stock: 0 });
    expect(calls[2]?.url).toBe("/api/v1/products?barcode=000123&limit=1");

    const before = calls.length;
    await expect(dataSource.findActiveProductByBarcode("   ")).resolves.toBeNull();
    expect(calls).toHaveLength(before);
  });

  it("ADMIN dapat meminta produk nonaktif lewat includeInactive", async () => {
    const { fetchImpl, calls } = stubFetch([
      loginEnvelope(),
      meEnvelope(),
      { status: 200, body: { data: [{ ...CATALOG_PRODUCT, active: false }], requestId: "r-all" } },
    ]);
    const dataSource = await loginAdmin(fetchImpl);

    const items = await dataSource.listCatalogProducts({ includeInactive: true });
    expect(items[0]?.active).toBe(false);
    expect(calls[2]?.url).toBe("/api/v1/products?includeInactive=true");
  });

  it("CASHIER yang ditolak backend mendapat FORBIDDEN, bukan sukses palsu", async () => {
    const cashier = { id: 2, username: "kasir.lokal", role: "CASHIER", active: true };
    const { fetchImpl } = stubFetch([
      { status: 200, body: { data: { token: "token-2", user: cashier }, requestId: "r-login" } },
      { status: 200, body: { data: cashier, requestId: "r-me" } },
      {
        status: 403,
        body: { error: { code: "FORBIDDEN", message: "Akses hanya untuk ADMIN.", retryable: false } },
      },
    ]);
    const dataSource = createHttpDataSource({ baseUrl: "/api/v1", fetchImpl });
    await dataSource.login("kasir.lokal", makeTestPassword("ksr"));

    await expect(
      dataSource.createCategory("Kategori Dilarang"),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });
});

const SHIFT_DTO = { id: 7, cashierId: 2, openedAtMs: 1_700_000_000_000, openingCashRp: 50_000 };
const HASH = "a".repeat(64);
const QUOTE = {
  shiftId: 7,
  cashierId: 2,
  items: [
    {
      productId: 1,
      sku: "SKU-001",
      name: "Produk Uji",
      quantity: 1,
      unitPriceRp: 5000,
      lineTotalRp: 5000,
    },
  ],
  totalRp: 5000,
  payment: { method: "CASH" },
};
const PREPARED_DTO = { attemptKey: "co_test", requestHash: HASH, status: "PREPARED", quote: QUOTE };
const COMMITTED_DTO = {
  saleId: 11,
  saleNo: "E2E-001",
  attemptKey: "co_test",
  requestHash: HASH,
  status: "COMMITTED",
  totalRp: 5000,
  committedAtMs: 1_700_000_001_000,
  payment: {
    method: "CASH",
    amountRp: 5000,
    cashReceivedRp: 10_000,
    changeRp: 5000,
    verifiedBy: 2,
    verifiedAtMs: 1_700_000_001_000,
    evidenceRef: null,
  },
};

async function loginCashier(fetchImpl: typeof fetch) {
  const dataSource = createHttpDataSource({ baseUrl: "/api/v1", fetchImpl });
  // Stub fetch tidak menegakkan RBAC; penolakan 403 diuji di backend/app.test.ts.
  await dataSource.login("kasir.lokal", makeTestPassword("ksr"));
  return dataSource;
}

describe("TASK-017 klien shift & checkout lokal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GET /shifts/current memetakan null dan DTO shift", async () => {
    const empty = stubFetch([loginEnvelope(), meEnvelope(), { status: 200, body: { data: null } }]);
    const noShift = await loginCashier(empty.fetchImpl);
    await expect(noShift.getCurrentShift()).resolves.toBeNull();

    const active = stubFetch([
      loginEnvelope(),
      meEnvelope(),
      { status: 200, body: { data: SHIFT_DTO } },
    ]);
    const withShift = await loginCashier(active.fetchImpl);
    await expect(withShift.getCurrentShift()).resolves.toEqual({
      id: 7,
      cashierId: 2,
      openedAtMs: 1_700_000_000_000,
      openingCashRp: 50_000,
    });
    expect(active.calls[2]?.url).toBe("/api/v1/shifts/current");
  });

  it("POST /shifts/open mengirim modal awal opsional", async () => {
    const { fetchImpl, calls } = stubFetch([
      loginEnvelope(),
      meEnvelope(),
      { status: 200, body: { data: SHIFT_DTO } },
    ]);
    const dataSource = await loginCashier(fetchImpl);
    await dataSource.openShift({ openingCashRp: 50_000 });
    expect(calls[2]?.url).toBe("/api/v1/shifts/open");
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ openingCashRp: 50_000 });
  });

  it("prepare mengirim niat tanpa harga, commit mengirim attemptKey/hash/konfirmasi tunai", async () => {
    const { fetchImpl, calls } = stubFetch([
      loginEnvelope(),
      meEnvelope(),
      { status: 200, body: { data: PREPARED_DTO } },
      { status: 200, body: { data: COMMITTED_DTO } },
    ]);
    const dataSource = await loginCashier(fetchImpl);

    const prepared = await dataSource.prepareCheckout({
      attemptKey: "co_test",
      shiftId: 7,
      items: [{ productId: 1, quantity: 1 }],
      paymentMethod: "CASH",
    });
    expect(prepared.quote.totalRp).toBe(5000);
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({
      attemptKey: "co_test",
      shiftId: 7,
      items: [{ productId: 1, quantity: 1 }],
      payment: { method: "CASH" },
    });

    const committed = await dataSource.commitCheckout({
      attemptKey: "co_test",
      requestHash: HASH,
      paymentConfirmation: { method: "CASH", cashReceivedRp: 10_000 },
    });
    expect(committed).toMatchObject({ saleNo: "E2E-001", status: "COMMITTED" });
    expect(committed.payment.changeRp).toBe(5000);
    expect(JSON.parse(String(calls[3]?.init?.body))).toEqual({
      attemptKey: "co_test",
      requestHash: HASH,
      paymentConfirmation: { method: "CASH", cashReceivedRp: 10_000 },
    });
  });

  it("lookup status memakai attemptKey terenkode dan memetakan COMMITTED", async () => {
    const { fetchImpl, calls } = stubFetch([
      loginEnvelope(),
      meEnvelope(),
      { status: 200, body: { data: COMMITTED_DTO } },
    ]);
    const dataSource = await loginCashier(fetchImpl);
    const result = await dataSource.getCheckoutStatus("co_test");
    expect(result.status).toBe("COMMITTED");
    expect(calls[2]?.url).toBe("/api/v1/checkouts/co_test");
  });

  it("pesan PRICE_CHANGED dari server diteruskan apa adanya ke UI", async () => {
    const { fetchImpl } = stubFetch([
      loginEnvelope(),
      meEnvelope(),
      {
        status: 409,
        body: {
          error: {
            code: "PRICE_CHANGED",
            message: 'Harga "SKU-001" berubah dari Rp5.000 menjadi Rp6.000.',
            retryable: false,
          },
        },
      },
    ]);
    const dataSource = await loginCashier(fetchImpl);
    await expect(
      dataSource.commitCheckout({
        attemptKey: "co_test",
        requestHash: HASH,
        paymentConfirmation: { method: "CASH", cashReceivedRp: 10_000 },
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "PRICE_CHANGED",
      message: 'Harga "SKU-001" berubah dari Rp5.000 menjadi Rp6.000.',
    });
  });
});

describe("TASK-023 kontrak HTTP tutup shift", () => {
  it("memetakan pratinjau, POST dan status dengan payload yang sama", async () => {
    const preview = { shiftId: 7, openingCashRp: 100000, cashTotalRp: 500000, qrisTotalRp: 300000, expectedCashRp: 600000, saleCount: 2 };
    const closed = { shiftId: 7, closeKey: "close_test", requestHash: "a".repeat(64), closedAtMs: 123, closedBy: 2, openingCashRp: 100000, expectedCashRp: 600000, declaredCashRp: 590000, varianceRp: -10000, totals: { cashRp: 500000, qrisManualRp: 300000, totalSalesRp: 800000, saleCount: 2 } };
    const { fetchImpl, calls } = stubFetch([loginEnvelope(), meEnvelope(), { status: 200, body: { data: preview } }, { status: 200, body: { data: closed } }, { status: 200, body: { data: closed } }]);
    const dataSource = await loginCashier(fetchImpl);
    expect(await dataSource.getShiftClosePreview(7)).toEqual(preview);
    expect(await dataSource.closeShift(7, { closeKey: "close_test", declaredCashRp: 590000 })).toEqual(closed);
    expect(await dataSource.getShiftClosing(7)).toEqual(closed);
    expect(calls[2]?.url).toBe("/api/v1/shifts/7/close/preview");
    expect(calls[3]?.url).toBe("/api/v1/shifts/7/close");
    expect(JSON.parse(String(calls[3]?.init?.body))).toEqual({ closeKey: "close_test", declaredCashRp: 590000 });
    expect(calls[4]?.init?.method).toBe("GET");
  });
});

describe("TASK-037 kontrak HTTP QRIS manual", () => {
  const QRIS_QUOTE = {
    shiftId: 7,
    cashierId: 2,
    items: [
      {
        productId: 1,
        sku: "QRIS-001",
        name: "Produk QRIS",
        quantity: 1,
        unitPriceRp: 5000,
        lineTotalRp: 5000,
      },
    ],
    totalRp: 5000,
    payment: { method: "QRIS_MANUAL" },
  };
  const QRIS_PREPARED = {
    attemptKey: "co_qris",
    requestHash: HASH,
    status: "PREPARED",
    quote: QRIS_QUOTE,
    qrisVerification: { status: "pending" },
  };
  const QRIS_COMMITTED = {
    saleId: 12,
    saleNo: "QRIS-001",
    attemptKey: "co_qris",
    requestHash: HASH,
    status: "COMMITTED",
    totalRp: 5000,
    committedAtMs: 1_700_000_001_000,
    payment: {
      method: "QRIS_MANUAL",
      amountRp: 5000,
      cashReceivedRp: null,
      changeRp: 0,
      verifiedBy: 2,
      verifiedAtMs: 1_700_000_001_000,
      evidenceRef: "REF-1",
    },
    qrisVerification: { status: "verified", verifiedBy: 2, verifiedAtMs: 1_700_000_001_000 },
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prepare QRIS mengirim metode dan memetakan quote", async () => {
    const { fetchImpl, calls } = stubFetch([
      loginEnvelope(),
      meEnvelope(),
      { status: 200, body: { data: QRIS_PREPARED } },
    ]);
    const dataSource = await loginCashier(fetchImpl);
    const result = await dataSource.prepareCheckout({
      attemptKey: "co_qris",
      shiftId: 7,
      items: [{ productId: 1, quantity: 1 }],
      paymentMethod: "QRIS_MANUAL",
    });
    expect(result.quote.payment.method).toBe("QRIS_MANUAL");
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({
      attemptKey: "co_qris",
      shiftId: 7,
      items: [{ productId: 1, quantity: 1 }],
      payment: { method: "QRIS_MANUAL" },
    });
  });

  it("commit QRIS memetakan status verified, kasir, waktu, dan referensi", async () => {
    const { fetchImpl, calls } = stubFetch([
      loginEnvelope(),
      meEnvelope(),
      { status: 200, body: { data: QRIS_COMMITTED } },
    ]);
    const dataSource = await loginCashier(fetchImpl);
    const result = await dataSource.commitCheckout({
      attemptKey: "co_qris",
      requestHash: HASH,
      paymentConfirmation: {
        method: "QRIS_MANUAL",
        merchantConfirmed: true,
        confirmedAmountRp: 5000,
        evidenceRef: "REF-1",
      },
    });
    expect(result.payment.method).toBe("QRIS_MANUAL");
    expect(result.payment.evidenceRef).toBe("REF-1");
    expect(result.qrisVerification).toEqual({
      status: "verified",
      verifiedBy: 2,
      verifiedAtMs: 1_700_000_001_000,
    });
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({
      attemptKey: "co_qris",
      requestHash: HASH,
      paymentConfirmation: {
        method: "QRIS_MANUAL",
        merchantConfirmed: true,
        confirmedAmountRp: 5000,
        evidenceRef: "REF-1",
      },
    });
  });

  it("commit QRIS tanpa verifikasi sah ditolak sebagai INVALID_RESPONSE", async () => {
    const { fetchImpl } = stubFetch([
      loginEnvelope(),
      meEnvelope(),
      { status: 200, body: { data: { ...QRIS_COMMITTED, qrisVerification: undefined } } },
    ]);
    const dataSource = await loginCashier(fetchImpl);
    await expect(
      dataSource.commitCheckout({
        attemptKey: "co_qris",
        requestHash: HASH,
        paymentConfirmation: {
          method: "QRIS_MANUAL",
          merchantConfirmed: true,
          confirmedAmountRp: 5000,
          evidenceRef: "REF-1",
        },
      }),
    ).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      message: expect.stringMatching(/verifikasi/),
    });
  });

  it("lookup COMMITTED QRIS tanpa verifikasi sah ditolak sebagai INVALID_RESPONSE", async () => {
    const { fetchImpl } = stubFetch([
      loginEnvelope(),
      meEnvelope(),
      { status: 200, body: { data: { ...QRIS_COMMITTED, qrisVerification: { status: "pending" } } } },
    ]);
    const dataSource = await loginCashier(fetchImpl);
    await expect(dataSource.getCheckoutStatus("co_qris")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      message: expect.stringMatching(/verifikasi/),
    });
  });

  it("lookup QRIS PREPARED memuat status pending", async () => {
    const { fetchImpl } = stubFetch([
      loginEnvelope(),
      meEnvelope(),
      { status: 200, body: { data: QRIS_PREPARED } },
    ]);
    const dataSource = await loginCashier(fetchImpl);
    const result = await dataSource.getCheckoutStatus("co_qris");
    expect(result.status).toBe("PREPARED");
    if (result.status === "PREPARED") {
      expect(result.qrisVerification).toEqual({ status: "pending" });
    }
  });

  it("GET /reports/payments memetakan angka kas dan QRIS terpisah", async () => {
    const report = {
      cash: { totalRp: 125000, count: 5 },
      qrisManual: { totalRp: 75000, count: 3, verifiedCount: 3 },
      totalRp: 200000,
      qrisSales: [
        {
          saleId: 12,
          saleNo: "QRIS-001",
          committedAtMs: 1_700_000_000_000,
          totalRp: 25000,
          cashierUsername: "kasir.demo",
          verifiedBy: 2,
          verifiedAtMs: 1_700_000_000_000,
          evidenceRef: "REF-1",
          status: "verified",
        },
      ],
    };
    const { fetchImpl, calls } = stubFetch([
      loginEnvelope(),
      meEnvelope(),
      { status: 200, body: { data: report } },
    ]);
    const dataSource = await loginCashier(fetchImpl);
    const result = await dataSource.getPaymentReport();
    expect(result.cash.totalRp).toBe(125000);
    expect(result.qrisManual.totalRp).toBe(75000);
    expect(result.qrisSales[0]?.status).toBe("verified");
    expect(calls[2]?.url).toBe("/api/v1/reports/payments");
  });
});

describe("TASK-021 klien struk & cetak ulang", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const RECEIPT = {
    saleId: 102,
    saleNo: "S-000102",
    committedAtMs: 1_700_000_000_000,
    totalRp: 5000,
    items: [
      { sku: "FX-001", name: "Produk lama", quantity: 2, unitPriceRp: 2500, lineTotalRp: 5000 },
    ],
    payment: {
      method: "CASH",
      amountRp: 5000,
      cashReceivedRp: 10_000,
      changeRp: 5000,
      evidenceRef: null,
      verifiedAtMs: null,
    },
  };

  it("GET receipt dan POST print memakai saleId lama", async () => {
    const { fetchImpl, calls } = stubFetch([
      loginEnvelope(),
      meEnvelope(),
      { status: 200, body: { data: { receipt: RECEIPT, text: "=== STRUK DEMO ===\nS-000102\n", demo: true } } },
      {
        status: 200,
        body: {
          data: {
            saleId: 102,
            saleNo: "S-000102",
            status: "PRINTED",
            channel: "VIRTUAL",
            printedAtMs: 1_700_000_020_000,
            text: "=== STRUK DEMO ===\nS-000102\n",
            demo: true,
          },
        },
      },
    ]);
    const dataSource = await loginCashier(fetchImpl);
    const view = await dataSource.getSaleReceipt(102);
    expect(view.receipt.saleNo).toBe("S-000102");
    expect(view.demo).toBe(true);
    expect(calls[2]?.url).toBe("/api/v1/sales/102/receipt");

    const printed = await dataSource.printSaleReceipt(102);
    expect(printed.status).toBe("PRINTED");
    expect(calls[3]?.url).toBe("/api/v1/sales/102/print");
    expect(JSON.parse(String(calls[3]?.init?.body))).toEqual({});
  });

  it("PRINTER_UNAVAILABLE (503) dipetakan sebagai ApiError yang dapat dicetak ulang", async () => {
    const { fetchImpl } = stubFetch([
      loginEnvelope(),
      meEnvelope(),
      {
        status: 503,
        body: {
          error: {
            code: "PRINTER_UNAVAILABLE",
            message: "Printer mati (simulasi).",
            retryable: true,
          },
        },
      },
    ]);
    const dataSource = await loginCashier(fetchImpl);
    const error = await dataSource.printSaleReceipt(102).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 503,
      code: "PRINTER_UNAVAILABLE",
      retryable: true,
    });
    expect((error as ApiError).message).toContain("Printer mati");
  });
});
