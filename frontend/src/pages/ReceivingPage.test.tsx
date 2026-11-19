import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockDataSource } from "../api/mockDataSource";
import type {
  PosDataSource,
  ReceiveGoodsInput,
  ReceiptResult,
  StockReport,
} from "../api/types";
import type { ReceiptAttempt } from "../domain/receivingAttempt";
import { ReceivingPage } from "./ReceivingPage";

const ADMIN = { userId: 1, username: "admin.demo", displayName: "Admin DEMO", role: "ADMIN" as const };

const SUPPLIERS = [{ id: 1, name: "Supplier A" }];
const PRODUCTS = [
  { id: 1, sku: "FX-1", name: "Barang A", priceRp: 1000, stock: 2, active: true },
  { id: 101, sku: "FX-101", name: "Barang ke-101", priceRp: 2000, stock: 9, active: true },
];

function stockReport(overrides: Partial<StockReport> = {}): StockReport {
  return {
    generatedAtMs: 1_700_000_000_000,
    lowStockThreshold: 0,
    products: [
      {
        productId: 1,
        sku: "FX-1",
        name: "Barang A",
        onHand: 7,
        opening: 2,
        receipt: 5,
        sale: 0,
        adjustment: -2,
        matched: true,
        low: false,
        zero: false,
        movements: [
          {
            id: 9,
            kind: "RECEIPT",
            delta: 5,
            createdAtMs: 1_700_000_000_000,
            actorId: 1,
            sourceType: "RECEIPT_ITEM",
            sourceId: 1,
            sourceRef: "rcv_hist_1",
            sourceQuantity: 5,
            adjustmentReason: null,
          },
        ],
        movementsTruncated: false,
      },
    ],
    ...overrides,
  };
}

const RESULT: ReceiptResult = {
  receiptId: 11,
  receiptKey: "rcv_1",
  requestHash: "a".repeat(64),
  supplierId: 1,
  supplierRef: "SJ-1",
  committedAtMs: 1_700_000_000_000,
  totalQuantity: 5,
  items: [
    { receiptItemId: 21, productId: 1, sku: "FX-1", name: "Barang A", quantity: 5, movementId: 31 },
  ],
  duplicate: false,
};

