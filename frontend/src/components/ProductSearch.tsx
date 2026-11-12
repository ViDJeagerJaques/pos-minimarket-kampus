import { useId, useRef, useState, type FormEvent } from "react";
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
  const searchSeqRef = useRef(0);
  const inputId = useId();

  function handleQueryChange(nextValue: string) {
    setQuery(nextValue);
    if (nextValue.trim().length === 0) {
      // Invalidasi pencarian tertunda saat input dikosongkan.
      searchSeqRef.current += 1;
      setState({ kind: "idle" });
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      searchSeqRef.current += 1;
      setState({ kind: "idle" });
      return;
    }
    const requestSeq = ++searchSeqRef.current;
    setState({ kind: "loading" });
    try {
      const results = await search(trimmed);
      if (requestSeq !== searchSeqRef.current) {
        return;
      }
      setState({ kind: "done", results });
    } catch {
      if (requestSeq !== searchSeqRef.current) {
        return;
      }
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
            onChange={(event) => handleQueryChange(event.target.value)}
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

