import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import { createMockDataSource } from "../api/mockDataSource";
import type {
  CheckoutStatusResult,
  CommitCheckoutResult,
  PosDataSource,
  PrepareCheckoutResult,
  ShiftSummary,
} from "../api/types";
import type { CartLine } from "../domain/cart";
import { CashierPage } from "./CashierPage";

const SHIFT: ShiftSummary = {
  id: 7,
  cashierId: 2,
  openedAtMs: 1_700_000_000_000,
  openingCashRp: 50_000,
};

const LINE: CartLine = {
  productId: 1,
  sku: "QRIS-001",
  name: "Produk QRIS",
  unitPriceRp: 5000,
  quantity: 1,
  stockHint: 5,
};

const PREPARED_QRIS: PrepareCheckoutResult = {
  attemptKey: "co_qris_1",
  requestHash: "a".repeat(64),
  status: "PREPARED",
  quote: {
    shiftId: 7,
    cashierId: 2,
    items: [
      {
        productId: 1,
        sku: "QRIS-001",
        name: "Produk QRIS",
        quantity: 1,
        unitPriceRp: 5000,
        lineTotalRp: 5000,
      },
    ],
    totalRp: 5000,
    payment: { method: "QRIS_MANUAL" },
  },
};

const COMMITTED_QRIS: CommitCheckoutResult = {
  saleId: 12,
  saleNo: "QRIS-001",
  attemptKey: PREPARED_QRIS.attemptKey,
  requestHash: PREPARED_QRIS.requestHash,
  status: "COMMITTED",
  totalRp: 5000,
  committedAtMs: 1_700_000_001_000,
  payment: {
    method: "QRIS_MANUAL",
    amountRp: 5000,
    cashReceivedRp: null,
    changeRp: 0,
    verifiedBy: 2,
    verifiedAtMs: 1_700_000_001_000,
    evidenceRef: "REF-MERCHANT-1",
  },
  qrisVerification: {
    status: "verified",
    verifiedBy: 2,
    verifiedAtMs: 1_700_000_001_000,
  },
};

type Options = {
  prepare?: PosDataSource["prepareCheckout"];
  commit?: PosDataSource["commitCheckout"];
  status?: PosDataSource["getCheckoutStatus"];
};

function buildSource(options: Options = {}) {
  const base = createMockDataSource({ latencyMs: 0 });
  const source: PosDataSource = {
    ...base,
    authMode: "LOCAL_API",
    catalogMode: "LOCAL_API",
    getCurrentShift: vi.fn(async () => SHIFT),
    openShift: vi.fn(async () => SHIFT),
    prepareCheckout: options.prepare ?? vi.fn(async () => PREPARED_QRIS),
    commitCheckout: options.commit ?? vi.fn(async () => COMMITTED_QRIS),
    getCheckoutStatus: options.status ?? vi.fn(async (): Promise<CheckoutStatusResult> => COMMITTED_QRIS),
  };
  return source;
}

function Harness({ source, onSessionExpired = vi.fn() }: { source: PosDataSource; onSessionExpired?: () => void }) {
  const [lines, setLines] = useState<CartLine[]>([LINE]);
  return (
    <CashierPage
      dataSource={source}
      lines={lines}
      draftId="draft-qris"
      onDraftConsumed={vi.fn()}
      onDraftRestore={vi.fn()}
      onLinesChange={setLines}
      sessionEpoch={1}
      cashierId={2}
      onSessionExpired={onSessionExpired}
    />
  );
}

async function openQrisPayment(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("radio", { name: /QRIS manual/ }));
  const pay = await screen.findByRole("button", { name: "Lanjut pembayaran" });
  await waitFor(() => expect((pay as HTMLButtonElement).disabled).toBe(false));
  await user.click(pay);
  return screen.findByRole("dialog", { name: "Konfirmasi QRIS manual" });
}

