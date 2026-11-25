import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/errors";
import type { BackupEntry, PosDataSource } from "../api/types";
import {
  IconCheckCircle,
  IconDatabaseBackup,
  IconHardDrive,
  IconRefresh,
  IconShield,
  IconXCircle,
} from "../components/AdminIcons";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { StatusMessage, type StatusTone } from "../components/StatusMessage";

function formatBackupTime(ms: number | null): string {
  if (ms === null) return "Waktu tidak tercatat";
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? "Waktu tidak tercatat" : d.toLocaleString("id-ID");
}

export function BackupPage({
  dataSource,
  onSessionExpired,
}: {
  dataSource: PosDataSource;
  onSessionExpired: () => void;
}) {
  const [entries, setEntries] = useState<BackupEntry[]>([]);
  const [status, setStatus] = useState<{ tone: StatusTone; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirmEntry, setConfirmEntry] = useState<BackupEntry | null>(null);
  const [testedNames, setTestedNames] = useState<string[]>([]);
  const [lastRestorePath, setLastRestorePath] = useState<string | null>(null);
  const lock = useRef(false);
  const generation = useRef(0);

  function fail(error: unknown) {
    if (error instanceof ApiError && error.isSessionExpired) {
      onSessionExpired();
    } else {
      setStatus({
        tone: "danger",
        text: error instanceof Error ? error.message : "Operasi backup gagal.",
      });
    }
  }

  async function load() {
    const current = ++generation.current;
    const rows = await dataSource.listBackups();
    if (current === generation.current) setEntries(rows);
  }

  useEffect(() => {
    let active = true;
    const current = ++generation.current;
    setLoading(true);
    dataSource
      .listBackups()
      .then((rows) => {
        if (active && current === generation.current) setEntries(rows);
      })
      .catch((error) => {
        if (active && current === generation.current) fail(error);
      })
      .finally(() => {
        if (active && current === generation.current) setLoading(false);
      });
    return () => {
      active = false;
      generation.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, onSessionExpired]);

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setStatus(null);
    try {
      await action();
    } catch (error) {
      fail(error);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const latest = entries[0] ?? null;
  const validCount = entries.filter((e) => e.valid).length;
  const testedSet = new Set(testedNames);

  return (
    <section className="admin-page backup-page" aria-labelledby="backup-title" aria-busy={busy || loading}>
      <header className="admin-header">
        <div className="admin-header__titles">
          <h1 id="backup-title" className="admin-header__title">
            Cadangan Data
          </h1>
          <p className="admin-header__subtitle">
            Buat snapshot konsisten database SQLite lokal dan jalankan uji pemulihan pada lingkungan terisolasi.
          </p>
        </div>

        <div className="admin-header__actions">
          <Button
            type="button"
            variant="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await dataSource.createBackup();
                setStatus({
                  tone: result.valid ? "success" : "warning",
                  text: `Cadangan ${result.name} berhasil diverifikasi.`,
                });
                await load();
              })
            }
          >
            <IconDatabaseBackup size={18} />
            <span>{busy ? "Memproses…" : "Buat backup"}</span>
          </Button>
        </div>
      </header>

      {/* Peringatan Keamanan Operasional */}
      <div
        className="admin-card"
        style={{
          padding: "12px 16px",
          background: "var(--color-primary-soft)",
          borderColor: "rgba(38, 115, 73, 0.28)",
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}
      >
        <IconShield size={20} style={{ color: "var(--color-primary)" }} />
        <p style={{ margin: 0, fontSize: "13px", color: "var(--color-text)" }}>
          <strong>Perlindungan Database Aktif:</strong> Restore hanya membuat salinan uji untuk diperiksa; database operasional tidak dikembalikan atau ditimpa. Cadangan pada disk yang sama tidak menggantikan salinan media eksternal.
        </p>
      </div>

      {status && <StatusMessage tone={status.tone} text={status.text} />}

      {/* Empat Kartu Ringkasan Status Cadangan */}
      <div className="admin-kpi-grid">
        <div className="admin-kpi-card">
          <div className="admin-kpi-card__top">
            <span className="admin-kpi-card__label">Status cadangan terbaru</span>
            <span className="admin-kpi-card__icon">
              {latest ? (
                latest.valid ? (
                  <IconCheckCircle size={18} />
                ) : (
                  <IconXCircle size={18} />
                )
              ) : (
                <IconHardDrive size={18} />
              )}
            </span>
          </div>
          <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text)" }}>
            {!latest
              ? "Belum dibuat"
              : !latest.valid
                ? "Verifikasi gagal"
                : testedSet.has(latest.name)
                  ? "Uji pemulihan lulus"
                  : "Terverifikasi (belum diuji)"}
          </div>
          <p className="admin-kpi-card__meta">
            {!latest
              ? "Buat cadangan pertama sekarang"
              : latest.valid
                ? "Integritas SQLite terverifikasi saat pembuatan"
                : "Jangan gunakan file ini untuk pemulihan"}
          </p>
        </div>

        <div className="admin-kpi-card">
          <div className="admin-kpi-card__top">
            <span className="admin-kpi-card__label">Waktu cadangan terakhir</span>
          </div>
          <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text)" }}>
            {latest ? formatBackupTime(latest.createdAtMs) : "—"}
          </div>
          <p className="admin-kpi-card__meta">{latest ? latest.name : "Belum ada file cadangan"}</p>
        </div>

        <div className="admin-kpi-card">
          <div className="admin-kpi-card__top">
            <span className="admin-kpi-card__label">Jumlah cadangan</span>
          </div>
          <div className="admin-kpi-card__value">{entries.length}</div>
          <p className="admin-kpi-card__meta">{validCount} file lolos pemeriksaan integritas</p>
        </div>

        <div className="admin-kpi-card">
          <div className="admin-kpi-card__top">
            <span className="admin-kpi-card__label">Lokasi salinan uji</span>
          </div>
          <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text)", overflowWrap: "anywhere" }}>
            {lastRestorePath ?? "Direktori restore-test lokal"}
          </div>
          <p className="admin-kpi-card__meta">Terpisah dari file database operasional</p>
        </div>
      </div>

      {/* Tabel Riwayat Cadangan */}
      <div className="admin-card">
        <div className="admin-card__header">
          <div>
            <h2 className="admin-card__title">Riwayat Cadangan</h2>
            <p className="admin-card__desc">
              Daftar snapshot SQLite pada direktori backup yang dikonfigurasi di server lokal.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void run(load)}
          >
            <IconRefresh size={16} />
            <span>Muat ulang</span>
          </Button>
        </div>

        {entries.length === 0 ? (
          <div className="admin-empty">
            <span className="admin-empty__icon">
              <IconHardDrive size={24} />
            </span>
            <p className="admin-empty__title">Belum ada cadangan.</p>
            <p className="admin-empty__desc">
              Klik tombol Buat backup di kanan atas untuk membuat snapshot database SQLite pertama.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table" aria-label="Riwayat cadangan data">
              <thead>
                <tr>
                  <th scope="col">Tanggal / Waktu &amp; Nama File</th>
                  <th scope="col">Format</th>
                  <th scope="col">Status</th>
                  <th scope="col">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const isTested = testedSet.has(entry.name);
                  return (
                    <tr key={entry.name}>
                      <td>
                        <div className="cell-primary">{formatBackupTime(entry.createdAtMs)}</div>
                        <div className="cell-sub">
                          <code>
                            {entry.name} — {entry.valid ? "Terverifikasi" : "Verifikasi gagal"}
                          </code>
                        </div>
                      </td>
                      <td>SQLite (.sqlite)</td>
                      <td>
                        {entry.valid ? (
                          <span className="badge badge--ok">
                            <IconCheckCircle size={14} />
                            <span style={{ marginLeft: "4px" }}>
                              {isTested ? "Uji pemulihan berhasil" : "Terverifikasi"}
                            </span>
                          </span>
                        ) : (
                          <span className="badge badge--danger">
                            <IconXCircle size={14} />
                            <span style={{ marginLeft: "4px" }}>Verifikasi gagal</span>
                          </span>
                        )}
                      </td>
                      <td>
                        <Button
                          type="button"
                          variant="secondary"
                          style={{ minHeight: "34px", padding: "4px 12px", fontSize: "13px" }}
                          disabled={busy || !entry.valid}
                          onClick={() => setConfirmEntry(entry)}
                        >
                          Uji pemulihan
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmEntry && (
        <ConfirmDialog
          title="Jalankan uji pemulihan?"
          message={`Cadangan "${confirmEntry.name}" akan dipulihkan ke direktori salinan uji terpisah (restore-test) untuk memverifikasi kelayakan file. Database operasional aktif TIDAK akan ditimpa.`}
          confirmLabel="Ya, jalankan uji pemulihan"
          cancelLabel="Batal"
          onConfirm={() => {
            const target = confirmEntry;
            setConfirmEntry(null);
            void run(async () => {
              const result = await dataSource.restoreBackupTest(target.name);
              setLastRestorePath(result.destinationPath);
              setTestedNames((prev) => (prev.includes(target.name) ? prev : [...prev, target.name]));
              setStatus({
                tone: "success",
                text: `Salinan uji dibuat di ${result.destinationPath}. Database operasional tidak diubah.`,
              });
            });
          }}
          onCancel={() => setConfirmEntry(null)}
        />
      )}
    </section>
  );
}
