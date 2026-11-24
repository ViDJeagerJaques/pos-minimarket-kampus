import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../api/errors";
import type { AccountSummary, PosDataSource, Role, SessionUser } from "../api/types";
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
 * Pengelolaan akun ADMIN (TASK-011, AC-01.04).
 * Otorisasi sesungguhnya tetap di backend; halaman ini tidak boleh dianggap izin.
 * Form tidak pernah menampilkan/mencatat kata sandi di dialog, log, atau pesan error.
 */
export function AccountsPage({ dataSource, currentUser, onSessionExpired, selfServiceOnly = false }: AccountsPageProps) {
  const canManageAccounts = currentUser.role === "ADMIN" && !selfServiceOnly;
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
  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (passwordLock.current) return;
    if (!oldPassword || newPassword.length < 8 || newPassword.length > 1024 || newPassword !== confirmationPassword) {
      setStatus({ tone: "danger", text: "Isi sandi lama, sandi baru 8-1024 karakter, dan konfirmasi yang sama." }); return;
    }
    passwordLock.current = true; setChanging(true);
    try {
      await dataSource.changePassword({ oldPassword, newPassword });
      setOldPassword(""); setNewPassword(""); setConfirmationPassword(""); setVisible({});
      onSessionExpired();
    } catch (error) { handleActionError(error); }
    finally { passwordLock.current = false; setChanging(false); }
  }
  function visibility(key: string, label: string) {
    return <Button type="button" aria-label={`${visible[key] ? "Sembunyikan" : "Lihat"} ${label}`} aria-pressed={!!visible[key]} onClick={() => setVisible(previous => ({ ...previous, [key]: !previous[key] }))}><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{visible[key] && <path d="m3 3 18 18" />}</svg></Button>;
  }
  const [status, setStatus] = useState<Status | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const submitLockRef = useRef(false);
  // Kunci ref terpisah untuk PATCH status: dua klik cepat sebelum re-render
  // tidak boleh mengirim dua permintaan.
  const updateLockRef = useRef(false);
  const listRequestSeqRef = useRef(0);
  const listMutationSeqRef = useRef(0);
  const usernameId = useId();
  const passwordId = useId();
  const formErrorId = useId();

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
    if (submitLockRef.current) {
      return;
    }
    const validationMessage = validateCreateForm(username, password);
    if (validationMessage !== null) {
      setStatus({ tone: "danger", text: validationMessage });
      return;
    }
    // Konfirmasi dulu; kata sandi TIDAK dimasukkan ke dialog.
    setConfirmation({ kind: "create", username: username.trim(), role: "CASHIER" });
  }

  async function confirmCreate(target: CreateConfirmation): Promise<void> {
    if (submitLockRef.current) {
      return;
    }
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
    if (updateLockRef.current) {
      return;
    }
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
    if (confirmation === null) {
      return;
    }
    if (confirmation.kind === "create") {
      void confirmCreate(confirmation);
      return;
    }
    void confirmDisable(confirmation);
  }

  return (
    <section className="panel" aria-labelledby="accounts-title" aria-busy={isLoading}>
      <h1 id="accounts-title" className="page-title">
        {canManageAccounts ? (
          <>
            Akun <span className="chip chip--warning">ADMIN · API lokal</span>
          </>
        ) : (
          "Ganti Sandi"
        )}
      </h1>
      <p className="muted">
        {canManageAccounts ? (
          <>
            Masuk sebagai <strong>{currentUser.username}</strong>. Backend memeriksa role ADMIN pada
            setiap permintaan; CASHIER yang memanggil endpoint ini menerima <strong>403</strong>.
          </>
        ) : (
          <>
            Masuk sebagai <strong>{currentUser.username}</strong>. Anda hanya dapat mengubah kata
            sandi akun Anda sendiri.
          </>
        )}
      </p>
      {canManageAccounts && dataSource.authMode === "DEMO" && (
        <StatusMessage
          tone="warning"
          text="Mode DEMO hanya menampilkan akun sintetis. Pembuatan/penonaktifan akun memerlukan backend lokal."
        />
      )}

      {canManageAccounts && (
      <form className="account-form" onSubmit={handleSubmit} aria-label="Buat akun kasir" noValidate>
        <h2 className="section-title">Buat akun kasir</h2>
        <div className="form-grid">
          <div>
            <label htmlFor={usernameId} className="field-label">
              Nama pengguna
            </label>
            <input
              id={usernameId}
              className="input"
              type="text"
              autoComplete="off"
              maxLength={64}
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
            <input
              id={passwordId}
              className="input"
              type={visible.initial ? "text" : "password"}
              autoComplete="new-password"
              maxLength={1024}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isSubmitting}
              aria-describedby={formErrorId}
              required
            />
            {visibility("initial", "kata sandi awal")}
          </div>
        </div>
        <p id={formErrorId} className="muted">
          Minimal {PASSWORD_MIN_LENGTH} karakter. Kata sandi hanya dikirim ke backend lokal, tidak
          disimpan sebagai teks, dan tidak dicatat di log.
        </p>
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? "Menyimpan…" : "Buat akun kasir"}
        </Button>
      </form>
      )}

      <form className="account-form" aria-label="Ubah sandi sendiri" onSubmit={changePassword}>
        <h2>Ubah sandi akun sendiri</h2>
        <p>Sandi berhasil diubah akan mengakhiri semua sesi akun Anda. Masuk kembali dengan sandi baru.</p>
        {([
          ["old", "Sandi lama", oldPassword, setOldPassword],
          ["new", "Sandi baru", newPassword, setNewPassword],
          ["confirm", "Konfirmasi sandi baru", confirmationPassword, setConfirmationPassword],
        ] as const).map(([key, label, value, setter]) => <div key={key}>
          <label className="field-label" htmlFor={`password-${key}`}>{label}</label>
          <input id={`password-${key}`} className="input" type={visible[key] ? "text" : "password"} autoComplete={key === "old" ? "current-password" : "new-password"} value={value} onChange={event => setter(event.target.value)} maxLength={1024} disabled={changing} required />
          {visibility(key, label.toLowerCase())}
        </div>)}
        <Button type="submit" disabled={changing}>Ubah sandi</Button>
      </form>
      {status && <StatusMessage tone={status.tone} text={status.text} />}

      {canManageAccounts && (
      <>
      <h2 className="section-title">Daftar akun</h2>
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
      {!loadError && accounts === null && <p className="muted">Memuat akun…</p>}
      {!loadError && accounts !== null && accounts.length === 0 && (
        <p className="muted">Belum ada akun. Buat akun kasir melalui formulir di atas.</p>
      )}
      {!loadError && accounts !== null && accounts.length > 0 && (
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
              {accounts.map((account) => {
                const canDisable = account.role === "CASHIER" && account.active;
                const isUpdating = updatingId === account.id;
                return (
                  <tr key={account.id}>
                    <td>{account.username}</td>
                    <td>{ROLE_LABEL[account.role]}</td>
                    <td>
                      {account.active ? (
                        <span className="badge badge--ok">Aktif</span>
                      ) : (
                        <span className="badge">Nonaktif</span>
                      )}
                    </td>
                    <td>
                      {canDisable ? (
                        <Button
                          variant="destructive"
                          onClick={() => setConfirmation({ kind: "disable", account })}
                          disabled={updatingId !== null || isSubmitting}
                          aria-label={`Nonaktifkan ${account.username}`}
                        >
                          {isUpdating ? "Menyimpan…" : "Nonaktifkan"}
                        </Button>
                      ) : (
                        <span className="muted">{account.active ? "—" : "Akses ditolak saat login"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </>
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
          message={`Akun "${confirmation.account.username}" tidak dapat login lagi setelah dinonaktifkan. Sesi aktif akun tersebut akan dicabut oleh backend.`}
          confirmLabel="Ya, nonaktifkan"
          cancelLabel="Batal"
          destructive
          onConfirm={handleConfirm}
          onCancel={() => setConfirmation(null)}
        />
      )}
    </section>
  );
}
