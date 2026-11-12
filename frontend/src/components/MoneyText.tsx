import { formatRupiah } from "../domain/money";

interface MoneyTextProps {
  amountRp: number | null;
  className?: string;
}

/** Rupiah dengan angka tabular; nilai tidak valid ditampilkan sebagai penanda, bukan Rp0. */
export function MoneyText({ amountRp, className }: MoneyTextProps) {
  const formatted = amountRp === null ? null : formatRupiah(amountRp);
  const classes = ["money", className ?? ""].filter(Boolean).join(" ");
  if (formatted === null) {
    return (
      <span className={`${classes} money--invalid`} title="Nominal tidak valid">
        Nominal tidak valid
      </span>
    );
  }
  return <span className={classes}>{formatted}</span>;
}

