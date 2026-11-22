import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDataSource } from "../api/mockDataSource";
import { ApiError } from "../api/errors";
import { BackupPage } from "./BackupPage";
import { StockAdjustmentPage } from "./StockAdjustmentPage";

beforeEach(() => localStorage.clear());
describe("BUG-137/138 layar admin", () => {
  it("menyimpan target absolut dan tidak mengirim dua kali ketika request berjalan", async () => {
    const source = createMockDataSource({ latencyMs: 0 });
    let resolve!: (result: { productId: number; previousOnHand: number; onHand: number; delta: number; duplicate: boolean }) => void;
    source.getStockReport = vi.fn(async () => ({ generatedAtMs: 1, lowStockThreshold: 1, products: [{ productId: 1, sku: "D-1", name: "Produk DEMO", onHand: 5, opening: 5, receipt: 0, sale: 0, adjustment: 0, matched: true, low: false, zero: false, movements: [], movementsTruncated: false }] }));
    source.adjustStock = vi.fn(() => new Promise<{ productId: number; previousOnHand: number; onHand: number; delta: number; duplicate: boolean }>(r => { resolve = r; }));
    const user = userEvent.setup();
    render(<StockAdjustmentPage dataSource={source} currentUser={{ userId: 1, username: "admin", displayName: "Admin", role: "ADMIN" }} onSessionExpired={vi.fn()} />);
    await user.selectOptions(await screen.findByLabelText("Produk"), "1");
    await user.type(screen.getByLabelText("Target stok"), "3");
    await user.type(screen.getByLabelText("Alasan"), "Selisih");
    await user.click(screen.getByRole("button", { name: "Simpan koreksi" }));
    expect(source.adjustStock).toHaveBeenCalledTimes(1);
    expect(source.adjustStock).toHaveBeenCalledWith(expect.objectContaining({ productId: 1, expectedOnHand: 5, targetOnHand: 3, reason: "Selisih" }));
    expect((screen.getByRole("button", { name: "Simpan koreksi" }) as HTMLButtonElement).disabled).toBe(true);
    resolve({ productId: 1, previousOnHand: 5, onHand: 3, delta: -2, duplicate: false });
    expect(await screen.findByText(/Stok 5 menjadi 3/)).toBeTruthy();
  });
  it("hasil koreksi tidak pasti dapat diulang dengan kunci dan payload yang sama setelah halaman dipasang ulang", async () => {
    const source = createMockDataSource({ latencyMs: 0 });
    source.getStockReport = vi.fn(async () => ({ generatedAtMs: 1, lowStockThreshold: 1, products: [{ productId: 1, sku: "D-1", name: "Produk DEMO", onHand: 5, opening: 5, receipt: 0, sale: 0, adjustment: 0, matched: true, low: false, zero: false, movements: [], movementsTruncated: false }] }));
    source.adjustStock = vi.fn().mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "Timeout")).mockResolvedValueOnce({ productId: 1, previousOnHand: 5, onHand: 3, delta: -2, duplicate: true });
    const props = { dataSource: source, currentUser: { userId: 1, username: "admin", displayName: "Admin", role: "ADMIN" as const }, onSessionExpired: vi.fn() };
    const user = userEvent.setup();
    const view = render(<StockAdjustmentPage {...props} />);
    await user.selectOptions(await screen.findByLabelText("Produk"), "1");
    await user.type(screen.getByLabelText("Target stok"), "3");
    await user.type(screen.getByLabelText("Alasan"), "Selisih");
    await user.click(screen.getByRole("button", { name: "Simpan koreksi" }));
    await screen.findByText(/Hasil belum pasti/);
    const original = vi.mocked(source.adjustStock).mock.calls[0]![0];
    view.unmount();
    render(<StockAdjustmentPage {...props} />);
    await user.click(screen.getByRole("button", { name: "Ulangi permintaan yang sama" }));
    expect(await screen.findByText(/Stok 5 menjadi 3/)).toBeTruthy();
    expect(vi.mocked(source.adjustStock).mock.calls[1]![0]).toEqual(original);
  });
  it("menampilkan kegagalan tujuan backup dan menjelaskan restore salinan uji", async () => {
    const source = createMockDataSource({ latencyMs: 0 });
    source.createBackup = vi.fn(async () => { throw new ApiError(422, "VALIDATION_ERROR", "Cadangan gagal dibuat. Periksa tujuan dan izin penulisan."); });
    render(<BackupPage dataSource={source} onSessionExpired={vi.fn()} />);
    expect(screen.getByText(/Restore hanya membuat salinan uji/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Buat backup" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Cadangan gagal dibuat"));
  });
});
