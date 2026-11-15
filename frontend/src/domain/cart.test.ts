import { describe, expect, it } from "vitest";
import { addProduct, setQuantity, type CartLine, type CartProduct } from "./cart";

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
    const before: CartLine[] = [];
    const result = addProduct(before, PRODUCT, quantity);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("INVALID_QUANTITY");
    expect(result.lines).toEqual(before);
  });

  it("addProduct menolak jumlah yang melebihi stok dan mempertahankan baris", () => {
    const result = addProduct([LINE], PRODUCT, 3);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("INSUFFICIENT_STOCK");
    expect(result.lines).toEqual([LINE]);
  });

  it("addProduct menolak produk bersaldo nol", () => {
    const result = addProduct([], { ...PRODUCT, stock: 0 }, 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("INSUFFICIENT_STOCK");
    expect(result.lines).toEqual([]);
  });

  it.each([
    ["nol", 0],
    ["negatif", -1],
    ["pecahan", 2.5],
  ])("setQuantity menolak kuantitas %s tanpa mengubah baris", (_label, quantity) => {
    const result = setQuantity([LINE], PRODUCT.id, quantity);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("INVALID_QUANTITY");
    expect(result.lines).toEqual([LINE]);
  });

  it("setQuantity menolak jumlah di atas stok dan mempertahankan baris", () => {
    const result = setQuantity([LINE], PRODUCT.id, 4);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("INSUFFICIENT_STOCK");
    expect(result.lines).toEqual([LINE]);
  });

  it("setQuantity menolak produk yang tidak ada di keranjang", () => {
    const result = setQuantity([LINE], 999, 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("INVALID_QUANTITY");
    expect(result.lines).toEqual([LINE]);
  });

  it("menerima kuantitas valid dan menghitung total draft", () => {
    const result = addProduct([LINE], PRODUCT, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0]?.quantity).toBe(3);
  });
});
