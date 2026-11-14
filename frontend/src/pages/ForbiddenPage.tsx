import { Button } from "../components/Button";

interface ForbiddenPageProps {
  attemptedLabel: string;
  roleLabel: string;
  onBack: () => void;
}

/**
 * Penjagaan navigasi UI. Ini BUKAN otorisasi: backend tetap menolak akses
 * langsung dengan 403 (DEC-014, AUTHORIZATION §1). Pesan dibuat jelas agar
 * kasir tidak mengira kegagalan render adalah sukses.
 */
export function ForbiddenPage({ attemptedLabel, roleLabel, onBack }: ForbiddenPageProps) {
  return (
    <section className="panel placeholder" aria-labelledby="forbidden-title">
      <h1 id="forbidden-title" className="page-title">
        Akses ditolak
      </h1>
      <p className="muted">
        Halaman <strong>{attemptedLabel}</strong> tidak tersedia untuk role <strong>{roleLabel}</strong>.
        Backend juga menolak permintaan langsung dengan status <strong>403</strong>; menyembunyikan menu
        saja tidak cukup.
      </p>
      <Button variant="primary" onClick={onBack}>
        Kembali ke halaman utama
      </Button>
    </section>
  );
}
