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
import { ReportsPage } from "./ReportsPage";
import { ShiftDemoPage } from "./ShiftDemoPage";

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
});
