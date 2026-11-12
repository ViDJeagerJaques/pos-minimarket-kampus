import { useEffect, useState } from "react";
import type { PosDataSource, ProductSummary } from "../api/types";
import { MoneyText } from "../components/MoneyText";
import { StockBadge } from "../components/StockBadge";

/** Daftar barang read-only dari data DEMO. Kelola barang (CRUD) adalah TASK-010/TASK-012. */
export function ProductsPage({ dataSource }: { dataSource: PosDataSource }) {
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let isActive = true;
    dataSource
      .listProducts()
      .then((items) => {
        if (isActive) setProducts(items);
      })
      .catch(() => {
        if (isActive) setHasError(true);
      });
    return () => {
      isActive = false;
    };
  }, [dataSource]);

  return (
    <section className="panel" aria-labelledby="products-title">
      <h1 id="products-title" className="page-title">
        Barang/Stok <span className="chip chip--warning">DEMO · baca saja</span>
      </h1>
      {hasError && <p className="muted">Daftar barang gagal dimuat.</p>}
      {!hasError && products === null && <p className="muted">Memuat barang…</p>}
      {products !== null && products.length === 0 && (
        <p className="muted">Belum ada barang. Tambahkan barang melalui menu Admin.</p>
      )}
      {products !== null && products.length > 0 && (
        <div className="table-wrap">
          <table className="table" aria-label="Daftar barang">
            <thead>
              <tr>
                <th scope="col">Nama</th>
                <th scope="col">SKU</th>
                <th scope="col" className="num">
                  Harga
                </th>
                <th scope="col" className="num">
                  Stok
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td>{product.sku}</td>
                  <td className="num">
                    <MoneyText amountRp={product.priceRp} />
                  </td>
                  <td className="num">{product.stock}</td>
                  <td>
                    {product.active ? <StockBadge stock={product.stock} /> : <span className="badge">Nonaktif</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

