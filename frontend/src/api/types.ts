/**
 * Tipe sisi UI yang meniru bentuk respons baseline di
 * docs/architecture/API_CONTRACT.md v0.1.1 §3 (GET /auth/me, GET /products)
 * dan DTO nyata TASK-009 (`backend/src/auth/service.ts`).
 * File ini TIDAK mengubah kontrak backend. Bila kontrak berubah lewat review,
 * sesuaikan di sini dan pindahkan DTO ke `shared/` (CODING_STANDARDS §2).
 */
export type Role = "ADMIN" | "CASHIER";

/** `DEMO` = mock di memori; `LOCAL_API` = backend loopback nyata. */
export type AuthMode = "DEMO" | "LOCAL_API";

/** `DEMO` = katalog sintetis di memori; `LOCAL_API` = master katalog backend. */
export type CatalogMode = "DEMO" | "LOCAL_API";

export interface SessionUser {
  userId: number;
  username: string;
  displayName: string;
  role: Role;
}

/** API_CONTRACT §3: `GET /products` → id, sku, name, price, stock, active. */
export interface ProductSummary {
  id: number;
  sku: string;
  name: string;
  priceRp: number;
  stock: number;
  active: boolean;
}

/** DTO produk master TASK-010 (`GET /products`). Barcode selalu string. */
export interface CatalogProduct {
  id: number;
  categoryId: number;
  categoryName: string;
  sku: string;
  name: string;
  priceRp: number;
  active: boolean;
  barcodes: string[];
  supplierIds: number[];
  stockOnHand: number;
}

export interface CategorySummary {
  id: number;
  name: string;
}

export interface SupplierSummary {
  id: number;
  name: string;
}

export interface CreateProductInput {
  categoryId: number;
  sku: string;
  name: string;
  priceRp: number;
  /** Dikirim sebagai teks; nol awal tidak boleh diubah menjadi number. */
  barcodes: string[];
  supplierIds: number[];
}

export interface UpdateProductInput {
  name?: string;
  categoryId?: number;
  priceRp?: number;
  active?: boolean;
}

export interface CatalogQuery {
  query?: string;
  barcode?: string;
  includeInactive?: boolean;
  limit?: number;
  offset?: number;
}

/** `GET /shifts/current` / `POST /shifts/open` TASK-014. ID dipertahankan setelah restart. */
export interface ShiftSummary {
  id: number;
  cashierId: number;
  openedAtMs: number;
  openingCashRp: number | null;
}

export interface ShiftClosePreview {
  shiftId: number; openingCashRp: number | null; cashTotalRp: number;
  qrisTotalRp: number; expectedCashRp: number; saleCount: number;
}
export interface ShiftClosing {
  shiftId: number; closeKey: string; requestHash: string; closedAtMs: number;
  closedBy: number; openingCashRp: number | null; expectedCashRp: number;
  declaredCashRp: number | null; varianceRp: number | null;
  varianceNote?: string | null;
  totals: { cashRp: number; qrisManualRp: number; totalSalesRp: number; saleCount: number };
}
/** Metode bayar yang didukung: tunai dan QRIS manual (DEC-016 masih PENDING untuk SOP). */
export type CheckoutPaymentMethod = "CASH" | "QRIS_MANUAL";

export interface CheckoutQuoteItem {
  productId: number;
  sku: string;
  name: string;
  quantity: number;
  unitPriceRp: number;
  lineTotalRp: number;
}

/** Snapshot harga dari backend; UI tidak boleh mengirim harga sendiri (API_CONTRACT §2A). */
export interface CheckoutQuote {
  shiftId: number;
  cashierId: number;
  items: CheckoutQuoteItem[];
  totalRp: number;
  payment: { method: CheckoutPaymentMethod };
}

export interface PrepareCheckoutInput {
  attemptKey: string;
  shiftId: number;
  items: Array<{ productId: number; quantity: number }>;
  paymentMethod: CheckoutPaymentMethod;
}

/** `requestHash` berasal dari backend dan dikirim balik apa adanya saat commit. */
export interface PrepareCheckoutResult {
  attemptKey: string;
  requestHash: string;
  status: "PREPARED";
  quote: CheckoutQuote;
}

