export type MovementKind = "OPENING" | "SALE" | "RECEIPT" | "ADJUSTMENT";

export type StockBalance = {
  productId: number;
  sku: string;
  name: string;
  onHand: number;
  /** false = produk belum pernah punya mutasi; saldo tetap 0. */
  hasMovements: boolean;
};

export type StockMovementHistoryEntry = {
  id: number;
  kind: MovementKind;
  delta: number;
  createdAtMs: number;
  actorId: number;
  /** Jenis sumber ledger; OPENING memakai batch, ADJUSTMENT memakai reason. */
  sourceType: "OPENING" | "SALE_ITEM" | "RECEIPT_ITEM" | "ADJUSTMENT" | null;
  sourceId: number | null;
  /** sale_no / receipt_key / opening_batch_ref, tergantung kind. */
  sourceRef: string | null;
  /** Kuantitas sumber positif (sale_items/receipt_items). */
  sourceQuantity: number | null;
  adjustmentReason: string | null;
};

export type ReconciliationReport = {
  productId: number;
  sku: string;
  opening: number;
  receipt: number;
  sale: number;
  adjustment: number;
  computedOnHand: number;
  ledgerOnHand: number;
  matched: boolean;
  issues: string[];
};

export type OpeningFixtureEntry = {
  productId: number;
  quantity: number;
};

export type OpeningFixtureResult = {
  batchRef: string;
  applied: Array<{ productId: number; sku: string; quantity: number }>;
  skipped: Array<{ productId: number; sku: string; batchRef: string }>;
};
