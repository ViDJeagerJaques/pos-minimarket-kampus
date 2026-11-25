import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { ApiError } from "./api/errors";
import { createMockDataSource } from "./api/mockDataSource";
import type { LoginResult, PosDataSource } from "./api/types";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeSource(overrides: Partial<PosDataSource> = {}): PosDataSource {
  return { ...createMockDataSource({ latencyMs: 0 }), ...overrides };
}

function renderApp(source: PosDataSource) {
  const onAfterLogout = vi.fn();
  render(<App dataSource={source} onAfterLogout={onAfterLogout} />);
  return { onAfterLogout, user: userEvent.setup() };
}

function makeTestPassword(prefix = "pw"): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function loginAs(
  user: ReturnType<typeof userEvent.setup>,
  username: string,
  password = makeTestPassword("login"),
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
    await user.type(screen.getByLabelText("Kata sandi"), makeTestPassword("enter"));
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

  it("menekan Logout langsung menyembunyikan halaman terlindungi tanpa menunggu respons backend", async () => {
    const deferredLogout = createDeferred<void>();
    const logout = vi.fn(() => deferredLogout.promise);
    const { user, onAfterLogout } = renderApp(makeSource({ logout }));

    await loginAs(user, "admin.demo");
    await screen.findByRole("navigation", { name: "Menu utama" });
    await user.click(screen.getByRole("button", { name: "Akun" }));
    await screen.findByRole("heading", { name: /Akun/ });

    await user.click(screen.getByRole("button", { name: "Keluar" }));

    // Halaman terlindungi langsung hilang dan LoginPage tampil sebelum logout() resolve.
    expect(screen.queryByRole("navigation", { name: "Menu utama" })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Akun/ })).toBeNull();
    expect(screen.getByRole("heading", { name: "POS Minimarket Kampus" })).toBeTruthy();
    expect(logout).toHaveBeenCalledTimes(1);
    expect(onAfterLogout).not.toHaveBeenCalled();

    await act(async () => {
      deferredLogout.resolve(undefined);
    });
    expect(onAfterLogout).toHaveBeenCalledTimes(1);
  });

  it("respons 401 dari sesi lama tidak mengakhiri sesi pengguna yang baru masuk", async () => {
    const staleList = createDeferred<never>();
    let listCallCount = 0;
    const { user } = renderApp(
      makeSource({
        listAccounts: vi.fn(() => {
          listCallCount += 1;
          if (listCallCount === 1) {
            return staleList.promise;
          }
          return Promise.resolve([]);
        }),
      }),
    );

    // Sesi 1 masuk dan membuka halaman Akun (listAccounts menggantung)
    await loginAs(user, "admin.demo");
    await screen.findByRole("navigation", { name: "Menu utama" });
    await user.click(screen.getByRole("button", { name: "Akun" }));

    // Logout sebelum request lama selesai, lalu Sesi 2 login
    await user.click(screen.getByRole("button", { name: "Keluar" }));
    await loginAs(user, "admin.demo");
    await screen.findByRole("navigation", { name: "Menu utama" });

    // Request sesi 1 ditolak 401 -> sesi 2 harus tetap aktif
    await act(async () => {
      staleList.reject(new ApiError(401, "AUTH_REQUIRED", "Sesi berakhir. Silakan masuk lagi."));
      await Promise.resolve();
    });
    expect(screen.getByRole("navigation", { name: "Menu utama" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "POS Minimarket Kampus" })).toBeNull();
  });

  it("input password form login mendukung batas panjang 1024 karakter sesuai pembuatan akun & backend", () => {
    renderApp(makeSource());
    const passwordInput = screen.getByLabelText("Kata sandi") as HTMLInputElement;
    expect(passwordInput.maxLength).toBe(1024);
  });

  it("logout sesi A yang tertunda lalu selesai setelah sesi B login tidak memanggil onAfterLogout atau menghapus sesi B", async () => {
    const deferredLogoutA = createDeferred<void>();
    let logoutCalls = 0;
    const logout = vi.fn(() => {
      logoutCalls += 1;
      if (logoutCalls === 1) {
        return deferredLogoutA.promise;
      }
      return Promise.resolve();
    });
    const { user, onAfterLogout } = renderApp(makeSource({ logout }));

    // Sesi A login lalu menekan Keluar (request logout tertunda)
    await loginAs(user, "admin.demo");
    await screen.findByRole("navigation", { name: "Menu utama" });
    await user.click(screen.getByRole("button", { name: "Keluar" }));
    expect(screen.getByRole("heading", { name: "POS Minimarket Kampus" })).toBeTruthy();

    // Sesi B login sebelum logout sesi A selesai
    await loginAs(user, "kasir.demo");
    const navB = await screen.findByRole("navigation", { name: "Menu utama" });
    expect(navB).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kasir" })).toBeTruthy();

    // Logout sesi A selesai -> sesi B harus tetap aktif dan onAfterLogout tidak dipanggil
    await act(async () => {
      deferredLogoutA.resolve(undefined);
      await Promise.resolve();
    });

    expect(onAfterLogout).not.toHaveBeenCalled();
    expect(screen.getByRole("navigation", { name: "Menu utama" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kasir" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "POS Minimarket Kampus" })).toBeNull();
  });

  it("BUG-010: mutasi 401 dari sesi lama yang selesai setelah sesi baru login tidak memanggil logout atau menghapus sesi baru", async () => {
    const staleCreate = createDeferred<never>();
    const logout = vi.fn().mockResolvedValue(undefined);
    const { user } = renderApp(
      makeSource({
        listAccounts: vi.fn().mockResolvedValue([]),
        createAccount: vi.fn(() => staleCreate.promise),
        logout,
      }),
    );

    // Sesi 1 masuk, buka halaman Akun, lalu kirim createAccount yang tertunda
    await loginAs(user, "admin.demo");
    await screen.findByRole("navigation", { name: "Menu utama" });
    await user.click(screen.getByRole("button", { name: "Akun" }));
    await screen.findByRole("heading", { name: /Akun/ });

    await user.click(screen.getByRole("button", { name: "Tambah akun" }));
    await user.type(screen.getByLabelText("Nama pengguna"), "kasir.baru");
    await user.type(screen.getByLabelText("Kata sandi awal"), "sandi-uji-123");
    await user.click(screen.getByRole("button", { name: "Buat akun kasir" }));
    await user.click(screen.getByRole("button", { name: "Ya, buat akun" }));

    // Logout sebelum createAccount selesai (logout dipanggil 1x), lalu Sesi 2 login
    await user.click(screen.getByRole("button", { name: "Keluar" }));
    expect(logout).toHaveBeenCalledTimes(1);
    await loginAs(user, "kasir.demo");
    await screen.findByRole("navigation", { name: "Menu utama" });
    expect(screen.getByRole("button", { name: "Kasir" })).toBeTruthy();

    // Mutasi dari Sesi 1 ditolak 401 -> handleSessionExpired lama harus diabaikan
    await act(async () => {
      staleCreate.reject(new ApiError(401, "AUTH_REQUIRED", "Sesi berakhir. Silakan masuk lagi."));
      await Promise.resolve();
    });

    expect(logout).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("navigation", { name: "Menu utama" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kasir" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "POS Minimarket Kampus" })).toBeNull();
  });

  it("BUG-151: instalasi baru menampilkan setup admin pertama, membuat admin, lalu login berhasil", async () => {
    let setupDone = false;
    const bootstrapAdmin = vi.fn(async (input: { username: string; password: string }) => {
      setupDone = true;
      return { id: 1, username: input.username, role: "ADMIN" as const, active: true };
    });
    const getBootstrapStatus = vi.fn(async () => ({ needsSetup: !setupDone }));
    const { user } = renderApp(
      makeSource({
        authMode: "LOCAL_API",
        getBootstrapStatus,
        bootstrapAdmin,
        login: vi.fn(async (username: string, password: string) => {
          if (setupDone && username === "admin.baru" && password === "SandiAdmin123") {
            return {
              ok: true as const,
              user: { userId: 1, username: "admin.baru", displayName: "admin.baru", role: "ADMIN" as const },
            };
          }
          return { ok: false as const, code: "INVALID_CREDENTIALS" as const };
        }),
      }),
    );

    expect(await screen.findByRole("heading", { name: "Buat akun admin pertama" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "POS Minimarket Kampus" })).toBeNull();

    // Sandi pendek ditolak di klien tanpa memanggil backend
    await user.type(screen.getByLabelText("Nama pengguna"), "admin.baru");
    await user.type(screen.getByLabelText("Kata sandi"), "123");
    await user.type(screen.getByLabelText("Ulangi kata sandi"), "123");
    await user.click(screen.getByRole("button", { name: "Buat akun admin" }));
    expect(screen.getByRole("alert").textContent).toContain("8-1024 karakter");
    expect(bootstrapAdmin).not.toHaveBeenCalled();

    // Isi sandi valid dan buat admin pertama
    await user.clear(screen.getByLabelText("Kata sandi"));
    await user.clear(screen.getByLabelText("Ulangi kata sandi"));
    await user.type(screen.getByLabelText("Kata sandi"), "SandiAdmin123");
    await user.type(screen.getByLabelText("Ulangi kata sandi"), "SandiAdmin123");
    await user.click(screen.getByRole("button", { name: "Buat akun admin" }));

    expect(bootstrapAdmin).toHaveBeenCalledWith({
      username: "admin.baru",
      password: "SandiAdmin123",
    });
    expect(await screen.findByRole("heading", { name: "POS Minimarket Kampus" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain('Akun admin pertama "admin.baru" dibuat');

    // Login dengan admin baru berhasil membuka menu ADMIN
    await loginAs(user, "admin.baru", "SandiAdmin123");
    expect(await screen.findByRole("navigation", { name: "Menu utama" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Akun" })).toBeTruthy();
  });

  it("memulihkan pemeriksaan status yang gagal", async () => {
    const getBootstrapStatus = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ needsSetup: true });
    const { user } = renderApp(makeSource({ authMode: "LOCAL_API", getBootstrapStatus }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByRole("heading", { name: "Buat akun admin pertama" })).toBeTruthy();
  });

  it("menampilkan login ketika respons bootstrap hilang setelah akun tersimpan", async () => {
    const getBootstrapStatus = vi.fn().mockResolvedValueOnce({ needsSetup: true }).mockResolvedValue({ needsSetup: false });
    const bootstrapAdmin = vi.fn().mockRejectedValue(new Error("network"));
    const { user } = renderApp(makeSource({ authMode: "LOCAL_API", getBootstrapStatus, bootstrapAdmin }));
    await screen.findByRole("heading", { name: "Buat akun admin pertama" });
    await user.type(screen.getByLabelText("Nama pengguna"), "admin.baru");
    await user.type(screen.getByLabelText("Kata sandi"), "SandiAdmin123");
    await user.type(screen.getByLabelText("Ulangi kata sandi"), "SandiAdmin123");
    await user.click(screen.getByRole("button", { name: "Buat akun admin" }));
    expect(await screen.findByText(/Akun admin sudah ada/)).toBeTruthy();
  });

  it("BUG-151: database yang sudah memiliki user langsung membuka layar login tanpa setup admin", async () => {
    const getBootstrapStatus = vi.fn(async () => ({ needsSetup: false }));
    renderApp(makeSource({ authMode: "LOCAL_API", getBootstrapStatus }));

    expect(await screen.findByRole("heading", { name: "POS Minimarket Kampus" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Buat akun admin pertama" })).toBeNull();
  });
});
