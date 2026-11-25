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

  it("BUG-257 (dipindah ke Laporan §4.6 A): tombol Sinkronkan Spreadsheet memicu flush saat aktif, nonaktif saat belum terkonfigurasi, dan menandai Excel Lokal/Konfigurasi belum tersedia", async () => {
    const syncSheetsNow = vi.fn(async () => ({ enabled: true, sentCount: 2, pendingCount: 0 }));
    const enabledSource: PosDataSource = {
      ...sourceWith(REPORT),
      getSheetsSyncStatus: vi.fn(async () => ({ enabled: true, pendingCount: 2 })),
      syncSheetsNow,
    };
    const user = userEvent.setup();
    const first = render(<ReportsPage dataSource={enabledSource} currentUser={ADMIN} onSessionExpired={vi.fn()} />);

    await user.click(screen.getByRole("tab", { name: /Ekspor & Sinkronisasi/ }));
    expect((screen.getByRole("button", { name: "Pilih file" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Konfigurasi" }) as HTMLButtonElement).disabled).toBe(true);

    const syncButton = await screen.findByRole("button", { name: "Sinkronkan Spreadsheet" });
    await waitFor(() => expect((syncButton as HTMLButtonElement).disabled).toBe(false));
    await user.click(syncButton);
    expect(syncSheetsNow).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/2 penjualan terkirim/)).toBeTruthy();
    first.unmount();

    const disabledSource: PosDataSource = {
      ...sourceWith(REPORT),
      getSheetsSyncStatus: vi.fn(async () => ({ enabled: false, pendingCount: 0 })),
    };
    render(<ReportsPage dataSource={disabledSource} currentUser={ADMIN} onSessionExpired={vi.fn()} />);
    await user.click(screen.getByRole("tab", { name: /Ekspor & Sinkronisasi/ }));
    const disabledButton = await screen.findByRole("button", { name: "Sinkronkan Spreadsheet" });
    await waitFor(() => expect((disabledButton as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText(/Sinkronisasi spreadsheet belum dikonfigurasi/)).toBeTruthy();
  });

  it("BUG-263 (dipindah ke Laporan §4.6 A): gagal muat status sinkronisasi menampilkan error dan tombol Coba lagi, bukan pesan belum dikonfigurasi", async () => {
    const getSheetsSyncStatus = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "Server sinkronisasi sementara sibuk."))
      .mockResolvedValueOnce({ enabled: true, pendingCount: 1 });
    const source: PosDataSource = {
      ...sourceWith(REPORT),
      getSheetsSyncStatus,
    };
    const user = userEvent.setup();
    render(<ReportsPage dataSource={source} currentUser={ADMIN} onSessionExpired={vi.fn()} />);

    await user.click(screen.getByRole("tab", { name: /Ekspor & Sinkronisasi/ }));
    expect(await screen.findByText("Server sinkronisasi sementara sibuk.")).toBeTruthy();
    expect(screen.queryByText(/Sinkronisasi spreadsheet belum dikonfigurasi/)).toBeNull();
    const syncButton = screen.getByRole("button", { name: "Sinkronkan Spreadsheet" }) as HTMLButtonElement;
    expect(syncButton.disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    await waitFor(() => expect(syncButton.disabled).toBe(false));
    expect(screen.queryByText("Server sinkronisasi sementara sibuk.")).toBeNull();
  });
});

it("Sheets DEMO dialog menguji koneksi dan menyimpan tanpa menampilkan secret sesudahnya", async () => {
 const secret = Array.from(crypto.getRandomValues(new Uint8Array(24)), x => x.toString(16).padStart(2, "0")).join("");
 const endpoint = "https://script.google.com/macros/s/synthetic/exec";
 const getSheetsConfig = vi.fn(async () => ({ configured: false, restartRequired: false }));
 const pingSheetsConfig = vi.fn(async () => ({ connected: true }));
 const saveSheetsConfig = vi.fn(async () => ({ saved: true, restartRequired: true }));
 const { user } = renderPage({ ...sourceWith(REPORT), getSheetsConfig, pingSheetsConfig, saveSheetsConfig });
 await user.click(screen.getByRole("tab", { name: /Ekspor & Sinkronisasi/ }));
 await user.click(screen.getByRole("button", { name: "Konfigurasi" }));
 await user.type(screen.getByLabelText("URL web app Apps Script"), endpoint);
 await user.type(screen.getByLabelText("Secret"), secret);
 await user.click(screen.getByRole("button", { name: "Uji Koneksi" }));
 expect(await screen.findByText(/receiver merespons ping/)).toBeTruthy();
 await user.click(screen.getByRole("checkbox", { name: /transaksi baru/ }));
 await user.click(screen.getByRole("button", { name: "Simpan Konfigurasi" }));
 expect(await screen.findByText(/Konfigurasi tersimpan. Restart aplikasi/)).toBeTruthy();
 expect(saveSheetsConfig).toHaveBeenCalledWith({ webhookUrl: endpoint, secret, futureSalesOnly: true });
 expect((screen.getByLabelText("Secret") as HTMLInputElement).value).toBe("");
});
