import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import { createMockDataSource } from "../api/mockDataSource";
import type { DailyReport, PosDataSource, SessionUser, StockReport } from "../api/types";
import { toDateInputValue } from "../components/DailyReportPanel";
import { DashboardPage } from "./DashboardPage";

const ADMIN: SessionUser = { userId: 1, username: "admin.fixture", displayName: "Admin DEMO", role: "ADMIN" };
const DAILY: DailyReport = {
  startMs: 0, endMs: 86400000, shiftId: null, generatedAtMs: 1000,
  totalRp: 10000, saleCount: 3, cash: { totalRp: 7500, count: 2 },
  qrisManual: { totalRp: 2500, count: 1, verifiedCount: 1 }, salesTruncated: false,
  sales: [
    { saleId: 1, saleNo: "DEMO-1", shiftId: 10, cashierUsername: "pagi", committedAtMs: 1000, method: "CASH", amountRp: 5000, items: [{ sku: "SKU-DEMO", name: "Barang DEMO", quantity: 2, unitPriceRp: 2500, lineTotalRp: 5000 }] },
    { saleId: 2, saleNo: "DEMO-2", shiftId: 10, cashierUsername: "pagi", committedAtMs: 2000, method: "QRIS_MANUAL", amountRp: 2500 },
    { saleId: 3, saleNo: "DEMO-3", shiftId: 11, cashierUsername: "sore", committedAtMs: 3000, method: "CASH", amountRp: 2500 },
  ],
};
const STOCK: StockReport = {
  generatedAtMs: 2000, lowStockThreshold: 5,
  products: [0, 2, 8].map((onHand, i) => ({ productId: i + 1, sku: `DEMO-${i}`, name: `Produk ${i}`,
    onHand, opening: onHand, receipt: 0, sale: 0, adjustment: 0, matched: true,
    zero: onHand === 0, low: onHand > 0 && onHand <= 5, movements: [], movementsTruncated: false })),
};
function source(overrides: Partial<PosDataSource> = {}): PosDataSource {
  return { ...createMockDataSource({ latencyMs: 0 }), authMode: "LOCAL_API", catalogMode: "LOCAL_API",
    getDailyReport: vi.fn(async () => DAILY), getStockReport: vi.fn(async () => STOCK), ...overrides };
}
function show(dataSource = source(), user = ADMIN, onSessionExpired = vi.fn()) {
  return { ...render(<DashboardPage dataSource={dataSource} currentUser={user} onSessionExpired={onSessionExpired} />), onSessionExpired };
}
async function loaded() { await screen.findByRole("article", { name: "Omzet" }); }

