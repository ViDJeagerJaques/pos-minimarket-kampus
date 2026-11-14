import { ValidationError } from "./errors.ts";
import { assertPasswordInput } from "./password.ts";

const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export function assertUsername(value: unknown, field = "username"): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} harus berupa teks.`, field);
  }
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 64) {
    throw new ValidationError(`${field} harus 3-64 karakter.`, field);
  }
  if (!USERNAME_PATTERN.test(trimmed)) {
    throw new ValidationError(
      `${field} hanya boleh huruf, angka, titik, strip, dan garis bawah.`,
      field,
    );
  }
  return trimmed;
}

export function assertPassword(value: unknown, field = "password"): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} harus berupa teks.`, field);
  }
  try {
    assertPasswordInput(value);
  } catch (error) {
    throw new ValidationError(
      error instanceof Error ? error.message : "Kata sandi tidak valid.",
      field,
    );
  }
  return value;
}

export function assertRole(value: unknown, field = "role"): "ADMIN" | "CASHIER" {
  if (value !== "ADMIN" && value !== "CASHIER") {
    throw new ValidationError(`${field} harus ADMIN atau CASHIER.`, field);
  }
  return value;
}

export function assertId(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError(`${field} harus ID positif.`, field);
  }
  return value;
}
