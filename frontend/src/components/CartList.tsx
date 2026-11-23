import type { CartLine } from "../domain/cart";
import { lineTotalRp } from "../domain/cart";
import { Button } from "./Button";
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
    return <p className="cart__empty muted">Keranjang kosong. Scan barcode atau cari barang untuk mulai.</p>;
  }
  return (
    <div className="table-wrap">
      <table className="table" aria-label="Keranjang">
        <thead>
          <tr>
            <th scope="col">Barang</th>
            <th scope="col" className="num">
              Harga
            </th>
            <th scope="col" className="num">
              Qty
            </th>
            <th scope="col" className="num">
              Pot (%)
            </th>
            <th scope="col" className="num">
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
                <span className="cart__name">{line.name}</span>
                <span className="cart__sku muted">{line.sku}</span>
              </td>
              <td className="num">
                <MoneyText amountRp={line.unitPriceRp} />
              </td>
              <td className="num">
                <div className="qty">
                  <Button
                    className="btn--icon"
                    onClick={() => onDecrease(line.productId)}
                    disabled={disabled || line.quantity <= 1}
                    aria-label={`Kurangi ${line.name}`}
                  >
                    −
                  </Button>
                  <span className="qty__value" aria-label={`Jumlah ${line.name}`}>
                    {line.quantity}
                  </span>
                  <Button
                    className="btn--icon"
                    onClick={() => onIncrease(line.productId)}
                    disabled={disabled}
                    aria-label={`Tambah satu ${line.name}`}
                  >
                    +
                  </Button>
                </div>
              </td>
              <td className="num">
                {onDiscountChange ? (
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className="input input--compact"
                    style={{ width: "64px", textAlign: "right" }}
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
              <td className="num">
                <MoneyText amountRp={lineTotalRp(line)} />
              </td>
              <td>
                <Button variant="secondary" onClick={() => onRemove(line.productId)} disabled={disabled} aria-label={`Hapus ${line.name}`}>
                  Hapus
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

