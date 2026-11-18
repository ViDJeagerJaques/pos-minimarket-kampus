import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { ApiError } from "../api/errors";
import { createMockDataSource } from "../api/mockDataSource";
import type {
  CheckoutStatusResult,
  CommitCheckoutResult,
  PosDataSource,
  PrepareCheckoutResult,
  ProductSummary,
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
    evidenceRef: null,
  },
};

type SourceOptions = {
  shift?: ShiftSummary | null;
  prepare?: PosDataSource["prepareCheckout"];
  commit?: PosDataSource["commitCheckout"];
  status?: PosDataSource["getCheckoutStatus"];
  getCurrentShift?: PosDataSource["getCurrentShift"];
  findActiveProductByBarcode?: PosDataSource["findActiveProductByBarcode"];
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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
    findActiveProductByBarcode:
      options.findActiveProductByBarcode ?? base.findActiveProductByBarcode,
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
      draftId="draft-test"
      onDraftConsumed={(id, ids) => { if (id === "draft-test") setLines(current => ids ? current.filter(line => !ids.includes(line.productId)) : []); }} onDraftRestore={(id, restored) => { if (id === "draft-test") setLines(current => current.length ? current : restored); }}
      lines={lines}
      onLinesChange={setLines}
      sessionEpoch={1}
      cashierId={2}
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

beforeEach(() => localStorage.clear());

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
    const revisedCommitted: CommitCheckoutResult = {
      ...COMMITTED,
      saleNo: "E2E-002",
      attemptKey: "co_test_2",
      requestHash: "b".repeat(64),
      totalRp: 6000,
      payment: {
        ...COMMITTED.payment,
        amountRp: 6000,
        cashReceivedRp: 10_000,
        changeRp: 4000,
      },
    };
    let commitCalls = 0;
    const commit = vi.fn(async () => {
      commitCalls += 1;
      if (commitCalls === 1) {
        throw new ApiError(409, "PRICE_CHANGED", 'Harga "SKU-001" berubah menjadi Rp6.000.');
      }
      return revisedCommitted;
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

    const success = await screen.findByRole("dialog", { name: "Transaksi tersimpan" });
    expect(success.textContent).toContain("Rp6.000");
    expect(success.textContent).toContain("Rp4.000");
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

  it("pemilik menemukan commit setelah reload tanpa checkout baru", async () => {
    const commit = vi.fn(async () => { throw new ApiError(0, "NETWORK_ERROR", "timeout"); });
    const { source } = buildSource({ commit });
    const user = userEvent.setup();
    const view = render(<Harness source={source} />);
    await openPayment(user);
    await user.type(screen.getByLabelText("Uang diterima (Rp)"), "10000");
    await user.click(screen.getByRole("button", { name: "Ya, commit pembayaran" }));
    await screen.findByRole("dialog", { name: "Status pembayaran belum diketahui" });
    view.unmount();
    render(<Harness source={source} initialLines={[]} />);
    await screen.findByRole("dialog", { name: "Status pembayaran belum diketahui" });
    await user.click(screen.getByRole("button", { name: "Cek status upaya" }));
    expect((await screen.findByRole("dialog", { name: "Transaksi tersimpan" })).textContent).toContain("E2E-001");
    expect(commit).toHaveBeenCalledTimes(1);
    expect(source.prepareCheckout).toHaveBeenCalledTimes(1);
  });

  it("remount memulihkan snapshot dan hanya menghapus barang yang terjual", async () => {
    const extra = { ...LINE, productId: 2, sku: "EXTRA", name: "Barang lain" };
    const commit = vi.fn(async () => { throw new ApiError(0, "NETWORK_ERROR", "timeout"); });
    const { source } = buildSource({ commit });
    const user = userEvent.setup();
    function NavigationHarness() {
      const [lines, setLines] = useState<CartLine[]>([LINE]);
      const [visible, setVisible] = useState(true);
      return <><button onClick={() => { setLines(current => [...current, extra]); setVisible(false); }}>Pindah</button>
        <button onClick={() => setVisible(true)}>Kembali</button>
        {visible && <CashierPage dataSource={source} draftId="draft-test" onDraftConsumed={(id, ids) => { if (id === "draft-test") setLines(current => ids ? current.filter(line => !ids.includes(line.productId)) : []); }} onDraftRestore={(id, restored) => { if (id === "draft-test") setLines(current => current.length ? current : restored); }} lines={lines} onLinesChange={setLines} sessionEpoch={1} cashierId={2} onSessionExpired={vi.fn()} />}</>;
    }
    render(<NavigationHarness />);
    await openPayment(user);
    await user.type(screen.getByLabelText("Uang diterima (Rp)"), "10000");
    await user.click(screen.getByRole("button", { name: "Ya, commit pembayaran" }));
    await screen.findByRole("dialog", { name: "Status pembayaran belum diketahui" });
    await user.click(screen.getByRole("button", { name: "Pindah" }));
    await user.click(screen.getByRole("button", { name: "Kembali" }));
    await user.click(screen.getByRole("button", { name: "Cek status upaya" }));
    await user.click(await screen.findByRole("button", { name: "Transaksi baru" }));
    expect(screen.queryByText("Produk Uji")).toBeNull();
    expect(screen.getByText("Barang lain")).toBeTruthy();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("kegagalan menghapus rekaman tidak mengunci fase committing dan memberi peringatan", async () => {
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("denied"); });
    try {
      const commit = vi.fn(async () => { throw new ApiError(409, "INSUFFICIENT_STOCK", "Stok kurang"); });
      const { user } = renderPage({ commit });
      await openPayment(user);
      await user.type(screen.getByLabelText("Uang diterima (Rp)"), "10000");
      await user.click(screen.getByRole("button", { name: "Ya, commit pembayaran" }));
      expect(await screen.findByText(/Rekaman pemulihan tidak dapat dihapus/)).toBeTruthy();
      expect(screen.queryByRole("dialog", { name: "Menyimpan transaksi…" })).toBeNull();
      expect(localStorage.length).toBe(1);
    } finally { remove.mockRestore(); }
  });

  it("dua tab menyimpan dan memulihkan masing-masing upaya", async () => {
    const commit = vi.fn(async () => { throw new ApiError(0, "NETWORK_ERROR", "timeout"); });
    const first = buildSource({ commit }).source;
    const secondAttempt = { ...PREPARED, attemptKey: "co_test_2" };
    const second = buildSource({ commit, prepare: vi.fn(async () => secondAttempt) }).source;
    const one = render(<Harness source={first} />);
    const two = render(<Harness source={second} />);
    const user = userEvent.setup();
    for (const view of [one, two]) {
      const ui = within(view.container);
      const pay = await ui.findByRole("button", { name: "Lanjut pembayaran" });
      await waitFor(() => expect((pay as HTMLButtonElement).disabled).toBe(false));
      await user.click(pay);
      await user.type(await ui.findByLabelText("Uang diterima (Rp)"), "10000");
      await user.click(ui.getByRole("button", { name: "Ya, commit pembayaran" }));
      await ui.findByRole("dialog", { name: "Status pembayaran belum diketahui" });
    }
    expect(localStorage.length).toBe(2);
    one.unmount(); two.unmount();
    const recovered = render(<Harness source={first} initialLines={[]} />);
    expect(recovered.container.textContent).toContain("co_test_1");
    await user.click(screen.getByRole("button", { name: "Cek status upaya" }));
    await user.click(await screen.findByRole("button", { name: "Transaksi baru" }));
    expect(screen.getByRole("dialog", { name: "Status pembayaran belum diketahui" }).textContent).toContain("co_test_2");
    expect(localStorage.length).toBe(1);
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it("recovery tab lain tidak menghapus produk sama dari draft berbeda", async () => {
    localStorage.setItem("pos.checkout.recovery.2.co_test_1", JSON.stringify({
      attempt: PREPARED, cashReceivedRp: 10000, snapshot: [LINE], draftId: "draft-tab-a",
    }));
    const { user } = renderPage();
    await user.click(screen.getByRole("button", { name: "Cek status upaya" }));
    await user.click(await screen.findByRole("button", { name: "Transaksi baru" }));
    expect(screen.getByText("Produk Uji")).toBeTruthy();
    expect(screen.getByText("1 barang")).toBeTruthy();
  });

  it("recovery lama tanpa identitas tidak menghapus draft yang tidak terbukti", async () => {
    localStorage.setItem("pos.checkout.recovery.2", JSON.stringify({ attempt: PREPARED, cashReceivedRp: 10000 }));
    const { user } = renderPage();
    await user.click(screen.getByRole("button", { name: "Cek status upaya" }));
    await user.click(await screen.findByRole("button", { name: "Transaksi baru" }));
    expect(screen.getByText("Produk Uji")).toBeTruthy();
  });

  it("harga berubah setelah reload memakai snapshot, bukan draft kosong atau tab lain", async () => {
    localStorage.setItem("pos.checkout.recovery.2.co_test_1", JSON.stringify({
      attempt: PREPARED, cashReceivedRp: 10000, snapshot: [LINE], draftId: "draft-tab-a",
    }));
    const prepare = vi.fn(async () => ({ ...PREPARED, attemptKey: "revised" }));
    const commit = vi.fn(async () => { throw new ApiError(409, "PRICE_CHANGED", "Harga berubah"); });
    const status = vi.fn(async (): Promise<CheckoutStatusResult> => PREPARED);
    const other = { ...LINE, productId: 2, name: "Produk lain" };
    const { user } = renderPage({ prepare, commit, status }, [other]);
    await user.click(screen.getByRole("button", { name: "Cek status upaya" }));
    await user.click(await screen.findByRole("button", { name: "Lanjutkan commit upaya ini" }));
    await screen.findByRole("dialog", { name: "Harga berubah — setujui ulang" });
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ items: [{ productId: 1, quantity: 1 }] }));
    expect(localStorage.getItem("pos.checkout.recovery.2.co_test_1")).not.toBeNull();
  });

  it("quote baru gagal tetap menyimpan pembelian yang dipulihkan", async () => {
    const key = "pos.checkout.recovery.2.co_test_1";
    localStorage.setItem(key, JSON.stringify({ attempt: PREPARED, cashReceivedRp: 10000, snapshot: [LINE], draftId: "tab-lama" }));
    const prepare = vi.fn(async () => { throw new ApiError(0, "NETWORK_ERROR", "Offline"); });
    const commit = vi.fn(async () => { throw new ApiError(409, "PRICE_CHANGED", "Harga berubah"); });
    const status = vi.fn(async (): Promise<CheckoutStatusResult> => PREPARED);
    const { user } = renderPage({ prepare, commit, status }, []);
    await screen.findByText(/#7/);
    await user.click(screen.getByRole("button", { name: "Cek status upaya" }));
    await user.click(await screen.findByRole("button", { name: "Lanjutkan commit upaya ini" }));
    await waitFor(() => expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ items: [{ productId: 1, quantity: 1 }] })));
    expect(localStorage.getItem(key)).not.toBeNull();
    expect(screen.getByRole("dialog", { name: "Status pembayaran belum diketahui" })).toBeTruthy();
  });

  it.each(["SHIFT_NOT_ACTIVE", "INSUFFICIENT_STOCK"] as const)("penolakan %s menampilkan upaya berikutnya", async (code) => {
    for (const attemptKey of ["co_test_1", "co_test_2"]) {
      localStorage.setItem(`pos.checkout.recovery.2.${attemptKey}`, JSON.stringify({
        attempt: { ...PREPARED, attemptKey }, cashReceivedRp: 10000, snapshot: [LINE], draftId: "draft-test",
      }));
    }
    const status = vi.fn(async (): Promise<CheckoutStatusResult> => PREPARED);
    const commit = vi.fn(async () => { throw new ApiError(409, code, "Ditolak"); });
    const { user } = renderPage({ status, commit });
    await user.click(screen.getByRole("button", { name: "Cek status upaya" }));
    await user.click(await screen.findByRole("button", { name: "Lanjutkan commit upaya ini" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Status pembayaran belum diketahui" }).textContent).toContain("co_test_2"));
    expect((screen.getByRole("button", { name: "Lanjut pembayaran" }) as HTMLButtonElement).disabled).toBe(true);
    expect(localStorage.getItem("pos.checkout.recovery.2.co_test_1")).toBeNull();
  });

  it.each(["INSUFFICIENT_STOCK", "SHIFT_NOT_ACTIVE"] as const)("%s memulihkan pembelian setelah reload dengan draft kosong", async (code) => {
    const key = "pos.checkout.recovery.2.co_test_1";
    localStorage.setItem(key, JSON.stringify({ attempt: PREPARED, cashReceivedRp: 10000, snapshot: [LINE], draftId: "sesi-lama" }));
    const status = vi.fn(async (): Promise<CheckoutStatusResult> => PREPARED);
    const commit = vi.fn(async () => { throw new ApiError(409, code, "Ditolak"); });
    const { user } = renderPage({ status, commit }, []);
    await user.click(screen.getByRole("button", { name: "Cek status upaya" }));
    await user.click(await screen.findByRole("button", { name: "Lanjutkan commit upaya ini" }));
    await waitFor(() => expect(screen.getByText("Produk Uji")).toBeTruthy());
    expect(screen.getByText("1 barang")).toBeTruthy();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("rekaman lama tanpa petunjuk stok dipulihkan secara konservatif", async () => {
    localStorage.setItem("pos.checkout.recovery.2", JSON.stringify({ attempt: PREPARED, cashReceivedRp: 10000 }));
    const status = vi.fn(async (): Promise<CheckoutStatusResult> => PREPARED);
    const commit = vi.fn(async () => { throw new ApiError(409, "INSUFFICIENT_STOCK", "Ditolak"); });
    const { user } = renderPage({ status, commit }, []);
    await user.click(screen.getByRole("button", { name: "Cek status upaya" }));
    await user.click(await screen.findByRole("button", { name: "Lanjutkan commit upaya ini" }));
    expect(await screen.findByText("Produk Uji")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Tambah satu Produk Uji" }));
    expect(screen.getByLabelText("Jumlah Produk Uji").textContent).toBe("1");
  });

  it("pemulihan penolakan tidak menimpa draft yang sudah berisi barang", async () => {
    localStorage.setItem("pos.checkout.recovery.2.co_test_1", JSON.stringify({ attempt: PREPARED, cashReceivedRp: 10000, snapshot: [LINE] }));
    const status = vi.fn(async (): Promise<CheckoutStatusResult> => PREPARED);
    const commit = vi.fn(async () => { throw new ApiError(409, "INSUFFICIENT_STOCK", "Ditolak"); });
    const other = { ...LINE, productId: 2, name: "Barang lain" };
    const { user } = renderPage({ status, commit }, [other]);
    await user.click(screen.getByRole("button", { name: "Cek status upaya" }));
    await user.click(await screen.findByRole("button", { name: "Lanjutkan commit upaya ini" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Menyimpan transaksi…" })).toBeNull());
    expect(screen.getByText("Barang lain")).toBeTruthy();
    expect(screen.queryByText("Produk Uji")).toBeNull();
  });

  it("penghapusan rekaman gagal tidak menyalin snapshot ke draft", async () => {
    const key = "pos.checkout.recovery.2.co_test_1";
    localStorage.setItem(key, JSON.stringify({ attempt: PREPARED, cashReceivedRp: 10000, snapshot: [LINE] }));
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("denied"); });
    try {
      const status = vi.fn(async (): Promise<CheckoutStatusResult> => PREPARED);
      const commit = vi.fn(async () => { throw new ApiError(409, "INSUFFICIENT_STOCK", "Ditolak"); });
      const { user } = renderPage({ status, commit }, []);
      await user.click(screen.getByRole("button", { name: "Cek status upaya" }));
      await user.click(await screen.findByRole("button", { name: "Lanjutkan commit upaya ini" }));
      expect(await screen.findByText(/Rekaman pemulihan tidak dapat dihapus/)).toBeTruthy();
      expect(screen.getByText("0 barang")).toBeTruthy();
      expect(localStorage.getItem(key)).not.toBeNull();
    } finally { remove.mockRestore(); }
  });

  it("hasil commit lama setelah navigasi tidak mengubah draft baru di App", async () => {
    const deferred = createDeferred<CommitCheckoutResult>();
    const source = buildSource({ commit: vi.fn(() => deferred.promise), findActiveProductByBarcode: vi.fn(async () => ({
      id: 1, sku: "SKU-001", name: "Produk Uji", priceRp: 5000, stock: 5, active: true,
    })) }).source;
    source.login = vi.fn(async () => ({ ok: true as const, user: { userId: 2, username: "uji", displayName: "Kasir", role: "CASHIER" as const } }));
    render(<App dataSource={source} onAfterLogout={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nama pengguna"), "uji");
    await user.type(screen.getByLabelText("Kata sandi"), "sintetis");
    await user.click(screen.getByRole("button", { name: "Masuk" }));
    await user.type(await screen.findByLabelText("Scan barcode", { selector: "input" }), "123{Enter}");
    await screen.findByText("Produk Uji");
    await openPayment(user);
    await user.type(screen.getByLabelText("Uang diterima (Rp)"), "10000");
    await user.click(screen.getByRole("button", { name: "Ya, commit pembayaran" }));
    await user.click(screen.getByRole("button", { name: "Riwayat/Struk" }));
    await user.click(screen.getByRole("button", { name: "Kasir" }));
    await user.click(await screen.findByRole("button", { name: "Cek status upaya" }));
    await user.click(await screen.findByRole("button", { name: "Transaksi baru" }));
    expect(screen.getByText("0 barang")).toBeTruthy();
    await user.type(screen.getByLabelText("Scan barcode", { selector: "input" }), "123{Enter}");
    await screen.findByText("Produk Uji");
    await act(async () => { deferred.resolve(COMMITTED); await deferred.promise; });
    expect(screen.getByText("Produk Uji")).toBeTruthy();
    expect(screen.getByText("1 barang")).toBeTruthy();
  });

  it.each([false, true])("menolak quote revisi membuka antrean lain bila ada: %s", async (other) => {
    const key = "pos.checkout.recovery.2.co_test_1";
    localStorage.setItem(key, JSON.stringify({ attempt: PREPARED, cashReceivedRp: 10000, snapshot: [LINE], draftId: "draft-test" }));
    if (other) localStorage.setItem("pos.checkout.recovery.2.co_test_2", JSON.stringify({ attempt: { ...PREPARED, attemptKey: "co_test_2" }, cashReceivedRp: 10000, snapshot: [LINE], draftId: "draft-lain" }));
    const prepare = vi.fn(async () => ({ ...PREPARED, attemptKey: "revised" }));
    const commit = vi.fn(async () => { throw new ApiError(409, "PRICE_CHANGED", "Harga berubah"); });
    const status = vi.fn(async (): Promise<CheckoutStatusResult> => PREPARED);
    const { user } = renderPage({ prepare, commit, status });
    await screen.findByText(/#7/);
    await user.click(screen.getByRole("button", { name: "Cek status upaya" }));
    await user.click(await screen.findByRole("button", { name: "Lanjutkan commit upaya ini" }));
    await user.click(await screen.findByRole("button", { name: "Tolak dan kembali" }));
    expect(localStorage.getItem(key)).toBeNull();
    if (other) expect(screen.getByRole("dialog", { name: "Status pembayaran belum diketahui" }).textContent).toContain("co_test_2");
    else expect(screen.queryByRole("dialog", { name: "Status pembayaran belum diketahui" })).toBeNull();
  });

  it("status tidak diketahui tetap terkunci dan meminta pemeriksaan", async () => {
    const commit = vi.fn(async () => { throw new ApiError(0, "NETWORK_ERROR", "timeout"); });
    const status = vi.fn(async (): Promise<CheckoutStatusResult> => { throw new ApiError(404, "NOT_FOUND", "Tidak ditemukan"); });
    const { user } = renderPage({ commit, status });
    await openPayment(user);
    await user.type(screen.getByLabelText("Uang diterima (Rp)"), "10000");
    await user.click(screen.getByRole("button", { name: "Ya, commit pembayaran" }));
    await user.click(await screen.findByRole("button", { name: "Cek status upaya" }));
    expect(screen.getByRole("dialog", { name: "Status pembayaran belum diketahui" }).textContent).toContain("Jangan bayar ulang");
    expect(screen.queryByRole("button", { name: "Lanjutkan commit upaya ini" })).toBeNull();
    expect(commit).toHaveBeenCalledTimes(1);
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

  it("lookup barcode tertunda tidak menambah barang setelah prepare dimulai", async () => {
    const lookup = createDeferred<ProductSummary | null>();
    const prepareDeferred = createDeferred<PrepareCheckoutResult>();
    const findActiveProductByBarcode = vi.fn(() => lookup.promise);
    const prepare = vi.fn(() => prepareDeferred.promise);
    const { user, callLog } = renderPage({ prepare, findActiveProductByBarcode });

    const barcodeInput = screen.getByLabelText("Scan barcode", { selector: "input" }) as HTMLInputElement;
    await user.type(barcodeInput, "000123{Enter}");
    expect(findActiveProductByBarcode).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Lanjut pembayaran" }));
    expect(barcodeInput.disabled).toBe(true);

    lookup.resolve({
      id: 2,
      sku: "SKU-TELAT",
      name: "Barang Telat",
      priceRp: 7000,
      stock: 5,
      active: true,
    });
    prepareDeferred.resolve(PREPARED);

    await screen.findByRole("dialog", { name: "Konfirmasi pembayaran tunai" });
    expect(screen.getByText("1 barang")).toBeTruthy();
    expect(screen.queryByText("Barang Telat")).toBeNull();
    expect(callLog.some((entry) => entry.isMutation)).toBe(false);
  });

  it("draft dan qty terkunci saat pembayaran; kembalian memakai quote dan commit hanya menghapus snapshot", async () => {
    const extraLine: CartLine = {
      productId: 2,
      sku: "SKU-002",
      name: "Produk Ekstra",
      unitPriceRp: 5000,
      quantity: 1,
      stockHint: 5,
    };

    function HarnessWithExternalLine({ source }: { source: PosDataSource }) {
      const [lines, setLines] = useState<CartLine[]>([LINE]);
      return (
        <div>
          <button type="button" onClick={() => setLines((current) => [...current, extraLine])}>
            Tambah eksternal
          </button>
          <CashierPage
            dataSource={source}
      draftId="draft-test"
      onDraftConsumed={(id, ids) => { if (id === "draft-test") setLines(current => ids ? current.filter(line => !ids.includes(line.productId)) : []); }} onDraftRestore={(id, restored) => { if (id === "draft-test") setLines(current => current.length ? current : restored); }}
            lines={lines}
            onLinesChange={setLines}
            sessionEpoch={1}
            cashierId={2}
            onSessionExpired={vi.fn()}
          />
        </div>
      );
    }

    render(<HarnessWithExternalLine source={buildSource().source} />);
    const user = userEvent.setup();
    await openPayment(user);

    const plus = screen.getByRole("button", { name: "Tambah satu Produk Uji" }) as HTMLButtonElement;
    const minus = screen.getByRole("button", { name: "Kurangi Produk Uji" }) as HTMLButtonElement;
    const remove = screen.getByRole("button", { name: "Hapus Produk Uji" }) as HTMLButtonElement;
    expect(plus.disabled).toBe(true);
    expect(minus.disabled).toBe(true);
    expect(remove.disabled).toBe(true);
    fireEvent.click(plus);
    expect(screen.getByLabelText("Jumlah Produk Uji").textContent).toBe("1");

    // Simulasikan baris yang masuk setelah quote (bypass UI yang memang sudah dikunci).
    await user.click(screen.getByRole("button", { name: "Tambah eksternal" }));
    expect(screen.getByText("2 barang")).toBeTruthy();

    await user.type(screen.getByLabelText("Uang diterima (Rp)"), "10000");
    // Total quote Rp5.000 → kembalian Rp5.000, bukan Rp0 dari total draft Rp10.000.
    expect(screen.getByText(/Kembalian:/).textContent).toContain("Rp5.000");
    await user.click(screen.getByRole("button", { name: "Ya, commit pembayaran" }));

    expect(await screen.findByRole("dialog", { name: "Transaksi tersimpan" })).toBeTruthy();
    expect(screen.getByText("1 barang")).toBeTruthy();
    expect(screen.getByText("Produk Ekstra")).toBeTruthy();
    expect(screen.queryByText("Produk Uji")).toBeNull();
  });

  it("INVALID_RESPONSE saat commit masuk pemulihan dan memakai attemptKey yang sama", async () => {
    let commitCalls = 0;
    const commit = vi.fn(async (_input: Parameters<PosDataSource["commitCheckout"]>[0]) => {
      commitCalls += 1;
      if (commitCalls === 1) {
        throw new ApiError(200, "INVALID_RESPONSE", "Respons backend tidak valid.");
      }
      return COMMITTED;
    });
    const status = vi.fn(async (): Promise<CheckoutStatusResult> => ({
      ...PREPARED,
      status: "PREPARED",
      quote: PREPARED.quote,
    }));
    const { source, user } = renderPage({ commit, status });

    await openPayment(user);
    await user.type(screen.getByLabelText("Uang diterima (Rp)"), "10000");
    await user.click(screen.getByRole("button", { name: "Ya, commit pembayaran" }));

    const timeout = await screen.findByRole("dialog", { name: "Status pembayaran belum diketahui" });
    expect(timeout.textContent).toContain("Jangan bayar ulang");
    expect(source.prepareCheckout).toHaveBeenCalledTimes(1);
    expect(commitCalls).toBe(1);

    await user.click(screen.getByRole("button", { name: "Cek status upaya" }));
    await waitFor(() => expect(screen.getByText(/Status: PREPARED/)).toBeTruthy());

    const pending = createDeferred<CheckoutStatusResult>();
    vi.mocked(source.getCheckoutStatus).mockImplementationOnce(() => pending.promise);
    await user.click(screen.getByRole("button", { name: "Cek status upaya" }));
    expect(screen.queryByRole("button", { name: "Lanjutkan commit upaya ini" })).toBeNull();

    pending.resolve({ ...PREPARED, status: "PREPARED", quote: PREPARED.quote });
    const continueButton = await screen.findByRole("button", { name: "Lanjutkan commit upaya ini" });
    await user.click(continueButton);

    expect(await screen.findByRole("dialog", { name: "Transaksi tersimpan" })).toBeTruthy();
    expect(commitCalls).toBe(2);
    const keys = vi.mocked(source.commitCheckout).mock.calls.map((call) => call[0].attemptKey);
    expect(keys).toEqual(["co_test_1", "co_test_1"]);
  });

  it("shift gagal dimuat menampilkan tombol Coba lagi tanpa refresh halaman", async () => {
    let calls = 0;
    const getCurrentShift = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        throw new ApiError(500, "INTERNAL_ERROR", "Backend shift sibuk.");
      }
      return SHIFT;
    });
    const { user } = renderPage({ getCurrentShift });

    expect(await screen.findByText("Backend shift sibuk.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));

    await waitFor(() => expect(getCurrentShift).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/#7/)).toBeTruthy();
  });

  it("commit yang selesai setelah epoch sesi berubah tidak menghapus draft", async () => {
    const result = createDeferred<CommitCheckoutResult>();
    const commit = vi.fn(() => result.promise);
    const source = buildSource({ commit }).source;

    function EpochHarness({ epoch }: { epoch: number }) {
      const [lines, setLines] = useState<CartLine[]>([LINE]);
      return (
        <CashierPage
          dataSource={source}
      draftId="draft-test"
      onDraftConsumed={(id, ids) => { if (id === "draft-test") setLines(current => ids ? current.filter(line => !ids.includes(line.productId)) : []); }} onDraftRestore={(id, restored) => { if (id === "draft-test") setLines(current => current.length ? current : restored); }}
          lines={lines}
          onLinesChange={setLines}
          sessionEpoch={epoch}
          cashierId={2}
          onSessionExpired={vi.fn()}
        />
      );
    }

    const view = render(<EpochHarness epoch={1} />);
    const user = userEvent.setup();
    await openPayment(user);
    await user.type(screen.getByLabelText("Uang diterima (Rp)"), "10000");
    await user.click(screen.getByRole("button", { name: "Ya, commit pembayaran" }));

    // Simulasikan logout/pindah sesi sebelum backend menjawab.
    view.rerender(<EpochHarness epoch={2} />);
    result.resolve(COMMITTED);

    await waitFor(() => expect(source.commitCheckout).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog", { name: "Transaksi tersimpan" })).toBeNull();
    expect(screen.getByText("1 barang")).toBeTruthy();
  });
});
