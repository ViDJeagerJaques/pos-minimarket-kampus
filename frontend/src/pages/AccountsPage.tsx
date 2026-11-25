import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ApiError } from "../api/errors";
import type { AccountSummary, PosDataSource, Role, SessionUser } from "../api/types";
import {
  IconCheckCircle,
  IconEye,
  IconEyeOff,
  IconKey,
  IconPlus,
  IconSearch,
  IconShield,
  IconUsers,
  IconXCircle,
} from "../components/AdminIcons";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { StatusMessage, type StatusTone } from "../components/StatusMessage";

interface AccountsPageProps {
  dataSource: PosDataSource;
  currentUser: SessionUser;
  /** Dipanggil saat backend menjawab 401: App wajib membersihkan sesi dan kembali ke login. */
  onSessionExpired: () => void;
  selfServiceOnly?: boolean;
}

type AccountTab = "users" | "security";

type CreateConfirmation = {
  kind: "create";
  username: string;
  role: Role;
};

type DisableConfirmation = {
  kind: "disable";
  account: AccountSummary;
};

type Confirmation = CreateConfirmation | DisableConfirmation;

type Status = { tone: StatusTone; text: string };

const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const PASSWORD_MIN_LENGTH = 8;
const ROLE_LABEL: Record<Role, string> = { ADMIN: "Admin", CASHIER: "Kasir" };

function sortAccounts(accounts: AccountSummary[]): AccountSummary[] {
  return [...accounts].sort((left, right) =>
    left.username.localeCompare(right.username, "id", { sensitivity: "base" }),
  );
}

