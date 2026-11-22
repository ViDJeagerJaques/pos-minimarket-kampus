import { describe, expect, it } from "vitest";
import type { CartLine } from "./cart";
import {
  buildCsv,
  buildCustomerDisplayState,
  buildDemoTaxInvoiceText,
  buildExcelHtml,
  calculateEarnedPoints,
  calculatePromoDiscountRp,
  recordCustomerPoints,
  renderCustomerDisplayHtml,
} from "./iposFeatures";

const SAMPLE_LINES: CartLine[] = [
  { productId: 1, sku: "DEMO-001", name: "Air Mineral 600ml", unitPriceRp: 3000, quantity: 3, stockHint: 10 },
  { productId: 2, sku: "DEMO-002", name: "Roti Tawar", unitPriceRp: 15000, quantity: 3, stockHint: 10 },
];

describe("iposFeatures (Ide 3 & Ide 7)", () => {
  it("menghitung dan menyimpan point pelanggan (1 point per Rp10.000)", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };
    expect(calculateEarnedPoints(25000)).toBe(2);
    const first = recordCustomerPoints("mhs01", 32000, storage);
    expect(first).toEqual({ customerCode: "MHS01", earned: 3, totalPoints: 3 });
    const second = recordCustomerPoints("mhs01", 20000, storage);
    expect(second).toEqual({ customerCode: "MHS01", earned: 2, totalPoints: 5 });
  });

  it("menjalankan mesin promo Beli 2 Gratis 1 dan Tebus Murah", () => {
    expect(calculatePromoDiscountRp(SAMPLE_LINES, "BUY_2_GET_1")).toBe(18000);
    expect(calculatePromoDiscountRp(SAMPLE_LINES, "TEBUS_MURAH")).toBe(2000);
  });

  it("membangun state dan HTML customer display dengan total setelah promo", () => {
    const state = buildCustomerDisplayState(SAMPLE_LINES, "BUY_2_GET_1", 4000);
    expect(state.totalRp).toBe(36000);
    const html = renderCustomerDisplayHtml(state);
    expect(html).toContain("CUSTOMER DISPLAY");
    expect(html).toContain("Rp36.000");
    expect(html).toContain("Kembalian: Rp4.000");
  });

  it("menghasilkan ekspor CSV, Excel HTML, dan faktur pajak simulasi DEMO", () => {
    const csv = buildCsv(["No", "Total"], [["S-001", 10000]]);
    expect(csv).toContain("No,Total");
    expect(csv).toContain("S-001,10000");

    const xls = buildExcelHtml("Laporan Uji", ["No", "Total"], [["S-001", 10000]]);
    expect(xls).toContain("<table");
    expect(xls).toContain("Laporan Uji");

    const tax = buildDemoTaxInvoiceText({ saleNo: "S-001", committedAtMs: 1700000000000, totalRp: 11100 });
    expect(tax).toContain("SIMULASI DEMO");
    expect(tax).toContain("BUKAN DOKUMEN PAJAK RESMI");
    expect(tax).toContain("Rp10.000");
    expect(tax).toContain("Rp1.100");
  });
});
