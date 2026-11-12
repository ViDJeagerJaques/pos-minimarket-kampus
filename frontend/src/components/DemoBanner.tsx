/** Penanda DEMO yang selalu terlihat (syarat TASK-007: mode mock wajib berlabel DEMO). */
export function DemoBanner() {
  return (
    <div className="demo-banner" role="note" aria-label="Mode DEMO">
      <strong>MODE DEMO</strong> — data sintetis, login tidak memverifikasi kata sandi, tidak ada transaksi,
      pembayaran, atau stok yang disimpan. Bukan untuk uang sungguhan.
    </div>
  );
}

