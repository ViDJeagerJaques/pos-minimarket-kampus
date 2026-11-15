import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import { createMockDataSource } from "../api/mockDataSource";
import type { CatalogProduct, CreateProductInput, PosDataSource, SessionUser } from "../api/types";
import { ProductsPage } from "./ProductsPage";

const ADMIN: SessionUser = {
  userId: 1,
  username: "admin.demo",
  displayName: "Admin DEMO",
  role: "ADMIN",
};

const PRODUCT: CatalogProduct = {
  id: 7,
  categoryId: 1,
  categoryName: "Minuman",
  sku: "SKU-001",
  name: "Produk Uji",
  priceRp: 5000,
  active: true,
  barcodes: ["000123"],
  supplierIds: [1],
  stockOnHand: 0,
};

function buildSource(overrides: Partial<PosDataSource> = {}): PosDataSource {
  const base = createMockDataSource({ latencyMs: 0 });
  return {
    ...base,
    catalogMode: "LOCAL_API",
    listCategories: vi.fn(async () => [{ id: 1, name: "Minuman" }]),
    listSuppliers: vi.fn(async () => [{ id: 1, name: "Supplier DEMO" }]),
    listCatalogProducts: vi.fn(async () => []),
    ...overrides,
  };
}

function renderPage(source: PosDataSource, onSessionExpired = vi.fn()) {
  const user = userEvent.setup();
  render(
    <ProductsPage
      dataSource={source}
      currentUser={ADMIN}
      onSessionExpired={onSessionExpired}
    />,
  );
  return { user, onSessionExpired };
}

async function fillCreateForm(user: ReturnType<typeof userEvent.setup>, barcode = "000123") {
  await screen.findByRole("option", { name: "Minuman" });
  await user.type(screen.getByLabelText("SKU"), "SKU-001");
  await user.type(screen.getByLabelText("Nama produk"), "Produk Uji");
  await user.type(screen.getByLabelText("Harga (Rp)"), "5000");
  await user.selectOptions(screen.getByLabelText("Kategori"), "1");
  await user.type(screen.getByLabelText("Barcode (satu per baris)"), barcode);
}

describe("TASK-012 katalog ADMIN", () => {
  it("mengirim barcode sebagai string sehingga nol awal tidak hilang", async () => {
    const createProduct = vi.fn(async (_input: CreateProductInput): Promise<CatalogProduct> => PRODUCT);
    const source = buildSource({ createProduct });
    const { user } = renderPage(source);

    await fillCreateForm(user, "000123");
    await user.click(screen.getByRole("button", { name: "Simpan produk" }));
    expect(screen.getByRole("dialog", { name: "Simpan produk baru?" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Ya, simpan produk" }));

    await waitFor(() => expect(createProduct).toHaveBeenCalledTimes(1));
    const payload = createProduct.mock.calls[0]?.[0];
    expect(payload?.barcodes).toEqual(["000123"]);
    expect(typeof payload?.barcodes[0]).toBe("string");
    expect(screen.getByRole("status").textContent).toContain("tersimpan");
  });

  it("menampilkan pesan server saat barcode duplikat", async () => {
    const createProduct = vi.fn(async () => {
      throw new ApiError(409, "DUPLICATE_BARCODE", "Barcode sudah dipakai produk lain.");
    });
    const { user } = renderPage(buildSource({ createProduct }));

    await fillCreateForm(user);
    await user.click(screen.getByRole("button", { name: "Simpan produk" }));
    await user.click(screen.getByRole("button", { name: "Ya, simpan produk" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("Barcode sudah dipakai produk lain.");
    });
  });

  it("menampilkan pesan server saat SKU invalid (422)", async () => {
    const createProduct = vi.fn(async () => {
      throw new ApiError(422, "VALIDATION_ERROR", "SKU tidak boleh mengandung spasi.");
    });
    const { user } = renderPage(buildSource({ createProduct }));

    await fillCreateForm(user);
    await user.click(screen.getByRole("button", { name: "Simpan produk" }));
    await user.click(screen.getByRole("button", { name: "Ya, simpan produk" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("SKU tidak boleh mengandung spasi.");
    });
  });

  it("meminta konfirmasi sebelum menonaktifkan produk", async () => {
    const updateProduct = vi.fn(async () => ({ ...PRODUCT, active: false }));
    const source = buildSource({
      listCatalogProducts: vi.fn(async () => [PRODUCT]),
      updateProduct,
    });
    const { user } = renderPage(source);

    await screen.findByRole("table", { name: "Daftar barang" });
    await user.click(screen.getByRole("button", { name: "Nonaktifkan SKU-001" }));
    expect(screen.getByRole("dialog", { name: "Nonaktifkan produk?" })).toBeTruthy();
    expect(updateProduct).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Batal" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateProduct).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Nonaktifkan SKU-001" }));
    await user.click(screen.getByRole("button", { name: "Ya, nonaktifkan" }));

    await waitFor(() => expect(updateProduct).toHaveBeenCalledWith(7, { active: false }));
  });

  it("403 ditampilkan sebagai penolakan backend tanpa mengakhiri sesi", async () => {
    const createCategory = vi.fn(async () => {
      throw new ApiError(403, "FORBIDDEN", "Akses ditolak oleh backend (403). Tindakan ini hanya untuk ADMIN.");
    });
    const source = buildSource({ createCategory });
    const { user, onSessionExpired } = renderPage(source);

    await user.type(screen.getByLabelText("Nama kategori baru"), "Kategori Dilarang");
    await user.click(screen.getByRole("button", { name: "Tambah kategori" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("Akses ditolak oleh backend (403)");
    });
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("401 dari backend memanggil onSessionExpired, bukan menampilkan katalog kosong", async () => {
    const source = buildSource({
      listCategories: vi.fn(async () => {
        throw new ApiError(401, "SESSION_INVALID", "Sesi berakhir. Silakan masuk lagi.");
      }),
    });
    const { onSessionExpired } = renderPage(source);

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
  });
});
