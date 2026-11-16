export const CHECKOUT_HASH_VERSION = "checkout-v1" as const;

export type CheckoutPaymentMethod = "CASH" | "QRIS_MANUAL";

export type CheckoutHashItem = {
  productId: number;
  quantity: number;
  unitPriceRp: number;
  lineTotalRp: number;
};

export type CheckoutIntentV1 = {
  version: typeof CHECKOUT_HASH_VERSION;
  cashierId: number;
  shiftId: number;
  items: CheckoutHashItem[];
  totalRp: number;
  paymentMethod: CheckoutPaymentMethod;
};

function assertPositiveInt(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} harus bilangan bulat positif.`);
  }
  return value;
}

function assertNonNegativeInt(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} harus bilangan bulat non-negatif.`);
  }
  return value;
}

/**
 * Menghasilkan JSON kanonis UTF-8 untuk niat checkout versi `checkout-v1`
 * (API_CONTRACT.md §2A). Urutan kunci objek deterministik, item disortir
 * menaik berdasarkan `productId`, tanpa whitespace tak bermakna dan tanpa
 * floating point.
 */
export function canonicalCheckoutPayload(intent: CheckoutIntentV1): string {
  if (intent.version !== CHECKOUT_HASH_VERSION) {
    throw new Error(`Versi niat checkout tidak didukung: ${String(intent.version)}.`);
  }
  const cashierId = assertPositiveInt(intent.cashierId, "cashierId");
  const shiftId = assertPositiveInt(intent.shiftId, "shiftId");
  if (intent.paymentMethod !== "CASH" && intent.paymentMethod !== "QRIS_MANUAL") {
    throw new Error(`paymentMethod tidak valid: ${String(intent.paymentMethod)}.`);
  }
  if (!Array.isArray(intent.items) || intent.items.length === 0) {
    throw new Error("items wajib berisi minimal satu item.");
  }

  const seenProducts = new Set<number>();
  const normalizedItems = intent.items.map((item) => {
    const productId = assertPositiveInt(item.productId, "items.productId");
    if (seenProducts.has(productId)) {
      throw new Error(`productId ganda di dalam niat checkout: ${productId}.`);
    }
    seenProducts.add(productId);
    const quantity = assertPositiveInt(item.quantity, "items.quantity");
    const unitPriceRp = assertNonNegativeInt(item.unitPriceRp, "items.unitPriceRp");
    const lineTotalRp = assertNonNegativeInt(item.lineTotalRp, "items.lineTotalRp");
    const expectedLineTotal = quantity * unitPriceRp;
    if (!Number.isSafeInteger(expectedLineTotal) || expectedLineTotal !== lineTotalRp) {
      throw new Error(`lineTotalRp tidak konsisten untuk productId ${productId}.`);
    }
    return {
      productId,
      quantity,
      unitPriceRp,
      lineTotalRp,
    };
  });

  normalizedItems.sort((a, b) => a.productId - b.productId);

  let expectedTotal = 0;
  for (const item of normalizedItems) {
    expectedTotal += item.lineTotalRp;
    if (!Number.isSafeInteger(expectedTotal)) {
      throw new Error("totalRp melebihi batas integer aman.");
    }
  }
  const totalRp = assertNonNegativeInt(intent.totalRp, "totalRp");
  if (totalRp !== expectedTotal) {
    throw new Error("totalRp tidak sama dengan jumlah lineTotalRp.");
  }

  const canonicalObject: CheckoutIntentV1 = {
    version: CHECKOUT_HASH_VERSION,
    cashierId,
    shiftId,
    items: normalizedItems,
    totalRp,
    paymentMethod: intent.paymentMethod,
  };
  return JSON.stringify(canonicalObject);
}

