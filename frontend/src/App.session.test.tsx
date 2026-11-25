import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { createMockDataSource } from "./api/mockDataSource";

function makeSource() {
  return createMockDataSource({ latencyMs: 0 });
}

async function loginAs(
  user: ReturnType<typeof userEvent.setup>,
  username: string,
  password: string,
) {
  await user.type(screen.getByLabelText("Nama pengguna"), username);
  await user.type(screen.getByLabelText("Kata sandi"), password);
  await user.click(screen.getByRole("button", { name: "Masuk" }));
}

/**
 * TASK-013 — perilaku sesi di UI pada tingkat komponen (jsdom).
 * Refresh browser nyata TIDAK dijalankan di sini; ini mensimulasikan mount ulang
 * aplikasi dengan data source baru dan memeriksa token tidak dipulihkan dari storage.
 */
describe("TASK-013 sesi UI: refresh, ganti role, akun nonaktif", () => {
  it("mount ulang (simulasi refresh) tidak memulihkan sesi dan kembali ke login", async () => {
    localStorage.clear();
    sessionStorage.clear();

    const first = render(<App dataSource={makeSource()} onAfterLogout={vi.fn()} />);
    const user = userEvent.setup();
    await loginAs(user, "admin.demo", "sandi-demo");
    expect(await screen.findByRole("navigation", { name: "Menu utama" })).toBeTruthy();
    first.unmount();

    // Instans baru = proses renderer baru setelah refresh; tidak ada token di storage.
    render(<App dataSource={makeSource()} onAfterLogout={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Masuk ke akun" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Menu utama" })).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("ganti role ADMIN -> CASHIER menampilkan menu sesuai role backend", async () => {
    render(<App dataSource={makeSource()} onAfterLogout={vi.fn()} />);
    const user = userEvent.setup();

    await loginAs(user, "admin.demo", "sandi-demo");
    const adminNav = await screen.findByRole("navigation", { name: "Menu utama" });
    expect(adminNav).toBeTruthy();
    expect(screen.getByRole("button", { name: "Akun" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Kasir" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Keluar" }));
    await screen.findByRole("heading", { name: "Masuk ke akun" });

    await loginAs(user, "kasir.demo", "sandi-demo");
    expect(await screen.findByRole("navigation", { name: "Menu utama" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kasir" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Akun" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dashboard" })).toBeNull();
  });

  it("akun nonaktif ditolak dengan pesan generik tanpa membuka menu", async () => {
    render(<App dataSource={makeSource()} onAfterLogout={vi.fn()} />);
    const user = userEvent.setup();

    await loginAs(user, "kasir.nonaktif", "sandi-demo");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Nama pengguna atau kata sandi salah");
    expect(screen.queryByRole("navigation", { name: "Menu utama" })).toBeNull();
  });

  it("barcode tak dikenal tidak menambah barang dan keranjang tetap kosong", async () => {
    render(<App dataSource={makeSource()} onAfterLogout={vi.fn()} />);
    const user = userEvent.setup();
    await loginAs(user, "kasir.demo", "sandi-demo");

    const barcodeInput = (await screen.findByLabelText("Scan barcode", {
      selector: "input",
    })) as HTMLInputElement;
    await user.type(barcodeInput, "9999999999999{Enter}");

    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Barang tidak ditemukan");
    expect(screen.queryByRole("table", { name: "Keranjang" })).toBeNull();
    expect(screen.getByText("0 barang")).toBeTruthy();
  });
});
