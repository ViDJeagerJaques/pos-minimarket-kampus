import { describe, expect, it } from "vitest";
import type { CatalogProduct } from "../api/types";
import { buildPriceTags, buildPriceTagsPrintHtml } from "./priceTags";

const PRODUCTS: CatalogProduct[] = [
  {
    id: 1,
    categoryId: 10,
    categoryName: "Minuman",
    sku: "DEMO-001",
    name: "Air Mineral 600ml",
    priceRp: 3500,
    active: true,
    barcodes: ["8992753184200"],
    supplierIds: [1],
    stockOnHand: 20,
  },
  {
    id: 2,
    categoryId: 20,
    categoryName: "Makanan",
    sku: "DEMO-002",
    name: "Mie Instan Goreng",
    priceRp: 3200,
    active: true,
    barcodes: ["8998866200123"],
    supplierIds: [1],
    stockOnHand: 15,
  },
  {
    id: 3,
    categoryId: 20,
    categoryName: "Makanan",
    sku: "DEMO-003",
    name: "Produk Nonaktif",
    priceRp: 5000,
    active: false,
    barcodes: ["8990000000001"],
    supplierIds: [1],
    stockOnHand: 0,
  },
];

describe("priceTags (Ide 2)", () => {
  it("membuat tag harga untuk semua produk aktif atau per kategori dan membedakan barcode EAN-13 dari SKU", () => {
    const allTags = buildPriceTags(PRODUCTS, null);
    expect(allTags).toHaveLength(2);
    expect(allTags[0]).toMatchObject({
      storeName: "Minimarket Kampus",
      name: "Air Mineral 600ml",
      formattedPrice: "Rp3.500",
      barcode: "8992753184200",
      sku: "DEMO-001",
    });

    const foodTags = buildPriceTags(PRODUCTS, 20);
    expect(foodTags).toHaveLength(1);
    expect(foodTags[0]?.sku).toBe("DEMO-002");
  });

  it("menghasilkan HTML cetak dengan layout tag harga lengkap", () => {
    const html = buildPriceTagsPrintHtml(buildPriceTags(PRODUCTS, null));
    expect(html).toContain("Minimarket Kampus");
    expect(html).toContain("Air Mineral 600ml");
    expect(html).toContain("Rp3.500");
    expect(html).toContain("8992753184200");
    expect(html).toContain("Belanja praktis untuk kebutuhan kampus");
  });
});
