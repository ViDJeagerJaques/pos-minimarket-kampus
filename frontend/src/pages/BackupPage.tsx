import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/errors";
import type { BackupEntry, PosDataSource } from "../api/types";
export function BackupPage({ dataSource, onSessionExpired }: { dataSource: PosDataSource; onSessionExpired: () => void }) {
  const [entries, setEntries] = useState<BackupEntry[]>([]); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false); const lock = useRef(false);
  function fail(error: unknown) { if (error instanceof ApiError && error.isSessionExpired) onSessionExpired(); else setMessage(error instanceof Error ? error.message : "Operasi backup gagal."); }
  async function load() { setEntries(await dataSource.listBackups()); }
  useEffect(() => { let active = true; dataSource.listBackups().then(rows => { if (active) setEntries(rows); }).catch(error => { if (active) fail(error); }); return () => { active = false; }; }, [dataSource, onSessionExpired]);
  async function run(action: () => Promise<void>) { if (lock.current) return; lock.current = true; setBusy(true); setMessage(""); try { await action(); } catch (error) { fail(error); } finally { lock.current = false; setBusy(false); } }
  return <section className="panel"><h1>Backup</h1><p>Restore hanya membuat salinan uji untuk diperiksa; database operasional tidak dikembalikan.</p>
    <button type="button" disabled={busy} onClick={() => void run(async () => { const result = await dataSource.createBackup(); setMessage(`Cadangan ${result.name} berhasil diverifikasi.`); await load(); })}>Buat backup</button>
    {message && <p role="status">{message}</p>}
    <h2>Riwayat backup</h2>{entries.length === 0 ? <p>Belum ada cadangan.</p> : <ul>{entries.map(entry => <li key={entry.name}>{entry.name} — {entry.valid ? "Terverifikasi" : "Verifikasi gagal"} <button type="button" disabled={busy || !entry.valid} onClick={() => void run(async () => { const result = await dataSource.restoreBackupTest(entry.name); setMessage(`Salinan uji dibuat di ${result.destinationPath}. Database operasional tidak diubah.`); })}>Restore salinan uji</button></li>)}</ul>}
  </section>;
}