describe("TASK-040 Dashboard ADMIN", () => {
  it("dua shift, CASH/QRIS dan stok memakai laporan; tidak mencampur QRIS ke kas", async () => {
    const api = source();
    const { container } = show(api);
    await loaded();
    expect(within(screen.getByRole("article", { name: "Omzet" })).getByText("Rp10.000")).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "Jumlah transaksi" })).getByText("3")).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "Penjualan CASH" })).getByText("Rp7.500")).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "Penjualan QRIS" })).getByText("Rp2.500")).toBeTruthy();
    expect(screen.getByText(/QRIS tidak menambah uang kas laci/)).toBeTruthy();
    expect(screen.getByText(/Draft dan transaksi gagal/)).toBeTruthy();
    const rows = within(screen.getByRole("table", { name: "Penjualan per shift" })).getAllByRole("row");
    expect(rows[1]?.textContent).toContain("#102Rp5.000Rp2.500Rp7.500");
    expect(rows[2]?.textContent).toContain("#111Rp2.500Rp0Rp2.500");
    expect(within(screen.getByRole("article", { name: "Jumlah stok menipis" })).getByText("1")).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "Jumlah stok habis" })).getByText("1")).toBeTruthy();
    expect(screen.queryByText("DEMO-2 — Produk 2")).toBeNull();
    expect(container.querySelector(".dashboard__primary")).toBeTruthy();
    expect(container.querySelector(".dashboard__accent")).toBeTruthy();
  });

  it("tanggal lokal [start,end) dan ambang dikirim; stok tetap snapshot terkini", async () => {
    const api = source(); show(api); await loaded();
    fireEvent.change(screen.getByLabelText("Tanggal penjualan"), { target: { value: "2026-11-17" } });
    fireEvent.change(screen.getByLabelText(/Ambang stok/), { target: { value: "2" } });
    await userEvent.click(screen.getByRole("button", { name: "Perbarui dashboard" }));
    await waitFor(() => expect(api.getDailyReport).toHaveBeenLastCalledWith({
      startMs: new Date(2026, 10, 17).getTime(), endMs: new Date(2026, 10, 18).getTime(),
    }));
    expect(api.getStockReport).toHaveBeenLastCalledWith({ lowStockThreshold: 2 });
    expect(screen.getByText(/bukan stok historis/)).toBeTruthy();
  });

  it("input invalid tidak memanggil laporan ulang", async () => {
    const api = source(); show(api); await loaded();
    fireEvent.change(screen.getByLabelText(/Ambang stok/), { target: { value: "-1" } });
    await userEvent.click(screen.getByRole("button", { name: "Perbarui dashboard" }));
    expect(screen.getByRole("alert").textContent).toContain("bilangan bulat");
    expect(api.getDailyReport).toHaveBeenCalledTimes(1);
  });

  it("rincian terpotong tidak dijumlahkan menjadi rekap shift palsu", async () => {
    show(source({ getDailyReport: vi.fn(async () => ({ ...DAILY, salesTruncated: true, sales: DAILY.sales.slice(0, 1) })) }));
    await loaded();
    expect(screen.getByText(/Rincian backend dibatasi/)).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Penjualan per shift" })).toBeNull();
    expect(within(screen.getByRole("article", { name: "Omzet" })).getByText("Rp10.000")).toBeTruthy();
  });

  it("kosong menampilkan nol hanya setelah backend selesai", async () => {
    show(source({
      getDailyReport: vi.fn(async () => ({ ...DAILY, totalRp: 0, saleCount: 0, sales: [], cash: { totalRp: 0, count: 0 }, qrisManual: { totalRp: 0, count: 0, verifiedCount: 0 } })),
      getStockReport: vi.fn(async () => ({ ...STOCK, products: [] })),
    }));
    expect(screen.queryByRole("article", { name: "Omzet" })).toBeNull();
    await loaded();
    expect(screen.getByText(/Belum ada transaksi tersimpan/)).toBeTruthy();
    expect(screen.getByText(/Belum ada produk/)).toBeTruthy();
  });

  it("403 tetap error, tidak menampilkan angka lama, lalu dapat retry", async () => {
    const getDailyReport = vi.fn<PosDataSource["getDailyReport"]>()
      .mockResolvedValueOnce(DAILY).mockRejectedValueOnce(new ApiError(403, "FORBIDDEN", "Akses ditolak"))
      .mockResolvedValueOnce(DAILY);
    const { onSessionExpired } = show(source({ getDailyReport })); await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Perbarui dashboard" }));
    expect(await screen.findByText("Akses ditolak")).toBeTruthy();
    expect(screen.queryByRole("article", { name: "Omzet" })).toBeNull();
    expect(onSessionExpired).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Perbarui dashboard" }));
    await loaded();
  });

  it("401 meminta login ulang", async () => {
    const { onSessionExpired } = show(source({ getStockReport: vi.fn(async () => { throw new ApiError(401, "AUTH_REQUIRED", "Sesi habis"); }) }));
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
  });

  it.each(["daily", "stock"] as const)("BUG-096: 401 %s tetap mengakhiri sesi setelah laporan lain gagal", async (lateReport) => {
    let rejectLate!: (error: unknown) => void;
    const late = new Promise<never>((_, reject) => { rejectLate = reject; });
    const firstFailure = async () => { throw new ApiError(500, "INTERNAL_ERROR", "Laporan gagal duluan"); };
    const api = source({
      getDailyReport: vi.fn(lateReport === "daily" ? () => late : firstFailure),
      getStockReport: vi.fn(lateReport === "stock" ? () => late : firstFailure),
    });
    const { onSessionExpired } = show(api);
    expect(await screen.findByText("Laporan gagal duluan")).toBeTruthy();
    expect(onSessionExpired).not.toHaveBeenCalled();
    await act(async () => rejectLate(new ApiError(401, "AUTH_REQUIRED", "Sesi habis")));
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("article", { name: "Omzet" })).toBeNull();
  });

  it.each(["daily", "stock"] as const)("BUG-096: 401 %s setelah unmount tidak mengakhiri sesi berikutnya", async (lateReport) => {
    let rejectLate!: (error: unknown) => void;
    const late = new Promise<never>((_, reject) => { rejectLate = reject; });
    const firstFailure = async () => { throw new ApiError(500, "INTERNAL_ERROR", "Laporan gagal duluan"); };
    const view = show(source({
      getDailyReport: vi.fn(lateReport === "daily" ? () => late : firstFailure),
      getStockReport: vi.fn(lateReport === "stock" ? () => late : firstFailure),
    }));
    await screen.findByText("Laporan gagal duluan");
    view.unmount();
    await act(async () => rejectLate(new ApiError(401, "AUTH_REQUIRED", "Sesi habis")));
    expect(view.onSessionExpired).not.toHaveBeenCalled();
  });

  it("CASHIER tidak merender dashboard atau memanggil laporan", () => {
    const api = source(); show(api, { ...ADMIN, role: "CASHIER" });
    expect(screen.getByRole("alert").textContent).toContain("hanya dapat diakses ADMIN");
    expect(api.getDailyReport).not.toHaveBeenCalled();
    expect(api.getStockReport).not.toHaveBeenCalled();
  });

  it("loader mengunci refresh; respons setelah unmount diabaikan", async () => {
    let resolve!: (report: DailyReport) => void;
    const api = source({ getDailyReport: vi.fn(() => new Promise<DailyReport>((r) => { resolve = r; })) });
    const view = show(api);
    expect((screen.getByRole("button", { name: "Memuat dashboard…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("article", { name: "Omzet" })).toBeNull();
    view.unmount();
    await act(async () => resolve(DAILY));
    expect(view.onSessionExpired).not.toHaveBeenCalled();
  });

  it("mock selalu berlabel DEMO dan ketidakcocokan ledger diberitahukan", async () => {
    show(source({ authMode: "DEMO", getStockReport: vi.fn(async () => ({ ...STOCK, products: [{ ...STOCK.products[0]!, matched: false }] })) }));
    await loaded();
    expect(screen.getByText(/DEMO — data sintetis/)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("belum cocok dengan ledger");
  });

  it("fixture DEMO mengikuti filter tanggal/shift dan ambang tanpa angka ringkasan yang bertentangan", async () => {
    const api = createMockDataSource({ latencyMs: 0 });
    const filter = { startMs: 1000, endMs: 2000 };
    const report = await api.getDailyReport(filter);
    expect(report.startMs).toBe(1000);
    expect(report.endMs).toBe(2000);
    expect(report.saleCount).toBe(report.sales.length);
    expect(report.totalRp).toBe(report.cash.totalRp + report.qrisManual.totalRp);
    expect(new Set(report.sales.map((sale) => sale.shiftId)).size).toBe(2);
    const shift = await api.getDailyReport({ ...filter, shiftId: 8 });
    expect(shift.saleCount).toBe(1);
    expect(shift.cash.totalRp).toBe(0);
    const stock = await api.getStockReport({ lowStockThreshold: 7 });
    expect(stock.lowStockThreshold).toBe(7);
    expect(stock.products[0]?.low).toBe(true);
  });

  it("BUG-179: mengekspor ringkasan penjualan CSV dan Excel dengan nama laporan-penjualan-YYYY-MM-DD", async () => {
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return "blob:dash-url";
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const downloads: string[] = [];
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });

    const api = source();
    show(api);
    await loaded();
    fireEvent.change(screen.getByLabelText("Tanggal penjualan"), { target: { value: "2026-11-17" } });
    await userEvent.click(screen.getByRole("button", { name: "Perbarui dashboard" }));
    await loaded();

    await userEvent.click(screen.getByRole("button", { name: "Ekspor CSV" }));
    await userEvent.click(screen.getByRole("button", { name: "Ekspor Excel" }));

    expect(downloads).toEqual(["laporan-penjualan-2026-11-17.csv", "laporan-penjualan-2026-11-17.xlsx"]);
    const csvText = await blobs[0]!.text();
    expect(csvText).toContain("10000");
    expect(csvText).toContain("#10");
    expect(csvText).toContain("#11");
    expect(csvText).toContain("Barang DEMO,SKU-DEMO,2,2500,5000");
    const xlsx = new Uint8Array(await blobs[1]!.arrayBuffer());
    expect(Array.from(xlsx.slice(0, 4))).toEqual([80, 75, 3, 4]);
    const xml = new TextDecoder().decode(xlsx);
    expect(xml).toContain("xl/worksheets/sheet1.xml");
    expect(xml).toContain("xl/tables/table1.xml");
    expect(xml).toContain("xl/styles.xml");
    expect(xml).toContain("autoFilter");
    expect(xml).toContain('state="frozen"');
    expect(xml).toContain("Barang DEMO");
    expect(xml).toContain("SKU-DEMO");
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("BUG-179: tombol ekspor nonaktif saat kosong dan mencatat pembatasan backend saat salesTruncated", async () => {
    const { unmount } = show(source({
      getDailyReport: vi.fn(async () => ({
        ...DAILY,
        totalRp: 0,
        saleCount: 0,
        sales: [],
        cash: { totalRp: 0, count: 0 },
        qrisManual: { totalRp: 0, count: 0, verifiedCount: 0 },
      })),
    }));
    await loaded();
    expect((screen.getByRole("button", { name: "Ekspor CSV" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Ekspor Excel" }) as HTMLButtonElement).disabled).toBe(true);
    unmount();

    const blobs: Blob[] = [];
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn((b: Blob) => { blobs.push(b); return "blob:trunc"; }), revokeObjectURL: vi.fn() });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    show(source({ getDailyReport: vi.fn(async () => ({ ...DAILY, salesTruncated: true })) }));
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Ekspor CSV" }));
    expect(await blobs[0]!.text()).toContain("Rincian dibatasi backend");
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("BUG-181: ganti periode Hari, Bulan, Tahun mengubah rentang backend dan judul kartu", async () => {
    const api = source();
    show(api);
    await loaded();

    await userEvent.selectOptions(screen.getByLabelText("Periode"), "month");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Omzet bulan ini" })).toBeTruthy());
    const now = new Date();
    expect(api.getDailyReport).toHaveBeenLastCalledWith({
      startMs: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
      endMs: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime(),
    });

    await userEvent.selectOptions(screen.getByLabelText("Periode"), "year");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Omzet tahun ini" })).toBeTruthy());
    expect(api.getDailyReport).toHaveBeenLastCalledWith({
      startMs: new Date(now.getFullYear(), 0, 1).getTime(),
      endMs: new Date(now.getFullYear() + 1, 0, 1).getTime(),
    });
  });

  it("BUG-216: tanggal penjualan dibatasi max hari ini dan menolak tanggal masa depan", async () => {
    const api = source();
    show(api);
    await loaded();

    const now = new Date();
    const todayStr = toDateInputValue(now);
    const tomorrowStr = toDateInputValue(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

    const dateInput = screen.getByLabelText("Tanggal penjualan") as HTMLInputElement;
    expect(dateInput.max).toBe(todayStr);

    fireEvent.change(dateInput, { target: { value: tomorrowStr } });
    await userEvent.click(screen.getByRole("button", { name: "Perbarui dashboard" }));
    expect(screen.getByRole("alert").textContent).toContain("Tanggal tidak boleh lebih dari hari ini");
    expect(api.getDailyReport).toHaveBeenCalledTimes(1);

    await userEvent.selectOptions(screen.getByLabelText("Periode"), "month");
    expect(screen.getByRole("alert").textContent).toContain("Tanggal tidak boleh lebih dari hari ini");
    expect(api.getDailyReport).toHaveBeenCalledTimes(1);
  });

  it("BUG-217: periode Mingguan menghitung Senin-Minggu, menyesuaikan judul omzet, dan dipakai ekspor", async () => {
    const blobs: Blob[] = [];
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn((blob: Blob) => {
        blobs.push(blob);
        return "blob:week-url";
      }),
      revokeObjectURL: vi.fn(),
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const api = source();
    show(api);
    await loaded();

    await userEvent.selectOptions(screen.getByLabelText("Periode"), "week");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Omzet minggu ini" })).toBeTruthy());
    const now = new Date();
    const daysSinceMonday = (now.getDay() + 6) % 7;
    expect(api.getDailyReport).toHaveBeenLastCalledWith({
      startMs: new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday).getTime(),
      endMs: new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday + 7).getTime(),
    });

    const prevWeekSunday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - daysSinceMonday - 1,
    );
    const prevWeekSundayStr = toDateInputValue(prevWeekSunday);
    const prevWeekStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - daysSinceMonday - 7,
    ).getTime();
    const prevWeekEnd = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - daysSinceMonday,
    ).getTime();

    fireEvent.change(screen.getByLabelText("Tanggal penjualan"), {
      target: { value: prevWeekSundayStr },
    });
    await userEvent.click(screen.getByRole("button", { name: "Perbarui dashboard" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Omzet minggu terpilih" })).toBeTruthy());
    expect(api.getDailyReport).toHaveBeenLastCalledWith({
      startMs: prevWeekStart,
      endMs: prevWeekEnd,
    });

    await userEvent.click(screen.getByRole("button", { name: "Ekspor CSV" }));
    expect(await blobs[0]!.text()).toContain(`Periode week (${prevWeekSundayStr})`);

    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("BUG-223: max tanggal dan judul omzet diperbarui saat melewati tengah malam lokal dan saat fokus kembali", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 10, 24, 23, 59, 59, 0));
      const api = source();
      const view = show(api);
      await act(async () => {
        await Promise.resolve();
      });

      const dateInput = screen.getByLabelText("Tanggal penjualan") as HTMLInputElement;
      expect(dateInput.max).toBe("2026-11-24");
      expect(screen.getByRole("heading", { name: "Omzet hari ini" })).toBeTruthy();

      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(dateInput.max).toBe("2026-11-25");
      expect(screen.getByRole("heading", { name: "Omzet tanggal terpilih" })).toBeTruthy();

      vi.setSystemTime(new Date(2026, 10, 26, 8, 0, 0, 0));
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });
      expect(dateInput.max).toBe("2026-11-26");

      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

});
