import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ProductSummary } from "../api/types";
import { IconPlus, IconSearch } from "./AdminIcons";
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
  disabled?: boolean;
}

export function ProductSearch({ search, onAdd, disabled = false }: ProductSearchProps) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchSeqRef = useRef(0);
  const containerRef = useRef<HTMLElement>(null);
  const inputId = useId();
  const listboxId = useId();

  const activeOptionId =
    isOpen &&
    state.kind === "done" &&
    activeIndex >= 0 &&
    activeIndex < state.results.length
      ? `${listboxId}-opt-${state.results[activeIndex]!.id}`
      : undefined;

  useEffect(() => {
    if (!activeOptionId) return;
    const el = document.getElementById(activeOptionId);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [activeOptionId]);

  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, []);

  function selectProduct(product: ProductSummary) {
    if (disabled || product.stock <= 0) return;
    onAdd(product);
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function handleQueryChange(nextValue: string) {
    searchSeqRef.current += 1;
    setQuery(nextValue);
    setState({ kind: "idle" });
    setIsOpen(false);
    setActiveIndex(-1);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      searchSeqRef.current += 1;
      setState({ kind: "idle" });
      setIsOpen(false);
      setActiveIndex(-1);
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
      setIsOpen(results.length > 0);
      setActiveIndex(results.length > 0 ? 0 : -1);
    } catch {
      if (requestSeq !== searchSeqRef.current) {
        return;
      }
      setState({ kind: "error" });
      setIsOpen(false);
      setActiveIndex(-1);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen || state.kind !== "done" || state.results.length === 0) {
      if (event.key === "Escape" && isOpen) {
        event.preventDefault();
        setIsOpen(false);
        setActiveIndex(-1);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => (prev + 1) % state.results.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? state.results.length - 1 : prev - 1));
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      const target = state.results[activeIndex];
      if (target) {
        selectProduct(target);
      }
    }
  }

  return (
    <section ref={containerRef} className="search cashier-input-group" aria-label="Cari barang manual">
      <form className="cashier-input-group" onSubmit={handleSubmit} role="search" aria-label="Cari barang">
        <label htmlFor={inputId} className="cashier-input-group__label">
          Cari barang
        </label>
        <div className="cashier-input-row">
          <div className="cashier-input-icon-wrap">
            <span className="cashier-input-icon-wrap__icon" aria-hidden="true">
              <IconSearch size={16} />
            </span>
            <input
              id={inputId}
              className="input"
              type="search"
              autoComplete="off"
              maxLength={64}
              placeholder="Nama, SKU, atau barcode"
              value={query}
              onChange={(event) => handleQueryChange(event.target.value)}
              onKeyDown={handleKeyDown}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={isOpen}
              aria-controls={isOpen ? listboxId : undefined}
              aria-activedescendant={activeOptionId}
              disabled={disabled}
            />
          </div>
          <Button type="submit" variant="secondary" disabled={disabled}>
            Cari
          </Button>
        </div>
      </form>
      {state.kind === "loading" && <p className="muted">Mencari barang…</p>}
      {state.kind === "error" && <p className="muted">Pencarian gagal. Coba lagi.</p>}
      {state.kind === "done" && state.results.length === 0 && (
        <p className="muted">Barang tidak ditemukan. Periksa barcode atau cari nama barang.</p>
      )}
      {isOpen && state.kind === "done" && state.results.length > 0 && (
        <ul id={listboxId} className="search__results" role="listbox" aria-label="Hasil pencarian">
          {state.results.map((product, index) => (
            <li
              key={product.id}
              id={`${listboxId}-opt-${product.id}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`search__item${index === activeIndex ? " search__item--active" : ""}`}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <span className="search__name">{product.name}</span>
              <MoneyText amountRp={product.priceRp} />
              <StockBadge stock={product.stock} />
              <Button
                variant="secondary"
                onClick={() => selectProduct(product)}
                disabled={disabled || product.stock <= 0}
                aria-label={`Tambah ${product.name}`}
              >
                <IconPlus size={14} /> Tambah
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
