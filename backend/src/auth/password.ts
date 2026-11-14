import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Hash sandi memakai `scrypt` bawaan Node (TECH_STACK.md §3 mengizinkan
 * Argon2id kandidat atau scrypt/bcrypt sesuai kompatibilitas). Pilihan ini
 * menghindari dependensi native tambahan dan tetap adaptif ber-salt.
 *
 * Format tersimpan: `scrypt$N$r$p$saltB64url$hashB64url`.
 * Hash milik seed DEMO (`DEMO_LOCKED_NO_LOGIN`) sengaja bukan format ini,
 * sehingga akun demo tidak pernah bisa login.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 1024;

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export const PASSWORD_HASH_PREFIX = "scrypt";

export function assertPasswordInput(password: unknown): asserts password is string {
  if (typeof password !== "string") {
    throw new Error("Kata sandi harus berupa teks.");
  }
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(
      `Kata sandi harus ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} karakter.`,
    );
  }
}

export function hashPassword(password: string): string {
  assertPasswordInput(password);
  const salt = randomBytes(SALT_LENGTH);
  const derived = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return [
    PASSWORD_HASH_PREFIX,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

/**
 * Verifikasi sandi. Hash dengan parameter/format lain ditolak (fail closed)
 * daripada diam-diam dianggap cocok.
 */
export function verifyPassword(password: string, stored: string): boolean {
  if (typeof password !== "string" || typeof stored !== "string") {
    return false;
  }
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PASSWORD_HASH_PREFIX) {
    return false;
  }
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (
    !Number.isSafeInteger(n) ||
    !Number.isSafeInteger(r) ||
    !Number.isSafeInteger(p) ||
    n !== SCRYPT_N ||
    r !== SCRYPT_R ||
    p !== SCRYPT_P
  ) {
    return false;
  }
  const salt = Buffer.from(parts[4] ?? "", "base64url");
  const expected = Buffer.from(parts[5] ?? "", "base64url");
  if (salt.length !== SALT_LENGTH || expected.length !== KEY_LENGTH) {
    return false;
  }
  let actual: Buffer;
  try {
    actual = scryptSync(password, salt, KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_MAXMEM,
    });
  } catch {
    return false;
  }
  return timingSafeEqual(actual, expected);
}

/**
 * Menghabiskan biaya komputasi serupa untuk username yang tidak ada agar
 * waktu respons tidak menjadi oracle keberadaan akun.
 */
export function spendUnknownUsernameCost(password: string): void {
  if (typeof password !== "string" || password.length === 0) {
    return;
  }
  scryptSync(
    password.slice(0, PASSWORD_MAX_LENGTH),
    randomBytes(SALT_LENGTH),
    KEY_LENGTH,
    { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM },
  );
}
