/**
 * Format rupiah sesuai DESIGN_SYSTEM §4: `Rp5.000` (pemisah ribuan titik).
 * Uang selalu INTEGER rupiah (CODING_STANDARDS §2). Nilai tidak valid TIDAK
 * diformat menjadi `Rp0` secara diam-diam; kembalikan null agar UI menampilkan
 * penanda tidak valid.
 */
export function formatRupiah(amountRp: number): string | null {
  if (!Number.isSafeInteger(amountRp)) {
    return null;
  }
  const sign = amountRp < 0 ? "-" : "";
  const digits = Math.abs(amountRp).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}Rp${grouped}`;
}

/** Perkalian integer yang menolak hasil di luar batas aman JavaScript. */
export function multiplyRp(unitPriceRp: number, quantity: number): number | null {
  if (!Number.isSafeInteger(unitPriceRp) || !Number.isSafeInteger(quantity)) {
    return null;
  }
  const result = unitPriceRp * quantity;
  return Number.isSafeInteger(result) ? result : null;
}

