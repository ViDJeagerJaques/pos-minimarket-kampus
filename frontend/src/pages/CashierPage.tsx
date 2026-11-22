import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import { ApiError } from "../api/errors";
import type {
  CheckoutPaymentMethod,
  CheckoutStatusResult,
  CommitCheckoutResult,
  PaymentConfirmation,
  PosDataSource,
  PrepareCheckoutResult,
  ProductSummary,
  ShiftSummary,
} from "../api/types";
import { BarcodeInput } from "../components/BarcodeInput";
import { Button } from "../components/Button";
import { CartList } from "../components/CartList";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MoneyText } from "../components/MoneyText";
import { ProductSearch } from "../components/ProductSearch";
import { ReceiptPanel } from "../components/ReceiptPanel";
import { StatusMessage, type StatusTone } from "../components/StatusMessage";
import {
  addProduct,
  cartItemCount,
  cartTotalRp,
  removeLine,
  setQuantity,
  type AddResult,
  type CartLine,
} from "../domain/cart";
import {
  buildCustomerDisplayState,
  calculatePromoDiscountRp,
  getCustomerPoints,
  recordCustomerPoints,
  renderCustomerDisplayHtml,
  type PromoKind,
} from "../domain/iposFeatures";

interface CashierPageProps {
  dataSource: PosDataSource;
  lines: CartLine[];
  draftId: string;
  onDraftConsumed: (draftId: string, soldProductIds: number[] | null) => void;
  onDraftRestore: (draftId: string, lines: CartLine[]) => void;
  onLinesChange: Dispatch<SetStateAction<CartLine[]>>;
  sessionEpoch: number;
  cashierId: number;
  /** 401 dari shift/checkout: App wajib membersihkan sesi dan kembali ke login. */
  onSessionExpired: () => void;
}

interface Status {
  tone: StatusTone;
  text: string;
}

/**
 * Fase checkout. `attemptKey` dan `requestHash` disimpan di fase selama retry;
 * tidak pernah dibuat upaya baru otomatis, terutama saat respons commit lambat.
 */
type CheckoutPhase =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "recoveryError" }
  | { kind: "payment"; attempt: PrepareCheckoutResult }
  | { kind: "committing"; attempt: PrepareCheckoutResult }
  | {
      kind: "timeout";
      attempt: PrepareCheckoutResult;
      cashReceivedRp: number;
      /** Konfirmasi asli yang dipakai saat commit; dipakai ulang saat retry. */
      paymentConfirmation?: PaymentConfirmation;
      known?: Extract<CheckoutStatusResult, { status: "PREPARED" | "ABANDONED" }>["status"];
      /** Upaya yang sudah ditolak tidak boleh di-replay lewat status lookup. */
      noReplay?: boolean;
      /** Alasan VALIDATION_ERROR yang masih bisa dicoba dengan attempt pengganti. */
      replacementReason?: string;
    }
  | { kind: "priceChanged"; attempt: PrepareCheckoutResult; previousTotalRp: number }
  | { kind: "success"; result: CommitCheckoutResult };

const MSG_NOT_FOUND = "Barang tidak ditemukan. Periksa barcode atau cari nama barang.";
const MSG_NO_STOCK = "Stok tidak cukup untuk jumlah ini.";
const MSG_TIMEOUT =
  "Status pembayaran belum diketahui. Jangan bayar ulang atau scan ulang barang — cek status upaya dan bukti pembayaran fisik terlebih dahulu.";
const MSG_DEMO =
  "Mode DEMO: shift dan checkout memerlukan backend lokal. Tombol bayar sengaja dinonaktifkan.";

function createAttemptKey(): string {
  const random =
    typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `co_${random}`;
}

function parseRupiahInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function confirmationAmount(confirmation: PaymentConfirmation): number {
  return confirmation.method === "CASH" ? confirmation.cashReceivedRp : confirmation.confirmedAmountRp;
}

function formatShiftTime(openedAtMs: number): string {
  const date = new Date(openedAtMs);
  return Number.isNaN(date.getTime()) ? "waktu tidak diketahui" : date.toLocaleString("id-ID");
}

/**
 * Layar kasir (DESIGN_SYSTEM §5.2): scan/cari di kiri, ringkasan dan aksi di kanan.
 * Checkout memakai kontrak prepare/commit TASK-016. Hanya status `COMMITTED`
 * dari backend yang boleh ditampilkan sebagai sukses; `PREPARED` bukan penjualan.
 */
