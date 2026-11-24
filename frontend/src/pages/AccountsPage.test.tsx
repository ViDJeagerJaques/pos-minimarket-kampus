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

function makeTestPassword(prefix = "pw"): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function fillCreateForm(user: ReturnType<typeof userEvent.setup>, password = makeTestPassword("kasir")) {
  await user.type(screen.getByLabelText("Nama pengguna"), "kasir.baru");
  await user.type(screen.getByLabelText("Kata sandi awal"), password);
  await user.click(screen.getByRole("button", { name: "Buat akun kasir" }));
  return password;
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
    const createdPassword = await fillCreateForm(user);

    const dialog = await screen.findByRole("dialog", { name: "Buat akun kasir?" });
    expect(dialog.textContent).toContain("kasir.baru");
    expect(dialog.textContent).not.toContain(createdPassword);
    expect(createAccount).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Ya, buat akun" }));

    await waitFor(() => {
      expect(createAccount).toHaveBeenCalledWith({
        username: "kasir.baru",
        password: createdPassword,
        role: "CASHIER",
      });
    });
    expect(await screen.findByText(/Akun kasir "kasir.baru" dibuat/)).toBeTruthy();
    expect((screen.getByLabelText("Kata sandi awal") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("dialog")).toBeNull();

    for (const spy of consoleSpies) {
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).not.toContain(createdPassword);
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

  it("respons daftar akun lama yang terlambat tidak menimpa akun yang baru dibuat", async () => {
    let resolveList!: (items: AccountSummary[]) => void;
    const listAccounts = vi.fn(
      () =>
        new Promise<AccountSummary[]>((resolve) => {
          resolveList = resolve;
        }),
    );
    const created: AccountSummary = { id: 9, username: "kasir.baru", role: "CASHIER", active: true };
    const createAccount = vi.fn(async () => created);
    const { user } = renderAccounts(makeSource({ listAccounts, createAccount }));

    // Buat akun saat listAccounts masih menggantung
    await fillCreateForm(user);
    await user.click(await screen.findByRole("button", { name: "Ya, buat akun" }));
    expect(await screen.findByText(/Akun kasir "kasir.baru" dibuat/)).toBeTruthy();

    // Respons listAccounts lama baru datang berisi hanya ADMIN_ACCOUNT
    resolveList([ADMIN_ACCOUNT]);
    const table = await screen.findByRole("table", { name: "Daftar akun" });
    await waitFor(() => {
      expect(within(table).getByText("admin.lokal")).toBeTruthy();
      expect(within(table).getByText("kasir.baru")).toBeTruthy();
    });
  });
});

it("BUG-207: lihat sandi, validasi konfirmasi dan ubah hanya sandi sendiri", async () => {
  const changePassword = vi.fn(async () => {});
  const { user, onSessionExpired } = renderAccounts(makeSource({ changePassword }));
  const old = makeTestPassword(); const next = makeTestPassword();
  await user.type(screen.getByLabelText("Sandi lama"), old);
  await user.type(screen.getByLabelText("Sandi baru"), next);
  await user.click(screen.getByRole("button", { name: "Lihat sandi baru" }));
  expect((screen.getByLabelText("Sandi baru") as HTMLInputElement).type).toBe("text");
  await user.click(screen.getByRole("button", { name: "Ubah sandi" }));
  expect(changePassword).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("Konfirmasi sandi baru"), next);
  await user.click(screen.getByRole("button", { name: "Ubah sandi" }));
  await waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
  expect(changePassword).toHaveBeenCalledWith({ oldPassword: old, newPassword: next });
  expect((screen.getByLabelText("Sandi baru") as HTMLInputElement).value).toBe("");
});

it("BUG-226: admin dapat mereset sandi kasir lewat dialog tanpa menampilkan sandi di pesan", async () => {
  const resetAccountPassword = vi.fn(async () => {});
  const { user } = renderAccounts(
    makeSource({
      authMode: "LOCAL_API",
      listAccounts: vi.fn(async () => [ADMIN_ACCOUNT, CASHIER_ACCOUNT]),
      resetAccountPassword,
    }),
  );
  const resetButton = await screen.findByRole("button", { name: "Ubah sandi kasir.uji" });
  await user.click(resetButton);

  const dialog = screen.getByRole("dialog");
  const next = makeTestPassword();
  await user.type(within(dialog).getByLabelText("Sandi baru"), next);
  await user.type(within(dialog).getByLabelText("Konfirmasi sandi baru"), next);
  await user.click(within(dialog).getByRole("button", { name: "Simpan sandi baru" }));

  await waitFor(() =>
    expect(resetAccountPassword).toHaveBeenCalledWith(2, { newPassword: next }),
  );
  const status = await screen.findByText(/Kata sandi akun "kasir\.uji" berhasil direset/);
  expect(status.textContent).not.toContain(next);
});

it("BUG-236: dialog reset sandi memindahkan fokus saat dibuka, menjebak Tab, dan mengembalikan fokus saat ditutup", async () => {
  const { user } = renderAccounts(
    makeSource({
      authMode: "LOCAL_API",
      listAccounts: vi.fn(async () => [ADMIN_ACCOUNT, CASHIER_ACCOUNT]),
    }),
  );
  const resetButton = await screen.findByRole("button", { name: "Ubah sandi kasir.uji" });
  await user.click(resetButton);

  const dialog = screen.getByRole("dialog");
  const newInput = within(dialog).getByLabelText("Sandi baru");
  const submitButton = within(dialog).getByRole("button", { name: "Simpan sandi baru" });
  expect(document.activeElement).toBe(newInput);

  await user.keyboard("{Shift>}{Tab}{/Shift}");
  expect(document.activeElement).toBe(submitButton);

  await user.keyboard("{Tab}");
  expect(document.activeElement).toBe(newInput);

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(resetButton);
});
