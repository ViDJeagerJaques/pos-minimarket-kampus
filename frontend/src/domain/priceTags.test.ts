import { describe, expect, it } from "vitest";
import type { CatalogProduct } from "../api/types";
import { buildPriceTags, buildPriceTagsPdfBlob, buildPriceTagsPrintHtml } from "./priceTags";

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

  it("BUG-182: menghasilkan Blob PDF asli yang memuat header %PDF dan tag produk terpilih", async () => {
    const blob = buildPriceTagsPdfBlob(buildPriceTags(PRODUCTS, null));
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/pdf");
    const buffer = await blob.arrayBuffer();
    const text = new TextDecoder("latin1").decode(buffer);
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text).toContain("Air Mineral 600ml");
    expect(text).toContain("Rp3.500");
  });

  it("BUG-189: menggeser posisi SKU dan footer berdasarkan tinggi barcode panjang yang membungkus", async () => {
    const shortBlob = buildPriceTagsPdfBlob(buildPriceTags([PRODUCTS[0]!], null));
    const longBarcodeProduct: CatalogProduct = {
      ...PRODUCTS[0]!,
      barcodes: ["8".repeat(64)],
      sku: "SKU-LONG-BARCODE",
    };
    const longBlob = buildPriceTagsPdfBlob(buildPriceTags([longBarcodeProduct], null));
    const shortText = new TextDecoder("latin1").decode(await shortBlob.arrayBuffer());
    const longText = new TextDecoder("latin1").decode(await longBlob.arrayBuffer());

    const extractSkuY = (pdfText: string, sku: string): number => {
      const escaped = sku.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = pdfText.match(new RegExp(`([0-9.]+) ([0-9.]+) Td\\s*\\(SKU: ${escaped}\\)`));
      expect(match).not.toBeNull();
      return Number(match![2]);
    };

    const shortSkuY = extractSkuY(shortText, "DEMO-001");
    const longSkuY = extractSkuY(longText, "SKU-LONG-BARCODE");
    expect(longSkuY).toBeLessThan(shortSkuY - 10);
  });
});
