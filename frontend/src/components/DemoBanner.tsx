import type { AuthMode } from "../api/types";

/**
 * Penanda DEMO yang selalu terlihat (syarat TASK-007: mode mock wajib berlabel DEMO).
 * Saat autentikasi memakai backend lokal, jangan klaim bahwa login masih mock:
 * Hanya katalog yang masih sintetis. Mode API lokal dapat menyimpan transaksi
 * uji yang sudah COMMITTED di SQLite lokal. Bukan untuk uang sungguhan.
 */
export function DemoBanner({ authMode = "DEMO" }: { authMode?: AuthMode }) {
  const message =
    authMode === "LOCAL_API"
      ? "Autentikasi memakai backend lokal (offline). Katalog masih data sintetis; transaksi uji yang COMMITTED dapat tersimpan di SQLite lokal. Bukan untuk uang sungguhan."
      : "data sintetis, login tidak memverifikasi kata sandi, tidak ada transaksi, pembayaran, atau stok yang disimpan. Bukan untuk uang sungguhan.";
  return (
    <div className="demo-banner" role="note" aria-label="Mode DEMO">
      <strong>MODE DEMO</strong> — {message}
    </div>
  );
}
