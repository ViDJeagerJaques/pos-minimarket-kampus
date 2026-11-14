import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { ApiError } from "./api/errors";
import { createMockDataSource } from "./api/mockDataSource";
import type { LoginResult, PosDataSource } from "./api/types";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeSource(overrides: Partial<PosDataSource> = {}): PosDataSource {
  return { ...createMockDataSource({ latencyMs: 0 }), ...overrides };
}

function renderApp(source: PosDataSource) {
  const onAfterLogout = vi.fn();
  render(<App dataSource={source} onAfterLogout={onAfterLogout} />);
  return { onAfterLogout, user: userEvent.setup() };
}

async function loginAs(
  user: ReturnType<typeof userEvent.setup>,
  username: string,
  password = "demo-password",
) {
  await user.type(screen.getByLabelText("Nama pengguna"), username);
  await user.type(screen.getByLabelText("Kata sandi"), password);
  await user.click(screen.getByRole("button", { name: "Masuk" }));
}

describe("TASK-011 alur login/logout/401/403 di App", () => {
  it("Enter berulang saat login hanya mengirim satu permintaan", async () => {
    const deferred = createDeferred<LoginResult>();
    const login = vi.fn(() => deferred.promise);
    const { user } = renderApp(makeSource({ login }));

    await user.type(screen.getByLabelText("Nama pengguna"), "admin.demo");
    await user.type(screen.getByLabelText("Kata sandi"), "demo-password");
    const passwordInput = screen.getByLabelText("Kata sandi");
    passwordInput.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");

    expect(login).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve({
        ok: true,
        user: { userId: 1, username: "admin.demo", displayName: "Admin DEMO", role: "ADMIN" },
      });
    });
    expect(await screen.findByRole("navigation", { name: "Menu utama" })).toBeTruthy();
  });

  it("login yang gagal di API tidak membuka halaman sensitif", async () => {
    const { user } = renderApp(
      makeSource({
        login: vi.fn(async () => {
          throw new ApiError(429, "LOGIN_RATE_LIMITED", "Terlalu banyak percobaan login. Coba lagi nanti.", true);
        }),
      }),
    );

    await loginAs(user, "admin.demo");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Terlalu banyak percobaan login");
    expect(screen.queryByRole("navigation", { name: "Menu utama" })).toBeNull();
    expect(screen.getByRole("heading", { name: "POS Minimarket Kampus" })).toBeTruthy();
  });

  it("setelah logout, tombol Back/popstate tidak membuka halaman sensitif", async () => {
    const { user, onAfterLogout } = renderApp(makeSource());

    await loginAs(user, "admin.demo");
    await screen.findByRole("navigation", { name: "Menu utama" });
    await user.click(screen.getByRole("button", { name: "Akun" }));
    await screen.findByRole("heading", { name: /Akun/ });

    await user.click(screen.getByRole("button", { name: "Keluar" }));
    expect(onAfterLogout).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("heading", { name: "POS Minimarket Kampus" })).toBeTruthy();

    act(() => {
      window.history.back();
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(screen.queryByRole("navigation", { name: "Menu utama" })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Akun/ })).toBeNull();
    expect(screen.getByRole("heading", { name: "POS Minimarket Kampus" })).toBeTruthy();
  });

  it("401 saat memuat akun membersihkan sesi dan menampilkan alasan di login", async () => {
    const logout = vi.fn(async () => undefined);
    const { user } = renderApp(
      makeSource({
        logout,
        listAccounts: vi.fn(async () => {
          throw new ApiError(401, "AUTH_REQUIRED", "Sesi berakhir. Silakan masuk lagi.");
        }),
      }),
    );

    await loginAs(user, "admin.demo");
    await screen.findByRole("navigation", { name: "Menu utama" });
    await user.click(screen.getByRole("button", { name: "Akun" }));

    expect(await screen.findByRole("heading", { name: "POS Minimarket Kampus" })).toBeTruthy();
    expect(screen.getByText(/Sesi berakhir atau tidak lagi valid/)).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Menu utama" })).toBeNull();
    expect(logout).toHaveBeenCalled();
  });

  it("403 saat memuat akun tidak mengakhiri sesi ADMIN dan menampilkan pesan backend", async () => {
    const { user } = renderApp(
      makeSource({
        listAccounts: vi.fn(async () => {
          throw new ApiError(403, "FORBIDDEN", "Akses ditolak oleh backend (403). Halaman ini hanya untuk ADMIN.");
        }),
      }),
    );

    await loginAs(user, "admin.demo");
    await screen.findByRole("navigation", { name: "Menu utama" });
    await user.click(screen.getByRole("button", { name: "Akun" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("403");
    expect(screen.getByRole("navigation", { name: "Menu utama" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "POS Minimarket Kampus" })).toBeNull();
  });
});
