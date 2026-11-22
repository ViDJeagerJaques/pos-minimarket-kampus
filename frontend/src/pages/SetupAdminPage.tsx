import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../api/errors";
import type { PosDataSource } from "../api/types";
import { Button } from "../components/Button";
import { DemoBanner } from "../components/DemoBanner";

interface SetupAdminPageProps {
  dataSource: PosDataSource;
  onCompleted: (username: string) => void;
  onAlreadyExists: () => void;
}

const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 1024;

function validateSetup(username: string, password: string, confirmPassword: string): string | null {
  const trimmed = username.trim();
  if (trimmed.length < 3 || trimmed.length > 64) {
    return "Nama pengguna harus 3-64 karakter.";
  }
  if (!USERNAME_PATTERN.test(trimmed)) {
    return "Nama pengguna hanya boleh huruf, angka, titik, strip, dan garis bawah.";
  }
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return `Kata sandi harus ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} karakter.`;
  }
  if (password !== confirmPassword) {
    return "Konfirmasi kata sandi tidak cocok.";
  }
  return null;
}

/**
 * Layar setup pertama kali (BUG-151): hanya tampil ketika database belum
 * memiliki akun sama sekali. Backend menolak bootstrap kedua dengan 409.
 */
export function SetupAdminPage({ dataSource, onCompleted, onAlreadyExists }: SetupAdminPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const usernameId = useId();
  const passwordId = useId();
  const confirmId = useId();
  const errorId = useId();

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) {
      return;
    }
    const validationError = validateSetup(username, password, confirmPassword);
    if (validationError !== null) {
      setError(validationError);
      return;
    }
    if (typeof dataSource.bootstrapAdmin !== "function") {
      setError("Sumber data tidak mendukung setup admin pertama.");
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      const created = await dataSource.bootstrapAdmin({
        username: username.trim(),
        password,
      });
      setPassword("");
      setConfirmPassword("");
      onCompleted(created.username);
    } catch (caught) {
      try {
        if (dataSource.getBootstrapStatus && !(await dataSource.getBootstrapStatus()).needsSetup) {
          onAlreadyExists();
          return;
        }
      } catch { /* Status tidak pasti; tetap tampilkan kegagalan. */ }
      if (caught instanceof ApiError) {
        setError(caught.message);
      } else {
        setError("Pembuatan akun admin pertama gagal. Coba lagi.");
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <div className="login">
      <DemoBanner authMode={dataSource.authMode} />
      <form
        className="login__card panel"
        onSubmit={handleSubmit}
        aria-labelledby="setup-admin-title"
        aria-busy={isSubmitting}
        noValidate
      >
        <h1 id="setup-admin-title" className="login__title">
          Buat akun admin pertama
        </h1>
        <p className="muted">
          Instalasi baru belum memiliki akun. Buat akun ADMIN pertama untuk mengelola kasir,
          katalog, dan stok secara lokal.
        </p>
        <label htmlFor={usernameId} className="field-label">
          Nama pengguna
        </label>
        <input
          ref={usernameRef}
          id={usernameId}
          className="input"
          type="text"
          autoComplete="username"
          maxLength={64}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          aria-describedby={error ? errorId : undefined}
          required
        />
        <label htmlFor={passwordId} className="field-label">
          Kata sandi
        </label>
        <input
          id={passwordId}
          className="input"
          type="password"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-describedby={error ? errorId : undefined}
          required
        />
        <label htmlFor={confirmId} className="field-label">
          Ulangi kata sandi
        </label>
        <input
          id={confirmId}
          className="input"
          type="password"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          aria-describedby={error ? errorId : undefined}
          required
        />
        <p className="muted">
          Minimal {PASSWORD_MIN_LENGTH} karakter. Sandi hanya disimpan sebagai hash di database
          lokal.
        </p>
        {error && (
          <p id={errorId} className="field-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Menyimpan…" : "Buat akun admin"}
        </Button>
      </form>
    </div>
  );
}
