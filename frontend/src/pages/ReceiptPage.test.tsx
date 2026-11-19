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
