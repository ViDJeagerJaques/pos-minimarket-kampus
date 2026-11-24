import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ProductSummary } from "../api/types";
import { ProductSearch } from "./ProductSearch";

const PRODUCTS: ProductSummary[] = [
  {
    id: 1,
    sku: "SKU-001",
    name: "Air Mineral 600ml",
    priceRp: 4000,
    stock: 10,
    active: true,
  },
  {
    id: 2,
    sku: "SKU-002",
    name: "Air Kelapa 330ml",
    priceRp: 7000,
    stock: 5,
    active: true,
  },
];

describe("BUG-258, 261, 262, 264 ProductSearch dropdown melayang dan navigasi keyboard", () => {
  it("menampilkan combobox/listbox dengan aria-activedescendant, scrollIntoView, dan menutup setelah memilih atau Escape", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const onAdd = vi.fn();
    const search = vi.fn(async () => PRODUCTS);
    const user = userEvent.setup();
    render(
      <ProductSearch
        search={search}
        onAdd={onAdd}
      />,
    );

    const input = screen.getByRole("combobox", { name: "Cari barang" });
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
    await user.type(input, "Air{Enter}");

    const listbox = await screen.findByRole("listbox", { name: "Hasil pencarian" });
    const options = listbox.querySelectorAll('[role="option"]');
    expect(options.length).toBe(2);
    expect(options[0]?.id).toBeTruthy();
    expect(options[1]?.id).toBeTruthy();
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });

    scrollIntoView.mockClear();
    await user.keyboard("{ArrowDown}");
    expect(options[1]?.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]?.id);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });

    await user.keyboard("{ArrowUp}");
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]?.id);

    await user.keyboard("{ArrowDown}{Enter}");
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith(PRODUCTS[1]);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input.getAttribute("aria-activedescendant")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Cari" }));
    await screen.findByRole("listbox", { name: "Hasil pencarian" });
    await user.click(input);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
  });

  it("BUG-261: mengubah query saat pencarian masih berjalan membatalkan respons lama dan mereset state ke idle", async () => {
    let resolveSearch!: (items: ProductSummary[]) => void;
    const search = vi.fn(
      () =>
        new Promise<ProductSummary[]>((resolve) => {
          resolveSearch = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<ProductSearch search={search} onAdd={vi.fn()} />);

    const input = screen.getByRole("combobox", { name: "Cari barang" });
    await user.type(input, "Air{Enter}");
    expect(screen.getByText("Mencari barang…")).toBeTruthy();

    await user.type(input, "x");
    expect(screen.queryByText("Mencari barang…")).toBeNull();

    await act(async () => {
      resolveSearch(PRODUCTS);
    });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByText("Mencari barang…")).toBeNull();
  });
});
