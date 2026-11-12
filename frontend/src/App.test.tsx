import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { createMockDataSource } from "./api/mockDataSource";

function renderDemoApp() {
  const dataSource = createMockDataSource({ latencyMs: 0 });
  const onAfterLogout = vi.fn();
  render(<App dataSource={dataSource} onAfterLogout={onAfterLogout} />);
  return { dataSource, onAfterLogout, user: userEvent.setup() };
}

async function loginAs(user: ReturnType<typeof userEvent.setup>, username: string, password = "demo-password") {
  const usernameInput = screen.getByLabelText("Nama pengguna");
  const passwordInput = screen.getByLabelText("Kata sandi");
  await user.clear(usernameInput);
  await user.type(usernameInput, username);
  await user.clear(passwordInput);
  await user.type(passwordInput, password);
  await user.click(screen.getByRole("button", { name: "Masuk" }));
}

describe("TASK-007 Kerangka layar lokal (MODE DEMO)", () => {
  it("menolak login DEMO untuk akun nonaktif tanpa membocorkan status akun", async () => {
    const { user, dataSource } = renderDemoApp();

    await loginAs(user, "kasir.nonaktif");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Nama pengguna atau kata sandi salah");
    expect(screen.getByRole("heading", { name: "POS Minimarket Kampus" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Menu utama" })).toBeNull();
    expect(dataSource.callLog.some((entry) => entry.isMutation)).toBe(false);
  });

  it("navigasi CASHIER hanya menampilkan menu kasir, label DEMO, dan tombol bayar nonaktif", async () => {
    const { user } = renderDemoApp();

    await loginAs(user, "kasir.demo");

    await screen.findByRole("navigation", { name: "Menu utama" });
    expect(screen.getByRole("note", { name: "Mode DEMO" })).toBeTruthy();

    expect(screen.getByRole("button", { name: "Kasir" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Riwayat/Struk" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Shift" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Dashboard" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Barang/Stok" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Akun" })).toBeNull();

    const payButton = screen.getByRole("button", { name: "Lanjut pembayaran" }) as HTMLButtonElement;
    expect(payButton.disabled).toBe(true);
  });

  it("navigasi ADMIN menampilkan menu admin dan menyembunyikan menu kasir", async () => {
    const { user } = renderDemoApp();

    await loginAs(user, "admin.demo");

    await screen.findByRole("navigation", { name: "Menu utama" });
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeTruthy();

    for (const label of ["Dashboard", "Barang/Stok", "Penerimaan", "Koreksi Stok", "Laporan", "Akun", "Backup"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: "Kasir" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Barang/Stok" }));
    await screen.findByRole("table", { name: "Daftar barang" });
    expect(screen.getByText("Roti Isi Cokelat (DEMO)")).toBeTruthy();
  });

  it("barcode tidak dikenal tidak menambahkan barang ke keranjang dan menjaga fokus input", async () => {
    const { user } = renderDemoApp();
    await loginAs(user, "kasir.demo");

    const barcodeInput = (await screen.findByLabelText("Scan barcode", { selector: "input" })) as HTMLInputElement;
    expect(document.activeElement).toBe(barcodeInput);

    await user.type(barcodeInput, "9999999999999{Enter}");

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("Barang tidak ditemukan");
    });
    expect(screen.queryByRole("table", { name: "Keranjang" })).toBeNull();
    expect(screen.getByText("0 barang")).toBeTruthy();
    expect(document.activeElement).toBe(barcodeInput);
  });

  it("membatalkan draft mengosongkan keranjang tanpa menciptakan transaksi atau mutasi", async () => {
    const { user, dataSource } = renderDemoApp();
    await loginAs(user, "kasir.demo");

    const barcodeInput = (await screen.findByLabelText("Scan barcode", { selector: "input" })) as HTMLInputElement;
    await user.type(barcodeInput, "0000000000017{Enter}");

    await screen.findByRole("table", { name: "Keranjang" });
    expect(screen.getByText("1 barang")).toBeTruthy();

    const payButton = screen.getByRole("button", { name: "Lanjut pembayaran" }) as HTMLButtonElement;
    expect(payButton.disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: "Batal draft" }));
    expect(screen.getByRole("dialog", { name: "Batalkan draft?" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Ya, batalkan draft" }));

    expect(screen.queryByRole("table", { name: "Keranjang" })).toBeNull();
    expect(screen.getByText("0 barang")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Draft dibatalkan");
    expect(dataSource.callLog.some((entry) => entry.isMutation)).toBe(false);
    expect(document.activeElement).toBe(barcodeInput);
  });
});
