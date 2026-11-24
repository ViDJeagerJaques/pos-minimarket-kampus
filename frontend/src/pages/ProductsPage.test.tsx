import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import { createMockDataSource } from "../api/mockDataSource";
import type {
  CatalogProduct,
  CategorySummary,
  CreateProductInput,
  PosDataSource,
  SessionUser,
  SupplierSummary,
} from "../api/types";
import { ProductsPage } from "./ProductsPage";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
  expect((screen.getByLabelText("Harga (Rp)") as HTMLInputElement).value).toBe("5.000");
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

  it("BUG-006: respons pencarian lama yang selesai setelah mutasi produk tidak menimpa data produk terbaru", async () => {
    const staleSearch = createDeferred<CatalogProduct[]>();
    const updatedProduct: CatalogProduct = {
      ...PRODUCT,
      name: "Produk Baru",
      priceRp: 6500,
    };
    let catalogCall = 0;
    const listCatalogProducts = vi.fn(() => {
      catalogCall += 1;
      if (catalogCall === 1) {
        return Promise.resolve([PRODUCT]);
      }
      if (catalogCall === 2) {
        return staleSearch.promise;
      }
      return Promise.resolve([updatedProduct]);
    });
    const updateProduct = vi.fn(async () => updatedProduct);

    const { user } = renderPage(buildSource({ listCatalogProducts, updateProduct }));

    await screen.findByText("Produk Uji");

    // Picu pencarian yang responsnya tertunda (call #2)
    await user.type(screen.getByLabelText("Cari produk"), "SKU-001");
    await user.click(screen.getByRole("button", { name: "Cari" }));
    await waitFor(() => expect(listCatalogProducts).toHaveBeenCalledTimes(2));

    // Mutasi produk selesai lebih dulu sebelum pencarian #2 selesai
    await user.click(screen.getByRole("button", { name: "Ubah SKU-001" }));
    const editForm = screen.getByRole("form", { name: "Ubah produk" });
    const nameInput = within(editForm).getByLabelText("Nama produk");
    await user.clear(nameInput);
    await user.type(nameInput, "Produk Baru");
    await user.click(within(editForm).getByRole("button", { name: "Simpan perubahan" }));

    await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
    await screen.findByText("Produk Baru");

    // Respons pencarian lama (#2) tiba terlambat dengan nama lama -> tidak boleh menimpa
    await act(async () => {
      staleSearch.resolve([PRODUCT]);
      await Promise.resolve();
    });

    expect(screen.getByText("Produk Baru")).toBeTruthy();
    expect(screen.queryByText("Produk Uji")).toBeNull();
  });

  it("BUG-006: respons baca lama yang selesai setelah mutasi kategori tidak menimpa kategori baru", async () => {
    const staleCategories = createDeferred<CategorySummary[]>();
    const initialCategory: CategorySummary = { id: 1, name: "Minuman" };
    const createdCategory: CategorySummary = { id: 2, name: "Makanan Ringan" };

    let catCall = 0;
    let categoryCreated = false;
    const listCategories = vi.fn(() => {
      catCall += 1;
      if (catCall === 1) return Promise.resolve([initialCategory]);
      if (catCall === 2) return staleCategories.promise;
      return Promise.resolve(
        categoryCreated ? [initialCategory, createdCategory] : [initialCategory],
      );
    });

    const { user } = renderPage(
      buildSource({
        listCategories,
        createCategory: vi.fn(async () => {
          categoryCreated = true;
          return createdCategory;
        }),
      }),
    );

    await screen.findByRole("option", { name: "Minuman" });

    // Picu baca ulang lewat pencarian (call #2 tertunda)
    await user.type(screen.getByLabelText("Cari produk"), "uji");
    await user.click(screen.getByRole("button", { name: "Cari" }));
    await waitFor(() => expect(listCategories).toHaveBeenCalledTimes(2));

    // Mutasi kategori selesai lebih dulu dan memicu refresh (#3)
    await user.type(screen.getByLabelText("Nama kategori baru"), "Makanan Ringan");
    await user.click(screen.getByRole("button", { name: "Tambah kategori" }));
    await waitFor(() => expect(listCategories).toHaveBeenCalledTimes(3));
    await screen.findByRole("option", { name: "Makanan Ringan" });

    // Respons lama (#2) tiba terlambat -> kategori baru harus tetap ada
    await act(async () => {
      staleCategories.resolve([initialCategory]);
      await Promise.resolve();
    });

    expect(screen.getByRole("option", { name: "Makanan Ringan" })).toBeTruthy();
  });

  it("BUG-006: respons baca lama yang selesai setelah mutasi supplier memicu refresh dan tidak menimpa supplier baru", async () => {
    const staleSuppliers = createDeferred<SupplierSummary[]>();
    const initialSupplier: SupplierSummary = { id: 1, name: "Supplier DEMO" };
    const createdSupplier: SupplierSummary = { id: 2, name: "PT Sumber Segar" };

    let supCall = 0;
    let supplierCreated = false;
    const listSuppliers = vi.fn(() => {
      supCall += 1;
      if (supCall === 1) return Promise.resolve([initialSupplier]);
      if (supCall === 2) return staleSuppliers.promise;
      return Promise.resolve(
        supplierCreated ? [initialSupplier, createdSupplier] : [initialSupplier],
      );
    });

    const { user } = renderPage(
      buildSource({
        listSuppliers,
        createSupplier: vi.fn(async () => {
          supplierCreated = true;
          return createdSupplier;
        }),
      }),
    );

    await screen.findByLabelText("Supplier DEMO");

    // Picu baca ulang supplier lewat pencarian (call #2 tertunda)
    await user.type(screen.getByLabelText("Cari produk"), "uji");
    await user.click(screen.getByRole("button", { name: "Cari" }));
    await waitFor(() => expect(listSuppliers).toHaveBeenCalledTimes(2));

    // Mutasi supplier selesai lebih dulu -> harus menginvalidasi #2 dan memicu refresh #3
    await user.type(screen.getByLabelText("Nama supplier baru"), "PT Sumber Segar");
    await user.click(screen.getByRole("button", { name: "Tambah supplier" }));
    await waitFor(() => expect(listSuppliers).toHaveBeenCalledTimes(3));
    await screen.findByLabelText("PT Sumber Segar");

    // Respons lama (#2) tiba terlambat -> supplier baru dari refresh harus tetap ada
    await act(async () => {
      staleSuppliers.resolve([initialSupplier]);
      await Promise.resolve();
    });

    expect(screen.getByLabelText("PT Sumber Segar")).toBeTruthy();
  });

  it("BUG-006: invalidatePendingReadsAndRefresh menaikkan token secara sinkron sebelum efek refresh berjalan", async () => {
    const staleCategories = createDeferred<CategorySummary[]>();
    const pendingCreate = createDeferred<CategorySummary>();
    const pendingRefresh = createDeferred<CategorySummary[]>();
    const initialCategory: CategorySummary = { id: 1, name: "Minuman" };
    const createdCategory: CategorySummary = { id: 2, name: "Makanan Ringan" };

    let catCall = 0;
    const listCategories = vi.fn(() => {
      catCall += 1;
      if (catCall === 1) return Promise.resolve([initialCategory]);
      if (catCall === 2) return staleCategories.promise;
      return pendingRefresh.promise;
    });

    const { user } = renderPage(
      buildSource({
        listCategories,
        createCategory: vi.fn(() => pendingCreate.promise),
      }),
    );

    await screen.findByRole("option", { name: "Minuman" });

    // Picu baca ulang (call #2 tertunda)
    await user.type(screen.getByLabelText("Cari produk"), "uji");
    await user.click(screen.getByRole("button", { name: "Cari" }));
    await waitFor(() => expect(listCategories).toHaveBeenCalledTimes(2));

    // Mulai mutasi kategori (masih tertunda)
    await user.type(screen.getByLabelText("Nama kategori baru"), "Makanan Ringan");
    await user.click(screen.getByRole("button", { name: "Tambah kategori" }));

    // Selesaikan mutasi lalu langsung selesaikan respons lama sebelum efek refresh #3 berjalan
    await act(async () => {
      pendingCreate.resolve(createdCategory);
      await Promise.resolve();
      expect(listCategories).toHaveBeenCalledTimes(2);

      staleCategories.resolve([initialCategory]);
      await Promise.resolve();
    });

    expect(screen.getByRole("option", { name: "Makanan Ringan" })).toBeTruthy();
  });

  it("BUG-007: klik ganda konfirmasi hapus barcode hanya mengirim satu permintaan dan hapus normal tetap bekerja", async () => {
    const pendingRemove = createDeferred<CatalogProduct>();
    const updatedProduct: CatalogProduct = { ...PRODUCT, barcodes: [] };
    let removed = false;
    const removeBarcode = vi.fn(() => {
      removed = true;
      return pendingRemove.promise;
    });
    const listCatalogProducts = vi.fn(async () => [removed ? updatedProduct : PRODUCT]);

    const { user } = renderPage(buildSource({ listCatalogProducts, removeBarcode }));

    await screen.findByRole("table", { name: "Daftar barang" });
    await user.click(screen.getByRole("button", { name: "Ubah SKU-001" }));
    await user.click(screen.getByRole("button", { name: "Hapus barcode 000123" }));
    const confirmBtn = screen.getByRole("button", { name: "Ya, hapus barcode" });

    await user.click(confirmBtn);
    await user.click(confirmBtn);

    expect(removeBarcode).toHaveBeenCalledTimes(1);
    expect(removeBarcode).toHaveBeenCalledWith(PRODUCT.id, "000123");

    await act(async () => {
      pendingRemove.resolve(updatedProduct);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain('Barcode "000123" dihapus dari SKU-001.');
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

it("BUG-205/206: harga edit berformat ribuan dan badge stok mengikuti saldo", async () => {
  const updateProduct = vi.fn(async () => ({ ...PRODUCT, priceRp: 3000 }));
  const { user } = renderPage(buildSource({ listCatalogProducts: vi.fn(async () => [PRODUCT, { ...PRODUCT, id: 8, sku: "SKU-002", stockOnHand: 5 }, { ...PRODUCT, id: 9, sku: "SKU-003", stockOnHand: 6 }]), updateProduct }));
  await screen.findByText("Stok habis");
  expect(screen.getByText("Stok menipis")).toBeTruthy();
  expect(screen.getByText("Stok aman")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Ubah SKU-001" }));
  const form = screen.getByRole("form", { name: "Ubah produk" });
  const input = within(form).getByLabelText("Harga (Rp)");
  expect((input as HTMLInputElement).value).toBe("5.000");
  await user.clear(input); await user.type(input, "3000");
  expect((input as HTMLInputElement).value).toBe("3.000");
  await user.click(within(form).getByRole("button", { name: "Simpan perubahan" }));
  await waitFor(() => expect(updateProduct).toHaveBeenCalledWith(7, expect.objectContaining({ priceRp: 3000 })));
});
