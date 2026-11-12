import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { PosDataSource, ProductSummary } from "../api/types";
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
}

interface Status {
  tone: StatusTone;
  text: string;
}

const MSG_NOT_FOUND = "Barang tidak ditemukan. Periksa barcode atau cari nama barang.";
const MSG_NO_STOCK = "Stok tidak cukup untuk jumlah ini.";
/** Alasan tombol bayar mati — checkout belum ada (TASK-016; TASK-001 K-05/K-06, K-01). */
const PAYMENT_DISABLED_REASON =
  "Pembayaran belum tersedia di DEMO: API checkout dan shift belum ada (TASK-014/TASK-016).";

/**
 * Layar kasir (DESIGN_SYSTEM §5.2): scan/cari di kiri, ringkasan dan aksi di kanan.
 * Tidak ada alur pembayaran yang bisa "sukses": tombol bayar selalu nonaktif di DEMO.
 */
export function CashierPage({ dataSource, lines, onLinesChange, sessionEpoch }: CashierPageProps) {
  const [status, setStatus] = useState<Status>({ tone: "info", text: "Siap scan barang." });
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const isConfirmingCancelRef = useRef(false);
  const barcodeSeqRef = useRef(0);
  const sessionEpochRef = useRef(sessionEpoch);
  sessionEpochRef.current = sessionEpoch;

  function focusBarcode() {
    // Jangan mencuri fokus selama dialog konfirmasi terbuka.
    if (!isConfirmingCancelRef.current) {
      barcodeRef.current?.focus();
    }
  }

  useEffect(() => {
    focusBarcode();
    return () => {
      // Batalkan lookup barcode tertunda saat keluar halaman atau logout.
      barcodeSeqRef.current += 1;
    };
  }, [sessionEpoch]);

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
    applyResult(addProduct(lines, product), `${product.name} ditambahkan ke keranjang (draft).`);
  }

  async function handleBarcode(code: string) {
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
    const line = lines.find((item) => item.productId === productId);
    if (!line) {
      return;
    }
    applyResult(setQuantity(lines, productId, line.quantity + delta), `Jumlah ${line.name} diperbarui.`);
  }

  function handleRemove(productId: number) {
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
    // Invalidasi lookup barcode yang masih berjalan agar tidak mengisi ulang keranjang.
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

  const totalRp = cartTotalRp(lines);
  const itemCount = cartItemCount(lines);
  const isCartEmpty = lines.length === 0;

  return (
    <div className="cashier">
      <section className="cashier__work panel" aria-label="Scan dan keranjang">
        <BarcodeInput ref={barcodeRef} onSubmitCode={handleBarcode} />
        <ProductSearch search={(query) => dataSource.searchActiveProducts(query)} onAdd={handleAddFromSearch} />
        <h2 className="section-title">Keranjang</h2>
        <CartList
          lines={lines}
          onIncrease={(id) => changeQuantity(id, 1)}
          onDecrease={(id) => changeQuantity(id, -1)}
          onRemove={handleRemove}
        />
      </section>

      <aside className="cashier__summary panel" aria-label="Ringkasan belanja">
        <h2 className="section-title">Ringkasan belanja</h2>
        <p className="summary__count">{itemCount} barang</p>
        <div className="summary__total">
          <span>TOTAL</span>
          <MoneyText amountRp={totalRp} className="money--total" />
        </div>
        <p className="summary__draft-note muted">Draft belum tersimpan sebagai transaksi.</p>
        <div className="summary__actions">
          <Button variant="primary" block disabled aria-describedby="payment-disabled-reason">
            Lanjut pembayaran
          </Button>
          <p id="payment-disabled-reason" className="summary__reason">
            {PAYMENT_DISABLED_REASON}
          </p>
          <Button variant="secondary" block disabled={isCartEmpty} onClick={openCancelDialog}>
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
    </div>
  );
}

