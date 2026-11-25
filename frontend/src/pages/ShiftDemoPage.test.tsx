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
const result = (closeKey: string, varianceNote: string | null = "Selisih uji"): ShiftClosing => ({ shiftId: 7, closeKey, requestHash: "a".repeat(64), closedAtMs: 123, closedBy: 2, openingCashRp: 100000, expectedCashRp: 600000, declaredCashRp: 590000, varianceRp: -10000, varianceNote, totals: { cashRp: 500000, qrisManualRp: 300000, totalSalesRp: 800000, saleCount: 2 } });
function source(overrides: Partial<PosDataSource> = {}): PosDataSource {
  return { ...createMockDataSource({ latencyMs: 0 }), authMode: "LOCAL_API", getCurrentShift: vi.fn(async () => ({ id: 7, cashierId: 2, openedAtMs: 1, openingCashRp: 100000 })), getShiftClosePreview: vi.fn(async () => preview), getShiftClosing: vi.fn(async () => { throw new ApiError(404, "NOT_FOUND", "Belum ada"); }), closeShift: vi.fn(async (_id, input) => result(input.closeKey, input.varianceNote ?? null)), ...overrides };
}
function show(dataSource: PosDataSource, currentUser = user) {
  const onPendingChange = vi.fn();
  render(<ShiftDemoPage dataSource={dataSource} currentUser={currentUser} onSessionExpired={vi.fn()} onPendingChange={onPendingChange} />);
  return { onPendingChange, u: userEvent.setup() };
}
async function confirm(u: ReturnType<typeof userEvent.setup>) {
  await u.type(await screen.findByLabelText("Uang dihitung (Rp)"), "590000");
  await u.type(screen.getByLabelText("Catatan/Alasan Selisih"), "Selisih uji");
  await u.click(screen.getByRole("button", { name: "Tutup shift" }));
  await u.click(screen.getByRole("button", { name: "Ya, tutup shift" }));
}
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
describe("TASK-023 penutupan shift", () => {
  it("memakai preview backend dan memisahkan QRIS dari uang tunai", async () => {
    const api = source(); const { u } = show(api);
    const table = await screen.findByRole("table", { name: "Ringkasan shift" });
    expect(within(table).getByRole("row", { name: /^Penjualan CASH/ }).textContent).toContain("Rp500.000");
    expect(within(table).getByRole("row", { name: /^Penjualan QRIS/ }).textContent).toContain("Rp300.000");
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
    await u.type(screen.getByLabelText("Catatan/Alasan Selisih"), "Selisih uji");
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
    await u.type(screen.getByLabelText("Catatan/Alasan Selisih"), "Selisih uji");
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

it("BUG-210/214/215: refresh total, input ribuan, dan tanda selisih", async () => {
  const getPreview = vi.fn().mockResolvedValueOnce(preview).mockResolvedValueOnce({ ...preview, cashTotalRp: 510000, expectedCashRp: 610000 });
  const api = source({ getShiftClosePreview: getPreview });
  const { u } = show(api);
  const input = await screen.findByLabelText("Uang dihitung (Rp)");
  await u.type(input, "620000");
  expect((input as HTMLInputElement).value).toBe("620.000");
  expect(screen.getByText(/Perkiraan selisih/).textContent).toContain("+Rp20.000");
  await u.click(screen.getByRole("button", { name: "Muat ulang pratinjau" }));
  await waitFor(() => expect(screen.getByText(/Perkiraan selisih/).textContent).toContain("+Rp10.000"));
  expect(screen.getByRole("row", { name: /Total penghasilan/ }).textContent).toContain("Rp810.000");
  await u.clear(input); await u.type(input, "610000");
  expect(screen.getByText(/Perkiraan selisih/).textContent).toBe("Perkiraan selisih: Rp0");
});

it("BUG-230/231/232/233: tata letak, warna selisih, catatan wajib saat selisih != 0, dan konfirmasi bernomor shift", async () => {
  const api = source();
  const { u } = show(api);
  const input = await screen.findByLabelText("Uang dihitung (Rp)");
  expect(input.closest(".shift-close-row")).toBeTruthy();

  await u.type(input, "600000");
  expect(screen.queryByLabelText("Catatan/Alasan Selisih")).toBeNull();
  const closeBtn = screen.getByRole("button", { name: "Tutup shift" }) as HTMLButtonElement;
  expect(closeBtn.disabled).toBe(false);

  await u.clear(input);
  await u.type(input, "620000");
  const plusSpan = screen.getByText(/Perkiraan selisih/).querySelector(".variance--positive");
  expect(plusSpan).toBeTruthy();

  await u.clear(input);
  await u.type(input, "590000");
  const minusSpan = screen.getByText(/Perkiraan selisih/).querySelector(".variance--negative");
  expect(minusSpan).toBeTruthy();
  const noteInput = screen.getByLabelText("Catatan/Alasan Selisih");
  expect(closeBtn.disabled).toBe(true);

  await u.type(noteInput, "Uang receh kurang");
  expect(closeBtn.disabled).toBe(false);
  await u.click(closeBtn);
  const dialog = screen.getByRole("dialog");
  expect(dialog.textContent).toContain("#7");
  expect(dialog.textContent).toContain("Rp590.000");
  expect(dialog.textContent).toContain("-Rp10.000");

  await u.click(screen.getByRole("button", { name: "Ya, tutup shift" }));
  expect(await screen.findByRole("heading", { name: "Penutupan tersimpan" })).toBeTruthy();
  expect(api.closeShift).toHaveBeenCalledWith(
    7,
    expect.objectContaining({ declaredCashRp: 590000, varianceNote: "Uang receh kurang" }),
  );
  expect(screen.getByText(/Catatan selisih/).textContent).toContain("Uang receh kurang");
  expect(document.querySelector(".variance--negative")).toBeTruthy();
});

it("BUG-235: penolakan 422 kurang catatan selisih melepas pending dan memungkinkan tutup shift dengan closeKey baru", async () => {
  const keys: string[] = [];
  const getShiftClosePreview = vi
    .fn()
    .mockResolvedValueOnce(preview)
    .mockResolvedValueOnce({ ...preview, cashTotalRp: 510000, expectedCashRp: 610000 });
  const closeShift = vi
    .fn<PosDataSource["closeShift"]>()
    .mockImplementationOnce(async (_id, input) => {
      keys.push(input.closeKey);
      throw new ApiError(422, "VALIDATION_ERROR", "Catatan selisih wajib diisi jika terdapat selisih kas.");
    })
    .mockImplementationOnce(async (_id, input) => {
      keys.push(input.closeKey);
      return result(input.closeKey, input.varianceNote ?? null);
    });
  const api = source({ getShiftClosePreview, closeShift });
  const { u } = show(api);

  await u.type(await screen.findByLabelText("Uang dihitung (Rp)"), "600000");
  await u.click(screen.getByRole("button", { name: "Tutup shift" }));
  await u.click(screen.getByRole("button", { name: "Ya, tutup shift" }));

  expect(await screen.findByText(/Catatan selisih wajib diisi/)).toBeTruthy();
  expect(localStorage.length).toBe(0);
  const noteInput = await screen.findByLabelText("Catatan/Alasan Selisih");
  await u.type(noteInput, "Ada transaksi baru sebelum tutup");
  await u.click(screen.getByRole("button", { name: "Tutup shift" }));
  await u.click(screen.getByRole("button", { name: "Ya, tutup shift" }));

  expect(await screen.findByRole("heading", { name: "Penutupan tersimpan" })).toBeTruthy();
  expect(keys).toHaveLength(2);
  expect(keys[0]).not.toBe(keys[1]);
});

it("BUG-242: pemulihan dari upaya pending tersimpan yang ditolak 422 mengembalikan shift dan pratinjau", async () => {
  localStorage.setItem(
    "pos.shift.close.2.close_saved_422",
    JSON.stringify({ shiftId: 7, closeKey: "close_saved_422", declaredCashRp: 600000 }),
  );
  const closeShift = vi
    .fn<PosDataSource["closeShift"]>()
    .mockRejectedValueOnce(
      new ApiError(422, "VALIDATION_ERROR", "Catatan selisih wajib diisi jika terdapat selisih kas."),
    )
    .mockImplementationOnce(async (_id, input) => result(input.closeKey, input.varianceNote ?? null));
  const api = source({
    closeShift,
    getShiftClosePreview: vi.fn(async () => ({ ...preview, cashTotalRp: 510000, expectedCashRp: 610000 })),
  });
  const { u } = show(api);

  const retryButton = await screen.findByRole("button", { name: "Ulangi permintaan yang sama" });
  await u.click(retryButton);

  expect(await screen.findByText(/Catatan selisih wajib diisi/)).toBeTruthy();
  expect(await screen.findByRole("heading", { name: "Pratinjau shift #7" })).toBeTruthy();
  expect(api.getCurrentShift).toHaveBeenCalledTimes(1);

  await u.type(screen.getByLabelText("Uang dihitung (Rp)"), "600000");
  await u.type(screen.getByLabelText("Catatan/Alasan Selisih"), "Selisih setelah pulih");
  await u.click(screen.getByRole("button", { name: "Tutup shift" }));
  expect(screen.getByRole("dialog").textContent).toContain("#7");
  await u.click(screen.getByRole("button", { name: "Ya, tutup shift" }));
  expect(await screen.findByRole("heading", { name: "Penutupan tersimpan" })).toBeTruthy();
});

it("BUG-244: gagal muat shift saat pemulihan menampilkan tombol coba lagi dan kasir dapat melanjutkan", async () => {
  localStorage.setItem(
    "pos.shift.close.2.close_saved_retry",
    JSON.stringify({ shiftId: 7, closeKey: "close_saved_retry", declaredCashRp: 600000 }),
  );
  const getCurrentShift = vi
    .fn<PosDataSource["getCurrentShift"]>()
    .mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "Koneksi terputus"))
    .mockResolvedValueOnce({ id: 7, cashierId: 2, openedAtMs: 1, openingCashRp: 100000 });
  const closeShift = vi
    .fn<PosDataSource["closeShift"]>()
    .mockRejectedValueOnce(
      new ApiError(422, "VALIDATION_ERROR", "Catatan selisih wajib diisi jika terdapat selisih kas."),
    )
    .mockImplementationOnce(async (_id, input) => result(input.closeKey, input.varianceNote ?? null));
  const api = source({
    getCurrentShift,
    closeShift,
    getShiftClosePreview: vi.fn(async () => ({ ...preview, cashTotalRp: 510000, expectedCashRp: 610000 })),
  });
  const { u } = show(api);

  await u.click(await screen.findByRole("button", { name: "Ulangi permintaan yang sama" }));
  const retryShiftButton = await screen.findByRole("button", { name: "Coba lagi muat shift" });
  expect(screen.queryByRole("heading", { name: "Pratinjau shift #7" })).toBeNull();

  await u.click(retryShiftButton);
  expect(await screen.findByRole("heading", { name: "Pratinjau shift #7" })).toBeTruthy();
  await u.type(screen.getByLabelText("Uang dihitung (Rp)"), "600000");
  await u.type(screen.getByLabelText("Catatan/Alasan Selisih"), "Berhasil setelah coba lagi");
  await u.click(screen.getByRole("button", { name: "Tutup shift" }));
  await u.click(screen.getByRole("button", { name: "Ya, tutup shift" }));
  expect(await screen.findByRole("heading", { name: "Penutupan tersimpan" })).toBeTruthy();
});

it("AUDIT-01 laporan dua shift diberi batas cakupan yang jelas", async () => {
 const api = source({ getPaymentReport: vi.fn(async () => ({ cash: { totalRp: 0, count: 0 }, qrisManual: { totalRp: 3000, count: 2, verifiedCount: 2 }, totalRp: 3000, qrisSales: [1,2].map(i => ({ saleId: i, saleNo: `DUA-SHIFT-${i}`, committedAtMs: 1000, totalRp: i * 1000, cashierUsername: "kasir", verifiedBy: 2, verifiedAtMs: 1000, evidenceRef: null, status: "verified" as const })) })) });
 show(api);
 expect(await screen.findByText(/bukan khusus shift aktif/)).toBeTruthy();
 expect(await screen.findByText("DUA-SHIFT-1")).toBeTruthy(); expect(screen.getByText("DUA-SHIFT-2")).toBeTruthy();
 expect(screen.getByRole("row", { name: /^Penjualan QRIS/ }).textContent).toContain("Rp300.000");
});
