import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import { createMockDataSource } from "../api/mockDataSource";
import type { PosDataSource, ReceiveGoodsInput, ReceiptResult, StockReport } from "../api/types";
import { ReceivingPage } from "./ReceivingPage";

const ADMIN = { userId: 1, username: "admin.demo", displayName: "Admin DEMO", role: "ADMIN" as const };

const SUPPLIERS = [{ id: 1, name: "Supplier A" }];
const PRODUCTS = [
  { id: 1, sku: "FX-1", name: "Barang A", priceRp: 1000, stock: 2, active: true },
];

const STOCK_REPORT: StockReport = {
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
      adjustment: 0,
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
};

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
    listProducts: vi.fn(async () => PRODUCTS),
    getStockReport: vi.fn(async () => STOCK_REPORT),
    ...overrides,
  };
  return { source, callLog: base.callLog };
}

function renderPage(source: PosDataSource, onSessionExpired = vi.fn()) {
  render(<ReceivingPage dataSource={source} currentUser={ADMIN} onSessionExpired={onSessionExpired} />);
  return { onSessionExpired };
}

async function fillDraft(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(await screen.findByLabelText(/Supplier/), "1");
  await user.selectOptions(screen.getByLabelText(/Produk/), "1");
  await user.type(screen.getByLabelText(/Jumlah diterima/), "5");
  await user.click(screen.getByRole("button", { name: "Tambah ke draft" }));
}

describe("TASK-027 ReceivingPage — draft, konfirmasi, error, riwayat", () => {
  it("batal draft tidak memanggil API dan tidak mengubah stok", async () => {
    const receiveGoods = vi.fn(async () => RESULT);
    const { source, callLog } = makeSource({ receiveGoods });
    const user = userEvent.setup();
    renderPage(source);

    await fillDraft(user);
    expect(screen.getByRole("table", { name: "Draft penerimaan" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Batal draft" }));

    expect(screen.queryByRole("table", { name: "Draft penerimaan" })).toBeNull();
    expect(screen.getByText(/Draft dibatalkan/)).toBeTruthy();
    expect(receiveGoods).not.toHaveBeenCalled();
    expect(callLog.filter((entry) => entry.isMutation && entry.operation === "receiveGoods")).toHaveLength(0);
  });

  it("konfirmasi menyimpan penerimaan sekali dan menampilkan hasil backend", async () => {
    const receiveGoods = vi.fn(async (_input: ReceiveGoodsInput) => RESULT);
    const { source } = makeSource({ receiveGoods });
    const user = userEvent.setup();
    renderPage(source);

    await fillDraft(user);
    await user.click(screen.getByRole("button", { name: "Konfirmasi penerimaan" }));
    await user.click(screen.getByRole("button", { name: "Ya, simpan penerimaan" }));

    await waitFor(() => expect(receiveGoods).toHaveBeenCalledTimes(1));
    const payload = receiveGoods.mock.calls[0]![0];
    expect(payload.receiptKey).toMatch(/^rcv_/);
    expect(payload.supplierId).toBe(1);
    expect(payload.items).toEqual([{ productId: 1, quantity: 5 }]);
    expect(screen.getByText("rcv_1")).toBeTruthy();
    expect(screen.getByText(/Stok bertambah satu kali/)).toBeTruthy();
  });

  it("403 ditampilkan sebagai error dan draft dipertahankan untuk retry identik", async () => {
    const receiveGoods = vi.fn(async () => {
      throw new ApiError(403, "FORBIDDEN", "Hanya ADMIN yang boleh menerima barang.");
    });
    const { source } = makeSource({ receiveGoods });
    const { onSessionExpired } = renderPage(source);
    const user = userEvent.setup();

    await fillDraft(user);
    const keyBefore = screen.getByText(/Identitas upaya/).textContent ?? "";
    await user.click(screen.getByRole("button", { name: "Konfirmasi penerimaan" }));
    await user.click(screen.getByRole("button", { name: "Ya, simpan penerimaan" }));

    const alert = await screen.findByRole("status");
    expect(alert.textContent).toContain("Hanya ADMIN");
    expect(screen.getByRole("table", { name: "Draft penerimaan" })).toBeTruthy();
    expect(screen.getByText(/Identitas upaya/).textContent).toBe(keyBefore);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("401 dari penerimaan mengalihkan ke login", async () => {
    const receiveGoods = vi.fn(async () => {
      throw new ApiError(401, "AUTH_REQUIRED", "Sesi berakhir.");
    });
    const { source } = makeSource({ receiveGoods });
    const { onSessionExpired } = renderPage(source);
    const user = userEvent.setup();

    await fillDraft(user);
    await user.click(screen.getByRole("button", { name: "Konfirmasi penerimaan" }));
    await user.click(screen.getByRole("button", { name: "Ya, simpan penerimaan" }));

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
  });

  it("riwayat menampilkan mutasi RECEIPT yang tersimpan di backend", async () => {
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
