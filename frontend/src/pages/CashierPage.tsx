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
  CheckoutStatusResult,
  CommitCheckoutResult,
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

interface CashierPageProps {
  dataSource: PosDataSource;
  lines: CartLine[];
  onLinesChange: Dispatch<SetStateAction<CartLine[]>>;
  sessionEpoch: number;
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
  | { kind: "payment"; attempt: PrepareCheckoutResult }
  | { kind: "committing"; attempt: PrepareCheckoutResult }
  | {
      kind: "timeout";
      attempt: PrepareCheckoutResult;
      cashReceivedRp: number;
      known?: Extract<CheckoutStatusResult, { status: "PREPARED" | "ABANDONED" }>["status"];
    }
  | { kind: "priceChanged"; attempt: PrepareCheckoutResult; previousTotalRp: number }
  | { kind: "success"; result: CommitCheckoutResult };

const MSG_NOT_FOUND = "Barang tidak ditemukan. Periksa barcode atau cari nama barang.";
const MSG_NO_STOCK = "Stok tidak cukup untuk jumlah ini.";
const MSG_TIMEOUT =
  "Status pembayaran belum diketahui. Jangan bayar ulang atau scan ulang barang — cek status upaya terlebih dahulu.";
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
  onLinesChange,
  sessionEpoch,
  onSessionExpired,
}: CashierPageProps) {
  const isDemo = dataSource.authMode === "DEMO";
  const [status, setStatus] = useState<Status>({ tone: "info", text: "Siap scan barang." });
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const [shift, setShift] = useState<ShiftSummary | null | undefined>(isDemo ? null : undefined);
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [isOpeningShift, setIsOpeningShift] = useState(false);
  const [phase, setPhase] = useState<CheckoutPhase>({ kind: "idle" });
  const [cashInput, setCashInput] = useState("");
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);

  const barcodeRef = useRef<HTMLInputElement>(null);
  const cashInputRef = useRef<HTMLInputElement>(null);
  const isConfirmingCancelRef = useRef(false);
  const barcodeSeqRef = useRef(0);
  const sessionEpochRef = useRef(sessionEpoch);
  const checkoutLockRef = useRef(false);
  /** Garis draft yang benar-benar dikirim pada prepare; dipakai saat membersihkan draft. */
  const snapshotLinesRef = useRef<CartLine[]>([]);
  const cashInputId = useId();
  const openingCashId = useId();
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
    onLinesChange([]);
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

  function cartItems(): Array<{ productId: number; quantity: number }> {
    return lines.map((line) => ({ productId: line.productId, quantity: line.quantity }));
  }

  async function runPrepare(attemptKey: string): Promise<PrepareCheckoutResult> {
    if (shift === null || shift === undefined) {
      throw new ApiError(409, "SHIFT_NOT_ACTIVE", "Shift aktif tidak ditemukan.");
    }
    return dataSource.prepareCheckout({
      attemptKey,
      shiftId: shift.id,
      items: cartItems(),
      paymentMethod: "CASH",
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
    setPhase({ kind: "preparing" });
    try {
      // attemptKey baru dibuat sekali per niat; retry memakai kunci yang sama.
      const attempt = await runPrepare(createAttemptKey());
      setCashInput("");
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
  async function prepareRevisedQuote(previousTotalRp: number): Promise<void> {
    try {
      const attempt = await runPrepare(createAttemptKey());
      setCashInput("");
      setPhase({ kind: "priceChanged", attempt, previousTotalRp });
      setStatus({ tone: "warning", text: "Harga berubah. Setujui ringkasan baru sebelum melanjutkan." });
    } catch (error) {
      setPhase({ kind: "idle" });
      handleActionError(error, "Quote harga baru gagal disiapkan.");
    }
  }

  function commitSucceeded(result: CommitCheckoutResult, epoch: number): void {
    // Commit bisa selesai setelah logout/pindah halaman; jangan sentuh draft sesi baru.
    if (epoch !== sessionEpochRef.current) return;
    setPhase({ kind: "success", result });
    // Draft dibersihkan HANYA setelah backend mengonfirmasi COMMITTED, dan hanya
    // garis yang masuk snapshot prepare. Baris lain tidak ikut terhapus.
    const soldProductIds = new Set(snapshotLinesRef.current.map((line) => line.productId));
    onLinesChange((current) =>
      soldProductIds.size > 0
        ? current.filter((line) => !soldProductIds.has(line.productId))
        : [],
    );
    snapshotLinesRef.current = [];
    barcodeSeqRef.current += 1;
    setStatus({ tone: "success", text: `Transaksi ${result.saleNo} tersimpan di backend.` });
  }

  async function handleCommitError(error: unknown, attempt: PrepareCheckoutResult, cashReceivedRp: number): Promise<void> {
    if (error instanceof ApiError) {
      if (error.isSessionExpired) {
        onSessionExpired();
        return;
      }
      if (error.code === "PRICE_CHANGED") {
        await prepareRevisedQuote(attempt.quote.totalRp);
        return;
      }
      if (error.code === "SHIFT_NOT_ACTIVE") {
        setPhase({ kind: "idle" });
        setShift(null);
        setStatus({ tone: "warning", text: error.message });
        void reloadShift();
        return;
      }
      if (error.code === "NETWORK_ERROR" || error.code === "INVALID_RESPONSE") {
        // Respons bisa saja berhasil di server tetapi gagal dibaca klien. Jangan
        // buat upaya baru dan jangan minta pembayaran fisik lagi: arahkan ke lookup.
        setPhase({ kind: "timeout", attempt, cashReceivedRp });
        setStatus({ tone: "danger", text: MSG_TIMEOUT });
        return;
      }
    }
    setPhase({ kind: "idle" });
    handleActionError(error, "Checkout gagal. Coba periksa keranjang Anda.");
  }

  async function confirmCommit(): Promise<void> {
    if (checkoutLockRef.current || phase.kind !== "payment") return;
    const cashReceivedRp = parseRupiahInput(cashInput);
    if (cashReceivedRp === null || cashReceivedRp < phase.attempt.quote.totalRp) {
      setStatus({ tone: "warning", text: "Nominal tunai harus berupa bilangan bulat dan minimal sama dengan total." });
      return;
    }
    const attempt = phase.attempt;
    const epoch = sessionEpochRef.current;
    checkoutLockRef.current = true;
    setPhase({ kind: "committing", attempt });
    try {
      const result = await dataSource.commitCheckout({
        attemptKey: attempt.attemptKey,
        requestHash: attempt.requestHash,
        paymentConfirmation: { method: "CASH", cashReceivedRp },
      });
      commitSucceeded(result, epoch);
    } catch (error) {
      await handleCommitError(error, attempt, cashReceivedRp);
    } finally {
      checkoutLockRef.current = false;
    }
  }

  /** Lanjutkan UPAYA YANG SAMA setelah status PREPARED diketahui (bukan transaksi baru). */
  async function resumeSameAttempt(attempt: PrepareCheckoutResult, cashReceivedRp: number): Promise<void> {
    if (checkoutLockRef.current) return;
    const epoch = sessionEpochRef.current;
    checkoutLockRef.current = true;
    setPhase({ kind: "committing", attempt });
    try {
      const result = await dataSource.commitCheckout({
        attemptKey: attempt.attemptKey,
        requestHash: attempt.requestHash,
        paymentConfirmation: { method: "CASH", cashReceivedRp },
      });
      commitSucceeded(result, epoch);
    } catch (error) {
      await handleCommitError(error, attempt, cashReceivedRp);
    } finally {
      checkoutLockRef.current = false;
    }
  }

  async function checkAttemptStatus(): Promise<void> {
    if (isCheckingStatus || phase.kind !== "timeout") return;
    const { attempt } = phase;
    const epoch = sessionEpochRef.current;
    setIsCheckingStatus(true);
    try {
      const result = await dataSource.getCheckoutStatus(attempt.attemptKey);
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
    // Tidak ada API dipanggil; ini hanya membersihkan UI setelah status ABANDONED.
    snapshotLinesRef.current = [];
    onLinesChange([]);
    setPhase({ kind: "idle" });
    setCashInput("");
    setStatus({ tone: "info", text: "Draft baru siap. Tidak ada transaksi yang disimpan." });
    focusBarcode();
  }

  function closePayment(): void {
    // PREPARED tidak membuat penjualan; menutup dialog hanya membuang referensi UI.
    snapshotLinesRef.current = [];
    setPhase({ kind: "idle" });
    setCashInput("");
    focusBarcode();
  }

  const totalRp = cartTotalRp(lines);
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

  return (
    <div className="cashier">
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
        <p className="summary__draft-note muted">
          Draft belum tersimpan sebagai transaksi sampai commit dikonfirmasi backend.
        </p>
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
        </div>
      </aside>

      <div className="cashier__status">
        <StatusMessage tone={status.tone} text={status.text} />
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
            <h2 id="payment-title" className="dialog__title">Konfirmasi pembayaran tunai</h2>
            <p>
              Total: <MoneyText amountRp={phase.attempt.quote.totalRp} />
            </p>
            <ul className="catalog-list">
              {phase.attempt.quote.items.map((item) => (
                <li key={item.productId}>
                  {item.name} · {item.quantity} × <MoneyText amountRp={item.unitPriceRp} /> ={" "}
                  <MoneyText amountRp={item.lineTotalRp} />
                </li>
              ))}
            </ul>
            <label htmlFor={cashInputId} className="field-label">Uang diterima (Rp)</label>
            <input
              id={cashInputId}
              ref={cashInputRef}
              className="input"
              type="text"
              inputMode="numeric"
              value={cashInput}
              onChange={(event) => setCashInput(event.target.value)}
              aria-describedby="change-info"
            />
            <p id="change-info" className="muted">
              Kembalian: <MoneyText amountRp={quoteChangeRp} />
            </p>
            <p className="muted">
              Upaya: <code>{phase.attempt.attemptKey}</code>. Jangan ulangi pembayaran fisik jika respons lambat.
            </p>
            <div className="dialog__actions">
              <Button variant="secondary" onClick={closePayment}>Batal</Button>
              <Button
                variant="primary"
                disabled={cashValue === null || cashValue < phase.attempt.quote.totalRp}
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
            <div className="dialog__actions">
              <Button variant="secondary" onClick={closePayment}>Tolak dan kembali</Button>
              <Button
                variant="primary"
                onClick={() => {
                  setCashInput("");
                  setPhase({ kind: "payment", attempt: phase.attempt });
                }}
              >
                Setuju harga baru
              </Button>
            </div>
          </div>
        </div>
      )}

      {phase.kind === "timeout" && (
        <div className="dialog-backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="timeout-title">
            <h2 id="timeout-title" className="dialog__title">Status pembayaran belum diketahui</h2>
            <p>{MSG_TIMEOUT}</p>
            <p className="muted">
              Upaya <code>{phase.attempt.attemptKey}</code> · uang diterima{" "}
              <MoneyText amountRp={phase.cashReceivedRp} /> · total{" "}
              <MoneyText amountRp={phase.attempt.quote.totalRp} />.
            </p>
            {phase.known !== undefined && (
              <p className="field-error" role="alert">
                {phase.known === "PREPARED"
                  ? "Status: PREPARED (belum ada penjualan)."
                  : "Status: ABANDONED (upaya dibatalkan)."}
              </p>
            )}
            <div className="dialog__actions">
              <Button variant="secondary" disabled={isCheckingStatus} onClick={() => void checkAttemptStatus()}>
                {isCheckingStatus ? "Mengecek…" : "Cek status upaya"}
              </Button>
              {phase.known === "PREPARED" && (
                <Button
                  variant="primary"
                  disabled={isCheckingStatus}
                  onClick={() => void resumeSameAttempt(phase.attempt, phase.cashReceivedRp)}
                >
                  Lanjutkan commit upaya ini
                </Button>
              )}
              {phase.known === "ABANDONED" && (
                <Button variant="primary" onClick={startNewDraft}>Buat draft baru</Button>
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
            <p>
              Total <MoneyText amountRp={phase.result.totalRp} /> · uang diterima{" "}
              <MoneyText amountRp={phase.result.payment.cashReceivedRp} /> · kembalian{" "}
              <MoneyText amountRp={phase.result.payment.changeRp} />.
            </p>
            <div className="dialog__actions">
              <Button variant="primary" onClick={() => setPhase({ kind: "idle" })}>
                Transaksi baru
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
