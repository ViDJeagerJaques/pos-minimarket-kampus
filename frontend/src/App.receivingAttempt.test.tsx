import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { createMockDataSource } from "./api/mockDataSource";
import type { PosDataSource, ReceiptResult } from "./api/types";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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
});
