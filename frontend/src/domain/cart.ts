import { multiplyRp } from "./money";

/**
 * Keranjang DRAFT di sisi UI. Ini BUKAN penjualan: tidak ada sale, pembayaran,
 * atau mutasi stok yang dibuat dari sini (POS-03.07). Harga dan stok final tetap
 * divalidasi backend saat checkout (POS-03.03, POS-03.06; TASK-016 belum ada).
 */
export interface CartProduct {
  id: number;
  sku: string;
  name: string;
  priceRp: number;
  stock: number;
}

export interface CartLine {
  productId: number;
  sku: string;
  name: string;
  unitPriceRp: number;
  quantity: number;
  /** Stok dari katalog saat barang dimuat; hanya petunjuk UI, bukan sumber kebenaran. */
  stockHint: number;
}

export type AddResult =
  | { ok: true; lines: CartLine[] }
  | { ok: false; reason: "INSUFFICIENT_STOCK" | "INVALID_QUANTITY"; lines: CartLine[] };

export function addProduct(lines: CartLine[], product: CartProduct, quantity = 1): AddResult {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    return { ok: false, reason: "INVALID_QUANTITY", lines };
  }
  const existing = lines.find((line) => line.productId === product.id);
  const nextQuantity = (existing?.quantity ?? 0) + quantity;
  if (nextQuantity > product.stock) {
    return { ok: false, reason: "INSUFFICIENT_STOCK", lines };
  }
  if (existing) {
    return {
      ok: true,
      lines: lines.map((line) =>
        line.productId === product.id ? { ...line, quantity: nextQuantity, stockHint: product.stock } : line,
      ),
    };
  }
  return {
    ok: true,
    lines: [
      ...lines,
      {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        unitPriceRp: product.priceRp,
        quantity,
        stockHint: product.stock,
      },
    ],
  };
}

export function setQuantity(lines: CartLine[], productId: number, quantity: number): AddResult {
  const line = lines.find((item) => item.productId === productId);
  if (!line || !Number.isSafeInteger(quantity) || quantity <= 0) {
    return { ok: false, reason: "INVALID_QUANTITY", lines };
  }
  if (quantity > line.stockHint) {
    return { ok: false, reason: "INSUFFICIENT_STOCK", lines };
  }
  return {
    ok: true,
    lines: lines.map((item) => (item.productId === productId ? { ...item, quantity } : item)),
  };
}

export function removeLine(lines: CartLine[], productId: number): CartLine[] {
  return lines.filter((line) => line.productId !== productId);
}

export function lineTotalRp(line: CartLine): number | null {
  return multiplyRp(line.unitPriceRp, line.quantity);
}

/** Total draft; null jika ada baris yang tidak bisa dihitung dengan aman. */
export function cartTotalRp(lines: CartLine[]): number | null {
  let total = 0;
  for (const line of lines) {
    const subtotal = lineTotalRp(line);
    if (subtotal === null) {
      return null;
    }
    total += subtotal;
    if (!Number.isSafeInteger(total)) {
      return null;
    }
  }
  return total;
}

export function cartItemCount(lines: CartLine[]): number {
  return lines.reduce((count, line) => count + line.quantity, 0);
}

