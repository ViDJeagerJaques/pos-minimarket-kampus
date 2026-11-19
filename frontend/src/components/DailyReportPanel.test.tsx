import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import { createMockDataSource } from "../api/mockDataSource";
import type { DailyReport, DailyReportFilter, PosDataSource } from "../api/types";
import { DailyReportPanel, exclusiveEndMs } from "./DailyReportPanel";

const REPORT: DailyReport = {
  startMs: 1_700_000_000_000,
  endMs: 1_700_086_400_000,
  shiftId: 7,
  cash: { totalRp: 125_000, count: 5 },
  qrisManual: { totalRp: 25_000, count: 1, verifiedCount: 1 },
  totalRp: 150_000,
  saleCount: 6,
  sales: [
    {
      saleId: 1,
      saleNo: "S-000001",
      committedAtMs: 1_700_000_010_000,
      shiftId: 7,
      cashierUsername: "kasir.demo",
      method: "CASH",
      amountRp: 125_000,
    },
  ],
  salesTruncated: true,
  generatedAtMs: 1_700_086_400_000,
};

function makeSource(getDailyReport: PosDataSource["getDailyReport"]) {
  return { ...createMockDataSource(), authMode: "LOCAL_API" as const, getDailyReport };
}

function renderPanel(source: PosDataSource, onSessionExpired = vi.fn()) {
  render(<DailyReportPanel dataSource={source} onSessionExpired={onSessionExpired} />);
  return { onSessionExpired };
}

describe("TASK-027 DailyReportPanel — filter dan angka dari backend", () => {
  it("mengirim filter [start,end) dan menampilkan angka backend tanpa dihitung ulang", async () => {
    const getDailyReport = vi.fn(async (_filter: DailyReportFilter) => REPORT);
    renderPanel(makeSource(getDailyReport));
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Muat laporan" }));

    await waitFor(() => expect(getDailyReport).toHaveBeenCalledTimes(1));
    const filter = getDailyReport.mock.calls[0]![0];
    expect(filter.startMs).toBeLessThan(filter.endMs);
    expect(filter.shiftId).toBeUndefined();
    expect(screen.getByText("Rp150.000")).toBeTruthy();
    expect(screen.getByText(/6 transaksi tersimpan/)).toBeTruthy();
    const table = screen.getByRole("table", { name: "Rincian penjualan harian" });
    expect(table.textContent).toContain("S-000001");
    expect(screen.getByText(/Menampilkan sebagian transaksi/)).toBeTruthy();
  });

  it("filter shift diteruskan ke backend", async () => {
    const getDailyReport = vi.fn(async (_filter: DailyReportFilter) => REPORT);
    renderPanel(makeSource(getDailyReport));
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/ID shift/), "7");
    await user.click(screen.getByRole("button", { name: "Muat laporan" }));
    await waitFor(() => expect(getDailyReport).toHaveBeenCalledTimes(1));
    expect(getDailyReport.mock.calls[0]![0].shiftId).toBe(7);
  });

  it("rentang terbalik ditolak di UI tanpa memanggil backend", async () => {
    const getDailyReport = vi.fn(async (_filter: DailyReportFilter) => REPORT);
    renderPanel(makeSource(getDailyReport));
    const user = userEvent.setup();

    fireEvent.change(screen.getByLabelText(/Tanggal mulai/), { target: { value: "2099-01-02" } });
    fireEvent.change(screen.getByLabelText(/Tanggal akhir/), { target: { value: "2099-01-01" } });
    await user.click(screen.getByRole("button", { name: "Muat laporan" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Tanggal akhir");
    expect(getDailyReport).not.toHaveBeenCalled();
  });

  it("exclusiveEndMs mengikuti kalender lokal pada hari DST 23 dan 25 jam", () => {
    const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
    const original = env.TZ;
    try {
      env.TZ = "America/New_York";
      const springStart = new Date(2026, 2, 8).getTime();
      const springEnd = new Date(2026, 2, 9).getTime();
      expect(springEnd - springStart).toBe(23 * 60 * 60_000);
      expect(exclusiveEndMs("2026-03-08")).toBe(springEnd);

      const fallStart = new Date(2026, 10, 1).getTime();
      const fallEnd = new Date(2026, 10, 2).getTime();
      expect(fallEnd - fallStart).toBe(25 * 60 * 60_000);
      expect(exclusiveEndMs("2026-11-01")).toBe(fallEnd);
    } finally {
      if (original === undefined) delete env.TZ;
      else env.TZ = original;
    }
  });

  it("kasir tanpa username tidak ditampilkan sebagai ID penjualan", async () => {
    const reportWithUnknownCashier: DailyReport = {
      ...REPORT,
      sales: [{ ...REPORT.sales[0]!, cashierUsername: null }],
    };
    const getDailyReport = vi.fn(async (_filter: DailyReportFilter) => reportWithUnknownCashier);
    renderPanel(makeSource(getDailyReport));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Muat laporan" }));
    const table = await screen.findByRole("table", { name: "Rincian penjualan harian" });
    expect(table.textContent).toContain("Kasir tidak diketahui");
    expect(table.textContent).not.toContain("#1");
  });

  it("403 ditampilkan sebagai error tanpa mengakhiri sesi", async () => {
    const forbidden = vi.fn(async () => {
      throw new ApiError(403, "FORBIDDEN", "Laporan hanya untuk ADMIN.");
    });
    const { onSessionExpired } = renderPanel(makeSource(forbidden));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Muat laporan" }));
    expect((await screen.findByRole("alert")).textContent).toContain("hanya untuk ADMIN");
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("401 mengalihkan ke login", async () => {
    const unauthorized = vi.fn(async () => {
      throw new ApiError(401, "AUTH_REQUIRED", "Sesi berakhir.");
    });
    const { onSessionExpired } = renderPanel(makeSource(unauthorized));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Muat laporan" }));
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
  });
});
