import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { ApiError } from "./api/errors";
import { createMockDataSource } from "./api/mockDataSource";
import type { PosDataSource, ReceiveGoodsInput, ReceiptResult } from "./api/types";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const RESULT: ReceiptResult = {
  receiptId: 1,
  receiptKey: "rcv_app",
  requestHash: "a".repeat(64),
  supplierId: 1,
  supplierRef: null,
  committedAtMs: 1_700_000_000_000,
  totalQuantity: 1,
  items: [
    { receiptItemId: 1, productId: 1, sku: "DEMO-001", name: "Roti", quantity: 1, movementId: 1 },
  ],
  duplicate: false,
};

async function loginAdmin(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Nama pengguna"), "admin.demo");
  await user.type(screen.getByLabelText("Kata sandi"), "demo");
  await user.click(screen.getByRole("button", { name: "Masuk" }));
  await screen.findByRole("button", { name: "Penerimaan" });
}

describe("TASK-027 App — upaya penerimaan dimiliki sesi (BUG-083)", () => {
  it("mencegah pindah halaman saat upaya belum selesai, lalu membuka setelah COMMITTED", async () => {
    const deferred = createDeferred<ReceiptResult>();
    const receiveGoods = vi.fn(() => deferred.promise);
    const base = createMockDataSource({ latencyMs: 0 });
    const dataSource: PosDataSource = { ...base, receiveGoods };
    render(<App dataSource={dataSource} onAfterLogout={vi.fn()} />);
    const user = userEvent.setup();

    await loginAdmin(user);
    await user.click(screen.getByRole("button", { name: "Penerimaan" }));
    await user.selectOptions(await screen.findByLabelText(/Supplier/), "1");
    await user.type(screen.getByLabelText(/Cari produk aktif/), "Roti");
    await waitFor(() => expect(screen.getByRole("option", { name: /Roti/ })).toBeTruthy());
    await user.selectOptions(screen.getByLabelText("Produk"), "1");
    await user.type(screen.getByLabelText(/Jumlah diterima/), "1");
    await user.click(screen.getByRole("button", { name: "Tambah ke draft" }));
    await user.click(screen.getByRole("button", { name: "Konfirmasi penerimaan" }));
    await user.click(screen.getByRole("button", { name: "Ya, simpan penerimaan" }));

    await waitFor(() => expect(receiveGoods).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Laporan" }));

    // Masih di halaman Penerimaan dan muncul alasan penolakan.
    expect(screen.getByRole("heading", { name: /Penerimaan Barang/ })).toBeTruthy();
    expect(screen.getByText(/Penerimaan belum selesai/)).toBeTruthy();

    await act(async () => {
      deferred.resolve(RESULT);
      await deferred.promise;
    });
    expect(await screen.findByText("rcv_app")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Laporan" }));
    expect(await screen.findByRole("heading", { name: /Laporan Pembayaran/ })).toBeTruthy();
  });

  it("DEMO_UNSUPPORTED menjadi REJECTED: halaman tidak terkunci dan navigasi dibuka", async () => {
    const receiveGoods = vi.fn(async (_payload: ReceiveGoodsInput) => {
      throw new ApiError(0, "DEMO_UNSUPPORTED", "Mode DEMO tidak menyimpan penerimaan.");
    });
    const base = createMockDataSource({ latencyMs: 0 });
    render(<App dataSource={{ ...base, receiveGoods }} onAfterLogout={vi.fn()} />);
    const user = userEvent.setup();

    await loginAdmin(user);
    await user.click(screen.getByRole("button", { name: "Penerimaan" }));
    await user.selectOptions(await screen.findByLabelText(/Supplier/), "1");
    await user.type(screen.getByLabelText(/Cari produk aktif/), "Roti");
    await waitFor(() => expect(screen.getByRole("option", { name: /Roti/ })).toBeTruthy());
    await user.selectOptions(screen.getByLabelText("Produk"), "1");
    await user.type(screen.getByLabelText(/Jumlah diterima/), "1");
    await user.click(screen.getByRole("button", { name: "Tambah ke draft" }));
    await user.click(screen.getByRole("button", { name: "Konfirmasi penerimaan" }));
    await user.click(screen.getByRole("button", { name: "Ya, simpan penerimaan" }));

    expect(await screen.findByText(/Penerimaan ditolak/)).toBeTruthy();
    expect((screen.getByLabelText("Produk") as HTMLSelectElement).disabled).toBe(false);
    await user.click(screen.getByRole("button", { name: "Laporan" }));
    expect(await screen.findByRole("heading", { name: /Laporan Pembayaran/ })).toBeTruthy();
  });

  it("401 menyimpan upaya UNKNOWN dan dipulihkan saat user yang sama login lagi", async () => {
    const receiveGoods = vi.fn(async (_payload: ReceiveGoodsInput) => {
      throw new ApiError(401, "AUTH_REQUIRED", "Sesi berakhir.");
    });
    const base = createMockDataSource({ latencyMs: 0 });
    render(<App dataSource={{ ...base, receiveGoods }} onAfterLogout={vi.fn()} />);
    const user = userEvent.setup();

    await loginAdmin(user);
    await user.click(screen.getByRole("button", { name: "Penerimaan" }));
    await user.selectOptions(await screen.findByLabelText(/Supplier/), "1");
    await user.type(screen.getByLabelText(/Cari produk aktif/), "Roti");
    await waitFor(() => expect(screen.getByRole("option", { name: /Roti/ })).toBeTruthy());
    await user.selectOptions(screen.getByLabelText("Produk"), "1");
    await user.type(screen.getByLabelText(/Jumlah diterima/), "1");
    await user.click(screen.getByRole("button", { name: "Tambah ke draft" }));
    await user.click(screen.getByRole("button", { name: "Konfirmasi penerimaan" }));
    await user.click(screen.getByRole("button", { name: "Ya, simpan penerimaan" }));

    await waitFor(() => expect(receiveGoods).toHaveBeenCalledTimes(1));
    const receiptKey = (receiveGoods.mock.calls[0]![0] as { receiptKey: string }).receiptKey;

    // Sesi berakhir: kembali ke login tanpa menampilkan UI penerimaan.
    expect(await screen.findByRole("button", { name: "Masuk" })).toBeTruthy();
    expect(screen.queryByText(/Upaya penerimaan belum selesai/)).toBeNull();

    // Login user yang sama memulihkan kunci/payload upaya UNKNOWN.
    await loginAdmin(user);
    await user.click(screen.getByRole("button", { name: "Penerimaan" }));
    expect(await screen.findByText(/Upaya penerimaan belum selesai/)).toBeTruthy();
    expect(screen.getByText(receiptKey)).toBeTruthy();
  });

  it("BUG-093: dua pemilik mempertahankan recovery masing-masing setelah pergantian login", async () => {
    const base = createMockDataSource({ latencyMs: 0 });
    let owner = 1;
    const login: PosDataSource["login"] = async (...args) => {
      const result = await base.login(...args);
      return result.ok ? { ...result, user: { ...result.user, userId: owner } } : result;
    };
    const receiveGoods = vi.fn<PosDataSource["receiveGoods"]>()
      .mockRejectedValueOnce(new ApiError(401, "AUTH_REQUIRED", "Sesi berakhir."))
      .mockRejectedValueOnce(new ApiError(401, "AUTH_REQUIRED", "Sesi berakhir."))
      .mockImplementation(async (payload) => ({ ...RESULT, receiptKey: payload.receiptKey, duplicate: true }));
    render(<App dataSource={{ ...base, login, receiveGoods }} onAfterLogout={vi.fn()} />);
    const user = userEvent.setup();
    await loginAdmin(user);
    await submitDraft(user);
    await screen.findByRole("button", { name: "Masuk" });
    const first = receiveGoods.mock.calls[0]![0];

    owner = 2;
    await loginAdmin(user);
    await user.click(screen.getByRole("button", { name: "Penerimaan" }));
    expect(screen.queryByText(first.receiptKey)).toBeNull();
    expect(screen.queryByText(/Upaya penerimaan belum selesai/)).toBeNull();
    await submitDraft(user);
    await screen.findByRole("button", { name: "Masuk" });
    const second = receiveGoods.mock.calls[1]![0];

    for (const [id, payload] of [[1, first], [2, second]] as const) {
      owner = id;
      await loginAdmin(user);
      await user.click(screen.getByRole("button", { name: "Penerimaan" }));
      expect(await screen.findByText(payload.receiptKey)).toBeTruthy();
      expect(screen.queryByText(id === 1 ? second.receiptKey : first.receiptKey)).toBeNull();
      await user.click(screen.getByRole("button", { name: "Periksa ulang dengan kunci yang sama" }));
      await screen.findByText(/sudah tercatat sebelumnya/);
      expect(receiveGoods.mock.lastCall?.[0]).toEqual(payload);
      await user.click(screen.getByRole("button", { name: "Keluar" }));
      await screen.findByRole("button", { name: "Masuk" });
    }
    owner = 1;
    await loginAdmin(user);
    await user.click(screen.getByRole("button", { name: "Penerimaan" }));
    expect(screen.queryByText(/Upaya penerimaan belum selesai/)).toBeNull();
  });

  it("BUG-095: logout default tidak reload selama recovery pemilik lain belum selesai", async () => {
    const reload = vi.fn();
    const browserWindow = window;
    // jsdom tidak menjalankan navigasi; amati efek reload di batas browser,
    // tanpa mengganti callback onAfterLogout bawaan App.
    vi.stubGlobal("window", new Proxy(browserWindow, {
      get(target, property, receiver) {
        if (property === "location") return { ...target.location, reload };
        return Reflect.get(target, property, receiver);
      },
    }));
    try {
      const base = createMockDataSource({ latencyMs: 0 });
      let owner = 1;
      const login: PosDataSource["login"] = async (...args) => {
        const result = await base.login(...args);
        return result.ok ? { ...result, user: { ...result.user, userId: owner } } : result;
      };
      const logout = vi.fn(base.logout);
      const receiveGoods = vi.fn<PosDataSource["receiveGoods"]>()
        .mockRejectedValueOnce(new ApiError(401, "AUTH_REQUIRED", "Sesi berakhir."))
        .mockImplementation(async (payload) => ({ ...RESULT, receiptKey: payload.receiptKey, duplicate: true }));
      render(<App dataSource={{ ...base, login, logout, receiveGoods }} />);
      const user = userEvent.setup();
      await loginAdmin(user);
      await submitDraft(user);
      await screen.findByRole("button", { name: "Masuk" });
      const payload = receiveGoods.mock.calls[0]![0];

      owner = 2;
      await loginAdmin(user);
      await user.click(screen.getByRole("button", { name: "Penerimaan" }));
      expect(screen.queryByText(payload.receiptKey)).toBeNull();
      await user.click(screen.getByRole("button", { name: "Keluar" }));
      await screen.findByRole("button", { name: "Masuk" });
      expect(logout).toHaveBeenCalledTimes(2);
      expect(reload).not.toHaveBeenCalled();

      owner = 1;
      await loginAdmin(user);
      await user.click(screen.getByRole("button", { name: "Penerimaan" }));
      expect(await screen.findByText(payload.receiptKey)).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Periksa ulang dengan kunci yang sama" }));
      await screen.findByText(/sudah tercatat sebelumnya/);
      expect(receiveGoods.mock.calls[1]![0]).toEqual(payload);
      await user.click(screen.getByRole("button", { name: "Keluar" }));
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("BUG-094: 401 riwayat saat PENDING menyimpan UNKNOWN dan mengabaikan hasil sesi lama", async () => {
    const base = createMockDataSource({ latencyMs: 0 });
    const history = createDeferred<Awaited<ReturnType<PosDataSource["getStockReport"]>>>();
    const pending = createDeferred<ReceiptResult>();
    const getStockReport = vi.fn<PosDataSource["getStockReport"]>()
      .mockImplementationOnce(base.getStockReport)
      .mockImplementationOnce(() => history.promise)
      .mockImplementation(base.getStockReport);
    const receiveGoods = vi.fn<PosDataSource["receiveGoods"]>()
      .mockImplementationOnce(() => pending.promise)
      .mockImplementation(async (payload) => ({ ...RESULT, receiptKey: payload.receiptKey, duplicate: true }));
    render(<App dataSource={{ ...base, getStockReport, receiveGoods }} onAfterLogout={vi.fn()} />);
    const user = userEvent.setup();
    await loginAdmin(user);
    await submitDraft(user);
    const payload = receiveGoods.mock.calls[0]![0];
    await act(async () => history.reject(new ApiError(401, "AUTH_REQUIRED", "Sesi berakhir.")));
    await screen.findByRole("button", { name: "Masuk" });
    await loginAdmin(user);
    await user.click(screen.getByRole("button", { name: "Penerimaan" }));
    expect(await screen.findByText(payload.receiptKey)).toBeTruthy();
    const retry = screen.getByRole("button", { name: "Periksa ulang dengan kunci yang sama" });
    expect((retry as HTMLButtonElement).disabled).toBe(false);
    await act(async () => pending.resolve({ ...RESULT, receiptKey: payload.receiptKey }));
    expect(screen.getByText(/Upaya penerimaan belum selesai/)).toBeTruthy();
    expect(screen.queryByText(/Saldo produk telah dimuat ulang/)).toBeNull();
    await user.click(retry);
    await screen.findByText(/sudah tercatat sebelumnya/);
    expect(receiveGoods).toHaveBeenCalledTimes(2);
    expect(receiveGoods.mock.calls[1]![0]).toEqual(payload);
  });

});


async function submitDraft(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Penerimaan" }));
  await user.selectOptions(await screen.findByLabelText(/Supplier/), "1");
  await user.type(screen.getByLabelText(/Cari produk aktif/), "Roti");
  await waitFor(() => expect(screen.getByRole("option", { name: /Roti/ })).toBeTruthy());
  await user.selectOptions(screen.getByLabelText("Produk"), "1");
  await user.type(screen.getByLabelText(/Jumlah diterima/), "1");
  await user.click(screen.getByRole("button", { name: "Tambah ke draft" }));
  await user.click(screen.getByRole("button", { name: "Konfirmasi penerimaan" }));
  await user.click(screen.getByRole("button", { name: "Ya, simpan penerimaan" }));
}
