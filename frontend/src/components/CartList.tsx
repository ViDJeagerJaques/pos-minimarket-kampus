import type { CartLine } from "../domain/cart";
import { lineTotalRp } from "../domain/cart";
import { IconMinus, IconPlus, IconShoppingCart, IconTrash } from "./AdminIcons";
import { MoneyText } from "./MoneyText";

interface CartListProps {
  lines: CartLine[];
  onIncrease: (productId: number) => void;
  onDecrease: (productId: number) => void;
  onRemove: (productId: number) => void;
  onDiscountChange?: (productId: number, discountPct: number) => void;
  /** Dinonaktifkan saat checkout berjalan agar draft tidak berubah setelah quote. */
  disabled?: boolean;
}

/** Tabel keranjang draft: nama, harga satuan, qty, pot %, subtotal, hapus. */
export function CartList({
  lines,
  onIncrease,
  onDecrease,
  onRemove,
  onDiscountChange,
  disabled = false,
}: CartListProps) {
  if (lines.length === 0) {
    return (
      <div className="cashier-cart-empty">
        <span className="cashier-cart-empty__icon" aria-hidden="true">
          <IconShoppingCart size={24} />
        </span>
        <p className="cashier-cart-empty__title">Keranjang kosong</p>
        <p className="cashier-cart-empty__hint">Scan barcode atau cari barang untuk mulai transaksi.</p>
      </div>
    );
  }
  return (
    <div className="cashier-cart-scroll">
      <table className="cashier-cart-table" aria-label="Keranjang">
        <thead>
          <tr>
            <th scope="col">Barang</th>
            <th scope="col" className="cashier-cart-table__num">
              Harga
            </th>
            <th scope="col" className="cashier-cart-table__num">
              Qty
            </th>
            <th scope="col" className="cashier-cart-table__num">
              Pot (%)
            </th>
            <th scope="col" className="cashier-cart-table__num">
              Subtotal
            </th>
            <th scope="col">
              <span className="visually-hidden">Aksi</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.productId}>
              <td>
                <div className="cashier-cart-table__product">{line.name}</div>
                <div className="cashier-cart-table__sku">{line.sku}</div>
              </td>
              <td className="cashier-cart-table__num">
                <MoneyText amountRp={line.unitPriceRp} />
              </td>
              <td className="cashier-cart-table__num">
                <div className="cashier-qty-ctrl">
                  <button
                    type="button"
                    className="cashier-qty-btn"
                    onClick={() => onDecrease(line.productId)}
                    disabled={disabled || line.quantity <= 1}
                    aria-label={`Kurangi ${line.name}`}
                  >
                    <IconMinus size={14} />
                  </button>
                  <span className="cashier-qty-val" aria-label={`Jumlah ${line.name}`}>
                    {line.quantity}
                  </span>
                  <button
                    type="button"
                    className="cashier-qty-btn"
                    onClick={() => onIncrease(line.productId)}
                    disabled={disabled}
                    aria-label={`Tambah satu ${line.name}`}
                  >
                    <IconPlus size={14} />
                  </button>
                </div>
              </td>
              <td className="cashier-cart-table__num">
                {onDiscountChange ? (
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className="input input--compact"
                    style={{ width: "62px", textAlign: "right" }}
                    value={line.discountPct ?? 0}
                    disabled={disabled}
                    aria-label={`Potongan persen ${line.name}`}
                    onChange={(event) => {
                      const parsed = Number.parseInt(event.target.value, 10);
                      onDiscountChange(line.productId, Number.isNaN(parsed) ? 0 : parsed);
                    }}
                  />
                ) : (
                  <span>{line.discountPct ?? 0}%</span>
                )}
              </td>
              <td className="cashier-cart-table__num">
                <MoneyText amountRp={lineTotalRp(line)} />
              </td>
              <td>
                <button
                  type="button"
                  className="cashier-icon-btn cashier-icon-btn--danger"
                  onClick={() => onRemove(line.productId)}
                  disabled={disabled}
                  aria-label={`Hapus ${line.name}`}
                  title={`Hapus ${line.name}`}
                >
                  <IconTrash size={15} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