export type PaymentConfirmation =
  | { method: "CASH"; cashReceivedRp: number }
  | {
      method: "QRIS_MANUAL";
      /** Kasir sudah memeriksa transaksi di aplikasi merchant di luar POS. */
      merchantConfirmed: true;
      /** Nominal yang terlihat di merchant; backend menyamakan dengan quote total. */
      confirmedAmountRp: number;
      /** Referensi opsional, bukan kredensial/data rekening. */
      evidenceRef: string | null;
    };

export type PendingQrisVerification = { status: "pending" };
export type VerifiedQrisVerification = {
  status: "verified";
  verifiedBy: number;
  verifiedAtMs: number;
};
export type QrisVerification = PendingQrisVerification | VerifiedQrisVerification;

export interface CommitCheckoutInput {
  attemptKey: string;
  requestHash: string;
  paymentConfirmation: PaymentConfirmation;
}

export interface CommitCheckoutResult {
  saleId: number;
  saleNo: string;
  attemptKey: string;
  requestHash: string;
  status: "COMMITTED";
  totalRp: number;
  committedAtMs: number;
  payment: {
    method: CheckoutPaymentMethod;
    amountRp: number;
    cashReceivedRp: number | null;
    changeRp: number | null;
    verifiedBy: number | null;
    verifiedAtMs: number | null;
    evidenceRef: string | null;
  };
  /** Hanya tersedia untuk QRIS_MANUAL yang COMMITTED. */
  qrisVerification?: VerifiedQrisVerification;
}

export type CheckoutStatusResult =
  | {
      attemptKey: string;
      requestHash: string;
      status: "PREPARED";
      quote: CheckoutQuote | null;
      /** Lookup PREPARED hanya boleh membawa status pending. */
      qrisVerification?: PendingQrisVerification;
    }
  | { attemptKey: string; requestHash: string; status: "ABANDONED"; abandonedAtMs: number }
  | CommitCheckoutResult;

/**
 * Struk TASK-021: dibangun backend dari sale/items/payments yang COMMITTED.
 * Harga pada item adalah harga historis (snapshot), bukan harga katalog kini.
 */
export interface ReceiptItem {
  sku: string;
  name: string;
  quantity: number;
  unitPriceRp: number;
  lineTotalRp: number;
}

export interface ReceiptPayment {
  method: CheckoutPaymentMethod;
  amountRp: number;
  cashReceivedRp: number | null;
  changeRp: number | null;
  evidenceRef: string | null;
  verifiedAtMs: number | null;
}

export interface Receipt {
  saleId: number;
  saleNo: string;
  committedAtMs: number;
  totalRp: number;
  items: ReceiptItem[];
  payment: ReceiptPayment;
}

/** Pratinjau struk virtual DEMO; `demo` selalu true sampai printer fisik diuji. */
export interface ReceiptView {
  receipt: Receipt;
  text: string;
  demo: true;
}

export interface PrintResult {
  saleId: number;
  saleNo: string;
  status: "PRINTED";
  channel: string;
  printedAtMs: number;
  text: string;
  demo: true;
}

/** Laporan pembayaran TASK-037: QRIS tidak dicampur ke kas fisik. */
export interface PaymentReport {
  cash: { totalRp: number; count: number };
  qrisManual: { totalRp: number; count: number; verifiedCount: number };
  totalRp: number;
  qrisSales: Array<{
    saleId: number;
    saleNo: string;
    committedAtMs: number;
    totalRp: number;
    cashierUsername: string | null;
    verifiedBy: number;
    verifiedAtMs: number;
    evidenceRef: string | null;
    status: "verified";
  }>;
}

/**
 * Penerimaan barang TASK-025/027: draft hanya ada di klien dan dibatalkan
 * tanpa API. `receiptKey` adalah identitas upaya idempoten yang dihitung
 * ulang oleh backend dari isi (bukan dipercaya dari klien).
 */
export interface ReceiveGoodsInput {
  receiptKey: string;
  supplierId: number;
  items: Array<{ productId: number; quantity: number }>;
  supplierRef?: string | null;
}

export interface ReceiptResultItem {
  receiptItemId: number;
  productId: number;
  sku: string;
  name: string;
  quantity: number;
  movementId: number;
}

