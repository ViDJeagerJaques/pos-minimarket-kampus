import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import { createMockDataSource } from "../api/mockDataSource";
import type {
  DailyReport,
  PaymentReport,
  PosDataSource,
  PrepareCheckoutResult,
  ReceiptView,
  SessionUser,
  ShiftClosePreview,
  ShiftSummary,
  StockReport,
} from "../api/types";
import { DailyReportPanel } from "../components/DailyReportPanel";
import { ReceiptPanel } from "../components/ReceiptPanel";
import { StockReportPanel } from "../components/StockReportPanel";
import type { CartLine } from "../domain/cart";
import { CashierPage } from "./CashierPage";
import { ProductsPage } from "./ProductsPage";
import { ReportsPage } from "./ReportsPage";
import { ShiftDemoPage } from "./ShiftDemoPage";
import { StockAdjustmentPage } from "./StockAdjustmentPage";

const CASHIER_USER: SessionUser = {
  userId: 2,
  username: "demo.kasir.pagi",
  displayName: "Kasir Pagi",
  role: "CASHIER",
};

const ACTIVE_SHIFT: ShiftSummary = {
  id: 1,
  cashierId: 2,
  openedAtMs: 1_700_000_000_000,
  openingCashRp: 100_000,
};

const SAMPLE_LINES: CartLine[] = [
  {
    productId: 1,
    sku: "BRG-001",
    name: "Air Mineral",
    unitPriceRp: 5000,
    quantity: 3,
    stockHint: 10,
  },
];

const PREPARE_OK: PrepareCheckoutResult = {
  attemptKey: "co_pr50_test",
  requestHash: "hash_pr50",
  status: "PREPARED",
  quote: {
    shiftId: 1,
    cashierId: 2,
    items: [
      {
        productId: 1,
        sku: "BRG-001",
        name: "Air Mineral",
        unitPriceRp: 5000,
        quantity: 3,
        lineTotalRp: 15000,
      },
    ],
    totalRp: 15000,
    payment: { method: "CASH" },
  },
};

const RECEIPT_VIEW: ReceiptView = {
  receipt: {
    saleId: 501,
    saleNo: "S-000501",
    committedAtMs: 1_700_000_000_000,
    totalRp: 15000,
    items: [
      { sku: "BRG-001", name: "Air Mineral", quantity: 3, unitPriceRp: 5000, lineTotalRp: 15000 },
    ],
    payment: {
      method: "CASH",
      amountRp: 15000,
      cashReceivedRp: 20000,
      changeRp: 5000,
      evidenceRef: null,
      verifiedAtMs: null,
    },
  },
  text: "=== STRUK DEMO ===\nBARIS: 1 · QTY: 3\nMETODE: TUNAI\n",
  demo: true,
};

function makeSource(overrides: Partial<PosDataSource> = {}): PosDataSource {
  return {
    ...createMockDataSource(),
    authMode: "LOCAL_API",
    getCurrentShift: async () => ACTIVE_SHIFT,
    ...overrides,
  };
}

