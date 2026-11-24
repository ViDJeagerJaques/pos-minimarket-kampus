import { render, screen } from "@testing-library/react";
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

describe("BUG-258 ProductSearch dropdown melayang dan navigasi keyboard", () => {
  it("menampilkan dropdown listbox, mendukung ArrowDown/ArrowUp/Enter/Escape, dan menutup setelah memilih", async () => {
    const onAdd = vi.fn();
    const search = vi.fn(async () => PRODUCTS);
    const user = userEvent.setup();
    render(
      <ProductSearch
        search={search}
        onAdd={onAdd}
      />,
    );

    const input = screen.getByRole("searchbox", { name: "Cari barang" });
    await user.type(input, "Air{Enter}");

    const listbox = await screen.findByRole("listbox", { name: "Hasil pencarian" });
    const options = listbox.querySelectorAll('[role="option"]');
    expect(options.length).toBe(2);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");

    await user.keyboard("{ArrowDown}");
    expect(options[1]?.getAttribute("aria-selected")).toBe("true");

    await user.keyboard("{ArrowUp}");
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");

    await user.keyboard("{ArrowDown}{Enter}");
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith(PRODUCTS[1]);
    expect(screen.queryByRole("listbox")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Cari" }));
    await screen.findByRole("listbox", { name: "Hasil pencarian" });
    await user.click(input);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