export interface ReceiptResult {
  receiptId: number;
  receiptKey: string;
  requestHash: string;
  supplierId: number;
  supplierRef: string | null;
  committedAtMs: number;
  totalQuantity: number;
  items: ReceiptResultItem[];
  /** true bila respons berasal dari penerimaan yang sudah tersimpan (retry identik). */
  duplicate: boolean;
}

/** Laporan harian TASK-026: filter `[startMs,endMs)` epoch ms, shift opsional. */
export interface DailyReportFilter {
  startMs: number;
  endMs: number;
  shiftId?: number | null;
}

export interface DailySaleRow {
  items?: ReceiptItem[];
  saleId: number;
  saleNo: string;
  committedAtMs: number;
  shiftId: number;
  cashierUsername: string | null;
  method: CheckoutPaymentMethod;
  amountRp: number;
}

export interface DailyReport {
  startMs: number;
  endMs: number;
  shiftId: number | null;
  cash: { totalRp: number; count: number };
  qrisManual: { totalRp: number; count: number; verifiedCount: number };
  totalRp: number;
  saleCount: number;
  sales: DailySaleRow[];
  salesTruncated: boolean;
  generatedAtMs: number;
}

/** Laporan stok TASK-026: saldo dan mutasi dari ledger, bukan saldo cache. */
export interface StockMovementEntry {
  id: number;
  kind: "OPENING" | "SALE" | "RECEIPT" | "ADJUSTMENT";
  delta: number;
  createdAtMs: number;
  actorId: number;
  sourceType: string | null;
  sourceId: number | null;
  sourceRef: string | null;
  sourceQuantity: number | null;
  adjustmentReason: string | null;
}

export interface ProductStockReport {
  productId: number;
  sku: string;
  name: string;
  onHand: number;
  opening: number;
  receipt: number;
  sale: number;
  adjustment: number;
  matched: boolean;
  low: boolean;
  zero: boolean;
  movements: StockMovementEntry[];
  movementsTruncated: boolean;
}

export interface StockReport {
  generatedAtMs: number;
  lowStockThreshold: number;
  products: ProductStockReport[];
}

/** `GET /users` TASK-009. Tidak pernah memuat hash/kata sandi. */
export interface AccountSummary {
  id: number;
  username: string;
  role: Role;
  active: boolean;
}

/** `POST /users` TASK-009; kata sandi hanya dikirim ke backend, tidak disimpan UI. */
export interface CreateAccountInput {
  username: string;
  password: string;
  role: Role;
}

export type LoginResult =
  | { ok: true; user: SessionUser }
  /** Pesan generik: tidak membocorkan apakah akun ada atau nonaktif (AC-01.02). */
  | { ok: false; code: "INVALID_CREDENTIALS" };

/**
 * Antarmuka data yang dipakai layar.
 * `authMode`/`catalogMode` dipakai UI untuk memberi label DEMO yang jujur:
 * autentikasi lokal nyata tetap bukan izin transaksi uang sungguhan.
 */
