interface PlaceholderPageProps {
  title: string;
  reason: string;
}

/** Halaman yang belum dibangun. Tidak menampilkan angka atau status palsu. */
export function PlaceholderPage({ title, reason }: PlaceholderPageProps) {
  return (
    <section className="panel placeholder" aria-labelledby="placeholder-title">
      <h1 id="placeholder-title" className="page-title">
        {title}
      </h1>
      <p className="muted">Belum tersedia di DEMO. {reason}</p>
    </section>
  );
}

