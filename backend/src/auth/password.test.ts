import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  assertPasswordInput,
  hashPassword,
  verifyPassword,
} from "./password.ts";

function makeRuntimePassword(): string {
  return `pw-${randomBytes(12).toString("hex")}`;
}

test("hash scrypt memakai format terversi dan memverifikasi sandi yang benar", () => {
  const password = makeRuntimePassword();
  const wrongPassword = makeRuntimePassword();
  const hash = hashPassword(password);
  assert.match(hash, /^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(verifyPassword(password, hash), true);
  assert.equal(verifyPassword(wrongPassword, hash), false);
});

test("salt unik dan placeholder seed DEMO ditolak", () => {
  const password = makeRuntimePassword();
  const first = hashPassword(password);
  const second = hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(verifyPassword(password, first), true);
  assert.equal(verifyPassword(password, second), true);
  assert.equal(verifyPassword(password, "DEMO_LOCKED_NO_LOGIN"), false);
});

test("hash rusak/parameter lain ditolak, bukan dianggap cocok", () => {
  const password = makeRuntimePassword();
  const hash = hashPassword(password);
  const parts = hash.split("$");
  const wrongN = [`scrypt`, "32768", parts[2], parts[3], parts[4], parts[5]].join("$");
  assert.equal(verifyPassword(password, wrongN), false);
  const wrongSalt = [`scrypt`, parts[1], parts[2], parts[3], "AAAA", parts[5]].join("$");
  assert.equal(verifyPassword(password, wrongSalt), false);
  assert.equal(verifyPassword(password, `${hash}extra`), false);
});

test("validasi input sandi dilakukan sebelum hashing", () => {
  assert.throws(() => assertPasswordInput(randomBytes(3).toString("hex")), /8-1024/);
  assert.throws(() => assertPasswordInput("x".repeat(1025)), /8-1024/);
  assert.throws(() => assertPasswordInput(123 as unknown as string), /teks/);
});
