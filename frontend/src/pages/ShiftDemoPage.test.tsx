import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ShiftDemoPage } from "./ShiftDemoPage";

describe("TASK-023 simulasi pratinjau terisolasi", () => {
  it("memisahkan fixture CASH dan QRIS dan menghitung selisih tanpa QRIS", async () => {
    render(<ShiftDemoPage />);
    const user = userEvent.setup();
    const table = screen.getByRole("table", { name: "Ringkasan simulasi" });
    expect(within(table).getByRole("row", { name: /CASH/ }).textContent).toContain("Rp500.000");
    expect(within(table).getByRole("row", { name: /QRIS/ }).textContent).toContain("Rp300.000");
    expect(within(table).getByRole("row", { name: /Perkiraan uang tunai/ }).textContent).toContain("Rp600.000");
    await user.type(screen.getByLabelText("Uang dihitung untuk simulasi (Rp)"), "590000");
    expect(screen.getByText(/Selisih simulasi/).textContent).toContain("-Rp10.000");
    expect(screen.getByRole("note").textContent).toContain("tidak membaca atau menutup shift sebenarnya");
  });

  it("memerlukan nominal valid dan konfirmasi eksplisit untuk simulasi", async () => {
    render(<ShiftDemoPage />);
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Lanjutkan simulasi" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const input = screen.getByLabelText("Uang dihitung untuk simulasi (Rp)");
    await user.type(input, "-1");
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(button.disabled).toBe(true);
    await user.clear(input);
    await user.type(input, "600000");
    await user.click(button);
    expect(screen.queryByRole("status")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Selesaikan simulasi" }));
    expect(screen.getByRole("status").textContent).toContain("Tidak ada shift sebenarnya yang ditutup");
  });
});
