import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import { createMockDataSource } from "../api/mockDataSource";
import type { AccountSummary, PosDataSource, SessionUser } from "../api/types";
import { AccountsPage } from "./AccountsPage";

const ADMIN: SessionUser = {
  userId: 1,
  username: "admin.lokal",
  displayName: "admin.lokal",
  role: "ADMIN",
};

const ADMIN_ACCOUNT: AccountSummary = { id: 1, username: "admin.lokal", role: "ADMIN", active: true };
const CASHIER_ACCOUNT: AccountSummary = { id: 2, username: "kasir.uji", role: "CASHIER", active: true };

function makeSource(overrides: Partial<PosDataSource> = {}): PosDataSource {
  return { ...createMockDataSource(), ...overrides };
}

function renderAccounts(source: PosDataSource, onSessionExpired = vi.fn()) {
  render(
    <AccountsPage dataSource={source} currentUser={ADMIN} onSessionExpired={onSessionExpired} />,
  );
  return { onSessionExpired, user: userEvent.setup() };
}

async function fillCreateForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Nama pengguna"), "kasir.baru");
  await user.type(screen.getByLabelText("Kata sandi awal"), "sandi-rahasia-uji");
  await user.click(screen.getByRole("button", { name: "Buat akun kasir" }));
}

describe("TASK-011 halaman pengelolaan akun ADMIN", () => {
  it("memuat daftar akun dari sumber data dan menandai akun nonaktif", async () => {
    const source = makeSource({
      listAccounts: vi.fn(async (): Promise<AccountSummary[]> => [
        ADMIN_ACCOUNT,
        CASHIER_ACCOUNT,
        { id: 3, username: "kasir.lama", role: "CASHIER", active: false },
      ]),
    });
    renderAccounts(source);

    const table = await screen.findByRole("table", { name: "Daftar akun" });
    expect(within(table).getByText("admin.lokal")).toBeTruthy();
    expect(within(table).getByText("kasir.uji")).toBeTruthy();
    expect(within(table).getByText("kasir.lama")).toBeTruthy();
    expect(within(table).getByText("Nonaktif")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nonaktifkan admin.lokal" })).toBeNull();
  });

  it("membuat akun hanya setelah konfirmasi dan tidak menampilkan kata sandi di dialog/log", async () => {
    const consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
    ];
    const created: AccountSummary = { id: 4, username: "kasir.baru", role: "CASHIER", active: true };
    const createAccount = vi.fn(async () => created);
    const source = makeSource({
      listAccounts: vi.fn(async () => [ADMIN_ACCOUNT]),
      createAccount,
    });
    const { user } = renderAccounts(source);

    await screen.findByRole("table", { name: "Daftar akun" });
    await fillCreateForm(user);

    const dialog = await screen.findByRole("dialog", { name: "Buat akun kasir?" });
    expect(dialog.textContent).toContain("kasir.baru");
    expect(dialog.textContent).not.toContain("sandi-rahasia-uji");
    expect(createAccount).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Ya, buat akun" }));

    await waitFor(() => {
      expect(createAccount).toHaveBeenCalledWith({
        username: "kasir.baru",
        password: "sandi-rahasia-uji",
        role: "CASHIER",
      });
    });
    expect(await screen.findByText(/Akun kasir "kasir.baru" dibuat/)).toBeTruthy();
    expect((screen.getByLabelText("Kata sandi awal") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("dialog")).toBeNull();

    for (const spy of consoleSpies) {
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).not.toContain("sandi-rahasia-uji");
    }
    consoleSpies.forEach((spy) => spy.mockRestore());
  });

  it("menonaktifkan kasir hanya setelah konfirmasi", async () => {
    const setAccountActive = vi.fn(async () => ({ ...CASHIER_ACCOUNT, active: false }));
    const source = makeSource({
      listAccounts: vi.fn(async () => [ADMIN_ACCOUNT, CASHIER_ACCOUNT]),
      setAccountActive,
    });
    const { user } = renderAccounts(source);

    await screen.findByRole("table", { name: "Daftar akun" });
    await user.click(screen.getByRole("button", { name: "Nonaktifkan kasir.uji" }));

    expect(await screen.findByRole("dialog", { name: "Nonaktifkan akun?" })).toBeTruthy();
    expect(setAccountActive).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Ya, nonaktifkan" }));

    await waitFor(() => {
      expect(setAccountActive).toHaveBeenCalledWith(2, false);
    });
    expect(await screen.findByText(/Akun "kasir.uji" dinonaktifkan/)).toBeTruthy();
    expect(screen.getByText("Nonaktif")).toBeTruthy();
  });

  it("klik konfirmasi ganda tidak mengirim dua permintaan pembuatan", async () => {
    let resolveCreate!: (account: AccountSummary) => void;
    const createAccount = vi.fn(
      () => new Promise<AccountSummary>((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const source = makeSource({
      listAccounts: vi.fn(async () => [ADMIN_ACCOUNT]),
      createAccount,
    });
    const { user } = renderAccounts(source);

    await screen.findByRole("table", { name: "Daftar akun" });
    await fillCreateForm(user);
    const confirm = await screen.findByRole("button", { name: "Ya, buat akun" });

    await user.dblClick(confirm);
    expect(createAccount).toHaveBeenCalledTimes(1);

    resolveCreate({ id: 5, username: "kasir.baru", role: "CASHIER", active: true });
    await screen.findByText(/Akun kasir "kasir.baru" dibuat/);
  });

  it("klik konfirmasi nonaktifkan ganda tidak mengirim dua PATCH", async () => {
    let resolveUpdate!: (account: AccountSummary) => void;
    const setAccountActive = vi.fn(
      () =>
        new Promise<AccountSummary>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const source = makeSource({
      listAccounts: vi.fn(async () => [ADMIN_ACCOUNT, CASHIER_ACCOUNT]),
      setAccountActive,
    });
    const { user } = renderAccounts(source);

    await screen.findByRole("table", { name: "Daftar akun" });
    await user.click(screen.getByRole("button", { name: "Nonaktifkan kasir.uji" }));
    const confirm = await screen.findByRole("button", { name: "Ya, nonaktifkan" });

    await user.dblClick(confirm);
    expect(setAccountActive).toHaveBeenCalledTimes(1);

    resolveUpdate({ ...CASHIER_ACCOUNT, active: false });
    await screen.findByText(/Akun "kasir.uji" dinonaktifkan/);
  });

  it("403 dari backend ditampilkan jelas tanpa mengakhiri sesi", async () => {
    const source = makeSource({
      listAccounts: vi.fn(async () => {
        throw new ApiError(403, "FORBIDDEN", "Akses ditolak oleh backend (403). Halaman ini hanya untuk ADMIN.");
      }),
    });
    const { onSessionExpired } = renderAccounts(source);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("403");
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("401 dari backend menyerahkan pembersihan sesi ke App", async () => {
    const source = makeSource({
      listAccounts: vi.fn(async () => {
        throw new ApiError(401, "AUTH_REQUIRED", "Sesi berakhir. Silakan masuk lagi.");
      }),
    });
    const { onSessionExpired } = renderAccounts(source);

    await waitFor(() => {
      expect(onSessionExpired).toHaveBeenCalledTimes(1);
    });
  });
});
