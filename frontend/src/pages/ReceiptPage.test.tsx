import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockDataSource } from "../api/mockDataSource";
import type { PosDataSource, PrintResult, ReceiptView } from "../api/types";
import { ReceiptPage } from "./ReceiptPage";

const VIEW: ReceiptView = {
  receipt: {
    saleId: 77,
    saleNo: "S-000077",
    committedAtMs: 1_700_000_000_000,
    totalRp: 2500,
    items: [
      { sku: "FX-001", name: "Produk lama", quantity: 1, unitPriceRp: 2500, lineTotalRp: 2500 },
    ],
    payment: {
      method: "QRIS_MANUAL",
      amountRp: 2500,
      cashReceivedRp: null,
      changeRp: 0,
      evidenceRef: "REF-77",
      verifiedAtMs: 1_700_000_000_000,
    },
  },
  text: "=== STRUK DEMO ===\nNo. Penjualan : S-000077\n1 x Rp2500 = Rp2500\n",
  demo: true,
};

const PRINTED: PrintResult = {
  saleId: 77,
  saleNo: "S-000077",
  status: "PRINTED",
  channel: "VIRTUAL",
  printedAtMs: 1_700_000_010_000,
  text: VIEW.text,
  demo: true,
};

function source(overrides: Partial<PosDataSource> = {}): PosDataSource {
  return { ...createMockDataSource(), ...overrides };
}

