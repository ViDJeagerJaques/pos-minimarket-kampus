import type { CatalogProduct } from "../api/types";
import { formatRupiah } from "./money";

export interface PriceTag {
  productId: number;
  storeName: string;
  name: string;
  priceRp: number;
  formattedPrice: string;
  barcode: string;
  sku: string;
  categoryName: string;
  slogan: string;
}

const STORE_NAME = "Minimarket Kampus";
const STORE_SLOGAN = "Belanja praktis untuk kebutuhan kampus";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Membangun daftar tag harga dari produk aktif di katalog.
 * Barcode pabrikan (mis. EAN-13 berawalan 899) dipertahankan sebagai teks
 * terpisah dari SKU internal toko.
 */
export function buildPriceTags(
  products: CatalogProduct[],
  categoryId: number | null = null,
): PriceTag[] {
  return products
    .filter((product) => product.active && (categoryId === null || product.categoryId === categoryId))
    .map((product) => ({
      productId: product.id,
      storeName: STORE_NAME,
      name: product.name,
      priceRp: product.priceRp,
      formattedPrice: formatRupiah(product.priceRp) ?? `Rp${product.priceRp}`,
      barcode: product.barcodes[0] ?? "",
      sku: product.sku,
      categoryName: product.categoryName,
      slogan: STORE_SLOGAN,
    }));
}

/**
 * Menghasilkan dokumen HTML siap cetak (Print / Simpan sebagai PDF) dengan layout
 * tag harga ala 89 Mart: header toko, nama produk, harga besar, nomor barcode,
 * dan footer slogan.
 */
export function buildPriceTagsPrintHtml(tags: PriceTag[]): string {
  const cards = tags
    .map(
      (tag) => `<article class="tag">
  <header class="tag__store">${escapeHtml(tag.storeName)}</header>
  <h2 class="tag__name">${escapeHtml(tag.name)}</h2>
  <div class="tag__price">${escapeHtml(tag.formattedPrice)}</div>
  <div class="tag__codes">
    <span>Barcode: ${escapeHtml(tag.barcode || "—")}</span>
    <span>SKU: ${escapeHtml(tag.sku)}</span>
  </div>
  <footer class="tag__slogan">${escapeHtml(tag.slogan)}</footer>
</article>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<title>Tag Harga — Minimarket Kampus</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 16px; color: #111827; }
  .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .tag { border: 2px solid #111827; border-radius: 6px; padding: 10px 12px; break-inside: avoid; display: grid; gap: 6px; }
  .tag__store { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; }
  .tag__name { font-size: 14px; font-weight: 700; margin: 0; min-height: 36px; }
  .tag__price { font-size: 24px; font-weight: 800; color: #0f5132; }
  .tag__codes { display: flex; justify-content: space-between; font-size: 11px; font-family: monospace; color: #334155; }
  .tag__slogan { font-size: 10px; color: #475569; border-top: 1px dashed #cbd5e1; padding-top: 4px; }
  @media print { body { margin: 8mm; } }
</style>
</head>
<body>
<div class="grid">
${cards}
</div>
</body>
</html>`;
}