export function CashierPage({
  dataSource,
  lines,
  draftId,
  onDraftConsumed,
  onDraftRestore,
  onLinesChange,
  sessionEpoch,
  cashierId,
  onSessionExpired,
}: CashierPageProps) {
  const isDemo = dataSource.authMode === "DEMO";
  const [status, setStatus] = useState<Status>({ tone: "info", text: "Siap scan barang." });
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const [shift, setShift] = useState<ShiftSummary | null | undefined>(isDemo ? null : undefined);
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [isOpeningShift, setIsOpeningShift] = useState(false);
  const storagePrefix = `pos.checkout.recovery.${cashierId}`;
  // Rekaman lama (satu key per kasir) tetap dibaca saat upgrade.
  function readRecovery(excludeKey?: string): {
    phase: CheckoutPhase; key: string | null; snapshot: CartLine[]; draftId: string | null;
    priorQrisConfirmation?: PaymentConfirmation | null; priorQrisReconciled?: boolean;
  } {
    try {
      const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
        .filter((key): key is string => key !== null && key !== excludeKey &&
          (key === storagePrefix || key.startsWith(`${storagePrefix}.`)))
        .sort();
      const records = keys.map((key) => ({ key, saved: JSON.parse(localStorage.getItem(key) ?? "null") }));
      const replacedKeys = new Set(records.map(({ saved }) => saved?.replacesAttemptKey)
        .filter((key): key is string => typeof key === "string"));
      // Pilih ujung rantai pengganti, terlepas dari urutan key localStorage.
      const key = records.find(({ saved }) => !replacedKeys.has(saved?.attempt?.attemptKey))?.key;
      if (records.length > 0 && !key) {
        return { phase: { kind: "recoveryError" }, key: null, snapshot: [], draftId: null };
      }
      if (!key) return { phase: { kind: "idle" }, key: null, snapshot: [], draftId: null };
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      if (saved?.attempt?.status === "PREPARED" && typeof saved.attempt.attemptKey === "string" &&
          typeof saved.attempt.requestHash === "string" && Number.isSafeInteger(saved.cashReceivedRp) &&
          Number.isSafeInteger(saved.attempt.quote?.totalRp) && Array.isArray(saved.attempt.quote?.items)) {
        // Rekaman lama memiliki item quote, tetapi belum memiliki snapshot draft.
        const snapshot = Array.isArray(saved.snapshot) ? saved.snapshot : saved.attempt.quote.items;
        if (!snapshot.every((line: CartLine) => Number.isSafeInteger(line.productId))) {
          return { phase: { kind: "recoveryError" }, key, snapshot: [], draftId: null };
        }
        const savedConfirmation = saved.paymentConfirmation;
        const paymentConfirmation: PaymentConfirmation | undefined =
          savedConfirmation?.method === "QRIS_MANUAL" &&
          savedConfirmation.merchantConfirmed === true &&
          Number.isSafeInteger(savedConfirmation.confirmedAmountRp) &&
          (savedConfirmation.evidenceRef === null || typeof savedConfirmation.evidenceRef === "string")
            ? {
                method: "QRIS_MANUAL",
                merchantConfirmed: true,
                confirmedAmountRp: savedConfirmation.confirmedAmountRp,
                evidenceRef: savedConfirmation.evidenceRef,
              }
            : savedConfirmation?.method === "CASH" &&
              Number.isSafeInteger(savedConfirmation.cashReceivedRp)
              ? { method: "CASH", cashReceivedRp: savedConfirmation.cashReceivedRp }
              : undefined;
        const original = saved.originalQrisConfirmation;
        const priorQrisConfirmation: PaymentConfirmation | null =
          original?.method === "QRIS_MANUAL" &&
          original.merchantConfirmed === true &&
          Number.isSafeInteger(original.confirmedAmountRp) &&
          (original.evidenceRef === null || typeof original.evidenceRef === "string")
            ? {
                method: "QRIS_MANUAL",
                merchantConfirmed: true,
                confirmedAmountRp: original.confirmedAmountRp,
                evidenceRef: original.evidenceRef,
              }
            : null;
        // Rekaman pengganti yang belum dikirim kembali ke form pembayaran,
        // bukan ke dialog "status belum diketahui".
        if (saved.paymentState === "UNSUBMITTED") {
          return {
            phase: { kind: "payment", attempt: saved.attempt },
            key, snapshot, draftId: typeof saved.draftId === "string" ? saved.draftId : null,
            priorQrisConfirmation,
            priorQrisReconciled: false,
          };
        }
        const noReplay = saved.noReplay === true;
        const replacementReason = noReplay && typeof saved.replacementReason === "string"
          ? saved.replacementReason : undefined;
        return { phase: { kind: "timeout", attempt: saved.attempt, cashReceivedRp: saved.cashReceivedRp, paymentConfirmation, noReplay, replacementReason }, key, snapshot, draftId: typeof saved.draftId === "string" ? saved.draftId : null };
      }
      return { phase: { kind: "recoveryError" }, key, snapshot: [], draftId: null };
    } catch {
      return { phase: { kind: "recoveryError" }, key: null, snapshot: [], draftId: null };
    }
  }
  const [initialRecovery] = useState(() => isDemo
    ? { phase: { kind: "idle" } as CheckoutPhase, key: null, snapshot: [] as CartLine[], draftId: null }
    : readRecovery());
  const [phase, setPhase] = useState<CheckoutPhase>(initialRecovery.phase);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const recoveryKeyRef = useRef<string | null>(initialRecovery.key);
  const [cashInput, setCashInput] = useState("");
  const [selectedMethod, setSelectedMethod] = useState<CheckoutPaymentMethod>("CASH");
  const [merchantConfirmed, setMerchantConfirmed] = useState(false);
  const [merchantAmountInput, setMerchantAmountInput] = useState("");
  const [evidenceRefInput, setEvidenceRefInput] = useState("");
  const [paymentError, setPaymentError] = useState<string | null>(null);
  /** Transfer QRIS lama yang ditolak karena harga/stok; tidak dipakai ulang untuk pembayaran baru. */
  const [priorQrisConfirmation, setPriorQrisConfirmation] = useState<PaymentConfirmation | null>(
    initialRecovery.priorQrisConfirmation ?? null,
  );
  const [priorQrisReconciled, setPriorQrisReconciled] = useState(
    initialRecovery.priorQrisReconciled ?? priorQrisConfirmation === null,
  );
  const [priorQrisAttempt, setPriorQrisAttempt] = useState<PrepareCheckoutResult | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [customerCode, setCustomerCode] = useState("");
  const [pointsNotice, setPointsNotice] = useState<string | null>(null);
  const [promoKind, setPromoKind] = useState<PromoKind>("NONE");
  const [showCustomerDisplay, setShowCustomerDisplay] = useState(false);

  const barcodeRef = useRef<HTMLInputElement>(null);
  const cashInputRef = useRef<HTMLInputElement>(null);
  const isConfirmingCancelRef = useRef(false);
  const barcodeSeqRef = useRef(0);
  const sessionEpochRef = useRef(sessionEpoch);
  const checkoutLockRef = useRef(false);
  /** Mencegah dua retry pengganti berjalan bersamaan. */
  const replacementLockRef = useRef(false);
  const [isRetryingReplacement, setIsRetryingReplacement] = useState(false);
  /** Invalidasi hasil cek status yang kembali setelah recovery berganti. */
  const recoveryEpochRef = useRef(0);
  /** Garis draft yang benar-benar dikirim pada prepare; dipakai saat membersihkan draft. */
  const snapshotLinesRef = useRef<CartLine[]>(initialRecovery.snapshot);
  const snapshotDraftIdRef = useRef<string | null>(initialRecovery.draftId);
  const cashInputId = useId();
  const openingCashId = useId();
  const customerCodeId = useId();
  const promoSelectId = useId();
  sessionEpochRef.current = sessionEpoch;
  /** Draft dikunci sejak prepare sampai checkout selesai atau dibatalkan. */
  const isCheckoutActive = phase.kind !== "idle";

  const handleActionError = useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof ApiError && error.isSessionExpired) {
        onSessionExpired();
        return;
      }
      setStatus({ tone: "danger", text: error instanceof ApiError ? error.message : fallback });
    },
    [onSessionExpired],
  );

  function removeRecovery(): string | null {
    const key = recoveryKeyRef.current;
    if (!key) return null;
    try {
      localStorage.removeItem(key);
      recoveryKeyRef.current = null;
      return null;
    } catch {
      setStorageWarning("Rekaman pemulihan tidak dapat dihapus. Catatan tetap tersimpan dan dapat muncul kembali setelah halaman dibuka ulang.");
      return key;
    }
  }

  function openNextRecovery(excludeKey?: string): void {
    recoveryEpochRef.current += 1;
    const next = readRecovery(excludeKey);
    recoveryKeyRef.current = next.key;
    snapshotLinesRef.current = next.snapshot;
    snapshotDraftIdRef.current = next.draftId;
    setPriorQrisConfirmation(next.priorQrisConfirmation ?? null);
    setPriorQrisReconciled(next.priorQrisReconciled ?? true);
    setPhase(next.phase);
  }

  /** Simpan keputusan noReplay pada rekaman attempt agar tetap berlaku setelah reload. */
  function persistNoReplay(attemptKey: string, replacementReason?: string): void {
    try {
      const attemptKeyStorage = `${storagePrefix}.${encodeURIComponent(attemptKey)}`;
      const activeKey = recoveryKeyRef.current;
      const active = activeKey === null ? null : JSON.parse(localStorage.getItem(activeKey) ?? "null");
      const key = active?.attempt?.attemptKey === attemptKey ? activeKey! : attemptKeyStorage;
      const raw = localStorage.getItem(key);
      if (raw === null) return;
      const saved = JSON.parse(raw) as Record<string, unknown>;
      saved.noReplay = true;
      saved.replacementReason = replacementReason;
      localStorage.setItem(key, JSON.stringify(saved));
    } catch {
      setStorageWarning("Keputusan blokir replay tidak tersimpan; periksa status upaya secara manual.");
    }
  }

  /** Pensiunkan pendahulu yang sudah selesai digantikan oleh commit baru. */
  function retireReplacedRecords(successAttemptKey: string): void {
    try {
      const currentKey = `${storagePrefix}.${encodeURIComponent(successAttemptKey)}`;
      const raw = localStorage.getItem(currentKey);
      if (raw === null) return;
      const saved = JSON.parse(raw) as { replacesAttemptKey?: unknown };
      const predecessor =
        typeof saved.replacesAttemptKey === "string" ? saved.replacesAttemptKey : null;
      if (predecessor !== null) {
        localStorage.removeItem(`${storagePrefix}.${encodeURIComponent(predecessor)}`);
      }
    } catch {
      // Rekaman usang dapat muncul lagi setelah reload; commit tetap sah.
    }
  }

  function focusBarcode() {
    // Jangan mencuri fokus selama dialog konfirmasi terbuka.
    if (!isConfirmingCancelRef.current && phase.kind === "idle") {
      barcodeRef.current?.focus();
    }
  }

  useEffect(() => {
    focusBarcode();
    return () => {
      // Batalkan lookup barcode tertunda saat keluar halaman atau logout.
      barcodeSeqRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionEpoch]);

  useEffect(() => {
    if (isDemo) {
      return;
    }
    let isActive = true;
    const epoch = sessionEpochRef.current;
    dataSource
      .getCurrentShift()
      .then((current) => {
        if (!isActive || epoch !== sessionEpochRef.current) return;
        setShift(current);
        setShiftError(null);
      })
      .catch((error: unknown) => {
        if (!isActive || epoch !== sessionEpochRef.current) return;
        if (error instanceof ApiError && error.isSessionExpired) {
          onSessionExpired();
          return;
        }
        // Tampilkan form + retry, bukan "Memuat shift…" selamanya.
        setShift(null);
        setShiftError(error instanceof ApiError ? error.message : "Shift gagal dimuat.");
      });
    return () => {
      isActive = false;
    };
  }, [dataSource, isDemo, onSessionExpired, sessionEpoch]);

  useEffect(() => {
    if (phase.kind === "payment") {
      cashInputRef.current?.focus();
    }
  }, [phase.kind]);

  function applyResult(result: AddResult, successText: string) {
    if (result.ok) {
      onLinesChange(result.lines);
      setStatus({ tone: "success", text: successText });
    } else if (result.reason === "INSUFFICIENT_STOCK") {
      setStatus({ tone: "warning", text: MSG_NO_STOCK });
    } else {
      setStatus({ tone: "warning", text: "Jumlah tidak valid." });
    }
  }

  function addToCart(product: ProductSummary) {
    if (isCheckoutActive || checkoutLockRef.current) return;
    applyResult(addProduct(lines, product), `${product.name} ditambahkan ke keranjang (draft).`);
  }

  async function handleBarcode(code: string) {
    if (isCheckoutActive || checkoutLockRef.current) return;
    const requestSeq = ++barcodeSeqRef.current;
    const requestEpoch = sessionEpochRef.current;
    try {
      const product = await dataSource.findActiveProductByBarcode(code);
      if (requestSeq !== barcodeSeqRef.current || requestEpoch !== sessionEpochRef.current) {
        return;
      }
      if (!product) {
        setStatus({ tone: "warning", text: MSG_NOT_FOUND });
        return;
      }
      onLinesChange((current) => {
        if (requestSeq !== barcodeSeqRef.current || requestEpoch !== sessionEpochRef.current) {
          return current;
        }
        const result = addProduct(current, product);
        if (result.ok) {
          setStatus({ tone: "success", text: `${product.name} ditambahkan ke keranjang (draft).` });
        } else {
          setStatus({
            tone: "warning",
            text: result.reason === "INSUFFICIENT_STOCK" ? MSG_NO_STOCK : "Jumlah tidak valid.",
          });
        }
        return result.lines;
      });
    } catch {
      if (requestSeq !== barcodeSeqRef.current || requestEpoch !== sessionEpochRef.current) {
        return;
      }
      setStatus({ tone: "danger", text: "Pencarian barcode gagal. Coba scan ulang." });
    } finally {
      if (requestEpoch === sessionEpochRef.current) {
        focusBarcode();
      }
    }
  }

  function handleAddFromSearch(product: ProductSummary) {
    addToCart(product);
    focusBarcode();
  }

  function changeQuantity(productId: number, delta: number) {
    if (isCheckoutActive || checkoutLockRef.current) return;
    const line = lines.find((item) => item.productId === productId);
    if (!line) {
      return;
    }
    applyResult(setQuantity(lines, productId, line.quantity + delta), `Jumlah ${line.name} diperbarui.`);
  }

  function handleRemove(productId: number) {
    if (isCheckoutActive || checkoutLockRef.current) return;
    const line = lines.find((item) => item.productId === productId);
    onLinesChange(removeLine(lines, productId));
    if (line) {
      setStatus({ tone: "info", text: `${line.name} dihapus dari keranjang.` });
    }
    focusBarcode();
  }

  function openCancelDialog() {
    isConfirmingCancelRef.current = true;
    setIsConfirmingCancel(true);
  }

  function confirmCancelDraft() {
    // Hanya membuang draft di memori UI; tidak memanggil API apa pun (AC-03.07).
    barcodeSeqRef.current += 1;
    isConfirmingCancelRef.current = false;
    onDraftConsumed(draftId, null);
    setIsConfirmingCancel(false);
    setStatus({ tone: "info", text: "Draft dibatalkan. Tidak ada transaksi yang disimpan." });
    barcodeRef.current?.focus();
  }

  function closeCancelDialog() {
    isConfirmingCancelRef.current = false;
    setIsConfirmingCancel(false);
    barcodeRef.current?.focus();
  }

  async function handleOpenShift(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isOpeningShift || checkoutLockRef.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const raw = String(data.get("openingCash") ?? "").trim();
    const openingCashRp = raw.length === 0 ? undefined : parseRupiahInput(raw);
    if (openingCashRp === null) {
      setShiftError("Modal awal harus bilangan rupiah bulat dan tidak negatif.");
      return;
    }
    setIsOpeningShift(true);
    try {
      const opened = await dataSource.openShift(
        openingCashRp === undefined ? {} : { openingCashRp },
      );
      setShift(opened);
      setShiftError(null);
      setStatus({ tone: "success", text: `Shift #${opened.id} dibuka untuk kasir ini.` });
    } catch (error) {
      handleActionError(error, "Shift gagal dibuka.");
      if (error instanceof ApiError && error.code === "SHIFT_ALREADY_OPEN") {
        setShiftError(error.message);
        void reloadShift();
      }
    } finally {
      setIsOpeningShift(false);
    }
  }

  async function reloadShift(): Promise<void> {
    if (isDemo) return;
    try {
      setShift(await dataSource.getCurrentShift());
    } catch (error) {
      handleActionError(error, "Shift gagal dimuat ulang.");
    }
  }

  function cartItems(source: CartLine[]): Array<{ productId: number; quantity: number }> {
    return source.map((line) => ({ productId: line.productId, quantity: line.quantity }));
  }

  async function runPrepare(
    attemptKey: string,
    source: CartLine[],
    method: CheckoutPaymentMethod,
  ): Promise<PrepareCheckoutResult> {
    if (shift === null || shift === undefined) {
      throw new ApiError(409, "SHIFT_NOT_ACTIVE", "Shift aktif tidak ditemukan.");
    }
    return dataSource.prepareCheckout({
      attemptKey,
      shiftId: shift.id,
      items: cartItems(source),
      paymentMethod: method,
    });
  }

  async function startCheckout(): Promise<void> {
    if (checkoutLockRef.current || phase.kind !== "idle") return;
    const total = cartTotalRp(lines);
    if (lines.length === 0 || total === null) {
      setStatus({ tone: "warning", text: "Keranjang kosong atau total tidak dapat dihitung." });
      return;
    }
    if (!isDemo && (shift === null || shift === undefined)) {
      setStatus({ tone: "warning", text: "Buka shift milik Anda terlebih dahulu sebelum checkout." });
      return;
    }
    checkoutLockRef.current = true;
    // Batalkan lookup barcode yang masih berjalan agar tidak menambah baris setelah quote.
    barcodeSeqRef.current += 1;
    // Snapshot garis yang dikirim ke backend; commit hanya boleh menghapus ini.
    snapshotLinesRef.current = lines;
    snapshotDraftIdRef.current = draftId;
    setPhase({ kind: "preparing" });
    try {
      // attemptKey baru dibuat sekali per niat; retry memakai kunci yang sama.
      const attempt = await runPrepare(createAttemptKey(), snapshotLinesRef.current, selectedMethod);
      setCashInput("");
      // Kasir wajib mengetik nominal merchant sendiri; jangan isi otomatis.
      setMerchantAmountInput("");
      setMerchantConfirmed(false);
      setEvidenceRefInput("");
      setPaymentError(null);
      setPriorQrisConfirmation(null);
      setPriorQrisReconciled(false);
      setPhase({ kind: "payment", attempt });
      setStatus({ tone: "info", text: "Quote pricing tersimpan. Periksa total sebelum membayar." });
    } catch (error) {
      snapshotLinesRef.current = [];
      setPhase({ kind: "idle" });
      handleActionError(error, "Quote checkout gagal disiapkan.");
    } finally {
      checkoutLockRef.current = false;
    }
  }

  /** Setelah PRICE_CHANGED: upaya lama tidak bisa dipakai, tapi user yang menyetujui harga baru. */
  async function prepareRevisedQuote(
    previous: PrepareCheckoutResult,
    paymentConfirmation: PaymentConfirmation,
  ): Promise<void> {
    const previousTotalRp = previous.quote.totalRp;
    // Transfer lama harus tetap terlihat & direkonsiliasi, tidak dipakai ulang.
    if (paymentConfirmation.method === "QRIS_MANUAL") {
      setPriorQrisConfirmation(paymentConfirmation);
      setPriorQrisAttempt(previous);
      setPriorQrisReconciled(false);
    } else {
      setPriorQrisConfirmation(null);
      setPriorQrisAttempt(null);
    }
    try {
      if (snapshotLinesRef.current.length === 0) throw new Error("Snapshot kosong");
      const attempt = await runPrepare(
        createAttemptKey(),
        snapshotLinesRef.current,
        previous.quote.payment.method,
      );
      setCashInput("");
      // Nominal dan referensi transfer baru dikumpulkan terpisah.
      setMerchantAmountInput("");
      setMerchantConfirmed(false);
      setEvidenceRefInput("");
      setPaymentError(null);
      setPhase({ kind: "priceChanged", attempt, previousTotalRp });
      setStatus({ tone: "warning", text: "Harga berubah. Setujui ringkasan baru sebelum melanjutkan." });
    } catch (error) {
      // Simpan rekaman dan snapshot lama agar pembelian dapat diperiksa lagi.
      setPhase({
        kind: "timeout",
        attempt: previous,
        cashReceivedRp: confirmationAmount(paymentConfirmation),
        paymentConfirmation,
      });
      handleActionError(error, "Quote harga baru gagal disiapkan. Periksa kembali upaya ini.");
    }
  }

  function commitSucceeded(result: CommitCheckoutResult, epoch: number): void {
    // Commit bisa selesai setelah logout/pindah halaman; jangan sentuh draft sesi baru.
    if (epoch !== sessionEpochRef.current) return;
    // Pengganti sukses: pensiunkan pendahulu yang sedang direkonsiliasi.
    retireReplacedRecords(result.attemptKey);
    try {
      const activeKey = recoveryKeyRef.current;
      if (activeKey !== null) {
        const saved = JSON.parse(localStorage.getItem(activeKey) ?? "null");
        if (saved?.attempt?.attemptKey === result.attemptKey) removeRecovery();
      }
      localStorage.removeItem(`${storagePrefix}.${encodeURIComponent(result.attemptKey)}`);
    } catch {
      setStorageWarning("Rekaman pemulihan tidak dapat dihapus. Catatan tetap tersimpan dan dapat muncul kembali setelah halaman dibuka ulang.");
    }
    recoveryEpochRef.current += 1;
    setPhase({ kind: "success", result });
    setPriorQrisConfirmation(null);
    setPriorQrisReconciled(false);
    setPriorQrisAttempt(null);
    // Draft dibersihkan HANYA setelah backend mengonfirmasi COMMITTED, dan hanya
    // garis yang masuk snapshot prepare. Baris lain tidak ikut terhapus.
    if (snapshotDraftIdRef.current !== null) {
      onDraftConsumed(snapshotDraftIdRef.current, snapshotLinesRef.current.map((line) => line.productId));
    }
    const trimmedCustomer = customerCode.trim();
    if (trimmedCustomer) {
      const pts = recordCustomerPoints(trimmedCustomer, result.totalRp);
      setPointsNotice(
        `Poin pelanggan ${pts.customerCode}: +${pts.earned} poin (total ${pts.totalPoints} poin).`,
      );
    } else {
      setPointsNotice(null);
    }
    snapshotLinesRef.current = [];
    barcodeSeqRef.current += 1;
    setStatus({ tone: "success", text: `Transaksi ${result.saleNo} tersimpan di backend.` });
  }

  function finishRejectedAttempt(): void {
    // Snapshot rekaman lama dapat berasal dari quote tanpa petunjuk stok.
    const source = snapshotLinesRef.current;
    const snapshot = source.map((line) => ({ ...line, stockHint: Number.isSafeInteger(line.stockHint) && line.stockHint >= 0 ? line.stockHint : 0 }));
    if (snapshot.length === 0 || !snapshot.every((line) =>
      Number.isSafeInteger(line.productId) && line.productId > 0 &&
      typeof line.sku === "string" && typeof line.name === "string" &&
      Number.isSafeInteger(line.unitPriceRp) && line.unitPriceRp >= 0 &&
      Number.isSafeInteger(line.quantity) && line.quantity > 0)) {
      setStorageWarning("Barang upaya tidak dapat dipulihkan. Rekaman tetap disimpan untuk pemeriksaan.");
      openNextRecovery();
      return;
    }
    const failedKey = removeRecovery();
    if (failedKey === null) onDraftRestore(draftId, snapshot);
    openNextRecovery(failedKey ?? undefined);
  }

  function rejectQrisAttempt(
    attempt: PrepareCheckoutResult,
    paymentConfirmation: PaymentConfirmation,
    blockReplay = false,
  ): void {
    // QRIS gagal setelah uang ditransfer: rekaman lokal sengaja dipertahankan.
    setPhase({
      kind: "timeout",
      attempt,
      cashReceivedRp: confirmationAmount(paymentConfirmation),
      paymentConfirmation,
      noReplay: blockReplay,
    });
    if (blockReplay) {
      persistNoReplay(attempt.attemptKey);
    }
    setStatus({
      tone: "danger",
      text: blockReplay
        ? "Shift sudah ditutup. Transfer QRIS tercatat; periksa aplikasi merchant dan status upaya. Jangan ulang commit attempt ini tanpa rekonsiliasi."
        : "Transfer QRIS tercatat. Periksa aplikasi merchant dan status upaya; jangan bayar ulang tanpa rekonsiliasi.",
    });
  }

  /**
   * VALIDATION_ERROR tidak menghasilkan sale, tetapi attemptKey lama sudah
   * dipakai. Siapkan identitas baru sambil mempertahankan rekaman lama sampai
   * rekaman attempt baru tersimpan.
   */
  async function retryValidationWithNewAttempt(
    attempt: PrepareCheckoutResult,
    paymentConfirmation: PaymentConfirmation,
    reason: string,
  ): Promise<void> {
    if (replacementLockRef.current || isCheckingStatus) return;
    replacementLockRef.current = true;
    setIsRetryingReplacement(true);
    persistNoReplay(attempt.attemptKey, reason);
    try {
      if (snapshotLinesRef.current.length === 0) throw new Error("Snapshot kosong");
      const fresh = await runPrepare(
        createAttemptKey(),
        snapshotLinesRef.current,
        attempt.quote.payment.method,
      );
      const key = `${storagePrefix}.${encodeURIComponent(fresh.attemptKey)}`;
      // Rekaman asli (dengan konfirmasi nyata) sengaja tidak dihapus sampai pengganti sukses.
      localStorage.setItem(
        key,
        JSON.stringify({
          attempt: fresh,
          cashReceivedRp: 0,
          paymentConfirmation: null,
          paymentState: "UNSUBMITTED",
          replacesAttemptKey: attempt.attemptKey,
          originalQrisConfirmation:
            paymentConfirmation.method === "QRIS_MANUAL" ? paymentConfirmation : null,
          snapshot: snapshotLinesRef.current,
          draftId: snapshotDraftIdRef.current,
        }),
      );
      recoveryKeyRef.current = key;
      if (paymentConfirmation.method === "QRIS_MANUAL") {
        setPriorQrisConfirmation(paymentConfirmation);
        setPriorQrisAttempt(attempt);
        setPriorQrisReconciled(false);
      }
      setCashInput("");
      setMerchantAmountInput("");
      setMerchantConfirmed(false);
      setEvidenceRefInput("");
      setPaymentError(
        `Status: GAGAL — ${reason} Upaya pengganti disiapkan; periksa transfer lama sebelum konfirmasi ulang.`,
      );
      setStatus({
        tone: "danger",
        text:
          paymentConfirmation.method === "QRIS_MANUAL"
            ? "Transfer QRIS lama tetap tercatat. Tentukan apakah transfer itu menyelesaikan quote baru sebelum mengirim konfirmasi ulang."
            : "Upaya pengganti disiapkan. Isi ulang konfirmasi pembayaran.",
      });
      setPhase({ kind: "payment", attempt: fresh });
    } catch (error) {
      if (error instanceof ApiError && error.isSessionExpired) {
        onSessionExpired();
        return;
      }
      // Jangan buka payment dengan kunci yang sudah ditolak; arahkan ke recovery.
      persistNoReplay(attempt.attemptKey, reason);
      setPhase({
        kind: "timeout",
        attempt,
        cashReceivedRp: confirmationAmount(paymentConfirmation),
        paymentConfirmation,
        noReplay: true,
        replacementReason: reason,
      });
      setStatus({
        tone: "danger",
        text: "Upaya pengganti gagal dibuat. Cek status upaya, lalu coba buat pengganti lagi; jangan bayar ulang.",
      });
    } finally {
      replacementLockRef.current = false;
      setIsRetryingReplacement(false);
    }
  }

  async function handleCommitError(
    error: unknown,
    attempt: PrepareCheckoutResult,
    paymentConfirmation: PaymentConfirmation,
  ): Promise<void> {
    const cashReceivedRp = confirmationAmount(paymentConfirmation);
    if (error instanceof ApiError) {
      if (error.isSessionExpired) {
        onSessionExpired();
        return;
      }
      if (error.code === "VALIDATION_ERROR") {
        // Verifikasi QRIS/tunai ditolak backend: tidak ada sale, tapi kunci lama
        // tidak boleh dipakai ulang. Pindah ke attempt baru.
        await retryValidationWithNewAttempt(attempt, paymentConfirmation, error.message);
        return;
      }
      if (error.code === "PRICE_CHANGED") {
        await prepareRevisedQuote(attempt, paymentConfirmation);
        return;
      }
      if (error.code === "SHIFT_NOT_ACTIVE") {
        if (paymentConfirmation.method === "QRIS_MANUAL") {
          rejectQrisAttempt(attempt, paymentConfirmation, true);
        } else {
          finishRejectedAttempt();
        }
        setShift(null);
        setStatus({ tone: "warning", text: error.message });
        void reloadShift();
        return;
      }
      if (error.code === "INSUFFICIENT_STOCK") {
        if (paymentConfirmation.method === "QRIS_MANUAL") {
          rejectQrisAttempt(attempt, paymentConfirmation);
          setStatus({ tone: "danger", text: `${error.message} Transfer QRIS tercatat; periksa merchant sebelum melanjutkan.` });
        } else {
          finishRejectedAttempt();
          handleActionError(error, "Stok tidak cukup.");
        }
        return;
      }
      if (error.code === "NETWORK_ERROR" || error.code === "INVALID_RESPONSE") {
        // Respons bisa saja berhasil di server tetapi gagal dibaca klien. Jangan
        // buat upaya baru dan jangan minta pembayaran fisik lagi: arahkan ke lookup.
        setPhase({ kind: "timeout", attempt, cashReceivedRp, paymentConfirmation });
        setStatus({ tone: "danger", text: MSG_TIMEOUT });
        return;
      }
    }
    // Kesalahan lain tidak membuktikan commit gagal; tetap kunci dan cek status.
    setPhase({ kind: "timeout", attempt, cashReceivedRp, paymentConfirmation });
    setStatus({ tone: "danger", text: MSG_TIMEOUT });
  }

  async function confirmCommit(): Promise<void> {
    if (checkoutLockRef.current || phase.kind !== "payment") return;
    const attempt = phase.attempt;
    const quoteTotalRp = attempt.quote.totalRp;
    let paymentConfirmation: PaymentConfirmation;

    if (attempt.quote.payment.method === "QRIS_MANUAL") {
      const confirmedAmountRp = parseRupiahInput(merchantAmountInput);
      if (!merchantConfirmed) {
        setPaymentError("Status: GAGAL — centang konfirmasi hanya setelah melihat transaksi di aplikasi merchant. Tidak ada penjualan.");
        return;
      }
      if (confirmedAmountRp === null || confirmedAmountRp !== quoteTotalRp) {
        setPaymentError(`Status: GAGAL — nominal merchant harus sama dengan total ${quoteTotalRp}. Tidak ada penjualan.`);
        return;
      }
      paymentConfirmation = {
        method: "QRIS_MANUAL",
        merchantConfirmed: true,
        confirmedAmountRp,
        evidenceRef: evidenceRefInput.trim().length > 0 ? evidenceRefInput.trim().slice(0, 120) : null,
      };
    } else {
      const cashReceivedRp = parseRupiahInput(cashInput);
      if (cashReceivedRp === null || cashReceivedRp < quoteTotalRp) {
        setStatus({ tone: "warning", text: "Nominal tunai harus berupa bilangan bulat dan minimal sama dengan total." });
        return;
      }
      paymentConfirmation = { method: "CASH", cashReceivedRp };
    }

    setPaymentError(null);
    const cashReceivedRp = confirmationAmount(paymentConfirmation);
    const epoch = sessionEpochRef.current;
    // Catat sebelum mengirim commit; bila penyimpanan gagal, jangan kirim.
    try {
      const key = `${storagePrefix}.${encodeURIComponent(attempt.attemptKey)}`;
      // Jangan menimpa rekaman dengan konfirmasi nyata. Placeholder dari
      // retry VALIDATION_ERROR belum memiliki konfirmasi dan boleh ditimpa.
      let link: { replacesAttemptKey?: string; originalQrisConfirmation?: unknown } = {};
      const stored = localStorage.getItem(key);
      if (stored !== null) {
        const parsed = JSON.parse(stored) as {
          paymentConfirmation?: unknown;
          replacesAttemptKey?: string;
          originalQrisConfirmation?: unknown;
        };
        if (parsed.paymentConfirmation !== null && parsed.paymentConfirmation !== undefined) {
          throw new Error("Attempt already recorded");
        }
        link = {
          replacesAttemptKey: parsed.replacesAttemptKey,
          originalQrisConfirmation: parsed.originalQrisConfirmation,
        };
      }
      localStorage.setItem(key, JSON.stringify({ attempt, cashReceivedRp, paymentConfirmation, paymentState: "SUBMITTED", ...link, snapshot: snapshotLinesRef.current, draftId: snapshotDraftIdRef.current }));
      // Quote baru sudah terlindungi sebelum rekaman lama dihapus.
      if (recoveryKeyRef.current && recoveryKeyRef.current !== key) removeRecovery();
      recoveryKeyRef.current = key;
    } catch {
      setStatus({ tone: "danger", text: "Identitas upaya tidak dapat disimpan lokal. Checkout tidak dikirim." });
      return;
    }
    checkoutLockRef.current = true;
    setPhase({ kind: "committing", attempt });
    try {
      const result = await dataSource.commitCheckout({
        attemptKey: attempt.attemptKey,
        requestHash: attempt.requestHash,
        paymentConfirmation,
      });
      commitSucceeded(result, epoch);
    } catch (error) {
      await handleCommitError(error, attempt, paymentConfirmation);
    } finally {
      checkoutLockRef.current = false;
    }
  }

  /** Lanjutkan UPAYA YANG SAMA setelah status PREPARED diketahui (bukan transaksi baru). */
  async function resumeSameAttempt(
    attempt: PrepareCheckoutResult,
    paymentConfirmation: PaymentConfirmation,
  ): Promise<void> {
    if (checkoutLockRef.current) return;
    const epoch = sessionEpochRef.current;
    checkoutLockRef.current = true;
    setPhase({ kind: "committing", attempt });
    try {
      const result = await dataSource.commitCheckout({
        attemptKey: attempt.attemptKey,
        requestHash: attempt.requestHash,
        paymentConfirmation,
      });
      commitSucceeded(result, epoch);
    } catch (error) {
      await handleCommitError(error, attempt, paymentConfirmation);
    } finally {
      checkoutLockRef.current = false;
    }
  }

  async function checkAttemptStatus(): Promise<void> {
    if (isCheckingStatus || replacementLockRef.current || phase.kind !== "timeout") return;
    const { attempt } = phase;
    const epoch = sessionEpochRef.current;
    const recoveryEpoch = recoveryEpochRef.current;
    setIsCheckingStatus(true);
    setPhase({ ...phase, known: undefined });
    try {
      const result = await dataSource.getCheckoutStatus(attempt.attemptKey);
      // Rekaman bisa berganti (draft baru/transaksi baru) saat lookup berjalan.
      if (recoveryEpoch !== recoveryEpochRef.current) return;
      if (result.status === "COMMITTED") {
        commitSucceeded(result, epoch);
        return;
      }
      setPhase({ ...phase, known: result.status });
      setStatus({
        tone: result.status === "PREPARED" ? "warning" : "danger",
        text:
          result.status === "PREPARED"
            ? "Upaya masih PREPARED dan belum menghasilkan penjualan. Periksa bukti pembayaran fisik sebelum melanjutkan commit upaya ini."
            : "Upaya ini sudah ABANDONED dan tidak dapat di-commit. Buat draft baru.",
      });
    } catch (error) {
      handleActionError(error, "Status upaya belum dapat dipastikan. Jangan bayar ulang.");
    } finally {
      setIsCheckingStatus(false);
    }
  }

  function startNewDraft(): void {
    // Jangan biarkan lookup yang masih berjalan menimpa draft baru.
    if (isCheckingStatus || replacementLockRef.current) return;
    recoveryEpochRef.current += 1;
    // Tidak ada API dipanggil; ini hanya membersihkan UI setelah status ABANDONED.
    const failedKey = removeRecovery();
    if (snapshotDraftIdRef.current !== null) {
      onDraftConsumed(snapshotDraftIdRef.current, null);
    }
    openNextRecovery(failedKey ?? undefined);
    setCashInput("");
    setStatus({ tone: "info", text: "Draft baru siap. Tidak ada transaksi yang disimpan." });
    focusBarcode();
  }

  function rejectRevisedQuote(): void {
    if (priorQrisConfirmation?.method === "QRIS_MANUAL" && priorQrisAttempt !== null) {
      // Tolak harga baru, tapi jangan buang transfer lama yang belum selesai.
      setPhase({
        kind: "timeout",
        attempt: priorQrisAttempt,
        cashReceivedRp: confirmationAmount(priorQrisConfirmation),
        paymentConfirmation: priorQrisConfirmation,
        noReplay: true,
      });
      setStatus({
        tone: "warning",
        text: "Harga baru ditolak. Transfer QRIS lama tetap tercatat; cek status upaya dan rekonsiliasi sebelum transaksi baru.",
      });
      setCashInput("");
      return;
    }
    const failedKey = removeRecovery();
    openNextRecovery(failedKey ?? undefined);
    setCashInput("");
    focusBarcode();
  }

  function closePayment(): void {
    // PREPARED tidak membuat penjualan; menutup dialog hanya membuang referensi UI.
    if (recoveryKeyRef.current) {
      const failedKey = removeRecovery();
      openNextRecovery(failedKey ?? undefined);
    } else {
      snapshotLinesRef.current = [];
      setPhase({ kind: "idle" });
    }
    setCashInput("");
    focusBarcode();
  }

  const totalRp = cartTotalRp(lines);
  const promoDiscountRp = calculatePromoDiscountRp(lines, promoKind);
  const netPreviewTotalRp = totalRp !== null ? Math.max(0, totalRp - promoDiscountRp) : null;
  const normalizedCustomerCode = customerCode.trim().toUpperCase();
  const currentCustomerPoints = normalizedCustomerCode ? getCustomerPoints(normalizedCustomerCode) : 0;
  const customerDisplayState = buildCustomerDisplayState(
    lines,
    promoKind,
    phase.kind === "success" ? phase.result.payment.changeRp : null,
  );
  const itemCount = cartItemCount(lines);
  const isCartEmpty = lines.length === 0;
  const cashValue = parseRupiahInput(cashInput);
  const canPay =
    !isDemo && shift !== null && shift !== undefined && !isCartEmpty && totalRp !== null &&
    (phase.kind === "idle" || phase.kind === "success");
  const payReason = isDemo
    ? MSG_DEMO
    : shift === null || shift === undefined
      ? "Buka shift milik Anda terlebih dahulu."
      : isCartEmpty
        ? "Tambahkan barang ke keranjang terlebih dahulu."
        : "";
  // Kembalian mengikuti total pada quote yang disetujui, bukan draft yang bisa berubah.
  const quoteTotalRp = phase.kind === "payment" ? phase.attempt.quote.totalRp : null;
  const quoteChangeRp =
    quoteTotalRp !== null && cashValue !== null && cashValue >= quoteTotalRp
      ? cashValue - quoteTotalRp
      : null;
  const paymentIsQris =
    phase.kind === "payment" && phase.attempt.quote.payment.method === "QRIS_MANUAL";
  const merchantAmountValue = parseRupiahInput(merchantAmountInput);
  const canCommitPayment = paymentIsQris
    ? (!priorQrisConfirmation || priorQrisReconciled) &&
      merchantConfirmed && merchantAmountValue !== null && merchantAmountValue === quoteTotalRp
    : cashValue !== null && quoteTotalRp !== null && cashValue >= quoteTotalRp;
  const timeoutConfirmation: PaymentConfirmation | null = phase.kind === "timeout"
    ? phase.paymentConfirmation ??
      (phase.attempt.quote.payment.method === "CASH"
        ? { method: "CASH", cashReceivedRp: phase.cashReceivedRp }
        : null)
    : null;
  const canResumeTimeout = timeoutConfirmation !== null;

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === "F2" && phase.kind === "idle") { event.preventDefault(); barcodeRef.current?.focus(); }
      if (event.key === "F9" && phase.kind === "idle") { event.preventDefault(); void startCheckout(); }
      if (event.key === "Escape" && phase.kind === "payment") { event.preventDefault(); closePayment(); }
      if (event.key === "Enter" && phase.kind === "payment" && event.target === cashInputRef.current && canCommitPayment) { event.preventDefault(); void confirmCommit(); }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });

  return (
    <div className="cashier">
      <p className="muted">F2 Cari/scan · F9 Bayar · Esc Kembali dari pembayaran · Enter Konfirmasi nominal</p>
      <section className="cashier__work panel" aria-label="Scan dan keranjang">
        <div className="shift-panel" aria-label="Shift kasir">
          {isDemo ? (
            <p className="muted">Shift/checkout tidak tersedia di MODE DEMO mock.</p>
          ) : shift === undefined ? (
            <p className="muted">Memuat shift…</p>
          ) : shift === null ? (
            <form onSubmit={(event) => void handleOpenShift(event)} aria-label="Buka shift">
              <p className="field-error" role="alert">
                {shiftError ?? "Belum ada shift aktif milik kasir ini."}
              </p>
              {shiftError !== null && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShiftError(null);
                    void reloadShift();
                  }}
                >
                  Coba lagi
                </Button>
              )}
              <label htmlFor={openingCashId} className="field-label">
                Modal awal (Rp, opsional)
              </label>
              <input id={openingCashId} className="input" type="text" inputMode="numeric" name="openingCash" />
              <Button type="submit" variant="primary" disabled={isOpeningShift}>
                {isOpeningShift ? "Membuka…" : "Buka shift"}
              </Button>
            </form>
          ) : (
            <p>
              <span className="badge badge--ok">Shift aktif</span> #{shift.id} · dibuka{" "}
              {formatShiftTime(shift.openedAtMs)}
            </p>
          )}
        </div>
        <BarcodeInput
          ref={barcodeRef}
          onSubmitCode={(code) => void handleBarcode(code)}
          disabled={isCheckoutActive}
        />
        <ProductSearch
          search={(query) => dataSource.searchActiveProducts(query)}
          onAdd={handleAddFromSearch}
          disabled={isCheckoutActive}
        />
        <h2 className="section-title">Keranjang</h2>
        <CartList
          lines={lines}
          onIncrease={(id) => changeQuantity(id, 1)}
          onDecrease={(id) => changeQuantity(id, -1)}
          onRemove={handleRemove}
          disabled={isCheckoutActive}
        />
      </section>

      <aside className="cashier__summary panel" aria-label="Ringkasan belanja">
        <h2 className="section-title">Ringkasan belanja</h2>
        <p className="summary__count">{itemCount} barang</p>
        <div className="summary__total">
          <span>TOTAL</span>
          <MoneyText amountRp={totalRp} className="money--total" />
        </div>
        {promoDiscountRp > 0 && (
          <p className="muted" role="status">
            Potongan promo lokal (DEMO): -<MoneyText amountRp={promoDiscountRp} /> · Estimasi bersih:{" "}
            <strong><MoneyText amountRp={netPreviewTotalRp} /></strong>
          </p>
        )}
        <div className="summary__extras">
          <label className="field-label" htmlFor={promoSelectId}>Promo lokal (DEMO)</label>
          <select
            id={promoSelectId}
            className="input"
            value={promoKind}
            disabled={isCheckoutActive}
            onChange={(event) => setPromoKind(event.target.value as PromoKind)}
          >
            <option value="NONE">Tanpa promo</option>
            <option value="BUY_2_GET_1">Beli 2 gratis 1 (item termurah)</option>
            <option value="TEBUS_MURAH">Tebus murah (hemat Rp5.000 min. Rp50.000)</option>
          </select>
          <label className="field-label" htmlFor={customerCodeId}>Kode pelanggan / poin (opsional)</label>
          <input
            id={customerCodeId}
            className="input"
            type="text"
            value={customerCode}
            disabled={isCheckoutActive}
            onChange={(event) => setCustomerCode(event.target.value)}
            placeholder="Mis. MHS001"
          />
          {normalizedCustomerCode && (
            <p className="muted" role="status">
              Pelanggan {normalizedCustomerCode}: <strong>{currentCustomerPoints} poin</strong> tersimpan.
            </p>
          )}
        </div>
        <p className="summary__draft-note muted">
          Draft belum tersimpan sebagai transaksi sampai commit dikonfirmasi backend.
        </p>
        <fieldset className="method-chooser" disabled={isDemo || isCheckoutActive}>
          <legend className="field-label">Metode pembayaran</legend>
          <label className="checkbox-row">
            <input
              type="radio"
              name="payment-method"
              checked={selectedMethod === "CASH"}
              onChange={() => setSelectedMethod("CASH")}
            />
            Tunai
          </label>
          <label className="checkbox-row">
            <input
              type="radio"
              name="payment-method"
              checked={selectedMethod === "QRIS_MANUAL"}
              onChange={() => setSelectedMethod("QRIS_MANUAL")}
            />
            QRIS manual (cek di aplikasi merchant)
          </label>
          <p className="muted">QRIS tidak otomatis lunas dan tidak masuk kas fisik.</p>
        </fieldset>
        <div className="summary__actions">
          <Button
            variant="primary"
            block
            disabled={!canPay}
            aria-describedby="payment-disabled-reason"
            onClick={() => void startCheckout()}
          >
            {phase.kind === "preparing" ? "Menyiapkan…" : "Lanjut pembayaran"}
          </Button>
          {payReason && (
            <p id="payment-disabled-reason" className="summary__reason">
              {payReason}
            </p>
          )}
          <Button
            variant="secondary"
            block
            disabled={isCartEmpty || phase.kind !== "idle"}
            onClick={openCancelDialog}
          >
            Batal draft
          </Button>
          <Button
            variant="secondary"
            block
            onClick={() => setShowCustomerDisplay((prev) => !prev)}
          >
            {showCustomerDisplay ? "Tutup layar pelanggan" : "Layar pelanggan"}
          </Button>
          {showCustomerDisplay && (
            <section className="customer-display-preview panel" aria-label="Layar pelanggan">
              <p>
                <strong>Layar pelanggan</strong> · {customerDisplayState.items.length} baris ·{" "}
                <MoneyText amountRp={customerDisplayState.totalRp} />
              </p>
              {customerDisplayState.promoLabel && (
                <p className="muted">
                  {customerDisplayState.promoLabel}: -<MoneyText amountRp={promoDiscountRp} />
                </p>
              )}
              <Button
                variant="secondary"
                onClick={() => {
                  const popup = window.open("", "pos-customer-display", "width=480,height=640");
                  if (popup) {
                    popup.document.open();
                    popup.document.write(renderCustomerDisplayHtml(customerDisplayState));
                    popup.document.close();
                  }
                }}
              >
                Buka jendela pelanggan
              </Button>
            </section>
          )}
        </div>
      </aside>

      <div className="cashier__status">
        <StatusMessage tone={status.tone} text={status.text} />
        {storageWarning && <StatusMessage tone="warning" text={storageWarning} />}
      </div>

      {isConfirmingCancel && (
        <ConfirmDialog
          title="Batalkan draft?"
          message="Semua barang di keranjang akan dibuang. Belum ada transaksi yang tersimpan."
          confirmLabel="Ya, batalkan draft"
          cancelLabel="Kembali ke keranjang"
          destructive
          onConfirm={confirmCancelDraft}
          onCancel={closeCancelDialog}
        />
      )}

      {phase.kind === "payment" && (
        <div className="dialog-backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="payment-title">
            <h2 id="payment-title" className="dialog__title">
              {paymentIsQris ? "Konfirmasi QRIS manual" : "Konfirmasi pembayaran tunai"}
            </h2>
            <p>
              <span className="badge badge--warning">PENDING — belum ada penjualan</span> · Total:{" "}
              <MoneyText amountRp={phase.attempt.quote.totalRp} />
            </p>
            <p className="muted" role="note">
              {paymentIsQris
                ? "Pemeriksaan metode: pastikan pelanggan membayar lewat QRIS merchant, bukan uang tunai."
                : "Pemeriksaan metode: pastikan pelanggan membayar tunai langsung, bukan transfer QRIS."}
            </p>
            <ul className="catalog-list">
              {phase.attempt.quote.items.map((item) => (
                <li key={item.productId}>
                  {item.name} · {item.quantity} × <MoneyText amountRp={item.unitPriceRp} /> ={" "}
                  <MoneyText amountRp={item.lineTotalRp} />
                </li>
              ))}
            </ul>
            {paymentIsQris ? (
              <div className="qris-panel">
                {priorQrisConfirmation?.method === "QRIS_MANUAL" && (
                  <p className="muted">
                    Transfer QRIS sebelumnya <MoneyText amountRp={priorQrisConfirmation.confirmedAmountRp} />{" "}
                    (ref. {priorQrisConfirmation.evidenceRef ?? "—"}) masih perlu direkonsiliasi.
                    Tentukan apakah transfer itu menyelesaikan quote ini sebelum mengirim transfer baru.
                  </p>
                )}
                {priorQrisConfirmation?.method === "QRIS_MANUAL" && (
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={priorQrisReconciled}
                      onChange={(event) => setPriorQrisReconciled(event.target.checked)}
                    />
                    Transfer lama tidak dipakai untuk quote ini; sudah saya cocokkan dengan aplikasi merchant
                  </label>
                )}
                <p className="muted">
                  Buka aplikasi merchant di luar POS. Periksa transaksi berhasil dan nominalnya
                  sebelum mencentang. POS tidak menerima notifikasi bank dan tidak otomatis lunas.
                </p>
                {paymentError && (
                  <p className="field-error" role="alert">{paymentError}</p>
                )}
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={merchantConfirmed}
                    onChange={(event) => {
                      setMerchantConfirmed(event.target.checked);
                      setPaymentError(null);
                    }}
                  />
                  Saya sudah memeriksa transaksi di aplikasi merchant
                </label>
                <label htmlFor={cashInputId} className="field-label">
                  Nominal yang terlihat di merchant (Rp)
                </label>
                <input
                  id={cashInputId}
                  ref={cashInputRef}
                  className="input"
                  type="text"
                  inputMode="numeric"
                  value={merchantAmountInput.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}
                  onChange={(event) => {
                    setMerchantAmountInput(event.target.value.replace(/\./g, ""));
                    setPaymentError(null);
                  }}
                  aria-describedby="qris-amount-hint"
                />
                <p id="qris-amount-hint" className="muted">
                  Harus sama persis dengan total quote:{" "}
                  <MoneyText amountRp={phase.attempt.quote.totalRp} />.
                </p>
                <label htmlFor={`${cashInputId}-ref`} className="field-label">
                  Referensi bukti (opsional)
                </label>
                <input
                  id={`${cashInputId}-ref`}
                  className="input"
                  type="text"
                  maxLength={120}
                  value={evidenceRefInput}
                  onChange={(event) => setEvidenceRefInput(event.target.value)}
                  placeholder="Mis. ID transaksi di aplikasi merchant"
                />
              </div>
            ) : (
              <>
                {paymentError && (
                  <p className="field-error" role="alert">{paymentError}</p>
                )}
                <label htmlFor={cashInputId} className="field-label">Uang diterima (Rp)</label>
                <input
                  id={cashInputId}
                  ref={cashInputRef}
                  className="input"
                  type="text"
                  inputMode="numeric"
                  value={cashInput.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}
                  onChange={(event) => {
                    setCashInput(event.target.value.replace(/\./g, ""));
                    setPaymentError(null);
                  }}
                  aria-describedby="change-info"
                />
                <div className="dialog__actions" aria-label="Nominal tunai cepat">
                  <Button onClick={() => setCashInput(String(phase.attempt.quote.totalRp))}>Uang pas</Button>
                  {[10000, 20000, 50000, 100000].map(amount => <Button key={amount} onClick={() => setCashInput(String(amount))}>{amount.toLocaleString("id-ID")}</Button>)}
                </div>
                <p id="change-info" className="muted">
                  Kembalian: <MoneyText amountRp={quoteChangeRp} />
                </p>
              </>
            )}
            <p className="muted">
              Upaya: <code>{phase.attempt.attemptKey}</code>. Jangan ulangi pembayaran fisik jika respons lambat.
            </p>
            <div className="dialog__actions">
              <Button variant="secondary" onClick={closePayment}>Batal</Button>
              <Button
                variant="primary"
                disabled={!canCommitPayment}
                onClick={() => void confirmCommit()}
              >
                Ya, commit pembayaran
              </Button>
            </div>
          </div>
        </div>
      )}

      {phase.kind === "priceChanged" && (
        <div className="dialog-backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="price-title">
            <h2 id="price-title" className="dialog__title">Harga berubah — setujui ulang</h2>
            <p>
              Total sebelumnya <MoneyText amountRp={phase.previousTotalRp} /> berubah menjadi{" "}
              <strong><MoneyText amountRp={phase.attempt.quote.totalRp} /></strong>. Tidak ada penjualan yang tersimpan.
            </p>
            <ul className="catalog-list">
              {phase.attempt.quote.items.map((item) => (
                <li key={item.productId}>
                  {item.sku} · {item.quantity} × <MoneyText amountRp={item.unitPriceRp} />
                </li>
              ))}
            </ul>
            {priorQrisConfirmation?.method === "QRIS_MANUAL" && (
              <div className="qris-prior">
                <p>
                  Transfer QRIS lama <MoneyText amountRp={priorQrisConfirmation.confirmedAmountRp} />{" "}
                  dengan referensi <code>{priorQrisConfirmation.evidenceRef ?? "—"}</code> tidak dipakai
                  untuk quote baru. Rekonsiliasi transfer itu sebelum melanjutkan.
                </p>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={priorQrisReconciled}
                    onChange={(event) => setPriorQrisReconciled(event.target.checked)}
                  />
                  Saya sudah memeriksa dan menyesuaikan transfer QRIS lama di aplikasi merchant
                </label>
              </div>
            )}
            <div className="dialog__actions">
              <Button variant="secondary" onClick={rejectRevisedQuote}>Tolak dan kembali</Button>
              <Button
                variant="primary"
                disabled={priorQrisConfirmation?.method === "QRIS_MANUAL" && !priorQrisReconciled}
                onClick={() => {
                  setCashInput("");
                  setMerchantAmountInput("");
                  setMerchantConfirmed(false);
                  setEvidenceRefInput("");
                  setPhase({ kind: "payment", attempt: phase.attempt });
                }}
              >
                Setuju harga baru
              </Button>
            </div>
          </div>
        </div>
      )}

      {phase.kind === "recoveryError" && (
        <div className="dialog-backdrop"><div className="dialog" role="alertdialog" aria-label="Pemulihan memerlukan rekonsiliasi">
          <h2>Pemulihan memerlukan rekonsiliasi</h2>
          <p>Data upaya lokal tidak dapat dibaca. Jangan bayar ulang; periksa transaksi tersimpan dan bukti pembayaran fisik bersama penanggung jawab.</p>
        </div></div>
      )}
      {phase.kind === "timeout" && (
        <div className="dialog-backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="timeout-title">
            <h2 id="timeout-title" className="dialog__title">Status pembayaran belum diketahui</h2>
            <p>{MSG_TIMEOUT}</p>
            <p className="muted">
              Upaya <code>{phase.attempt.attemptKey}</code> ·{" "}
              {phase.attempt.quote.payment.method === "QRIS_MANUAL"
                ? "nominal merchant"
                : "uang diterima"}{" "}
              <MoneyText amountRp={phase.cashReceivedRp} /> · total{" "}
              <MoneyText amountRp={phase.attempt.quote.totalRp} />.
            </p>
            {phase.noReplay && (
              <p className="field-error" role="alert">
                Attempt ini tidak boleh di-commit ulang. Periksa aplikasi merchant dan status
                tersimpan; bila transfer berhasil tanpa penjualan, catat untuk rekonsiliasi
                pengelola sebelum membuat transaksi baru.
              </p>
            )}
            {phase.known !== undefined && (
              <p className="field-error" role="alert">
                {phase.known === "PREPARED"
                  ? phase.attempt.quote.payment.method === "QRIS_MANUAL"
                    ? "Status: PENDING — belum ada penjualan. Periksa dulu aplikasi merchant; jangan minta bayar ulang."
                    : "Status: PREPARED (belum ada penjualan)."
                  : "Status: ABANDONED (upaya dibatalkan)."}
              </p>
            )}
            <div className="dialog__actions">
              <Button variant="secondary" disabled={isCheckingStatus || isRetryingReplacement} onClick={() => void checkAttemptStatus()}>
                {isCheckingStatus ? "Mengecek…" : "Cek status upaya"}
              </Button>
              {phase.known === "PREPARED" && canResumeTimeout && !phase.noReplay && (
                <Button
                  variant="primary"
                  disabled={isCheckingStatus || isRetryingReplacement}
                  onClick={() => void resumeSameAttempt(
                    phase.attempt,
                    timeoutConfirmation as PaymentConfirmation,
                  )}
                >
                  Lanjutkan commit upaya ini
                </Button>
              )}
              {phase.known === "PREPARED" && !canResumeTimeout && !phase.noReplay && (
                <p className="field-error" role="alert">
                  Konfirmasi QRIS belum tersimpan. Periksa aplikasi merchant dan status upaya di
                  backend; jangan minta transfer baru tanpa rekonsiliasi.
                </p>
              )}
              {phase.replacementReason !== undefined && (
                <Button
                  variant="primary"
                  disabled={isRetryingReplacement || isCheckingStatus}
                  onClick={() => void retryValidationWithNewAttempt(
                    phase.attempt,
                    phase.paymentConfirmation ?? {
                      method: "CASH",
                      cashReceivedRp: phase.cashReceivedRp,
                    },
                    phase.replacementReason as string,
                  )}
                >
                  Coba upaya pengganti
                </Button>
              )}
              {phase.noReplay && (
                <Button variant="secondary" disabled={isCheckingStatus || isRetryingReplacement} onClick={startNewDraft}>
                  Selesai rekonsiliasi, draft baru
                </Button>
              )}
              {phase.known === "ABANDONED" && (
                <Button variant="primary" disabled={isCheckingStatus || isRetryingReplacement} onClick={startNewDraft}>Buat draft baru</Button>
              )}
            </div>
          </div>
        </div>
      )}

      {phase.kind === "committing" && (
        <div className="dialog-backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="committing-title">
            <h2 id="committing-title" className="dialog__title">Menyimpan transaksi…</h2>
            <p className="muted">Jangan tutup jendela atau bayar ulang. Upaya sedang diproses backend.</p>
          </div>
        </div>
      )}

      {phase.kind === "success" && (
        <div className="dialog-backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="success-title">
            <h2 id="success-title" className="dialog__title">Transaksi tersimpan</h2>
            <p>
              Nomor penjualan <strong>{phase.result.saleNo}</strong> · status{" "}
              <strong>{phase.result.status}</strong>.
            </p>
            {phase.result.payment.method === "QRIS_MANUAL" ? (
              <>
                <p>
                  <span className="badge badge--ok">TERVERIFIKASI</span> · Total{" "}
                  <MoneyText amountRp={phase.result.totalRp} /> · kembalian{" "}
                  <MoneyText amountRp={phase.result.payment.changeRp} />.
                </p>
                {phase.result.qrisVerification?.status === "verified" && (
                  <p className="muted">
                    Diverifikasi kasir #{phase.result.qrisVerification.verifiedBy} pada{" "}
                    {formatShiftTime(phase.result.qrisVerification.verifiedAtMs)} oleh backend. QRIS tidak masuk kas fisik.
                  </p>
                )}
              </>
            ) : (
              <p>
                Total <MoneyText amountRp={phase.result.totalRp} /> · uang diterima{" "}
                <MoneyText amountRp={phase.result.payment.cashReceivedRp} /> · kembalian{" "}
                <MoneyText amountRp={phase.result.payment.changeRp} />.
              </p>
            )}
            {pointsNotice && (
              <p className="badge badge--ok" role="status">
                {pointsNotice}
              </p>
            )}
            <ReceiptPanel
              dataSource={dataSource}
              saleId={phase.result.saleId}
              onSessionExpired={onSessionExpired}
              autoLoad
            />
            <div className="dialog__actions">
              <Button variant="primary" onClick={() => { const failedKey = removeRecovery(); openNextRecovery(failedKey ?? undefined); }}>
                Transaksi baru
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