describe("TASK-021 ReceiptPage — cetak ulang dari saleId tersimpan", () => {
  it.each(["S-000208", "s-000208", "S-208", "208", "000208", "  S-000208  "])(
    "BUG-101: memuat nomor struk %s sebagai ID 208",
    async (input) => {
      const view = { ...VIEW, receipt: { ...VIEW.receipt, saleId: 208, saleNo: "S-000208" }, text: "No. Penjualan : S-000208" };
      const getSaleReceipt = vi.fn(async () => view);
      const user = userEvent.setup();
      render(<ReceiptPage dataSource={source({ getSaleReceipt })} onSessionExpired={vi.fn()} />);
      await user.type(screen.getByLabelText(/ID transaksi tersimpan/), input);
      await user.click(screen.getByRole("button", { name: "Muat struk" }));
      expect((await screen.findByTestId("receipt-text")).textContent).toContain("S-000208");
      expect(getSaleReceipt).toHaveBeenCalledWith(208);
    },
  );

  it("memuat dan mencetak ulang struk lama tanpa checkout baru", async () => {
    const getSaleReceipt = vi.fn(async () => VIEW);
    const printSaleReceipt = vi.fn(async () => PRINTED);
    const user = userEvent.setup();
    render(
      <ReceiptPage
        dataSource={source({ getSaleReceipt, printSaleReceipt })}
        onSessionExpired={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText(/ID transaksi tersimpan/), "77");
    await user.click(screen.getByRole("button", { name: "Muat struk" }));
    expect(await screen.findByTestId("receipt-text")).toBeTruthy();
    expect(getSaleReceipt).toHaveBeenCalledWith(77);
    await user.click(screen.getByRole("button", { name: /Cetak struk/ }));
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(printSaleReceipt).toHaveBeenCalledWith(77);
    // Tidak ada pemanggilan prepare/commit checkout dari halaman ini.
    expect(screen.queryByRole("button", { name: /Lanjut pembayaran/ })).toBeNull();
  });

  it("menolak ID bukan bilangan bulat positif tanpa memanggil backend", async () => {
    const getSaleReceipt = vi.fn(async () => VIEW);
    const user = userEvent.setup();
    render(
      <ReceiptPage dataSource={source({ getSaleReceipt })} onSessionExpired={vi.fn()} />,
    );
    await user.type(screen.getByLabelText(/ID transaksi tersimpan/), "abc");
    await user.click(screen.getByRole("button", { name: "Muat struk" }));
    expect((await screen.findByRole("alert")).textContent).toContain("bilangan bulat positif");
    expect(getSaleReceipt).not.toHaveBeenCalled();
  });
});


it("daftar otomatis dimuat untuk transaksi hari ini dan klik nomor membuka struk di pop-up", async () => {
  const now = Date.now();
  const yesterday = now - 2 * 24 * 60 * 60 * 1000;
  const getRecentSales = vi.fn(async () => [
    { saleId: 77, saleNo: "S-000077", committedAtMs: now, totalRp: 2500, method: "CASH" as const },
    { saleId: 76, saleNo: "S-000076", committedAtMs: yesterday, totalRp: 5000, method: "CASH" as const },
  ]);
  const getSaleReceipt = vi.fn(async () => VIEW);
  const user = userEvent.setup();
  render(<ReceiptPage dataSource={source({ getRecentSales, getSaleReceipt })} onSessionExpired={vi.fn()} />);
  expect(await screen.findByText("Transaksi hari ini")).toBeTruthy();
  expect(await screen.findByRole("button", { name: "S-000077" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "S-000076" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "S-000077" }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(await screen.findByTestId("receipt-text")).toBeTruthy();
  expect(getSaleReceipt).toHaveBeenCalledWith(77);
  expect(getRecentSales).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Tutup struk" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  await user.click(screen.getByRole("button", { name: "S-000077" }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("BUG-180: menampilkan pesan kosong hari ini dan paginasi slide samping bila transaksi hari ini > 20", async () => {
  const user = userEvent.setup();
  const emptySource = source({ getRecentSales: async () => [] });
  const { unmount } = render(<ReceiptPage dataSource={emptySource} onSessionExpired={vi.fn()} />);
  expect(await screen.findByText("Belum ada transaksi hari ini.")).toBeTruthy();
  unmount();

  const now = Date.now();
  const sales25 = Array.from({ length: 25 }, (_, i) => ({
    saleId: 100 + i,
    saleNo: `S-000${100 + i}`,
    committedAtMs: now,
    totalRp: 5000,
    method: "CASH" as const,
  }));
  render(
    <ReceiptPage
      dataSource={source({ getRecentSales: async () => sales25, getSaleReceipt: async () => VIEW })}
      onSessionExpired={vi.fn()}
    />,
  );
  expect(await screen.findByText("Halaman 1 dari 2")).toBeTruthy();
  expect(screen.getByRole("button", { name: "S-000100" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "S-000120" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Berikutnya" }));
  expect(await screen.findByText("Halaman 2 dari 2")).toBeTruthy();
  expect(screen.getByRole("button", { name: "S-000120" })).toBeTruthy();
});

it("BUG-186, BUG-187, BUG-188: batas tengah malam lokal berikutnya, deduplikasi batch, dan manajemen fokus modal", async () => {
  const user = userEvent.setup();
  const now = new Date();
  const nextMidnightMs = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const lastMsToday = nextMidnightMs - 1;
  const firstMsTomorrow = nextMidnightMs;

  const batch1 = Array.from({ length: 100 }, (_, i) => ({
    saleId: 1000 - i,
    saleNo: `S-${1000 - i}`,
    committedAtMs: lastMsToday,
    totalRp: 5000,
    method: "CASH" as const,
  }));
  const batch2 = [
    batch1[99]!,
    {
      saleId: 899,
      saleNo: "S-899",
      committedAtMs: lastMsToday,
      totalRp: 5000,
      method: "CASH" as const,
    },
    {
      saleId: 898,
      saleNo: "S-898",
      committedAtMs: firstMsTomorrow,
      totalRp: 5000,
      method: "CASH" as const,
    },
  ];
  const getRecentSales = vi.fn(async (opts?: { offset?: number }) =>
    (opts?.offset ?? 0) === 0 ? batch1 : batch2,
  );
  const getSaleReceipt = vi.fn(async () => VIEW);
  render(<ReceiptPage dataSource={source({ getRecentSales, getSaleReceipt })} onSessionExpired={vi.fn()} />);

  const opener = await screen.findByRole("button", { name: "S-1000" });
  expect(screen.queryByRole("button", { name: "S-898" })).toBeNull();
  expect(screen.getByText("Halaman 1 dari 6")).toBeTruthy();

  opener.focus();
  await user.click(opener);
  const dialog = await screen.findByRole("dialog");
  await screen.findByTestId("receipt-text");
  expect(dialog.contains(document.activeElement)).toBe(true);

  for (let i = 0; i < 6; i += 1) {
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  }

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
});
