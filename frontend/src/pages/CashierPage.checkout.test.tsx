import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import { createMockDataSource } from "../api/mockDataSource";
import type {
  CheckoutStatusResult,
  CommitCheckoutResult,
  PosDataSource,
  PrepareCheckoutResult,
  ShiftSummary,
} from "../api/types";
import type { CartLine } from "../domain/cart";
import { CashierPage } from "./CashierPage";

const SHIFT: ShiftSummary = {
  id: 7,
  cashierId: 2,
  openedAtMs: 1_700_000_000_000,
  openingCashRp: 50_000,
};

const LINE: CartLine = {
  productId: 1,
  sku: "SKU-001",
  name: "Produk Uji",
  unitPriceRp: 5000,
  quantity: 1,
  stockHint: 5,
};

const PREPARED: PrepareCheckoutResult = {
  attemptKey: "co_test_1",
  requestHash: "a".repeat(64),
  status: "PREPARED",
  quote: {
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
  },
};

const COMMITTED: CommitCheckoutResult = {
  saleId: 11,
  saleNo: "E2E-001",
  attemptKey: PREPARED.attemptKey,
  requestHash: PREPARED.requestHash,
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
  },
};

type SourceOptions = {
  shift?: ShiftSummary | null;
  prepare?: PosDataSource["prepareCheckout"];
  commit?: PosDataSource["commitCheckout"];
  status?: PosDataSource["getCheckoutStatus"];
  getCurrentShift?: PosDataSource["getCurrentShift"];
};

function buildSource(options: SourceOptions = {}) {
  const base = createMockDataSource({ latencyMs: 0 });
  const source: PosDataSource = {
    ...base,
    authMode: "LOCAL_API",
    catalogMode: "LOCAL_API",
    getCurrentShift: options.getCurrentShift ?? vi.fn(async () => (options.shift === undefined ? SHIFT : options.shift)),
    openShift: vi.fn(async () => SHIFT),
    prepareCheckout: options.prepare ?? vi.fn(async () => PREPARED),
    commitCheckout: options.commit ?? vi.fn(async () => COMMITTED),
    getCheckoutStatus: options.status ?? vi.fn(async (): Promise<CheckoutStatusResult> => COMMITTED),
  };
  return { source, callLog: base.callLog };
}

function Harness({
  source,
  initialLines = [LINE],
  onSessionExpired = vi.fn(),
}: {
  source: PosDataSource;
  initialLines?: CartLine[];
  onSessionExpired?: () => void;
}) {
  const [lines, setLines] = useState<CartLine[]>(initialLines);
  return (
    <CashierPage
      dataSource={source}
      lines={lines}
      onLinesChange={setLines}
      sessionEpoch={1}
      onSessionExpired={onSessionExpired}
    />
  );
}

function renderPage(options: SourceOptions = {}, initialLines: CartLine[] = [LINE]) {
  const { source, callLog } = buildSource(options);
  const user = userEvent.setup();
  const onSessionExpired = vi.fn();
  render(<Harness source={source} initialLines={initialLines} onSessionExpired={onSessionExpired} />);
  return { source, callLog, user, onSessionExpired };
}

async function openPayment(user: ReturnType<typeof userEvent.setup>) {
  const pay = await screen.findByRole("button", { name: "Lanjut pembayaran" });
  await waitFor(() => expect((pay as HTMLButtonElement).disabled).toBe(false));
  await user.click(pay);
  return screen.findByRole("dialog", { name: "Konfirmasi pembayaran tunai" });
}