describe("PR 50 UI integration", () => {
  it("CashierPage: promo, poin pelanggan, layar pelanggan, uang pas, guard QRIS, dan auto-load struk", async () => {
    localStorage.clear();
    const getSaleReceipt = vi.fn(async () => RECEIPT_VIEW);
    const prepareCheckout = vi.fn(async () => PREPARE_OK);
    const commitCheckout = vi.fn(async () => ({
      attemptKey: PREPARE_OK.attemptKey,
      requestHash: PREPARE_OK.requestHash,
      status: "COMMITTED" as const,
      replayed: false,
      saleId: 501,
      saleNo: "S-000501",
      committedAtMs: 1_700_000_000_000,
      totalRp: 15000,
      payment: {
        method: "CASH" as const,
        amountRp: 15000,
        cashReceivedRp: 15000,
        changeRp: 0,
        verifiedBy: null,
        verifiedAtMs: null,
        evidenceRef: null,
      },
    }));
    const user = userEvent.setup();
    render(
      <CashierPage
        dataSource={makeSource({ prepareCheckout, commitCheckout, getSaleReceipt })}
        lines={SAMPLE_LINES}
        draftId="draft-1"
        onDraftConsumed={vi.fn()}
        onDraftRestore={vi.fn()}
        onLinesChange={vi.fn()}
        sessionEpoch={1}
        cashierId={2}
        onSessionExpired={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Lanjut pembayaran" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );

    await user.selectOptions(screen.getByLabelText(/Promo lokal/), "BUY_2_GET_1");
    expect(screen.getByText(/Potongan promo lokal/)).toBeTruthy();

    await user.type(screen.getByLabelText(/Kode pelanggan/), "mhs001");
    expect(screen.getByText(/Pelanggan MHS001/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Layar pelanggan" }));
    expect(screen.getByRole("region", { name: "Layar pelanggan" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Lanjut pembayaran" }));
    expect(await screen.findByText(/Pemeriksaan metode: pastikan pelanggan membayar tunai langsung/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Uang pas" }));
    await user.click(screen.getByRole("button", { name: "Ya, commit pembayaran" }));

    await waitFor(() => expect(getSaleReceipt).toHaveBeenCalledWith(501));
    expect(await screen.findByText(/Poin pelanggan MHS001: \+1 poin/)).toBeTruthy();
  });

  it("CashierPage: BUG-076 runPrepare 401 memanggil onSessionExpired", async () => {
    const onSessionExpired = vi.fn();
    const prepareCheckout = vi.fn(async () => {
      throw new ApiError(401, "AUTH_REQUIRED", "Sesi habis.");
    });
    const user = userEvent.setup();
    render(
      <CashierPage
        dataSource={makeSource({ prepareCheckout })}
        lines={SAMPLE_LINES}
        draftId="draft-1"
        onDraftConsumed={vi.fn()}
        onDraftRestore={vi.fn()}
        onLinesChange={vi.fn()}
        sessionEpoch={1}
        cashierId={2}
        onSessionExpired={onSessionExpired}
      />,
    );

    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Lanjut pembayaran" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    await user.click(screen.getByRole("button", { name: "Lanjut pembayaran" }));
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
  });

  it("ReceiptPanel: tombol Faktur Pajak (Simulasi DEMO) menampilkan pratinjau", async () => {
    const user = userEvent.setup();
    render(<ReceiptPanel dataSource={makeSource({ getSaleReceipt: async () => RECEIPT_VIEW })} saleId={501} />);
    await user.click(screen.getByRole("button", { name: /Lihat struk/ }));
    await screen.findByTestId("receipt-text");
    await user.click(screen.getByRole("button", { name: /Faktur Pajak \(Simulasi DEMO\)/ }));
    const tax = await screen.findByTestId("tax-invoice-text");
    expect(tax.textContent).toContain("S-000501");
  });

  it("ShiftDemoPage: menampilkan petunjuk rekonsiliasi saat selisih kas sama dengan total QRIS", async () => {
    const preview: ShiftClosePreview = {
      shiftId: 1,
      openingCashRp: 100_000,
      cashTotalRp: 50_000,
      qrisTotalRp: 25_000,
      expectedCashRp: 150_000,
      saleCount: 2,
    };
    const user = userEvent.setup();
    render(
      <ShiftDemoPage
        dataSource={makeSource({
          getShiftClosePreview: async () => preview,
          getPaymentReport: async () => ({
            totalRp: 75_000,
            cash: { count: 1, totalRp: 50_000 },
            qrisManual: { count: 1, totalRp: 25_000, verifiedCount: 1 },
            qrisSales: [],
          }),
        })}
        currentUser={CASHIER_USER}
        onSessionExpired={vi.fn()}
        onPendingChange={vi.fn()}
      />,
    );

    const input = await screen.findByLabelText(/Uang dihitung/);
    await user.type(input, "125000");
    expect(screen.getByText(/Petunjuk rekonsiliasi: selisih kas sama persis dengan total QRIS/)).toBeTruthy();
  });

  it("ReportsPage, DailyReportPanel, dan StockReportPanel: tombol Ekspor CSV & Excel memicu unduhan", async () => {
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const paymentReport: PaymentReport = {
      totalRp: 15000,
      cash: { count: 1, totalRp: 15000 },
      qrisManual: { count: 0, totalRp: 0, verifiedCount: 0 },
      qrisSales: [],
    };
    const dailyReport: DailyReport = {
      generatedAtMs: 1_700_000_000_000,
      startMs: 1_700_000_000_000,
      endMs: 1_700_086_400_000,
      shiftId: null,
      saleCount: 1,
      totalRp: 15000,
      cash: { count: 1, totalRp: 15000 },
      qrisManual: { count: 0, totalRp: 0, verifiedCount: 0 },
      salesTruncated: false,
      sales: [],
    };
    const stockReport: StockReport = {
      generatedAtMs: 1_700_000_000_000,
      lowStockThreshold: 5,
      products: [],
    };

    const ds = makeSource({
      getPaymentReport: async () => paymentReport,
      getDailyReport: async () => dailyReport,
      getStockReport: async () => stockReport,
    });
    const user = userEvent.setup();
    render(
      <>
        <ReportsPage dataSource={ds} currentUser={CASHIER_USER} onSessionExpired={vi.fn()} />
        <DailyReportPanel dataSource={ds} onSessionExpired={vi.fn()} />
        <StockReportPanel dataSource={ds} onSessionExpired={vi.fn()} />
      </>,
    );

    const csvButtons = await screen.findAllByRole("button", { name: "Ekspor CSV" });
    expect(csvButtons.length).toBeGreaterThanOrEqual(1);
    for (const btn of csvButtons) {
      await user.click(btn);
    }
    const excelButtons = screen.getAllByRole("button", { name: "Ekspor Excel" });
    for (const btn of excelButtons) {
      await user.click(btn);
    }
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("BUG-159 & BUG-160: recovery menyimpan customerCode untuk poin setelah reload dan tampilan sukses memakai snapshot item", async () => {
    localStorage.clear();
    const key = "pos.checkout.recovery.2.co_pr50_test";
    localStorage.setItem(
      key,
      JSON.stringify({
        attempt: PREPARE_OK,
        cashReceivedRp: 20000,
        paymentConfirmation: { method: "CASH", cashReceivedRp: 20000 },
        paymentState: "SUBMITTED",
        snapshot: SAMPLE_LINES,
        draftId: "draft-1",
        customerCode: "MHS777",
      }),
    );
    const getCheckoutStatus = vi.fn(async () => ({
      attemptKey: PREPARE_OK.attemptKey,
      requestHash: PREPARE_OK.requestHash,
      status: "COMMITTED" as const,
      replayed: true,
      saleId: 501,
      saleNo: "S-000501",
      committedAtMs: 1_700_000_000_000,
      totalRp: 15000,
      payment: {
        method: "CASH" as const,
        amountRp: 15000,
        cashReceivedRp: 20000,
        changeRp: 5000,
        verifiedBy: null,
        verifiedAtMs: null,
        evidenceRef: null,
      },
    }));
    const user = userEvent.setup();
    render(
      <CashierPage
        dataSource={makeSource({ getCheckoutStatus, getSaleReceipt: async () => RECEIPT_VIEW })}
        lines={[]}
        draftId="draft-2"
        onDraftConsumed={vi.fn()}
        onDraftRestore={vi.fn()}
        onLinesChange={vi.fn()}
        sessionEpoch={1}
        cashierId={2}
        onSessionExpired={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Cek status upaya" }));
    expect(await screen.findByText(/Poin pelanggan MHS777: \+1 poin/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Layar pelanggan" }));
    const display = screen.getByRole("region", { name: "Layar pelanggan" });
    expect(display.textContent).toContain("1 baris");
    expect(display.textContent).toContain("Rp15.000");
  });

  it("BUG-161, BUG-162, BUG-163: F9 diabaikan saat dialog batal terbuka, label TEBUS_MURAH Rp2.000, dan popup display diperbarui lalu berhenti saat ditutup", async () => {
    const prepareCheckout = vi.fn(async () => PREPARE_OK);
    const popupDoc = { open: vi.fn(), write: vi.fn(), close: vi.fn() };
    const fakePopup = { closed: false, document: popupDoc };
    const openSpy = vi.spyOn(window, "open").mockReturnValue(fakePopup as unknown as Window);
    const user = userEvent.setup();
    const { rerender } = render(
      <CashierPage
        dataSource={makeSource({ prepareCheckout })}
        lines={SAMPLE_LINES}
        draftId="draft-1"
        onDraftConsumed={vi.fn()}
        onDraftRestore={vi.fn()}
        onLinesChange={vi.fn()}
        sessionEpoch={1}
        cashierId={2}
        onSessionExpired={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Lanjut pembayaran" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );

    expect(screen.getByRole("option", { name: /Tebus murah/ }).textContent).toContain("Rp2.000");

    await user.click(screen.getByRole("button", { name: "Layar pelanggan" }));
    await user.click(screen.getByRole("button", { name: "Buka jendela pelanggan" }));
    expect(popupDoc.write).toHaveBeenCalledTimes(1);

    // Ubah baris keranjang -> popup diperbarui
    rerender(
      <CashierPage
        dataSource={makeSource({ prepareCheckout })}
        lines={[{ ...SAMPLE_LINES[0]!, quantity: 4 }]}
        draftId="draft-1"
        onDraftConsumed={vi.fn()}
        onDraftRestore={vi.fn()}
        onLinesChange={vi.fn()}
        sessionEpoch={1}
        cashierId={2}
        onSessionExpired={vi.fn()}
      />,
    );
    await waitFor(() => expect(popupDoc.write).toHaveBeenCalledTimes(2));

    // Tutup popup -> perubahan selanjutnya tidak menulis lagi
    fakePopup.closed = true;
    rerender(
      <CashierPage
        dataSource={makeSource({ prepareCheckout })}
        lines={[{ ...SAMPLE_LINES[0]!, quantity: 5 }]}
        draftId="draft-1"
        onDraftConsumed={vi.fn()}
        onDraftRestore={vi.fn()}
        onLinesChange={vi.fn()}
        sessionEpoch={1}
        cashierId={2}
        onSessionExpired={vi.fn()}
      />,
    );
    expect(popupDoc.write).toHaveBeenCalledTimes(2);
    openSpy.mockRestore();

    // F9 diabaikan saat dialog Batalkan draft terbuka
    await user.click(screen.getByRole("button", { name: "Batal draft" }));
    await screen.findByRole("dialog");
    await user.keyboard("{F9}");
    expect(prepareCheckout).not.toHaveBeenCalled();
  });

  it("BUG-164 & 3 poin PR 50: batch tag harga paginasi >100, tanda Asli struk, tombol compact, dan stok sekarang di Koreksi Stok", async () => {
    const first100 = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      categoryId: 1,
      categoryName: "Minuman",
      sku: `SKU-${String(i + 1).padStart(3, "0")}`,
      name: `Produk ${i + 1}`,
      priceRp: 1000,
      active: true,
      barcodes: [`899000000${String(i + 1).padStart(4, "0")}`],
      supplierIds: [],
      stockOnHand: 5,
    }));
    const extra5 = Array.from({ length: 5 }, (_, i) => ({
      id: 101 + i,
      categoryId: 1,
      categoryName: "Minuman",
      sku: `SKU-${101 + i}`,
      name: `Produk ${101 + i}`,
      priceRp: 2000,
      active: true,
      barcodes: [`899000000${101 + i}`],
      supplierIds: [],
      stockOnHand: 5,
    }));
    const listCatalogProducts = vi.fn(async (query?: { offset?: number; includeInactive?: boolean }) => {
      if (query?.includeInactive === false && (query.offset ?? 0) === 100) {
        return extra5;
      }
      return first100;
    });
    const adminUser: SessionUser = {
      userId: 1,
      username: "admin",
      displayName: "Admin",
      role: "ADMIN",
    };

    const user = userEvent.setup();
    render(
      <>
        <ProductsPage
          dataSource={makeSource({
            listCategories: async () => [{ id: 1, name: "Minuman" }],
            listSuppliers: async () => [],
            listCatalogProducts,
          })}
          currentUser={adminUser}
          onSessionExpired={vi.fn()}
        />
        <ReceiptPanel dataSource={makeSource({ getSaleReceipt: async () => RECEIPT_VIEW })} saleId={501} />
        <StockAdjustmentPage
          dataSource={makeSource({
            getStockReport: async () => ({
              generatedAtMs: 1_700_000_000_000,
              lowStockThreshold: 5,
              products: [
                {
                  productId: 1,
                  sku: "SKU-001",
                  name: "Produk 1",
                  opening: 12,
                  receipt: 0,
                  sale: 0,
                  adjustment: 0,
                  onHand: 12,
                  matched: true,
                  low: false,
                  zero: false,
                  movements: [],
                  movementsTruncated: false,
                },
              ],
            }),
          })}
          currentUser={adminUser}
          onSessionExpired={vi.fn()}
        />
      </>,
    );

    const tagBtn = await screen.findByRole("button", { name: /Cetak \/ PDF Tag Harga \(105\)/ });
    expect(tagBtn).toBeTruthy();
    listCatalogProducts.mockClear();
    await user.type(screen.getByLabelText("Cari produk"), "Produk 1");
    await user.click(screen.getByRole("button", { name: /^Cari$/ }));
    await waitFor(() => expect(listCatalogProducts).toHaveBeenCalledWith({ includeInactive: false, limit: 100, offset: 100 }));
    expect(await screen.findByRole("button", { name: /Cetak \/ PDF Tag Harga \(105\)/ })).toBeTruthy();
    expect(document.querySelector(".table-actions .btn")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Lihat struk/ }));
    expect(await screen.findByText("Asli")).toBeTruthy();

    await screen.findByRole("option", { name: /SKU-001/ });
    await user.selectOptions(screen.getByLabelText("Produk"), "1");
    expect(await screen.findByText("Stok sekarang: 12")).toBeTruthy();
  });
});
