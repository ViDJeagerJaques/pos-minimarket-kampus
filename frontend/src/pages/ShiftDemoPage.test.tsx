import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { ApiError } from "../api/errors";
import { createMockDataSource } from "../api/mockDataSource";
import type { PosDataSource, SessionUser, ShiftClosing } from "../api/types";
import { ShiftDemoPage } from "./ShiftDemoPage";

const user: SessionUser = { userId: 2, username: "kasir", displayName: "Kasir", role: "CASHIER" };
const preview = { shiftId: 7, openingCashRp: 100000, cashTotalRp: 500000, qrisTotalRp: 300000, expectedCashRp: 600000, saleCount: 2 };
const result = (closeKey: string): ShiftClosing => ({ shiftId: 7, closeKey, requestHash: "a".repeat(64), closedAtMs: 123, closedBy: 2, openingCashRp: 100000, expectedCashRp: 600000, declaredCashRp: 590000, varianceRp: -10000, totals: { cashRp: 500000, qrisManualRp: 300000, totalSalesRp: 800000, saleCount: 2 } });
function source(overrides: Partial<PosDataSource> = {}): PosDataSource {
  return { ...createMockDataSource({ latencyMs: 0 }), authMode: "LOCAL_API", getCurrentShift: vi.fn(async () => ({ id: 7, cashierId: 2, openedAtMs: 1, openingCashRp: 100000 })), getShiftClosePreview: vi.fn(async () => preview), getShiftClosing: vi.fn(async () => { throw new ApiError(404, "NOT_FOUND", "Belum ada"); }), closeShift: vi.fn(async (_id, input) => result(input.closeKey)), ...overrides };
}
function show(dataSource: PosDataSource, currentUser = user) {
  const onPendingChange = vi.fn();
  render(<ShiftDemoPage dataSource={dataSource} currentUser={currentUser} onSessionExpired={vi.fn()} onPendingChange={onPendingChange} />);
  return { onPendingChange, u: userEvent.setup() };
}
async function confirm(u: ReturnType<typeof userEvent.setup>) {
  await u.type(await screen.findByLabelText("Uang dihitung (Rp)"), "590000");
  await u.click(screen.getByRole("button", { name: "Tutup shift" }));
  await u.click(screen.getByRole("button", { name: "Ya, tutup shift" }));
}
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
describe("TASK-023 penutupan shift", () => {
  it("memakai preview backend dan memisahkan QRIS dari uang tunai", async () => {
    const api = source(); const { u } = show(api);
    const table = await screen.findByRole("table", { name: "Ringkasan shift" });
    expect(within(table).getByRole("row", { name: /CASH/ }).textContent).toContain("Rp500.000");
    expect(within(table).getByRole("row", { name: /QRIS/ }).textContent).toContain("Rp300.000");
    expect(within(table).getByRole("row", { name: /Uang tunai harapan/ }).textContent).toContain("Rp600.000");
    await confirm(u);
    expect(await screen.findByRole("heading", { name: "Penutupan tersimpan" })).toBeTruthy();
    expect(api.closeShift).toHaveBeenCalledTimes(1);
  });
  it("request tertunda dikunci meskipun konfirmasi diklik dua kali", async () => {
    let resolve!: (value: ShiftClosing) => void;
    const api = source({ closeShift: vi.fn<PosDataSource["closeShift"]>((_id, input) => new Promise<ShiftClosing>(res => { resolve = () => res(result(input.closeKey)); })) });
    const { u } = show(api);
    await u.type(await screen.findByLabelText("Uang dihitung (Rp)"), "590000");
    await u.click(screen.getByRole("button", { name: "Tutup shift" }));
    const button = screen.getByRole("button", { name: "Ya, tutup shift" });
    fireEvent.click(button); fireEvent.click(button);
    expect(api.closeShift).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(result("ignored")); });
    expect(await screen.findByRole("heading", { name: "Penutupan tersimpan" })).toBeTruthy();
  });
  it("timeout memeriksa GET lalu retry identik setelah 404", async () => {
    const commit = vi.fn<PosDataSource["closeShift"]>().mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "timeout")).mockImplementation(async (_id, input) => result(input.closeKey));
    const api = source({ closeShift: commit }); const { u } = show(api);
    await confirm(u);
    const retry = await screen.findByRole("button", { name: "Ulangi permintaan yang sama" });
    expect(api.getShiftClosing).toHaveBeenCalledWith(7);
    expect(screen.queryByRole("heading", { name: "Penutupan tersimpan" })).toBeNull();
    await u.click(retry);
    await screen.findByRole("heading", { name: "Penutupan tersimpan" });
    expect(commit.mock.calls).toHaveLength(2);
    expect(commit.mock.calls[0]).toEqual(commit.mock.calls[1]);
    expect(localStorage.length).toBe(0);
  });
  it("timeout setelah commit pulih via GET tanpa POST kedua", async () => {
    let saved = "";
    const api = source({ closeShift: vi.fn(async (_id, input) => { saved = input.closeKey; throw new ApiError(0, "NETWORK_ERROR", "timeout"); }), getShiftClosing: vi.fn(async () => result(saved)) });
    const { u } = show(api); await confirm(u);
    expect(await screen.findByRole("heading", { name: "Penutupan tersimpan" })).toBeTruthy();
    expect(api.closeShift).toHaveBeenCalledTimes(1);
    expect(api.getShiftClosing).toHaveBeenCalledTimes(1);
  });
  it("reload mempertahankan kunci dan tidak menganggap 404 sebagai gagal", async () => {
    localStorage.setItem("pos.shift.close.2.close_old", JSON.stringify({ shiftId: 7, closeKey: "close_old", declaredCashRp: 590000 }));
    const api = source(); show(api);
    await screen.findByRole("button", { name: "Ulangi permintaan yang sama" });
    expect(api.getCurrentShift).not.toHaveBeenCalled();
    expect(screen.getByText(/penutupan mungkin masih berjalan/)).toBeTruthy();
    expect(localStorage.length).toBe(1);
  });
  it("login ulang mengarahkan upaya tertunda ke Shift dan mengunci navigasi kasir", async () => {
    localStorage.setItem("pos.shift.close.2.close_old", JSON.stringify({ shiftId: 7, closeKey: "close_old", declaredCashRp: 590000 }));
    const api = source({ login: vi.fn(async () => ({ ok: true as const, user })) });
    render(<App dataSource={api} onAfterLogout={vi.fn()} />);
    const u = userEvent.setup();
    await u.type(await screen.findByLabelText("Nama pengguna"), "kasir");
    await u.type(screen.getByLabelText("Kata sandi"), "uji");
    await u.click(screen.getByRole("button", { name: "Masuk" }));
    await screen.findByRole("button", { name: "Ulangi permintaan yang sama" });
    await u.click(screen.getByRole("button", { name: "Kasir" }));
    expect(screen.getByRole("heading", { name: "Penutupan shift" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Buka shift" })).toBeNull();
  });
  it("hasil dengan closeKey lain tidak dianggap sebagai hasil upaya ini", async () => {
    localStorage.setItem("pos.shift.close.2.close_old", JSON.stringify({ shiftId: 7, closeKey: "close_old", declaredCashRp: 590000 }));
    const api = source({ getShiftClosing: vi.fn(async () => result("close_lain")) });
    const { onPendingChange } = show(api);
    expect(await screen.findByText(/Hasil penutupan berbeda/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Penutupan tersimpan" })).toBeNull();
    expect(localStorage.length).toBe(1);
    expect(onPendingChange).toHaveBeenCalledWith(true);
  });
  it("gagal menyimpan identitas lokal tidak mengirim penutupan", async () => {
    const api = source(); const { u } = show(api);
    await u.type(await screen.findByLabelText("Uang dihitung (Rp)"), "590000");
    await u.click(screen.getByRole("button", { name: "Tutup shift" }));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("gagal"); });
    await u.click(screen.getByRole("button", { name: "Ya, tutup shift" }));
    expect(screen.getByText(/Penutupan tidak dikirim/)).toBeTruthy();
    expect(api.closeShift).not.toHaveBeenCalled();
  });
  it("kasir lain dan ADMIN tidak melihat tombol tutup", async () => {
    const api = source({ getCurrentShift: vi.fn(async () => ({ id: 7, cashierId: 3, openedAtMs: 1, openingCashRp: 0 })) });
    const view = render(<ShiftDemoPage dataSource={api} currentUser={user} onSessionExpired={vi.fn()} onPendingChange={vi.fn()} />);
    await screen.findByText(/Tidak ada shift aktif milik Anda/);
    expect(screen.queryByRole("button", { name: "Tutup shift" })).toBeNull();
    view.unmount(); show(api, { ...user, role: "ADMIN" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Tutup shift" })).toBeNull());
    expect(api.getShiftClosePreview).not.toHaveBeenCalled();
  });
});
