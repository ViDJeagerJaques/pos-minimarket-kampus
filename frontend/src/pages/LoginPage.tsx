import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../api/errors";
import type { PosDataSource, SessionUser } from "../api/types";
import { Button } from "../components/Button";
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
    if (submittingRef.current) {
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
      <form
        className="login__card panel"
        onSubmit={handleSubmit}
        aria-labelledby="login-title"
        aria-busy={isSubmitting}
        noValidate
      >
        <h1 id="login-title" className="login__title">
          POS Minimarket Kampus
        </h1>
        <p className="muted">
          {dataSource.authMode === "LOCAL_API"
            ? "Masuk dengan akun lokal. Server hanya diakses melalui loopback (tanpa internet)."
            : "Masuk dengan akun DEMO di memori."}
        </p>
        {notice && (
          <p className="status status--warning" role="status" aria-live="polite">
            <strong className="status__label">Info:</strong> {notice}
          </p>
        )}
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
          autoComplete="current-password"
          maxLength={1024}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-describedby={error ? errorId : undefined}
          required
        />
        {error && (
          <p id={errorId} className="field-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" block disabled={isSubmitting}>
          {isSubmitting ? "Memeriksa…" : "Masuk"}
        </Button>
        {dataSource.authMode === "DEMO" ? (
          <div className="login__demo-hint">
            <strong>Akun DEMO (sintetis):</strong> <code>kasir.demo</code>, <code>kasir.demo2</code>,{" "}
            <code>admin.demo</code>. Kata sandi DEMO boleh apa saja asal terisi — <strong>bukan</strong> perilaku
            produksi.
          </div>
        ) : (
          <p className="login__demo-hint">
            Belum punya akun? ADMIN membuat akun melalui menu <strong>Akun</strong> setelah masuk. Akun kasir
            nonaktif tidak dapat login.
          </p>
        )}
      </form>
    </div>
  );
}
