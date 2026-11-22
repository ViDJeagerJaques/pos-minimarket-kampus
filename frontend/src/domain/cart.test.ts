import { describe, expect, it } from "vitest";
import { addProduct, setQuantity, type CartLine, type CartProduct } from "./cart";

it("BUG-032: stok legacy nol tidak menghalangi pengurangan", () => {
  const lines = [{ productId: 1, sku: "DEMO", name: "DEMO", unitPriceRp: 1000, quantity: 3, stockHint: 0 }];
  expect(setQuantity(lines, 1, 2).ok).toBe(true);
  expect(setQuantity(lines, 1, 4).ok).toBe(false);
});

const PRODUCT: CartProduct = {
  id: 1,
  sku: "SKU-STOK-3",
  name: "Produk Stok 3",
  priceRp: 5000,
  stock: 3,
};

const LINE: CartLine = {
  productId: PRODUCT.id,
  sku: PRODUCT.sku,
  name: PRODUCT.name,
  unitPriceRp: PRODUCT.priceRp,
  quantity: 1,
  stockHint: PRODUCT.stock,
};

/**
 * TASK-013 — nilai tepi kuantitas pada draft keranjang.
 * Ini lapisan UI/domain: draft tidak pernah menjadi penjualan, dan backend
 * checkout belum ada (TASK-016). Pembuktian tidak ada mutasi DB ada di
 * scripts/task-013_integration_e2e.mjs (AC-03.07).
 */
describe("TASK-013 kuantitas invalid pada draft keranjang", () => {
  it.each([
    ["nol", 0],
    ["negatif", -1],
    ["pecahan", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("addProduct menolak kuantitas %s tanpa mengubah baris", (_label, quantity) => {
    const before: CartLine[] = [structuredClone(LINE)];
    const snapshot = structuredClone(before);
    const result = addProduct(before, PRODUCT, quantity);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("INVALID_QUANTITY");
    expect(result.lines).toEqual(snapshot);
    expect(before).toEqual(snapshot);
  });

  it("addProduct menolak jumlah yang melebihi stok dan mempertahankan baris", () => {
    const before: CartLine[] = [structuredClone(LINE)];
    const snapshot = structuredClone(before);
    const result = addProduct(before, PRODUCT, 3);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("INSUFFICIENT_STOCK");
    expect(result.lines).toEqual(snapshot);
    expect(before).toEqual(snapshot);
  });

  it("addProduct menolak produk bersaldo nol", () => {
    const before: CartLine[] = [];
    const snapshot = structuredClone(before);
    const result = addProduct(before, { ...PRODUCT, stock: 0 }, 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("INSUFFICIENT_STOCK");
    expect(result.lines).toEqual(snapshot);
    expect(before).toEqual(snapshot);
  });

  it.each([
    ["nol", 0],
    ["negatif", -1],
    ["pecahan", 2.5],
  ])("setQuantity menolak kuantitas %s tanpa mengubah baris", (_label, quantity) => {
    const before: CartLine[] = [structuredClone(LINE)];
    const snapshot = structuredClone(before);
    const result = setQuantity(before, PRODUCT.id, quantity);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("INVALID_QUANTITY");
    expect(result.lines).toEqual(snapshot);
    expect(before).toEqual(snapshot);
  });

  it("setQuantity menolak jumlah di atas stok dan mempertahankan baris", () => {
    const before: CartLine[] = [structuredClone(LINE)];
    const snapshot = structuredClone(before);
    const result = setQuantity(before, PRODUCT.id, 4);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("INSUFFICIENT_STOCK");
    expect(result.lines).toEqual(snapshot);
    expect(before).toEqual(snapshot);
  });

  it("setQuantity menolak produk yang tidak ada di keranjang", () => {
    const before: CartLine[] = [structuredClone(LINE)];
    const snapshot = structuredClone(before);
    const result = setQuantity(before, 999, 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("INVALID_QUANTITY");
    expect(result.lines).toEqual(snapshot);
    expect(before).toEqual(snapshot);
  });

  it("menerima kuantitas valid dan menghitung total draft", () => {
    const before: CartLine[] = [structuredClone(LINE)];
    const snapshot = structuredClone(before);
    const result = addProduct(before, PRODUCT, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0]?.quantity).toBe(3);
    expect(before).toEqual(snapshot);
  });
});
