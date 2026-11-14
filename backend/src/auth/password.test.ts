import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertPasswordInput,
  hashPassword,
  verifyPassword,
} from "./password.ts";

test("hash scrypt memakai format terversi dan memverifikasi sandi yang benar", () => {
  const hash = hashPassword("rahasia-uji-123");
  assert.match(hash, /^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(verifyPassword("rahasia-uji-123", hash), true);
  assert.equal(verifyPassword("rahasia-salah", hash), false);
});

test("salt unik dan placeholder seed DEMO ditolak", () => {
  const first = hashPassword("sandi-sama-123");
  const second = hashPassword("sandi-sama-123");
  assert.notEqual(first, second);
  assert.equal(verifyPassword("sandi-sama-123", first), true);
  assert.equal(verifyPassword("sandi-sama-123", second), true);
  assert.equal(verifyPassword("sandi-sama-123", "DEMO_LOCKED_NO_LOGIN"), false);
});

test("hash rusak/parameter lain ditolak, bukan dianggap cocok", () => {
  const hash = hashPassword("sandi-valid-123");
  const parts = hash.split("$");
  const wrongN = [`scrypt`, "32768", parts[2], parts[3], parts[4], parts[5]].join("$");
  assert.equal(verifyPassword("sandi-valid-123", wrongN), false);
  const wrongSalt = [`scrypt`, parts[1], parts[2], parts[3], "AAAA", parts[5]].join("$");
  assert.equal(verifyPassword("sandi-valid-123", wrongSalt), false);
  assert.equal(verifyPassword("sandi-valid-123", `${hash}extra`), false);
});

test("validasi input sandi dilakukan sebelum hashing", () => {
  assert.throws(() => assertPasswordInput("pendek"), /8-1024/);
  assert.throws(() => assertPasswordInput("x".repeat(1025)), /8-1024/);
  assert.throws(() => assertPasswordInput(123 as unknown as string), /teks/);
});
