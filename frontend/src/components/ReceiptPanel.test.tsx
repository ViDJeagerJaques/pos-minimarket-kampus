import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import { createMockDataSource } from "../api/mockDataSource";
import type { PosDataSource, PrintResult, ReceiptView } from "../api/types";
import { ReceiptPanel } from "./ReceiptPanel";

const VIEW: ReceiptView = {
  receipt: {
    saleId: 102,
    saleNo: "S-000102",
    committedAtMs: 1_700_000_000_000,
    totalRp: 5000,
    items: [
      { sku: "FX-001", name: "Fixture Produk", quantity: 2, unitPriceRp: 2500, lineTotalRp: 5000 },
    ],
    payment: {
      method: "CASH",
      amountRp: 5000,
      cashReceivedRp: 10_000,
      changeRp: 5000,
      evidenceRef: null,
      verifiedAtMs: null,
    },
  },
  text: "=== STRUK DEMO ===\nNo. Penjualan : S-000102\n2 x Rp2500 = Rp5000\n",
  demo: true,
};

const PRINTED: PrintResult = {
  saleId: 102,
  saleNo: "S-000102",
  status: "PRINTED",
  channel: "VIRTUAL",
  printedAtMs: 1_700_000_020_000,
  text: VIEW.text,
  demo: true,
};

function makeSource(overrides: Partial<PosDataSource> = {}): PosDataSource {
  return { ...createMockDataSource(), ...overrides };
}

describe("TASK-021 ReceiptPanel — struk dari transaksi tersimpan", () => {
  it("memuat pratinjau dari saleId lama saat tombol ditekan", async () => {
    const getSaleReceipt = vi.fn(async () => VIEW);
    const user = userEvent.setup();
    render(<ReceiptPanel dataSource={makeSource({ getSaleReceipt })} saleId={102} />);
    expect(screen.queryByTestId("receipt-text")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Lihat struk/ }));
    const text = await screen.findByTestId("receipt-text");
    expect(text.textContent).toContain("S-000102");
    expect(text.textContent).toContain("2 x Rp2500");
    expect(getSaleReceipt).toHaveBeenCalledWith(102);
  });

  it("cetak sukses menampilkan status dan memakai saleId lama", async () => {
    const printSaleReceipt = vi.fn(async () => PRINTED);
    const getSaleReceipt = vi.fn(async () => VIEW);
    const user = userEvent.setup();
    render(
      <ReceiptPanel
        dataSource={makeSource({ printSaleReceipt, getSaleReceipt })}
        saleId={102}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Cetak struk/ }));
    expect((await screen.findByRole("status")).textContent).toContain("TERCETAK (virtual DEMO)");
    expect(printSaleReceipt).toHaveBeenCalledWith(102);
    expect(getSaleReceipt).toHaveBeenCalledWith(102);
    expect(screen.getByTestId("receipt-text").textContent).toContain("S-000102");
  });

  it("PRINTER_UNAVAILABLE menampilkan status gagal dan mengizinkan cetak ulang tanpa transaksi baru", async () => {
    const printSaleReceipt = vi.fn(async () => {
      throw new ApiError(503, "PRINTER_UNAVAILABLE", "Printer mati (simulasi).");
    });
    const user = userEvent.setup();
    render(
      <ReceiptPanel dataSource={makeSource({ printSaleReceipt })} saleId={102} />,
    );
    await user.click(screen.getByRole("button", { name: /Cetak struk/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Printer mati (simulasi)");
    expect(alert.textContent).toContain("Transaksi tetap tersimpan");
    expect(alert.textContent).toContain("Tidak ada transaksi atau mutasi stok baru");
    await user.click(screen.getByRole("button", { name: /Cetak ulang/ }));
    await waitFor(() => expect(printSaleReceipt).toHaveBeenCalledTimes(2));
    expect(printSaleReceipt).toHaveBeenCalledWith(102);
  });

  it("401 dari backend mengalihkan ke login", async () => {
    const onSessionExpired = vi.fn();
    const getSaleReceipt = vi.fn(async () => {
      throw new ApiError(401, "AUTH_REQUIRED", "Sesi berakhir.");
    });
    const user = userEvent.setup();
    render(
      <ReceiptPanel
        dataSource={makeSource({ getSaleReceipt })}
        saleId={102}
        onSessionExpired={onSessionExpired}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Lihat struk/ }));
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
  });

  it("menyediakan fallback manual berupa teks struk yang dapat disalin", async () => {
    const user = userEvent.setup();
    render(<ReceiptPanel dataSource={makeSource({ getSaleReceipt: async () => VIEW })} saleId={102} />);
    await user.click(screen.getByRole("button", { name: /Lihat struk/ }));
    await screen.findByTestId("receipt-text");
    await user.click(screen.getByRole("button", { name: /Salin teks \(fallback manual\)/ }));
    await waitFor(() => {
      expect(screen.queryByRole("status")?.textContent ?? "").toMatch(/fallback manual/);
    });
  });

  it("BUG-077: cetak sukses tetapi pratinjau 401 mengembalikan aplikasi ke login", async () => {
    const onSessionExpired = vi.fn();
    const printSaleReceipt = vi.fn(async () => PRINTED);
    const getSaleReceipt = vi.fn(async () => {
      throw new ApiError(401, "AUTH_REQUIRED", "Sesi berakhir.");
    });
    const user = userEvent.setup();
    render(
      <ReceiptPanel
        dataSource={makeSource({ printSaleReceipt, getSaleReceipt })}
        saleId={102}
        onSessionExpired={onSessionExpired}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Cetak struk/ }));
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
    // Hasil cetak tetap dipertahankan walaupun sesi sudah habis.
    expect((await screen.findByRole("status")).textContent).toContain("TERCETAK (virtual DEMO)");
  });

  it("BUG-077: kegagalan pratinjau bukan sesi tetap memakai teks hasil cetak", async () => {
    const onSessionExpired = vi.fn();
    const getSaleReceipt = vi.fn(async () => {
      throw new ApiError(500, "INTERNAL_ERROR", "Struk gagal dimuat.");
    });
    const user = userEvent.setup();
    render(
      <ReceiptPanel
        dataSource={makeSource({ printSaleReceipt: async () => PRINTED, getSaleReceipt })}
        saleId={102}
        onSessionExpired={onSessionExpired}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Cetak struk/ }));
    expect((await screen.findByTestId("receipt-text")).textContent).toContain("S-000102");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onSessionExpired).not.toHaveBeenCalled();
  });
});
