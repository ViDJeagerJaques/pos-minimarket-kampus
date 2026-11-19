import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import { createMockDataSource } from "../api/mockDataSource";
import type { PosDataSource, StockReport } from "../api/types";
import { StockReportPanel } from "./StockReportPanel";

const REPORT: StockReport = {
  generatedAtMs: 1_700_000_000_000,
  lowStockThreshold: 5,
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

function makeSource(getStockReport: PosDataSource["getStockReport"]) {
  return { ...createMockDataSource(), authMode: "LOCAL_API" as const, getStockReport };
}

function renderPanel(source: PosDataSource, onSessionExpired = vi.fn()) {
  render(<StockReportPanel dataSource={source} onSessionExpired={onSessionExpired} />);
  return { onSessionExpired };
}

describe("TASK-027 StockReportPanel — saldo dan mutasi dari backend", () => {
  it("menampilkan saldo, komponen, dan riwayat mutasi apa adanya", async () => {
    const getStockReport = vi.fn(async (_filter: Parameters<PosDataSource["getStockReport"]>[0]) => REPORT);
    renderPanel(makeSource(getStockReport));
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Muat stok" }));

    await waitFor(() => expect(getStockReport).toHaveBeenCalledTimes(1));
    expect(getStockReport.mock.calls[0]![0]).toEqual({});
    const table = await screen.findByRole("table", { name: "Laporan stok per produk" });
    expect(table.textContent).toContain("FX-1");
    expect(table.textContent).toContain("7");
    const movements = screen.getByRole("table", { name: "Mutasi FX-1" });
    expect(movements.textContent).toContain("Penerimaan");
    expect(movements.textContent).toContain("rcv_hist_1");
  });

  it("ambang stok menipis diteruskan ke backend", async () => {
    const getStockReport = vi.fn(async (_filter: Parameters<PosDataSource["getStockReport"]>[0]) => REPORT);
    renderPanel(makeSource(getStockReport));
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Ambang stok menipis/), "5");
    await user.click(screen.getByRole("button", { name: "Muat stok" }));
    await waitFor(() => expect(getStockReport).toHaveBeenCalledTimes(1));
    expect(getStockReport.mock.calls[0]![0]).toEqual({ lowStockThreshold: 5 });
  });

  it("ambang tidak valid ditolak tanpa memanggil backend", async () => {
    const getStockReport = vi.fn(async (_filter: Parameters<PosDataSource["getStockReport"]>[0]) => REPORT);
    renderPanel(makeSource(getStockReport));
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Ambang stok menipis/), "abc");
    await user.click(screen.getByRole("button", { name: "Muat stok" }));
    expect((await screen.findByRole("alert")).textContent).toContain("bilangan bulat");
    expect(getStockReport).not.toHaveBeenCalled();
  });

  it("403 ditampilkan sebagai error tanpa mengakhiri sesi", async () => {
    const getStockReport = vi.fn(async () => {
      throw new ApiError(403, "FORBIDDEN", "Laporan stok hanya untuk ADMIN.");
    });
    const { onSessionExpired } = renderPanel(makeSource(getStockReport));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Muat stok" }));
    expect((await screen.findByRole("alert")).textContent).toContain("hanya untuk ADMIN");
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("401 mengalihkan ke login", async () => {
    const getStockReport = vi.fn(async () => {
      throw new ApiError(401, "AUTH_REQUIRED", "Sesi berakhir.");
    });
    const { onSessionExpired } = renderPanel(makeSource(getStockReport));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Muat stok" }));
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
  });
});
