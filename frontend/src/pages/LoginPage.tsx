import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../api/errors";
import type { PosDataSource, SessionUser } from "../api/types";
import { Button } from "../components/Button";
import { IconStore, IconEye, IconEyeOff } from "../components/AdminIcons";
import { DemoBanner } from "../components/DemoBanner";

interface LoginPageProps {
  dataSource: PosDataSource;
  onLoggedIn: (user: SessionUser) => void;
  /** Pesan aman dari App, mis. sesi kedaluwarsa. Tidak memuat detail akun. */
  notice?: string | null;
}

/** Login lokal (AC-01.01/AC-01.02). Sukses hanya setelah respons API/backend. */
export function LoginPage({ dataSource, onLoggedIn, notice = null }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  // Ref menutup celah Enter ganda sebelum re-render menonaktifkan tombol.
  const submittingRef = useRef(false);
  const usernameId = useId();
  const passwordId = useId();
  const errorId = useId();

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || !username.trim() || !password) {
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await dataSource.login(username, password);
      if (result.ok) {
        setPassword("");
        onLoggedIn(result.user);
        return;
      }
      // Pesan generik: tidak membedakan akun tidak ada, nonaktif, atau sandi salah (AC-01.02).
      setError("Nama pengguna atau kata sandi salah, atau akun tidak dapat dipakai.");
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
      } else {
        setError("Login belum berhasil. Coba lagi.");
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <div className="login">
      <DemoBanner authMode={dataSource.authMode} />
      <main className="login__main">
        <div className="login__brand"><span className="login__store"><IconStore size={30} /></span><h1>POS Minimarket</h1><p>Sistem Kasir dan Inventaris Kampus</p></div>
      <form
        className="login__card panel"
        onSubmit={handleSubmit}
        aria-labelledby="login-title"
        aria-busy={isSubmitting}
        noValidate
      >
        <h2 id="login-title" className="login__title">Masuk ke akun</h2>
        <p className="login__description">Gunakan akun yang telah diberikan oleh pengelola.</p>
        {notice && (
          <p className="status status--warning" role="status" aria-live="polite">
            <strong className="status__label">Info:</strong> {notice}
          </p>
        )}
        <label htmlFor={usernameId} className="field-label">
          Nama pengguna
        </label>
        <div className="login__input-wrap"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><input
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
        /></div>
        <label htmlFor={passwordId} className="field-label">
          Kata sandi
        </label>
        <div className="login__input-wrap"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4m-4 4v2"/></svg><input
          id={passwordId}
          className="input"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          maxLength={1024}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-describedby={error ? errorId : undefined}
          required
        /><button className="login__toggle" type="button" aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <IconEyeOff /> : <IconEye />}</button></div>
        {error && (
          <p id={errorId} className="field-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" block disabled={isSubmitting || !username.trim() || !password}>
          {isSubmitting ? "Sedang masuk..." : "Masuk"}
        </Button>
        <div className="login__help">Belum memiliki akun atau lupa kata sandi? <strong>Hubungi administrator.</strong></div>
      </form>
      <p className="login__local">Sistem lokal - Mendukung mode offline</p>
      <footer>POS Minimarket Kampus</footer>
      </main>
    </div>
  );
}
