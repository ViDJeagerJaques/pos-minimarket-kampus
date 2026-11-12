import { useId, useState, type FormEvent } from "react";
import type { ProductSummary } from "../api/types";
import { Button } from "./Button";
import { MoneyText } from "./MoneyText";
import { StockBadge } from "./StockBadge";

type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "done"; results: ProductSummary[] };

interface ProductSearchProps {
  search: (query: string) => Promise<ProductSummary[]>;
  onAdd: (product: ProductSummary) => void;
}

/** Pencarian manual nama/SKU/barcode dengan state loading, kosong, dan gagal. */
export function ProductSearch({ search, onAdd }: ProductSearchProps) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const inputId = useId();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (query.trim().length === 0) {
      setState({ kind: "idle" });
      return;
    }
    setState({ kind: "loading" });
    try {
      const results = await search(query);
      setState({ kind: "done", results });
    } catch {
      setState({ kind: "error" });
    }
  }

  return (
    <section className="search" aria-label="Cari barang manual">
      <form className="search__form" onSubmit={handleSubmit} role="search" aria-label="Cari barang">
        <label htmlFor={inputId} className="field-label">
          Cari barang
        </label>
        <div className="search__row">
          <input
            id={inputId}
            className="input"
            type="search"
            autoComplete="off"
            maxLength={64}
            placeholder="Nama, SKU, atau barcode"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button type="submit" variant="secondary">
            Cari
          </Button>
        </div>
      </form>
      {state.kind === "loading" && <p className="muted">Mencari barang…</p>}
      {state.kind === "error" && <p className="muted">Pencarian gagal. Coba lagi.</p>}
      {state.kind === "done" && state.results.length === 0 && (
        <p className="muted">Barang tidak ditemukan. Periksa barcode atau cari nama barang.</p>
      )}
      {state.kind === "done" && state.results.length > 0 && (
        <ul className="search__results" aria-label="Hasil pencarian">
          {state.results.map((product) => (
            <li key={product.id} className="search__item">
              <span className="search__name">{product.name}</span>
              <MoneyText amountRp={product.priceRp} />
              <StockBadge stock={product.stock} />
              <Button
                variant="secondary"
                onClick={() => onAdd(product)}
                disabled={product.stock <= 0}
                aria-label={`Tambah ${product.name}`}
              >
                Tambah
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