function makeSource(overrides: Partial<PosDataSource> = {}) {
  const base = createMockDataSource({ latencyMs: 0 });
  const source: PosDataSource = {
    ...base,
    authMode: "LOCAL_API",
    catalogMode: "LOCAL_API",
    listSuppliers: vi.fn(async () => SUPPLIERS),
    searchActiveProducts: vi.fn(async (query: string) =>
      PRODUCTS.filter(
        (item) =>
          item.name.toLowerCase().includes(query.trim().toLowerCase()) ||
          item.sku.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    ),
    getStockReport: vi.fn(async () => stockReport()),
    ...overrides,
  };
  return { source, callLog: base.callLog };
}

function renderPage(source: PosDataSource, options: {
  attempt?: ReceiptAttempt | null;
  onSubmitAttempt?: (payload: ReceiveGoodsInput) => void;
  onRetryAttempt?: () => void;
  onClearAttempt?: () => void;
  onSessionExpired?: () => void;
} = {}) {
  const onSessionExpired = options.onSessionExpired ?? vi.fn();
  const onSubmitAttempt = options.onSubmitAttempt ?? vi.fn();
  const onRetryAttempt = options.onRetryAttempt ?? vi.fn();
  const onClearAttempt = options.onClearAttempt ?? vi.fn();
  const view = render(
    <ReceivingPage
      dataSource={source}
      currentUser={ADMIN}
      onSessionExpired={onSessionExpired}
      attempt={options.attempt ?? null}
      onSubmitAttempt={onSubmitAttempt}
      onRetryAttempt={onRetryAttempt}
      onClearAttempt={onClearAttempt}
    />,
  );
  return { view, onSessionExpired, onSubmitAttempt, onRetryAttempt, onClearAttempt };
}

async function fillDraft(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(await screen.findByLabelText(/Supplier/), "1");
  await waitFor(() => expect(screen.getByRole("option", { name: /FX-1 — Barang A/ })).toBeTruthy());
  await user.selectOptions(screen.getByLabelText("Produk"), "1");
  await user.type(screen.getByLabelText(/Jumlah diterima/), "5");
  await user.click(screen.getByRole("button", { name: "Tambah ke draft" }));
}

function committedAttempt(payload: ReceiveGoodsInput): ReceiptAttempt {
  return { receiptKey: payload.receiptKey, payload, status: "COMMITTED", result: RESULT, error: null };
}

describe("TASK-027 ReceivingPage — draft, upaya, riwayat", () => {
  it("batal draft yang belum dikirim tidak memanggil API dan tidak mengubah stok", async () => {
    const { source, callLog } = makeSource();
    const { onSubmitAttempt } = renderPage(source);
    const user = userEvent.setup();

    await fillDraft(user);
    expect(screen.getByRole("table", { name: "Draft penerimaan" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Batal draft" }));

    expect(screen.queryByRole("table", { name: "Draft penerimaan" })).toBeNull();
    expect(screen.getByText(/Draft dibatalkan/)).toBeTruthy();
    expect(onSubmitAttempt).not.toHaveBeenCalled();
    expect(callLog.filter((entry) => entry.isMutation && entry.operation === "receiveGoods")).toHaveLength(0);
  });

  it("konfirmasi mengirim payload sekali; hasil COMMITTED menyegarkan saldo dan riwayat", async () => {
    const { source } = makeSource();
    const { view, onSubmitAttempt } = renderPage(source);
    const user = userEvent.setup();

    await fillDraft(user);
    await user.click(screen.getByRole("button", { name: "Konfirmasi penerimaan" }));
    await user.click(screen.getByRole("button", { name: "Ya, simpan penerimaan" }));

    expect(onSubmitAttempt).toHaveBeenCalledTimes(1);
    const payload = (onSubmitAttempt as ReturnType<typeof vi.fn>).mock.calls[0]![0] as ReceiveGoodsInput;
    expect(payload.receiptKey).toMatch(/^rcv_/);
    expect(payload.supplierId).toBe(1);
    expect(payload.items).toEqual([{ productId: 1, quantity: 5 }]);

    view.rerender(
      <ReceivingPage
        dataSource={source}
        currentUser={ADMIN}
        onSessionExpired={vi.fn()}
        attempt={committedAttempt(payload)}
        onSubmitAttempt={onSubmitAttempt}
        onRetryAttempt={vi.fn()}
        onClearAttempt={vi.fn()}
      />,
    );
    expect(await screen.findByText("rcv_1")).toBeTruthy();
    expect(screen.getByText(/Saldo produk telah dimuat ulang/)).toBeTruthy();
    await waitFor(() => {
      expect((source.searchActiveProducts as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1);
      expect((source.getStockReport as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1);
    });
  });

  it("upaya PENDING mengunci draft dan tombol periksa ulang", async () => {
    const onClearAttempt = vi.fn();
    const { source } = makeSource();
    renderPage(source, {
      attempt: { receiptKey: "rcv_x", payload: { receiptKey: "rcv_x", supplierId: 1, items: [] }, status: "PENDING", result: null, error: null },
      onClearAttempt,
    });
    const user = userEvent.setup();

    expect((screen.getByLabelText("Produk") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Periksa ulang/ }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Batal draft" }));
    expect(screen.getByText(/masih diproses atau hasilnya belum pasti/)).toBeTruthy();
    expect(onClearAttempt).not.toHaveBeenCalled();
  });

  it("upaya UNKNOWN menampilkan error dan retry memakai kunci/payload asli", async () => {
    const payload: ReceiveGoodsInput = {
      receiptKey: "rcv_same",
      supplierId: 1,
      items: [{ productId: 1, quantity: 5 }],
      supplierRef: null,
    };
    const onRetryAttempt = vi.fn();
    const onClearAttempt = vi.fn();
    const { source } = makeSource();
    renderPage(source, {
      attempt: { receiptKey: "rcv_same", payload, status: "UNKNOWN", result: null, error: "Jaringan terputus." },
      onRetryAttempt,
      onClearAttempt,
    });
    const user = userEvent.setup();

    expect(screen.getByRole("alert").textContent).toContain("Jaringan terputus");
    expect(screen.getByText(/rcv_same/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Periksa ulang/ }));
    expect(onRetryAttempt).toHaveBeenCalledTimes(1);
    expect(onClearAttempt).not.toHaveBeenCalled();
  });

  it("401 dari pengiriman mengalihkan ke login", async () => {
    const onSessionExpired = vi.fn();
    const { source } = makeSource();
    renderPage(source, { onSubmitAttempt: () => onSessionExpired() });
    const user = userEvent.setup();
    await fillDraft(user);
    await user.click(screen.getByRole("button", { name: "Konfirmasi penerimaan" }));
    await user.click(screen.getByRole("button", { name: "Ya, simpan penerimaan" }));
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("produk di luar 100 pertama dapat dicari dan dipilih", async () => {
    const { source } = makeSource();
    renderPage(source);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Cari produk aktif/), "FX-101");
    await waitFor(() => expect(screen.getByRole("option", { name: /FX-101/ })).toBeTruthy());
    await user.selectOptions(screen.getByLabelText("Produk"), "101");
    await user.type(screen.getByLabelText(/Jumlah diterima/), "2");
    await user.click(screen.getByRole("button", { name: "Tambah ke draft" }));
    expect(screen.getByRole("table", { name: "Draft penerimaan" }).textContent).toContain("FX-101");
  });

  it("riwayat terpotong tidak menampilkan pesan kosong definitif", async () => {
    const report = stockReport();
    report.products[0]!.movements = [];
    report.products[0]!.movementsTruncated = true;
    const { source } = makeSource({ getStockReport: vi.fn(async () => report) });
    renderPage(source);
    expect(await screen.findByText(/Riwayat menampilkan sebagian/)).toBeTruthy();
    expect(screen.queryByText(/Belum ada mutasi penerimaan yang tersimpan/)).toBeNull();
  });

  it("riwayat menampilkan mutasi RECEIPT yang tersimpan", async () => {
    const { source } = makeSource();
    renderPage(source);
    const table = await screen.findByRole("table", { name: "Riwayat penerimaan tersimpan" });
    expect(table.textContent).toContain("rcv_hist_1");
    expect(table.textContent).toContain("Barang A");
  });

  it("mode DEMO diberi label dan tidak menjanjikan perubahan stok", async () => {
    const { source } = makeSource({ authMode: "DEMO", catalogMode: "DEMO" });
    renderPage(source);
    expect(await screen.findByText(/Mode DEMO: penerimaan tidak disimpan/)).toBeTruthy();
  });
});
