import { ForbiddenError, ValidationError } from "./errors.ts";
import type { Actor, Role } from "./types.ts";

const ALLOWED_ROLES: readonly Role[] = ["ADMIN", "CASHIER"];

/**
 * Guard bentuk actor. Integritas sesi (token, kedaluwarsa, status akun) adalah
 * tanggung jawab TASK-009; service katalog hanya menerima actor yang sudah
 * diverifikasi dan tetap memeriksa role untuk setiap operasi tulis.
 */
export function assertActor(value: unknown): Actor {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError("Konteks aktor wajib diisi dari sesi backend.", "actor");
  }
  const candidate = value as { userId?: unknown; role?: unknown };
  if (
    typeof candidate.userId !== "number" ||
    !Number.isSafeInteger(candidate.userId) ||
    candidate.userId <= 0
  ) {
    throw new ValidationError("userId aktor tidak valid.", "actor.userId");
  }
  if (typeof candidate.role !== "string" || !ALLOWED_ROLES.includes(candidate.role as Role)) {
    throw new ValidationError("role aktor tidak valid.", "actor.role");
  }
  return { userId: candidate.userId, role: candidate.role as Role };
}

/** Penulisan master hanya ADMIN (AUTHORIZATION.md §3). */
export function requireAdmin(actor: Actor): void {
  if (actor.role !== "ADMIN") {
    throw new ForbiddenError("Hanya ADMIN yang boleh mengubah master katalog.");
  }
}

/** CASHIER selalu dibatasi ke katalog aktif; hanya ADMIN yang boleh melihat nonaktif. */
export function canSeeInactive(actor: Actor, includeInactive: boolean | undefined): boolean {
  if (!includeInactive) {
    return false;
  }
  if (actor.role !== "ADMIN") {
    throw new ForbiddenError("CASHIER hanya boleh mengakses produk aktif.");
  }
  return true;
}