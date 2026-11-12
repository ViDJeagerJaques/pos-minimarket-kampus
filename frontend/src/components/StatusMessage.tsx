export type StatusTone = "info" | "success" | "warning" | "danger";

const TONE_LABEL: Record<StatusTone, string> = {
  info: "Info",
  success: "Berhasil",
  warning: "Perhatian",
  danger: "Gagal",
};

interface StatusMessageProps {
  tone: StatusTone;
  text: string;
}

/** Status stabil (bukan toast) dengan label teks; tidak hanya mengandalkan warna. */
export function StatusMessage({ tone, text }: StatusMessageProps) {
  return (
    <p className={`status status--${tone}`} role="status" aria-live="polite">
      <strong className="status__label">{TONE_LABEL[tone]}:</strong> {text}
    </p>
  );
}

