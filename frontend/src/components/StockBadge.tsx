/** Ambang DEMO untuk label "menipis"; ambang resmi menunggu DEC-018/TASK-003. */
export const DEMO_LOW_STOCK_THRESHOLD = 5;

export function StockBadge({ stock }: { stock: number }) {
  if (stock <= 0) {
    return <span className="badge badge--danger">Stok habis</span>;
  }
  if (stock <= DEMO_LOW_STOCK_THRESHOLD) {
    return <span className="badge badge--warning">Stok menipis</span>;
  }
  return <span className="badge badge--ok">Stok aman</span>;
}

