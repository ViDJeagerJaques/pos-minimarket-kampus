import type { ComponentPropsWithRef } from "react";

type Variant = "primary" | "secondary" | "destructive";

interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: Variant;
  block?: boolean;
}

/** Tombol standar DESIGN_SYSTEM §7: primary hijau, secondary putih, destructive merah. */
export function Button({ variant = "secondary", block = false, className, type, ...rest }: ButtonProps) {
  const classes = ["btn", `btn--${variant}`, block ? "btn--block" : "", className ?? ""].filter(Boolean).join(" ");
  return <button type={type ?? "button"} className={classes} {...rest} />;
}
