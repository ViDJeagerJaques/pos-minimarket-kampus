import { useId, useState, type ComponentPropsWithRef, type FormEvent } from "react";

interface BarcodeInputProps {
  ref?: ComponentPropsWithRef<"input">["ref"];
  onSubmitCode: (code: string) => void;
  disabled?: boolean;
}

/**
 * Input barcode untuk scanner keyboard-wedge (kode + Enter) atau ketik manual.
 * Enter HANYA mengirim barcode, tidak pernah memicu pembayaran (DESIGN_SYSTEM §5.2 #6).
 * Perilaku scanner fisik belum diuji (TASK-005); tidak ada debounce khusus.
 */
export function BarcodeInput({ ref, onSubmitCode, disabled = false }: BarcodeInputProps) {
  const [value, setValue] = useState("");
  const inputId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = value.trim();
    if (code.length === 0) {
      return;
    }
    onSubmitCode(code);
    setValue("");
  }

  return (
    <form className="barcode-form" onSubmit={handleSubmit} role="search" aria-label="Scan barcode">
      <label htmlFor={inputId} className="field-label">
        Scan barcode
      </label>
      <input
        ref={ref}
        id={inputId}
        className="input input--barcode"
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        maxLength={64}
        placeholder="Arahkan scanner atau ketik barcode lalu Enter"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={disabled}
      />
    </form>
  );
}