describe("TASK-017 kasir: shift, prepare/commit, retry dan timeout", () => {
  it("menampilkan shift pemilik dan quote harga backend sebelum pembayaran", async () => {
    const { source, user } = renderPage();

    await screen.findByText(/#7/);
    await openPayment(user);

    expect(source.prepareCheckout).toHaveBeenCalledWith({
      attemptKey: expect.stringMatching(/^co_/),
      shiftId: 7,
      items: [{ productId: 1, quantity: 1 }],
      paymentMethod: "CASH",
    });
    expect(screen.getByText(/Total:/)).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Transaksi tersimpan" })).toBeNull();
  });

  it("menampilkan uang diterima dan kembalian; sukses hanya setelah commit", async () => {
    const { source, user } = renderPage();
    await openPayment(user);

    await user.type(screen.getByLabelText("Uang diterima (Rp)"), "10000");
    expect(screen.getByText(/Kembalian:/).textContent).toContain("Rp5.000");
    expect(screen.queryByRole("dialog", { name: "Transaksi tersimpan" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Ya, commit pembayaran" }));
    const success = await screen.findByRole("dialog", { name: "Transaksi tersimpan" });
    expect(success.textContent).toContain("E2E-001");
    expect(source.commitCheckout).toHaveBeenCalledWith({
      attemptKey: "co_test_1",
      requestHash: "a".repeat(64),
      paymentConfirmation: { method: "CASH", cashReceivedRp: 10_000 },
    });
    expect(screen.getByText("0 barang")).toBeTruthy();
  });

  it("klik Bayar dua kali hanya membuat satu prepare", async () => {
    const { source } = renderPage();
    const pay = await screen.findByRole("button", { name: "Lanjut pembayaran" });
    await waitFor(() => expect((pay as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(pay);
    fireEvent.click(pay);

    await waitFor(() => expect(source.prepareCheckout).toHaveBeenCalledTimes(1));
    await screen.findByRole("dialog", { name: "Konfirmasi pembayaran tunai" });
  });

  it("harga berubah tidak langsung commit dan harus disetujui dengan quote baru", async () => {
    let prepareCalls = 0;
    const prepare = vi.fn(async () => {
      prepareCalls += 1;
      if (prepareCalls === 1) return PREPARED;
      return {
        ...PREPARED,
        attemptKey: "co_test_2",
        requestHash: "b".repeat(64),
        quote: {
          ...PREPARED.quote,
          totalRp: 6000,
          items: [{ ...PREPARED.quote.items[0]!, unitPriceRp: 6000, lineTotalRp: 6000 }],
        },
      } satisfies PrepareCheckoutResult;
    });
    let commitCalls = 0;
    const commit = vi.fn(async () => {
      commitCalls += 1;
      if (commitCalls === 1) {
        throw new ApiError(409, "PRICE_CHANGED", 'Harga "SKU-001" berubah menjadi Rp6.000.');
      }
      return COMMITTED;
    });
    const { source, user } = renderPage({ prepare, commit });
    await openPayment(user);
    await user.type(screen.getByLabelText("Uang diterima (Rp)"), "10000");
    await user.click(screen.getByRole("button", { name: "Ya, commit pembayaran" }));

    const changed = await screen.findByRole("dialog", { name: "Harga berubah — setujui ulang" });
    expect(changed.textContent).toContain("Rp6.000");
    expect(screen.queryByRole("dialog", { name: "Transaksi tersimpan" })).toBeNull();
    expect(commitCalls).toBe(1);

    await user.click(screen.getByRole("button", { name: "Setuju harga baru" }));
    expect(screen.getByRole("dialog", { name: "Konfirmasi pembayaran tunai" })).toBeTruthy();
    await user.type(screen.getByLabelText("Uang diterima (Rp)"), "10000");
    await user.click(screen.getByRole("button", { name: "Ya, commit pembayaran" }));

    expect(await screen.findByRole("dialog", { name: "Transaksi tersimpan" })).toBeTruthy();
    expect(source.prepareCheckout).toHaveBeenCalledTimes(2);
    const keys = vi.mocked(source.prepareCheckout).mock.calls.map((call) => call[0].attemptKey);
    expect(new Set(keys).size).toBe(2);
  });

  it("stok kurang ditolak tanpa penjualan dan draft tetap ada untuk dikoreksi", async () => {
    const commit = vi.fn(async () => {
      throw new ApiError(409, "INSUFFICIENT_STOCK", "Stok tidak cukup untuk SKU-001.");
    });
    const { user } = renderPage({ commit });
    await openPayment(user);
    await user.type(screen.getByLabelText("Uang diterima (Rp)"), "10000");
    await user.click(screen.getByRole("button", { name: "Ya, commit pembayaran" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("Stok tidak cukup untuk SKU-001.");
    });
    expect(screen.queryByRole("dialog", { name: "Transaksi tersimpan" })).toBeNull();
    expect(screen.getByText("1 barang")).toBeTruthy();
  });

  it("timeout commit mengarahkan ke lookup status tanpa membuat upaya baru", async () => {
    let commitCalls = 0;
    const commit = vi.fn(async () => {
      commitCalls += 1;
      throw new ApiError(0, "NETWORK_ERROR", "Backend lokal tidak dapat dihubungi.");
    });
    const { source, user, callLog } = renderPage({ commit });
    await openPayment(user);
    await user.type(screen.getByLabelText("Uang diterima (Rp)"), "10000");
    await user.click(screen.getByRole("button", { name: "Ya, commit pembayaran" }));

    const timeout = await screen.findByRole("dialog", { name: "Status pembayaran belum diketahui" });
    expect(timeout.textContent).toContain("Jangan bayar ulang");
    expect(source.prepareCheckout).toHaveBeenCalledTimes(1);
    expect(commitCalls).toBe(1);

    await user.click(screen.getByRole("button", { name: "Cek status upaya" }));
    expect(await screen.findByRole("dialog", { name: "Transaksi tersimpan" })).toBeTruthy();
    expect(commitCalls).toBe(1);
    expect(source.prepareCheckout).toHaveBeenCalledTimes(1);
    expect(source.getCheckoutStatus).toHaveBeenCalledWith("co_test_1");
    expect(callLog.some((entry) => entry.isMutation)).toBe(false);
  });

  it("tanpa shift aktif tombol bayar mati dan pembukaan shift memperbarui UI", async () => {
    const openShift = vi.fn(async () => SHIFT);
    const { source, user } = renderPage({ shift: null });
    source.openShift = openShift;

    const pay = screen.getByRole("button", { name: "Lanjut pembayaran" }) as HTMLButtonElement;
    expect(pay.disabled).toBe(true);
    expect(await screen.findByText(/Belum ada shift aktif/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Buka shift" }));
    await waitFor(() => expect((pay as HTMLButtonElement).disabled).toBe(false));
    expect(openShift).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(/#7/).length).toBeGreaterThan(0);
  });

  it("401 dari shift memanggil onSessionExpired dan tidak menampilkan checkout", async () => {
    const { onSessionExpired } = renderPage({
      getCurrentShift: vi.fn(async () => {
        throw new ApiError(401, "AUTH_REQUIRED", "Sesi berakhir. Silakan masuk lagi.");
      }),
    });

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
    expect((screen.getByRole("button", { name: "Lanjut pembayaran" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
