import type { CartLine } from "./cart";
import { cartTotalRp, lineTotalRp } from "./cart";
import { formatRupiah } from "./money";

export type PromoKind = "NONE" | "BUY_2_GET_1" | "TEBUS_MURAH";

const POINTS_STORAGE_KEY = "pos_customer_points_v1";

/** Aturan sederhana: 1 point per Rp10.000 belanja (dibulatkan ke bawah). */
export function calculateEarnedPoints(totalRp: number): number {
  if (!Number.isSafeInteger(totalRp) || totalRp <= 0) {
    return 0;
  }
  return Math.floor(totalRp / 10000);
}

export function loadCustomerPointsMap(storage: Pick<Storage, "getItem"> = window.localStorage): Record<string, number> {
  try {
    const raw = storage.getItem(POINTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function getCustomerPoints(
  customerCode: string,
  storage: Pick<Storage, "getItem"> = window.localStorage,
): number {
  const normalized = customerCode.trim().toUpperCase();
  if (!normalized) return 0;
  return loadCustomerPointsMap(storage)[normalized] ?? 0;
}

export function recordCustomerPoints(
  customerCode: string,
  totalRp: number,
  storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage,
): { customerCode: string; earned: number; totalPoints: number } {
  const normalized = customerCode.trim().toUpperCase() || "UMUM";
  const earned = calculateEarnedPoints(totalRp);
  const current = loadCustomerPointsMap(storage);
  const nextTotal = (current[normalized] ?? 0) + earned;
  current[normalized] = nextTotal;
  try {
    storage.setItem(POINTS_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Abaikan kegagalan storage pada lingkungan terbatas.
  }
  return { customerCode: normalized, earned, totalPoints: nextTotal };
}

/**
 * Mesin promo sederhana (Ide 3):
 * - BUY_2_GET_1: setiap kelipatan 3 unit pada satu baris mendapat 1 unit gratis.
 * - TEBUS_MURAH: belanja >= Rp50.000 mendapat potongan tebus murah Rp2.000.
 */
export function calculatePromoDiscountRp(lines: CartLine[], promoKind: PromoKind): number {
  if (promoKind === "NONE") return 0;
  if (promoKind === "BUY_2_GET_1") {
    let discount = 0;
    for (const line of lines) {
      const freeUnits = Math.floor(line.quantity / 3);
      if (freeUnits > 0) {
        discount += freeUnits * line.unitPriceRp;
      }
    }
    return discount;
  }
  const subtotal = cartTotalRp(lines) ?? 0;
  return subtotal >= 50000 ? 2000 : 0;
}

export interface CustomerDisplayState {
  items: { name: string; quantity: number; lineTotalRp: number }[];
  totalRp: number;
  changeRp: number | null;
  promoLabel: string | null;
}

export function buildCustomerDisplayState(
  lines: CartLine[],
  promoKind: PromoKind,
  changeRp: number | null = null,
): CustomerDisplayState {
  const rawTotal = cartTotalRp(lines) ?? 0;
  const promoDiscount = calculatePromoDiscountRp(lines, promoKind);
  const totalRp = Math.max(0, rawTotal - promoDiscount);
  const promoLabel =
    promoKind === "BUY_2_GET_1"
      ? "Promo Beli 2 Gratis 1"
      : promoKind === "TEBUS_MURAH"
        ? "Promo Tebus Murah (>= Rp50.000)"
        : null;
  return {
    items: lines.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      lineTotalRp: lineTotalRp(line) ?? 0,
    })),
    totalRp,
    changeRp,
    promoLabel,
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderCustomerDisplayHtml(state: CustomerDisplayState): string {
  const rows = state.items.length
    ? state.items
        .map(
          (item) =>
            `<tr><td>${escapeHtml(item.name)}</td><td class="num">${item.quantity}</td><td class="num">${escapeHtml(formatRupiah(item.lineTotalRp) ?? "Rp0")}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="3">Selamat datang di Minimarket Kampus</td></tr>`;
  return `<!doctype html>
<html lang="id">
<head><meta charset="utf-8" /><title>Customer Display — Minimarket Kampus</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 20px; background: #0f172a; color: #f8fafc; }
  h1 { margin: 0 0 12px; font-size: 20px; color: #86efac; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { padding: 8px; border-bottom: 1px solid #334155; text-align: left; }
  .num { text-align: right; }
  .total { font-size: 36px; font-weight: 800; color: #4ade80; }
  .sub { font-size: 16px; color: #cbd5e1; margin-top: 6px; }
</style>
</head>
<body>
  <h1>MINIMARKET KAMPUS — CUSTOMER DISPLAY</h1>
  <table><thead><tr><th>Barang</th><th class="num">Qty</th><th class="num">Subtotal</th></tr></thead><tbody>${rows}</tbody></table>
  ${state.promoLabel ? `<p class="sub">${escapeHtml(state.promoLabel)}</p>` : ""}
  <div class="total">TOTAL: ${escapeHtml(formatRupiah(state.totalRp) ?? "Rp0")}</div>
  ${state.changeRp !== null ? `<div class="sub">Kembalian: ${escapeHtml(formatRupiah(state.changeRp) ?? "Rp0")}</div>` : ""}
</body>
</html>`;
}

function escapeCsvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const text =
    typeof value === "string" && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function buildCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function buildExcelHtml(
  title: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const th = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const trs = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(cell === null || cell === undefined ? "" : String(cell))}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="id">
<head><meta charset="utf-8" /><title>${escapeHtml(title)}</title></head>
<body>
  <table border="1">
    <caption>${escapeHtml(title)}</caption>
    <thead><tr>${th}</tr></thead>
    <tbody>${trs}</tbody>
  </table>
</body>
</html>`;
}

export function triggerFileDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Faktur pajak SIMULASI DEMO (keputusan David 2026-11-22: BUKAN dokumen resmi).
 */
export function buildDemoTaxInvoiceText(input: {
  saleNo: string;
  committedAtMs: number;
  totalRp: number;
  buyerName?: string;
}): string {
  const dppRp = Math.round((input.totalRp * 100) / 111);
  const ppnRp = input.totalRp - dppRp;
  const dateStr = Number.isNaN(new Date(input.committedAtMs).getTime())
    ? "waktu tidak diketahui"
    : new Date(input.committedAtMs).toLocaleString("id-ID");
  return [
    "=== FAKTUR PAJAK SIMULASI DEMO ===",
    "PERINGATAN: SIMULASI DEMO — BUKAN DOKUMEN PAJAK RESMI / BUKAN e-FAKTUR DJP",
    `No. Referensi : FP-DEMO-${input.saleNo}`,
    `No. Penjualan : ${input.saleNo}`,
    `Tanggal       : ${dateStr}`,
    `Pembeli       : ${input.buyerName?.trim() || "Pelanggan Umum (DEMO)"}`,
    "----------------------------------------",
    `Dasar Pengenaan Pajak (DPP) : ${formatRupiah(dppRp) ?? `Rp${dppRp}`}`,
    `PPN 11% (inklusif)          : ${formatRupiah(ppnRp) ?? `Rp${ppnRp}`}`,
    `Total Pembayaran            : ${formatRupiah(input.totalRp) ?? `Rp${input.totalRp}`}`,
    "========================================",
  ].join("\n");
}
