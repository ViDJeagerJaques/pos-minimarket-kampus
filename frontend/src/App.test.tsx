import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { createMockDataSource } from "./api/mockDataSource";
import type { PosDataSource, ProductSummary } from "./api/types";
import { ConfirmDialog } from "./components/ConfirmDialog";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderDemoApp(override?: Partial<PosDataSource>) {
  const base = createMockDataSource({ latencyMs: 0 });
  const dataSource: PosDataSource = { ...base, ...override };
  const onAfterLogout = vi.fn();
  render(<App dataSource={dataSource} onAfterLogout={onAfterLogout} />);
  return { dataSource, callLog: base.callLog, onAfterLogout, user: userEvent.setup() };
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
    const { user, callLog } = renderDemoApp();

    await loginAs(user, "kasir.nonaktif");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Nama pengguna atau kata sandi salah");
    expect(screen.getByRole("heading", { name: "POS Minimarket Kampus" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Menu utama" })).toBeNull();
    expect(callLog.some((entry) => entry.isMutation)).toBe(false);
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
    const { user, callLog } = renderDemoApp();
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
    expect(callLog.some((entry) => entry.isMutation)).toBe(false);
    expect(document.activeElement).toBe(barcodeInput);
  });

  it("keranjang draft tidak hilang diam-diam saat berpindah halaman", async () => {
    const { user } = renderDemoApp();
    await loginAs(user, "kasir.demo");

    const barcodeInput = (await screen.findByLabelText("Scan barcode", { selector: "input" })) as HTMLInputElement;
    await user.type(barcodeInput, "0000000000017{Enter}");
    await screen.findByRole("table", { name: "Keranjang" });
    expect(screen.getByText("Roti Isi Cokelat (DEMO)")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Riwayat/Struk" }));
    expect(screen.getByRole("heading", { name: "Riwayat/Struk" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Kasir" }));
    await screen.findByRole("table", { name: "Keranjang" });
    expect(screen.getByText("Roti Isi Cokelat (DEMO)")).toBeTruthy();
    expect(screen.getByText("1 barang")).toBeTruthy();
  });

  it("pencarian A yang selesai setelah B tidak menimpa hasil B", async () => {
    const deferredA = createDeferred<ProductSummary[]>();
    const deferredB = createDeferred<ProductSummary[]>();
    const productA: ProductSummary = { id: 1, sku: "DEMO-A", name: "Produk Lama A", priceRp: 5000, stock: 5, active: true };
    const productB: ProductSummary = { id: 2, sku: "DEMO-B", name: "Produk Baru B", priceRp: 4000, stock: 5, active: true };

    const { user } = renderDemoApp({
      searchActiveProducts: vi.fn((q: string) => (q === "aaa" ? deferredA.promise : deferredB.promise)),
    });
    await loginAs(user, "kasir.demo");

    const searchInput = await screen.findByLabelText("Cari barang", { selector: "input" });
    await user.type(searchInput, "aaa");
    await user.click(screen.getByRole("button", { name: "Cari" }));

    await user.clear(searchInput);
    await user.type(searchInput, "bbb");
    await user.click(screen.getByRole("button", { name: "Cari" }));

    await act(async () => {
      deferredB.resolve([productB]);
    });
    expect(await screen.findByText("Produk Baru B")).toBeTruthy();

    await act(async () => {
      deferredA.resolve([productA]);
    });
    expect(screen.getByText("Produk Baru B")).toBeTruthy();
    expect(screen.queryByText("Produk Lama A")).toBeNull();
  });

  it("error dari request pencarian lama tidak menimpa hasil pencarian terbaru", async () => {
    const deferredA = createDeferred<ProductSummary[]>();
    const deferredB = createDeferred<ProductSummary[]>();
    const productB: ProductSummary = { id: 2, sku: "DEMO-B", name: "Produk Baru B", priceRp: 4000, stock: 5, active: true };

    const { user } = renderDemoApp({
      searchActiveProducts: vi.fn((q: string) => (q === "aaa" ? deferredA.promise : deferredB.promise)),
    });
    await loginAs(user, "kasir.demo");

    const searchInput = await screen.findByLabelText("Cari barang", { selector: "input" });
    await user.type(searchInput, "aaa");
    await user.click(screen.getByRole("button", { name: "Cari" }));

    await user.clear(searchInput);
    await user.type(searchInput, "bbb");
    await user.click(screen.getByRole("button", { name: "Cari" }));

    await act(async () => {
      deferredB.resolve([productB]);
    });
    expect(await screen.findByText("Produk Baru B")).toBeTruthy();

    await act(async () => {
      deferredA.reject(new Error("network timeout"));
    });
    expect(screen.getByText("Produk Baru B")).toBeTruthy();
    expect(screen.queryByText("Pencarian gagal. Coba lagi.")).toBeNull();
  });

  it("pembatalan draft mengabaikan lookup barcode yang masih berjalan dan menjaga fokus di dalam dialog", async () => {
    const firstLookup = createDeferred<ProductSummary | null>();
    const secondLookup = createDeferred<ProductSummary | null>();
    const roti: ProductSummary = { id: 1, sku: "DEMO-001", name: "Roti Isi Cokelat (DEMO)", priceRp: 5000, stock: 12, active: true };
    const air: ProductSummary = { id: 2, sku: "DEMO-002", name: "Air Mineral 600 ml (DEMO)", priceRp: 4000, stock: 30, active: true };

    const findMock = vi.fn((code: string) => (code === "0000000000017" ? firstLookup.promise : secondLookup.promise));
    const { user } = renderDemoApp({ findActiveProductByBarcode: findMock });
    await loginAs(user, "kasir.demo");

    const barcodeInput = (await screen.findByLabelText("Scan barcode", { selector: "input" })) as HTMLInputElement;
    await user.type(barcodeInput, "0000000000017{Enter}");
    await act(async () => {
      firstLookup.resolve(roti);
    });
    await screen.findByRole("table", { name: "Keranjang" });

    // Mulai lookup kedua yang lambat, lalu buka dialog batal draft sebelum selesai.
    await user.type(barcodeInput, "0000000000024{Enter}");
    await user.click(screen.getByRole("button", { name: "Batal draft" }));

    const dialog = screen.getByRole("dialog", { name: "Batalkan draft?" });
    const cancelReturnBtn = screen.getByRole("button", { name: "Kembali ke keranjang" });
    expect(document.activeElement).toBe(cancelReturnBtn);

    // Lookup kedua selesai saat dialog terbuka -> fokus TIDAK boleh pindah ke barcodeInput.
    await act(async () => {
      secondLookup.resolve(air);
    });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(barcodeInput);

    // Konfirmasi batal draft -> keranjang harus kosong dan lookup lama tidak boleh mengisi ulang.
    await user.click(screen.getByRole("button", { name: "Ya, batalkan draft" }));
    expect(screen.queryByRole("table", { name: "Keranjang" })).toBeNull();
    expect(screen.getByText("0 barang")).toBeTruthy();
    expect(screen.queryByText("Air Mineral 600 ml (DEMO)")).toBeNull();
    expect(document.activeElement).toBe(barcodeInput);
  });

  it("logout membersihkan draft dan tidak memulihkannya ke sesi berikutnya", async () => {
    const slowLookup = createDeferred<ProductSummary | null>();
    const roti: ProductSummary = { id: 1, sku: "DEMO-001", name: "Roti Isi Cokelat (DEMO)", priceRp: 5000, stock: 12, active: true };
    const air: ProductSummary = { id: 2, sku: "DEMO-002", name: "Air Mineral 600 ml (DEMO)", priceRp: 4000, stock: 30, active: true };

    const findMock = vi.fn((code: string) => (code === "0000000000017" ? Promise.resolve(roti) : slowLookup.promise));
    const { user } = renderDemoApp({ findActiveProductByBarcode: findMock });

    await loginAs(user, "kasir.demo");
    const barcodeInput = (await screen.findByLabelText("Scan barcode", { selector: "input" })) as HTMLInputElement;
    await user.type(barcodeInput, "0000000000017{Enter}");
    await screen.findByRole("table", { name: "Keranjang" });

    // Mulai lookup kedua lalu langsung logout sebelum selesai.
    await user.type(barcodeInput, "0000000000024{Enter}");
    await user.click(screen.getByRole("button", { name: "Keluar" }));
    await screen.findByRole("heading", { name: "POS Minimarket Kampus" });

    await act(async () => {
      slowLookup.resolve(air);
    });

    // Login sesi berikutnya -> keranjang harus kosong.
    await loginAs(user, "kasir.demo2");
    await screen.findByLabelText("Scan barcode", { selector: "input" });
    expect(screen.queryByRole("table", { name: "Keranjang" })).toBeNull();
    expect(screen.getByText("0 barang")).toBeTruthy();
  });

  it("dialog tetap bisa digunakan pada viewport kecil dan zoom tinggi", async () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { value: 360, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 320, configurable: true });

    try {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      const { container } = render(
        <ConfirmDialog
          title="Batalkan draft?"
          message={"Pesan panjang ".repeat(30)}
          confirmLabel="Ya, batalkan draft"
          cancelLabel="Kembali ke keranjang"
          destructive
          onConfirm={onConfirm}
          onCancel={onCancel}
        />,
      );

      expect(container.querySelector(".dialog-backdrop")).toBeTruthy();
      const cancelBtn = screen.getByRole("button", { name: "Kembali ke keranjang" });
      const confirmBtn = screen.getByRole("button", { name: "Ya, batalkan draft" });
      expect(document.activeElement).toBe(cancelBtn);

      await user.tab();
      expect(document.activeElement).toBe(confirmBtn);

      await user.click(confirmBtn);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "innerWidth", { value: originalWidth, configurable: true });
      Object.defineProperty(window, "innerHeight", { value: originalHeight, configurable: true });
    }
  });
});
