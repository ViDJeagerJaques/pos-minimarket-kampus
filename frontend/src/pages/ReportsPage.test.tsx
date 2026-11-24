import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import { createMockDataSource } from "../api/mockDataSource";
import type { PaymentReport, PosDataSource } from "../api/types";
import { ReportsPage } from "./ReportsPage";

const ADMIN = { userId: 1, username: "admin.demo", displayName: "Admin DEMO", role: "ADMIN" as const };

const REPORT: PaymentReport = {
  cash: { totalRp: 125_000, count: 5 },
  qrisManual: { totalRp: 75_000, count: 3, verifiedCount: 3 },
  totalRp: 200_000,
  qrisSales: [
    {
      saleId: 11,
      saleNo: "QRIS-001",
      committedAtMs: 1_700_000_000_000,
      totalRp: 25_000,
      cashierUsername: "kasir.demo",
      verifiedBy: 2,
      verifiedAtMs: 1_700_000_000_000,
      evidenceRef: "REF-1",
      status: "verified",
    },
  ],
};

function renderPage(source: PosDataSource, onSessionExpired = vi.fn()) {
  const user = userEvent.setup();
  render(<ReportsPage dataSource={source} currentUser={ADMIN} onSessionExpired={onSessionExpired} />);
  return { user, onSessionExpired };
}

function sourceWith(report: PaymentReport): PosDataSource {
  const base = createMockDataSource({ latencyMs: 0 });
  return {
    ...base,
    authMode: "LOCAL_API",
    catalogMode: "LOCAL_API",
    getPaymentReport: vi.fn(async () => report),
  };
}

describe("TASK-037 laporan QRIS terpisah dari kas", () => {
  it("menampilkan total kas dan QRIS terpisah beserta baris verifikasi", async () => {
    const source = sourceWith(REPORT);
    renderPage(source);

    expect(await screen.findByText("Rincian QRIS terverifikasi")).toBeTruthy();
    const cash = screen.getByRole("heading", { name: "Kas tunai" }).parentElement;
    const qris = screen.getByRole("heading", { name: "QRIS manual" }).parentElement;
    expect(cash?.textContent).toContain("Rp125.000");
    expect(cash?.textContent).toContain("5 transaksi");
    expect(qris?.textContent).toContain("Rp75.000");
    expect(qris?.textContent).toContain("3 terverifikasi");

    const table = screen.getByRole("table", { name: "Rincian QRIS terverifikasi" });
    expect(table.textContent).toContain("QRIS-001");
    expect(table.textContent).toContain("kasir.demo");
    expect(table.textContent).toContain("REF-1");
    expect(source.getPaymentReport).toHaveBeenCalledTimes(1);
  });

  it("mode DEMO memberi label bahwa angka laporan sintetis", async () => {
    const base = createMockDataSource({ latencyMs: 0 });
    const source: PosDataSource = {
      ...base,
      getPaymentReport: vi.fn(async () => REPORT),
    };
    renderPage(source);
    expect(await screen.findByText(/angka laporan sintetis/)).toBeTruthy();
  });

  it("403 dari backend ditampilkan tanpa mengakhiri sesi", async () => {
    const base = createMockDataSource({ latencyMs: 0 });
    const source: PosDataSource = {
      ...base,
      authMode: "LOCAL_API",
      catalogMode: "LOCAL_API",
      getPaymentReport: vi.fn(async () => {
        throw new ApiError(403, "FORBIDDEN", "Laporan pembayaran hanya untuk ADMIN.");
      }),
    };
    const { onSessionExpired } = renderPage(source);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("hanya untuk ADMIN");
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("401 dari backend memanggil onSessionExpired", async () => {
    const base = createMockDataSource({ latencyMs: 0 });
    const source: PosDataSource = {
      ...base,
      authMode: "LOCAL_API",
      catalogMode: "LOCAL_API",
      getPaymentReport: vi.fn(async () => {
        throw new ApiError(401, "AUTH_REQUIRED", "Sesi berakhir. Silakan masuk lagi.");
      }),
    };
    const { onSessionExpired } = renderPage(source);
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
  });

  it("BUG-228: ekspor Excel Laporan menghasilkan file .xlsx asli dengan format tabel", async () => {
    const blobs: Blob[] = [];
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn((blob: Blob) => {
        blobs.push(blob);
        return "blob:qris-xlsx";
      }),
      revokeObjectURL: vi.fn(),
    });
    const downloads: string[] = [];
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });

    const source = sourceWith(REPORT);
    const { user } = renderPage(source);
    expect(await screen.findByText("Rincian QRIS terverifikasi")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Ekspor Excel" }));
    expect(downloads).toEqual(["laporan-qris.xlsx"]);
    const xlsx = new Uint8Array(await blobs[0]!.arrayBuffer());
    expect(Array.from(xlsx.slice(0, 4))).toEqual([80, 75, 3, 4]);
    const xml = new TextDecoder().decode(xlsx);
    expect(xml).toContain("xl/tables/table1.xml");
    expect(xml).toContain("autoFilter");
    expect(xml).toContain("xl/styles.xml");
    expect(xml).toContain("QRIS-001");

    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