describe("TASK-037 kasir: QRIS manual tidak lunas otomatis", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("prepare QRIS dan commit hanya setelah kasir centang konfirmasi merchant", async () => {
    const source = buildSource();
    const user = userEvent.setup();
    render(<Harness source={source} />);

    const dialog = await openQrisPayment(user);
    expect(dialog.textContent).toContain("PENDING");
    expect(source.prepareCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethod: "QRIS_MANUAL" }),
    );
    expect(source.commitCheckout).not.toHaveBeenCalled();

    const commitButton = screen.getByRole("button", { name: "Ya, commit pembayaran" }) as HTMLButtonElement;
    expect(commitButton.disabled).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: /sudah memeriksa transaksi/ }));
    expect(commitButton.disabled).toBe(false);

    await user.type(screen.getByLabelText(/Referensi bukti/), "REF-MERCHANT-1");
    await user.click(commitButton);

    expect(source.commitCheckout).toHaveBeenCalledWith({
      attemptKey: "co_qris_1",
      requestHash: "a".repeat(64),
      paymentConfirmation: {
        method: "QRIS_MANUAL",
        merchantConfirmed: true,
        confirmedAmountRp: 5000,
        evidenceRef: "REF-MERCHANT-1",
      },
    });
    const success = await screen.findByRole("dialog", { name: "Transaksi tersimpan" });
    expect(success.textContent).toContain("TERVERIFIKASI");
    expect(success.textContent).toContain("QRIS tidak masuk kas fisik");
  });

  it("nominal merchant yang berbeda dari total quote memblokir commit", async () => {
    const source = buildSource();
    const user = userEvent.setup();
    render(<Harness source={source} />);
    await openQrisPayment(user);

    await user.click(screen.getByRole("checkbox", { name: /sudah memeriksa transaksi/ }));
    const amount = screen.getByLabelText(/Nominal yang terlihat di merchant/);
    await user.clear(amount);
    await user.type(amount, "4000");
    expect((screen.getByRole("button", { name: "Ya, commit pembayaran" }) as HTMLButtonElement).disabled).toBe(true);
    expect(source.commitCheckout).not.toHaveBeenCalled();
  });

  it("VALIDATION_ERROR dari backend ditampilkan sebagai GAGAL tanpa penjualan", async () => {
    const commit = vi.fn(async () => {
      throw new ApiError(422, "VALIDATION_ERROR", "Nominal konfirmasi QRIS tidak sama dengan total belanja.");
    });
    const source = buildSource({ commit });
    const user = userEvent.setup();
    render(<Harness source={source} />);
    await openQrisPayment(user);

    await user.click(screen.getByRole("checkbox", { name: /sudah memeriksa transaksi/ }));
    await user.click(screen.getByRole("button", { name: "Ya, commit pembayaran" }));

    await waitFor(() => {
      expect(screen.getByText(/Status: GAGAL/)).toBeTruthy();
    });
    expect(screen.queryByRole("dialog", { name: "Transaksi tersimpan" })).toBeNull();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("timeout QRIS mengarahkan ke lookup dan memakai upaya yang sama saat lanjut", async () => {
    let commitCalls = 0;
    const commit = vi.fn(async () => {
      commitCalls += 1;
      if (commitCalls === 1) {
        throw new ApiError(200, "INVALID_RESPONSE", "Respons backend tidak valid.");
      }
      return COMMITTED_QRIS;
    });
    const status = vi.fn(async (): Promise<CheckoutStatusResult> => ({
      ...PREPARED_QRIS,
      status: "PREPARED",
      qrisVerification: { status: "pending" },
    }));
    const source = buildSource({ commit, status });
    const user = userEvent.setup();
    render(<Harness source={source} />);
    await openQrisPayment(user);
    await user.click(screen.getByRole("checkbox", { name: /sudah memeriksa transaksi/ }));
    await user.click(screen.getByRole("button", { name: "Ya, commit pembayaran" }));

    expect(await screen.findByRole("dialog", { name: "Status pembayaran belum diketahui" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cek status upaya" }));
    await waitFor(() => expect(screen.getByText(/Status: PENDING/)).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Lanjutkan commit upaya ini" }));

    expect(await screen.findByRole("dialog", { name: "Transaksi tersimpan" })).toBeTruthy();
    expect(commitCalls).toBe(2);
    const calls = vi.mocked(source.commitCheckout).mock.calls;
    expect(calls[0]?.[0].attemptKey).toBe("co_qris_1");
    expect(calls[1]?.[0].attemptKey).toBe("co_qris_1");
    expect(calls[1]?.[0].paymentConfirmation).toMatchObject({ method: "QRIS_MANUAL", merchantConfirmed: true });
  });
});