function validateCreateForm(username: string, password: string): string | null {
  const trimmed = username.trim();
  if (trimmed.length < 3 || trimmed.length > 64) {
    return "Nama pengguna harus 3-64 karakter.";
  }
  if (!USERNAME_PATTERN.test(trimmed)) {
    return "Nama pengguna hanya boleh huruf, angka, titik, strip, dan garis bawah.";
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Kata sandi minimal ${PASSWORD_MIN_LENGTH} karakter.`;
  }
  return null;
}

/**
 * Pengelolaan akun ADMIN (TASK-011, AC-01.04) & Ganti Sandi mandiri.
 * Otorisasi sesungguhnya tetap di backend; kata sandi tidak pernah ditampilkan di dialog/log.
 */
export function AccountsPage({
  dataSource,
  currentUser,
  onSessionExpired,
  selfServiceOnly = false,
}: AccountsPageProps) {
  const canManageAccounts = currentUser.role === "ADMIN" && !selfServiceOnly;
  const [activeTab, setActiveTab] = useState<AccountTab>("users");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmationPassword, setConfirmationPassword] = useState("");
  const [changing, setChanging] = useState(false);
  const passwordLock = useRef(false);

  const [resetTarget, setResetTarget] = useState<AccountSummary | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const resetLock = useRef(false);
  const resetDialogRef = useRef<HTMLFormElement>(null);
  const resetNewInputRef = useRef<HTMLInputElement>(null);
  const resetOpenerRef = useRef<HTMLElement | null>(null);
  const createUsernameInputRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<Status | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const submitLockRef = useRef(false);
  const updateLockRef = useRef(false);
  const listRequestSeqRef = useRef(0);
  const listMutationSeqRef = useRef(0);
  const usernameId = useId();
  const passwordId = useId();
  const formErrorId = useId();

  useEffect(() => {
    if (!resetTarget) return;
    resetNewInputRef.current?.focus();
    const opener = resetOpenerRef.current;
    return () => {
      opener?.focus();
    };
  }, [resetTarget]);

  function handleResetDialogKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeResetDialog();
      return;
    }
    if (event.key !== "Tab" || !resetDialogRef.current) return;
    const focusables = Array.from(
      resetDialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  function closeResetDialog() {
    if (resetting) return;
    setResetTarget(null);
    setResetPassword("");
    setResetConfirm("");
    setResetError(null);
    setVisible((previous) => ({ ...previous, resetNew: false, resetConfirm: false }));
  }

  async function submitResetPassword(event: FormEvent) {
    event.preventDefault();
    if (!resetTarget || resetLock.current) return;
    if (
      resetPassword.length < PASSWORD_MIN_LENGTH ||
      resetPassword.length > 1024 ||
      resetPassword !== resetConfirm
    ) {
      setResetError(`Isi sandi baru ${PASSWORD_MIN_LENGTH}-1024 karakter dan konfirmasi yang sama.`);
      return;
    }
    resetLock.current = true;
    setResetting(true);
    setResetError(null);
    try {
      await dataSource.resetAccountPassword(resetTarget.id, { newPassword: resetPassword });
      const targetUsername = resetTarget.username;
      setResetTarget(null);
      setResetPassword("");
      setResetConfirm("");
      setVisible((previous) => ({ ...previous, resetNew: false, resetConfirm: false }));
      setStatus({
        tone: "success",
        text: `Kata sandi akun "${targetUsername}" berhasil direset. Sesi aktif akun tersebut telah diakhiri.`,
      });
    } catch (error) {
      if (error instanceof ApiError && error.isSessionExpired) {
        setResetTarget(null);
        setResetPassword("");
        setResetConfirm("");
        onSessionExpired();
      } else {
        setResetError(error instanceof ApiError ? error.message : "Reset sandi gagal. Coba lagi.");
      }
    } finally {
      resetLock.current = false;
      setResetting(false);
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (passwordLock.current) return;
    if (
      !oldPassword ||
      newPassword.length < 8 ||
      newPassword.length > 1024 ||
      newPassword !== confirmationPassword
    ) {
      setStatus({
        tone: "danger",
        text: "Isi sandi lama, sandi baru 8-1024 karakter, dan konfirmasi yang sama.",
      });
      return;
    }
    passwordLock.current = true;
    setChanging(true);
    try {
      await dataSource.changePassword({ oldPassword, newPassword });
      setOldPassword("");
      setNewPassword("");
      setConfirmationPassword("");
      setVisible({});
      onSessionExpired();
    } catch (error) {
      handleActionError(error);
    } finally {
      passwordLock.current = false;
      setChanging(false);
    }
  }

  function renderEyeToggle(key: string, label: string) {
    const isShown = !!visible[key];
    return (
      <button
        type="button"
        className="input-with-icon__suffix-btn"
        aria-label={`${isShown ? "Sembunyikan" : "Lihat"} ${label}`}
        aria-pressed={isShown}
        onClick={() => setVisible((previous) => ({ ...previous, [key]: !previous[key] }))}
      >
        {isShown ? <IconEyeOff size={18} /> : <IconEye size={18} />}
      </button>
    );
  }

  useEffect(() => {
    if (!canManageAccounts) {
      setIsLoading(false);
      return;
    }
    let isActive = true;
    const seq = ++listRequestSeqRef.current;
    const mutationAtStart = listMutationSeqRef.current;
    setIsLoading(true);
    dataSource
      .listAccounts()
      .then((items) => {
        if (!isActive || seq !== listRequestSeqRef.current) return;
        if (listMutationSeqRef.current === mutationAtStart) {
          setAccounts(sortAccounts(items));
        } else {
          setAccounts((previous) => {
            if (previous === null) {
              return sortAccounts(items);
            }
            const merged = new Map<number, AccountSummary>();
            for (const item of items) {
              merged.set(item.id, item);
            }
            for (const localItem of previous) {
              merged.set(localItem.id, localItem);
            }
            return sortAccounts([...merged.values()]);
          });
        }
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (!isActive || seq !== listRequestSeqRef.current) return;
        if (error instanceof ApiError && error.isSessionExpired) {
          onSessionExpired();
          return;
        }
        setLoadError(error instanceof ApiError ? error.message : "Daftar akun gagal dimuat.");
      })
      .finally(() => {
        if (isActive && seq === listRequestSeqRef.current) setIsLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [canManageAccounts, dataSource, reloadKey, onSessionExpired]);

  function handleActionError(error: unknown): void {
    if (error instanceof ApiError && error.isSessionExpired) {
      onSessionExpired();
      return;
    }
    setStatus({
      tone: "danger",
      text: error instanceof ApiError ? error.message : "Tindakan gagal. Coba lagi.",
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLockRef.current) return;
    const validationMessage = validateCreateForm(username, password);
    if (validationMessage !== null) {
      setStatus({ tone: "danger", text: validationMessage });
      return;
    }
    setConfirmation({ kind: "create", username: username.trim(), role: "CASHIER" });
  }

  async function confirmCreate(target: CreateConfirmation): Promise<void> {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setIsSubmitting(true);
    try {
      const created = await dataSource.createAccount({
        username: target.username,
        password,
        role: target.role,
      });
      listMutationSeqRef.current += 1;
      setAccounts((previous) => sortAccounts([...(previous ?? []), created]));
      setUsername("");
      setPassword("");
      setVisible((previous) => ({ ...previous, initial: false }));
      setStatus({ tone: "success", text: `Akun kasir "${created.username}" dibuat dan aktif.` });
      setConfirmation(null);
    } catch (error) {
      setConfirmation(null);
      handleActionError(error);
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function confirmDisable(target: DisableConfirmation): Promise<void> {
    if (updateLockRef.current) return;
    updateLockRef.current = true;
    setUpdatingId(target.account.id);
    try {
      const updated = await dataSource.setAccountActive(target.account.id, false);
      listMutationSeqRef.current += 1;
      setAccounts((previous) =>
        previous === null
          ? previous
          : sortAccounts(previous.map((item) => (item.id === updated.id ? updated : item))),
      );
      setStatus({ tone: "success", text: `Akun "${updated.username}" dinonaktifkan.` });
      setConfirmation(null);
    } catch (error) {
      setConfirmation(null);
      handleActionError(error);
    } finally {
      updateLockRef.current = false;
      setUpdatingId(null);
    }
  }

  function handleConfirm(): void {
    if (confirmation === null) return;
    if (confirmation.kind === "create") {
      void confirmCreate(confirmation);
      return;
    }
    void confirmDisable(confirmation);
  }

  const totalAccounts = accounts?.length ?? 0;
  const activeAccounts = accounts?.filter((a) => a.active).length ?? 0;
  const inactiveAccounts = accounts?.filter((a) => !a.active).length ?? 0;

  const filteredAccounts =
    accounts?.filter((account) => {
      if (statusFilter === "active" && !account.active) return false;
      if (statusFilter === "inactive" && account.active) return false;
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return account.username.toLowerCase().includes(q);
    }) ?? null;

  const passwordMismatch =
    confirmationPassword.length > 0 && newPassword !== confirmationPassword;

  return (
    <section
      className={canManageAccounts ? "admin-page" : "panel"}
      aria-labelledby="accounts-title"
      aria-busy={isLoading}
    >
      <header className={canManageAccounts ? "admin-header" : undefined}>
        <div className={canManageAccounts ? "admin-header__titles" : undefined}>
          <h1 id="accounts-title" className={canManageAccounts ? "admin-header__title" : "page-title"}>
            {canManageAccounts ? "Akun" : "Ganti Sandi"}
          </h1>
          <p className={canManageAccounts ? "admin-header__subtitle" : "muted"}>
            {canManageAccounts ? (
              <>
                Kelola akun petugas kasir dan keamanan kata sandi administrator (<strong>{currentUser.username}</strong>).
              </>
            ) : (
              <>
                Masuk sebagai <strong>{currentUser.username}</strong>. Anda hanya dapat mengubah kata sandi akun Anda sendiri.
              </>
            )}
          </p>
        </div>

        {canManageAccounts && (
          <div className="admin-header__actions">
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                setActiveTab("users");
                setShowCreateForm((prev) => !prev);
                setTimeout(() => createUsernameInputRef.current?.focus(), 0);
              }}
            >
              <IconPlus size={18} />
              <span>Tambah akun</span>
            </Button>
          </div>
        )}
      </header>

      {canManageAccounts && dataSource.authMode === "DEMO" && (
        <StatusMessage
          tone="warning"
          text="Mode DEMO hanya menampilkan akun sintetis. Pembuatan/penonaktifan akun memerlukan backend lokal."
        />
      )}

      {status && <StatusMessage tone={status.tone} text={status.text} />}

      {canManageAccounts && (
        <div className="admin-tabs" role="tablist" aria-label="Submenu Akun">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "users"}
            className={activeTab === "users" ? "admin-tab admin-tab--active" : "admin-tab"}
            onClick={() => setActiveTab("users")}
          >
            <IconUsers size={18} />
            <span>Pengguna</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "security"}
            className={activeTab === "security" ? "admin-tab admin-tab--active" : "admin-tab"}
            onClick={() => setActiveTab("security")}
          >
            <IconShield size={18} />
            <span>Keamanan</span>
          </button>
        </div>
      )}

      {/* TAB PENGGUNA (ADMIN) */}
      {canManageAccounts && activeTab === "users" && (
        <>
          <div className="admin-kpi-grid admin-kpi-grid--3">
            <div className="admin-kpi-card">
              <div className="admin-kpi-card__top">
                <span className="admin-kpi-card__label">Total akun</span>
                <span className="admin-kpi-card__icon">
                  <IconUsers size={18} />
                </span>
              </div>
              <div className="admin-kpi-card__value">{totalAccounts}</div>
              <p className="admin-kpi-card__meta">Terdaftar pada aplikasi lokal</p>
            </div>

            <div className="admin-kpi-card">
              <div className="admin-kpi-card__top">
                <span className="admin-kpi-card__label">Akun aktif</span>
                <span className="admin-kpi-card__icon">
                  <IconCheckCircle size={18} />
                </span>
              </div>
              <div className="admin-kpi-card__value">{activeAccounts}</div>
              <p className="admin-kpi-card__meta">Dapat masuk ke sesi aplikasi</p>
            </div>

            <div className="admin-kpi-card">
              <div className="admin-kpi-card__top">
                <span className="admin-kpi-card__label">Akun nonaktif</span>
                <span className="admin-kpi-card__icon">
                  <IconXCircle size={18} />
                </span>
              </div>
              <div className="admin-kpi-card__value">{inactiveAccounts}</div>
              <p className="admin-kpi-card__meta">Login diblokir; riwayat tetap tersimpan</p>
            </div>
          </div>

          {showCreateForm && (
            <form className="admin-card" onSubmit={handleSubmit} aria-label="Buat akun kasir" noValidate>
              <div className="admin-card__header">
                <div>
                  <h2 className="admin-card__title">Buat Akun Kasir Baru</h2>
                  <p className="admin-card__desc">
                    Role akun baru dikunci sebagai Kasir sesuai kebijakan otorisasi sistem.
                  </p>
                </div>
              </div>

              <div className="form-grid">
                <div>
                  <label htmlFor={usernameId} className="field-label">
                    Nama pengguna
                  </label>
                  <input
                    ref={createUsernameInputRef}
                    id={usernameId}
                    className="input"
                    type="text"
                    autoComplete="off"
                    maxLength={64}
                    placeholder="Contoh: kasir.pagi"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    disabled={isSubmitting}
                    required
                  />
                </div>

                <div>
                  <label htmlFor={passwordId} className="field-label">
                    Kata sandi awal
                  </label>
                  <div className="input-with-icon">
                    <input
                      id={passwordId}
                      className="input input--pr"
                      type={visible.initial ? "text" : "password"}
                      autoComplete="new-password"
                      maxLength={1024}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      disabled={isSubmitting}
                      aria-describedby={formErrorId}
                      required
                    />
                    {renderEyeToggle("initial", "kata sandi awal")}
                  </div>
                </div>

                <div>
                  <label htmlFor="account-role-locked" className="field-label">
                    Role
                  </label>
                  <input
                    id="account-role-locked"
                    className="input"
                    type="text"
                    value="Kasir (CASHIER)"
                    disabled
                    readOnly
                  />
                </div>
              </div>

              <p id={formErrorId} className="field-hint" style={{ marginTop: "10px" }}>
                Nama pengguna 3–64 karakter (huruf, angka, titik, strip, garis bawah). Kata sandi minimal{" "}
                {PASSWORD_MIN_LENGTH} karakter (s.d. 1024 karakter) dan tidak dicatat di log.
              </p>

              <div className="dialog__actions" style={{ borderTop: "1px solid var(--color-border)", paddingTop: "12px" }}>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isSubmitting}
                  onClick={() => {
                    setShowCreateForm(false);
                    setUsername("");
                    setPassword("");
                  }}
                >
                  Tutup
                </Button>
                <Button type="submit" variant="primary" disabled={isSubmitting}>
                  <IconCheckCircle size={18} />
                  <span>{isSubmitting ? "Menyimpan…" : "Buat akun kasir"}</span>
                </Button>
              </div>
            </form>
          )}

          <div className="admin-card">
            <div className="admin-card__header">
              <div>
                <h2 className="admin-card__title">Daftar Pengguna</h2>
                <p className="admin-card__desc">Kelola akses masuk petugas pada PC kasir ini.</p>
              </div>
            </div>

            <div className="catalog-search" style={{ marginBottom: "16px" }}>
              <div className="catalog-search__field">
                <label htmlFor="account-search" className="field-label">
                  Cari username
                </label>
                <div className="input-with-icon">
                  <span className="input-with-icon__prefix">
                    <IconSearch size={16} />
                  </span>
                  <input
                    id="account-search"
                    type="search"
                    className="input input--pl"
                    placeholder="Ketik nama pengguna…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              <div className="catalog-search__filter">
                <label htmlFor="account-status-filter" className="field-label">
                  Status
                </label>
                <select
                  id="account-status-filter"
                  className="input"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "inactive")}
                >
                  <option value="all">Semua status</option>
                  <option value="active">Status: Aktif</option>
                  <option value="inactive">Status: Nonaktif</option>
                </select>
              </div>
            </div>

            {loadError && (
              <div className="account-load-error">
                <p className="field-error" role="alert">
                  {loadError}
                </p>
                <Button variant="secondary" onClick={() => setReloadKey((value) => value + 1)}>
                  Coba lagi
                </Button>
              </div>
            )}

            {!loadError && filteredAccounts === null && <p className="muted">Memuat akun…</p>}

            {!loadError && filteredAccounts !== null && filteredAccounts.length === 0 && (
              <div className="admin-empty">
                <span className="admin-empty__icon">
                  <IconUsers size={24} />
                </span>
                <p className="admin-empty__title">Tidak ada akun yang cocok</p>
                <p className="admin-empty__desc">
                  Ubah kata kunci pencarian atau klik Tambah akun untuk mendaftarkan kasir baru.
                </p>
              </div>
            )}

            {!loadError && filteredAccounts !== null && filteredAccounts.length > 0 && (
              <div className="table-wrap">
                <table className="table" aria-label="Daftar akun">
                  <thead>
                    <tr>
                      <th scope="col">Nama pengguna</th>
                      <th scope="col">Role</th>
                      <th scope="col">Status</th>
                      <th scope="col">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAccounts.map((account) => {
                      const isSelf = account.id === currentUser.userId;
                      const canDisable = account.role === "CASHIER" && account.active;
                      const isUpdating = updatingId === account.id;
                      return (
                        <tr key={account.id}>
                          <td>
                            <span className="cell-primary">{account.username}</span>
                            {isSelf && (
                              <span className="chip chip--local" style={{ marginLeft: "8px" }}>
                                Akun Anda
                              </span>
                            )}
                          </td>
                          <td>{ROLE_LABEL[account.role]}</td>
                          <td>
                            {account.active ? (
                              <span className="badge badge--ok">Aktif</span>
                            ) : (
                              <span className="badge">Nonaktif</span>
                            )}
                          </td>
                          <td>
                            <div className="table-actions">
                              {!isSelf && (
                                <Button
                                  variant="secondary"
                                  onClick={(event) => {
                                    resetOpenerRef.current = event.currentTarget;
                                    setResetTarget(account);
                                    setResetPassword("");
                                    setResetConfirm("");
                                    setResetError(null);
                                  }}
                                  disabled={updatingId !== null || isSubmitting || resetting}
                                  aria-label={`Ubah sandi ${account.username}`}
                                >
                                  <IconKey size={14} />
                                  <span>Reset sandi</span>
                                </Button>
                              )}
                              {canDisable ? (
                                <Button
                                  variant="destructive"
                                  onClick={() => setConfirmation({ kind: "disable", account })}
                                  disabled={updatingId !== null || isSubmitting || resetting}
                                  aria-label={`Nonaktifkan ${account.username}`}
                                >
                                  {isUpdating ? "Menyimpan…" : "Nonaktifkan"}
                                </Button>
                              ) : (
                                isSelf && <span className="muted">Kelola di tab Keamanan</span>
                              )}
                              {!account.active && <span className="muted">Akses ditolak saat login</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* TAB KEAMANAN / GANTI SANDI SENDIRI */}
      {(!canManageAccounts || activeTab === "security") && (
        <form
          className={canManageAccounts ? "admin-card" : "account-form"}
          style={canManageAccounts ? { maxWidth: "620px" } : undefined}
          aria-label="Ubah sandi sendiri"
          onSubmit={changePassword}
        >
          <div className="admin-card__header">
            <div>
              <h2 className="admin-card__title">Ubah Sandi Akun Sendiri</h2>
              <p className="admin-card__desc">
                Mengubah kata sandi akan mengakhiri seluruh sesi aktif akun Anda dan mengarahkan kembali ke halaman login.
              </p>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {(
              [
                ["old", "Sandi lama", oldPassword, setOldPassword],
                ["new", "Sandi baru", newPassword, setNewPassword],
                ["confirm", "Konfirmasi sandi baru", confirmationPassword, setConfirmationPassword],
              ] as const
            ).map(([key, label, value, setter]) => (
              <div key={key}>
                <label className="field-label" htmlFor={`password-${key}`}>
                  {label}
                </label>
                <div className="input-with-icon">
                  <input
                    id={`password-${key}`}
                    className="input input--pr"
                    type={visible[key] ? "text" : "password"}
                    autoComplete={key === "old" ? "current-password" : "new-password"}
                    value={value}
                    onChange={(event) => setter(event.target.value)}
                    maxLength={1024}
                    disabled={changing}
                    required
                  />
                  {renderEyeToggle(key, label.toLowerCase())}
                </div>
              </div>
            ))}

            <span className="field-hint">
              Ketentuan backend: minimal {PASSWORD_MIN_LENGTH} hingga 1024 karakter.
              {passwordMismatch ? " Konfirmasi sandi baru belum cocok." : ""}
              {!passwordMismatch && confirmationPassword.length >= PASSWORD_MIN_LENGTH
                ? " Konfirmasi sandi cocok."
                : ""}
            </span>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button type="submit" variant="primary" disabled={changing}>
                <IconKey size={18} />
                <span>{changing ? "Menyimpan…" : "Ubah sandi"}</span>
              </Button>
            </div>
          </div>
        </form>
      )}

      {confirmation?.kind === "create" && (
        <ConfirmDialog
          title="Buat akun kasir?"
          message={`Akun kasir "${confirmation.username}" akan dibuat dan langsung aktif. Kata sandi tidak ditampilkan di dialog ini.`}
          confirmLabel="Ya, buat akun"
          cancelLabel="Batal"
          onConfirm={handleConfirm}
          onCancel={() => setConfirmation(null)}
        />
      )}
      {confirmation?.kind === "disable" && (
        <ConfirmDialog
          title="Nonaktifkan akun?"
          message={`Akun "${confirmation.account.username}" tidak dapat login lagi setelah dinonaktifkan. Sesi aktif akun tersebut akan dicabut oleh backend. Riwayat transaksi tetap dipertahankan.`}
          confirmLabel="Ya, nonaktifkan"
          cancelLabel="Batal"
          destructive
          onConfirm={handleConfirm}
          onCancel={() => setConfirmation(null)}
        />
      )}
      {resetTarget && (
        <div className="dialog-backdrop">
          <form
            ref={resetDialogRef}
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-password-title"
            onSubmit={submitResetPassword}
            onKeyDown={handleResetDialogKeyDown}
            noValidate
          >
            <h2 id="reset-password-title" className="dialog__title">
              Reset sandi akun
            </h2>
            <p className="muted">
              Atur kata sandi baru untuk akun <strong>{resetTarget.username}</strong>. Semua sesi aktif akun tersebut akan diakhiri oleh backend.
            </p>
            <div style={{ marginBottom: "12px" }}>
              <label className="field-label" htmlFor="reset-password-new">
                Sandi baru
              </label>
              <div className="input-with-icon">
                <input
                  ref={resetNewInputRef}
                  id="reset-password-new"
                  className="input input--pr"
                  type={visible.resetNew ? "text" : "password"}
                  autoComplete="new-password"
                  maxLength={1024}
                  value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)}
                  disabled={resetting}
                  required
                />
                {renderEyeToggle("resetNew", "sandi baru reset")}
              </div>
            </div>
            <div>
              <label className="field-label" htmlFor="reset-password-confirm">
                Konfirmasi sandi baru
              </label>
              <div className="input-with-icon">
                <input
                  id="reset-password-confirm"
                  className="input input--pr"
                  type={visible.resetConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  maxLength={1024}
                  value={resetConfirm}
                  onChange={(event) => setResetConfirm(event.target.value)}
                  disabled={resetting}
                  required
                />
                {renderEyeToggle("resetConfirm", "konfirmasi sandi baru reset")}
              </div>
            </div>
            {resetError && (
              <p className="field-error" role="alert">
                {resetError}
              </p>
            )}
            <div className="dialog__actions">
              <Button type="button" variant="secondary" disabled={resetting} onClick={closeResetDialog}>
                Batal
              </Button>
              <Button type="submit" variant="primary" disabled={resetting}>
                {resetting ? "Menyimpan…" : "Simpan sandi baru"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