export interface AdjustmentInput { adjustmentKey: string; productId: number; expectedOnHand: number; targetOnHand: number; reason: string }
export interface BootstrapStatus {
  needsSetup: boolean;
}
export interface BootstrapAdminInput {
  username: string;
  password: string;
}
export interface AdjustmentResult { productId: number; previousOnHand: number; onHand: number; delta: number; duplicate: boolean }
export interface BackupEntry { name: string; valid: boolean; createdAtMs: number | null }
export interface SheetsSyncStatus { enabled: boolean; pendingCount: number }
export interface SheetsSyncResult { enabled: boolean; sentCount: number; pendingCount: number }
export interface PosDataSource {
  getBootstrapStatus?: () => Promise<BootstrapStatus>;
  bootstrapAdmin?: (input: BootstrapAdminInput) => Promise<AccountSummary>;
  getSheetsSyncStatus?: () => Promise<SheetsSyncStatus>;
  getSheetsConfig?: () => Promise<{ configured: boolean; restartRequired: boolean; legacy?: boolean }>;
  saveSheetsConfig?: (input: { webhookUrl: string; secret: string; futureSalesOnly: boolean }) => Promise<{ saved: boolean; restartRequired: boolean }>;
  pingSheetsConfig?: (input: { webhookUrl: string; secret: string }) => Promise<{ connected: boolean }>;
  syncSheetsNow?: () => Promise<SheetsSyncResult>;
  adjustStock(input: AdjustmentInput): Promise<AdjustmentResult>;
  listBackups(): Promise<BackupEntry[]>;
  createBackup(): Promise<BackupEntry>;
  restoreBackupTest(name: string): Promise<{ destinationPath: string }>;
  readonly authMode: AuthMode;
  readonly catalogMode: CatalogMode;
  login(username: string, password: string): Promise<LoginResult>;
  logout(): Promise<void>;
  changePassword(input: { oldPassword: string; newPassword: string }): Promise<void>;
  resetAccountPassword(userId: number, input: { newPassword: string }): Promise<void>;
  /** `GET /auth/me`; profil/role diambil ulang dari backend, bukan dari UI. */
  getProfile(): Promise<SessionUser>;
  listAccounts(): Promise<AccountSummary[]>;
  createAccount(input: CreateAccountInput): Promise<AccountSummary>;
  setAccountActive(userId: number, active: boolean): Promise<AccountSummary>;
  /** Katalog master TASK-010/TASK-012. */
  listCategories(): Promise<CategorySummary[]>;
  createCategory(name: string): Promise<CategorySummary>;
  listSuppliers(): Promise<SupplierSummary[]>;
  createSupplier(name: string): Promise<SupplierSummary>;
  listCatalogProducts(options?: CatalogQuery): Promise<CatalogProduct[]>;
  createProduct(input: CreateProductInput): Promise<CatalogProduct>;
  updateProduct(productId: number, input: UpdateProductInput): Promise<CatalogProduct>;
  addBarcode(productId: number, barcode: string): Promise<CatalogProduct>;
  removeBarcode(productId: number, barcode: string): Promise<CatalogProduct>;
  /** Lookup kasir: hanya produk aktif. */
  findActiveProductByBarcode(barcode: string): Promise<ProductSummary | null>;
  searchActiveProducts(query: string): Promise<ProductSummary[]>;
  listProducts(): Promise<ProductSummary[]>;
  /** Shift milik kasir dari sesi backend (TASK-014). */
  getCurrentShift(): Promise<ShiftSummary | null>;
  openShift(input?: { openingCashRp?: number }): Promise<ShiftSummary>;
  getShiftClosePreview(shiftId: number): Promise<ShiftClosePreview>;
  getShiftClosing(shiftId: number): Promise<ShiftClosing>;
  closeShift(shiftId: number, input: { closeKey: string; declaredCashRp: number; varianceNote?: string | null }): Promise<ShiftClosing>;
  /** Checkout dua fase TASK-016, dengan CASH dan QRIS_MANUAL (TASK-037). */
  prepareCheckout(input: PrepareCheckoutInput): Promise<PrepareCheckoutResult>;
  commitCheckout(input: CommitCheckoutInput): Promise<CommitCheckoutResult>;
  getCheckoutStatus(attemptKey: string): Promise<CheckoutStatusResult>;
  /** TASK-021: baca struk dari sale tersimpan (reprint tidak membuat sale baru). */
  getRecentSales(options?: { startMs?: number; endMs?: number; limit?: number; offset?: number }): Promise<Array<{ saleId: number; saleNo: string; committedAtMs: number; totalRp: number; method: "CASH" | "QRIS_MANUAL" }>>;
  getSaleReceipt(saleId: number): Promise<ReceiptView>;
  printSaleReceipt(saleId: number): Promise<PrintResult>;
  /** Laporan ADMIN: omzet CASH dan QRIS dipisah (TASK-037). */
  getPaymentReport(): Promise<PaymentReport>;
  /** Penerimaan ADMIN (TASK-025). Draft dibatalkan di UI tanpa memanggil ini. */
  receiveGoods(input: ReceiveGoodsInput): Promise<ReceiptResult>;
  /** Laporan harian per tanggal/shift dan stok dari ledger (TASK-026). */
  getDailyReport(filter: DailyReportFilter): Promise<DailyReport>;
  getStockReport(filter?: { lowStockThreshold?: number }): Promise<StockReport>;
}
