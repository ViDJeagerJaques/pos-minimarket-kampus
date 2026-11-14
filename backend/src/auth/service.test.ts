import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  createTempDatabase,
  FIXED_NOW,
  migrateFresh,
} from "../../db/test/helpers.ts";
import { writeAuthAudit } from "./audit.ts";
import {
  AuthRequiredError,
  ConflictError,
  ForbiddenError,
  InvalidCredentialsError,
  NotFoundError,
  ValidationError,
} from "./errors.ts";
import { hashPassword } from "./password.ts";
import { createAuthService } from "./service.ts";
import { createSessionStore, type Role, type SessionUser } from "./session.ts";
import { createSecurityLogger } from "../security/securityLog.ts";

const ADMIN_PASSWORD = "rahasia.admin1";
const CASHIER_PASSWORD = "rahasia.kasir1";
const TEST_SECRET = Buffer.from("test-secret-0123456789abcdef0123456789");

type TestUser = {
  id: number;
  username: string;
  password?: string;
  hash?: string;
  role: Role;
  active?: number;
};

function insertUser(db: DatabaseSync, user: TestUser): void {
  const hash = user.hash ?? hashPassword(user.password ?? "tidak-dipakai");
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, active, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(user.id, user.username, hash, user.role, user.active ?? 1, FIXED_NOW);
}

function setup(options: { now?: () => number; ttlMs?: number; secret?: Buffer } = {}) {
  const database = createTempDatabase("pos-auth-test-");
  const db = database.open();
  migrateFresh(database);
  const now = options.now ?? (() => FIXED_NOW);
  const sessions = createSessionStore(db, {
    secret: options.secret ?? TEST_SECRET,
    ttlMs: options.ttlMs ?? 12 * 60 * 60 * 1000,
    now,
  });
  const securityLines: string[] = [];
  const securityLog = createSecurityLogger({
    sink: (line) => securityLines.push(line),
    now,
  });
  const auth = createAuthService(db, { sessions, securityLog, now });

  insertUser(db, { id: 1, username: "admin.uji", password: ADMIN_PASSWORD, role: "ADMIN" });
  insertUser(db, { id: 2, username: "kasir.uji", password: CASHIER_PASSWORD, role: "CASHIER" });
  insertUser(db, {
    id: 3,
    username: "kasir.nonaktif",
    password: CASHIER_PASSWORD,
    role: "CASHIER",
    active: 0,
  });
  insertUser(db, {
    id: 4,
    username: "demo.akun",
    hash: "DEMO_LOCKED_NO_LOGIN",
    role: "CASHIER",
  });

  const admin: SessionUser = { userId: 1, username: "admin.uji", role: "ADMIN" };
  const cashier: SessionUser = { userId: 2, username: "kasir.uji", role: "CASHIER" };
  return { database, db, auth, sessions, securityLines, admin, cashier };
}

function countRows(db: DatabaseSync, table: string): number {
  return Number(
    (db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total,
  );
}

function auditRows(db: DatabaseSync, action?: string) {
  const rows =
    action === undefined
      ? (db.prepare("SELECT * FROM audit_log ORDER BY id").all() as Array<Record<string, unknown>>)
      : (db.prepare("SELECT * FROM audit_log WHERE action = ? ORDER BY id").all(action) as Array<
          Record<string, unknown>
        >);
  return rows.map((row) => ({ ...row }));
}

test("AC-01.01/AC-01.02: login hanya untuk akun aktif dengan sandi benar; kegagalan generik", () => {
  const { database, db, auth, sessions } = setup();
  try {
    const success = auth.login({ username: "admin.uji", password: ADMIN_PASSWORD });
    assert.equal(success.user.role, "ADMIN");
    assert.equal(typeof success.token, "string");
    assert.ok(success.token.length > 20);
    assert.deepEqual(sessions.verify(success.token), {
      userId: 1,
      username: "admin.uji",
      role: "ADMIN",
    });

    const expectedMessage =
      "Nama pengguna atau kata sandi salah, atau akun tidak dapat dipakai.";
    const failures: string[] = [];
    for (const attempt of [
      { username: "admin.uji", password: "sandi-salah" },
      { username: "tidak.ada", password: ADMIN_PASSWORD },
      { username: "kasir.nonaktif", password: CASHIER_PASSWORD },
      { username: "demo.akun", password: "apapun" },
    ]) {
      assert.throws(
        () => auth.login(attempt),
        (error: unknown) =>
          error instanceof InvalidCredentialsError &&
          error.httpStatus === 401 &&
          error.message === expectedMessage,
        `login gagal harus generik untuk ${attempt.username}`,
      );
      try {
        auth.login(attempt);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    assert.equal(new Set(failures).size, 1, "semua pesan kegagalan login harus identik");

    assert.throws(
      () => auth.login({ username: 123 as unknown as string, password: ADMIN_PASSWORD }),
      (error: unknown) => error instanceof ValidationError && error.field === "username",
    );
    assert.throws(
      () => auth.login({ username: "admin.uji", password: 123 as unknown as string }),
      (error: unknown) => error instanceof ValidationError && error.field === "password",
    );
    assert.throws(
      () => auth.login({ username: "admin.uji", password: "pendek" }),
      (error: unknown) =>
        error instanceof InvalidCredentialsError && error.httpStatus === 401,
    );
    assert.equal(countRows(db, "sessions"), 1, "login gagal tidak boleh membuat sesi");
  } finally {
    db.close();
    database.cleanup();
  }
});

test("Logout mencabut sesi; token lama tidak dipakai lagi; kedaluwarsa dan restart", () => {
  const { database, db, auth, sessions } = setup();
  try {
    const login = auth.login({ username: "kasir.uji", password: CASHIER_PASSWORD });
    const actor = sessions.verify(login.token);
    assert.ok(actor);
    assert.deepEqual(auth.logout(actor, login.token), { loggedOut: true });
    assert.equal(sessions.verify(login.token), null);
    assert.throws(
      () => auth.logout(actor, login.token),
      (error: unknown) => error instanceof AuthRequiredError && error.httpStatus === 401,
    );

    // Restart proses = secret baru; digest token lama tidak lagi cocok.
    const restarted = createSessionStore(db, {
      secret: Buffer.from("secret-lain-0123456789abcdef0123456789"),
      ttlMs: 12 * 60 * 60 * 1000,
    });
    assert.equal(restarted.verify(login.token), null);
    const restartedAuth = createAuthService(db, {
      sessions: restarted,
      securityLog: createSecurityLogger(),
    });
    const relogin = restartedAuth.login({ username: "kasir.uji", password: CASHIER_PASSWORD });
    assert.ok(restarted.verify(relogin.token));
  } finally {
    db.close();
    database.cleanup();
  }
});

test("Sesi kedaluwarsa tidak diverifikasi", () => {
  let current = FIXED_NOW;
  const { database, db, auth, sessions } = setup({
    now: () => current,
    ttlMs: 1000,
  });
  try {
    const login = auth.login({ username: "kasir.uji", password: CASHIER_PASSWORD });
    assert.ok(sessions.verify(login.token));
    current += 1001;
    assert.equal(sessions.verify(login.token), null);
    assert.equal(auth.resolveToken(login.token), null);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("AC-01.03/AC-01.04: ADMIN mengelola akun; CASHIER ditolak tanpa perubahan data", () => {
  const { database, db, auth, sessions, admin, cashier } = setup();
  try {
    const before = countRows(db, "users");
    const auditBefore = countRows(db, "audit_log");

    assert.throws(
      () =>
        auth.createUser(cashier, {
          username: "kasir.hendak.dibuat",
          password: "sandi.kuat.123",
          role: "CASHIER",
        }),
      (error: unknown) => error instanceof ForbiddenError && error.httpStatus === 403,
    );
    assert.throws(
      () => auth.listUsers(cashier),
      (error: unknown) => error instanceof ForbiddenError && error.httpStatus === 403,
    );
    assert.throws(
      () => auth.updateUser(cashier, 2, { active: false }),
      (error: unknown) => error instanceof ForbiddenError && error.httpStatus === 403,
    );
    assert.equal(countRows(db, "users"), before);
    assert.equal(countRows(db, "audit_log"), auditBefore);

    const created = auth.createUser(admin, {
      username: "kasir.baru",
      password: "sandi.baru123",
      role: "CASHIER",
    });
    assert.deepEqual({ ...created }, { id: 5, username: "kasir.baru", role: "CASHIER", active: true });
    const audit = auditRows(db, "ACCOUNT_CREATED");
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.entity_type, "users");
    assert.equal(audit[0]?.entity_id, "5");
    assert.equal(audit[0]?.actor_id, 1);
    const details = JSON.parse(String(audit[0]?.details)) as Record<string, unknown>;
    assert.equal(details.username, "kasir.baru");
    assert.equal(details.role, "CASHIER");

    assert.throws(
      () =>
        auth.createUser(admin, {
          username: "KASIR.BARU",
          password: "sandi.lain123",
          role: "CASHIER",
        }),
      (error: unknown) => error instanceof ConflictError && error.httpStatus === 409,
    );
    assert.throws(
      () =>
        auth.createUser(admin, {
          username: "kasir.baru2",
          password: "lemah",
          role: "CASHIER",
        }),
      (error: unknown) => error instanceof ValidationError && error.field === "password",
    );
    assert.throws(
      () =>
        auth.createUser(admin, {
          username: "kasir.baru3",
          password: "sandi.panjang123",
          role: "SUPERVISOR" as Role,
        }),
      (error: unknown) => error instanceof ValidationError && error.field === "role",
    );

    const cashierLogin = auth.login({ username: "kasir.baru", password: "sandi.baru123" });
    const disabled = auth.updateUser(admin, created.id, { active: false });
    assert.equal(disabled.active, false);
    assert.equal(sessions.verify(cashierLogin.token), null, "sesi akun nonaktif dicabut");
    assert.equal(auditRows(db, "ACCOUNT_DISABLED").length, 1);

    const reenabled = auth.updateUser(admin, created.id, { active: true });
    assert.equal(reenabled.active, true);
    assert.equal(auditRows(db, "ACCOUNT_ENABLED").length, 1);

    const admin2 = auth.createUser(admin, {
      username: "admin.dua",
      password: "sandi.admin2",
      role: "ADMIN",
    });
    const admin2Login = auth.login({ username: "admin.dua", password: "sandi.admin2" });
    const demoted = auth.updateUser(admin, admin2.id, { role: "CASHIER" });
    assert.equal(demoted.role, "CASHIER");
    assert.equal(sessions.verify(admin2Login.token), null, "sesi target ROLE_CHANGED dicabut");
    assert.equal(auditRows(db, "ROLE_CHANGED").length, 1);

    // Admin terakhir tidak boleh dinonaktifkan/diturunkan.
    assert.throws(
      () => auth.updateUser(admin, 1, { active: false }),
      (error: unknown) => error instanceof ConflictError && error.httpStatus === 409,
    );
    assert.throws(
      () => auth.updateUser(admin, 1, { role: "CASHIER" }),
      (error: unknown) => error instanceof ConflictError && error.httpStatus === 409,
    );

    assert.throws(
      () => auth.updateUser(admin, 9999, { active: false }),
      (error: unknown) => error instanceof NotFoundError && error.httpStatus === 404,
    );

    const list = auth.listUsers(admin);
    assert.equal(list.length, countRows(db, "users"));
    for (const user of list) {
      assert.deepEqual(Object.keys(user).sort(), ["active", "id", "role", "username"]);
    }
  } finally {
    db.close();
    database.cleanup();
  }
});

test("Audit dan log keamanan tidak memuat sandi, token, atau hash", () => {
  const { database, db, auth, securityLines } = setup();
  try {
    const password = "sandi-rahasia-uji-123";
    auth.createUser({ userId: 1, username: "admin.uji", role: "ADMIN" }, {
      username: "kasir.rahasia",
      password,
      role: "CASHIER",
    });
    try {
      auth.login({ username: "kasir.rahasia", password: "sandi-yang-salah" });
    } catch {
      // Diharapkan gagal.
    }
    const login = auth.login({ username: "kasir.rahasia", password });
    const actor = auth.resolveToken(login.token);
    assert.ok(actor);
    auth.logout(actor, login.token);

    const auditBlob = JSON.stringify(auditRows(db));
    const securityBlob = securityLines.join("\n");
    for (const secret of [password, login.token, "scrypt$", "password_hash"]) {
      assert.equal(auditBlob.includes(secret), false, `audit memuat ${secret}`);
      assert.equal(securityBlob.includes(secret), false, `security log memuat ${secret}`);
    }
    for (const row of auditRows(db)) {
      const details = String(row.details);
      assert.equal(details.includes("password"), false);
      assert.equal(details.includes("token"), false);
      assert.equal(details.includes("hash"), false);
    }
    assert.ok(securityLines.some((line) => line.includes("LOGIN_FAILED")));
    assert.ok(securityLines.some((line) => line.includes("LOGOUT")));
  } finally {
    db.close();
    database.cleanup();
  }
});

test("Audit akun gagal di-write membatalkan pembuatan akun (atomisitas)", () => {
  const { database, db } = setup();
  try {
    const before = countRows(db, "users");
    const service = createAuthService(db, {
      sessions: createSessionStore(db, { secret: TEST_SECRET, ttlMs: 1000 }),
      securityLog: createSecurityLogger(),
      now: () => -1,
    });
    assert.throws(
      () =>
        service.createUser({ userId: 1, username: "admin.uji", role: "ADMIN" }, {
          username: "kasir.gagal.audit",
          password: "sandi.panjang123",
          role: "CASHIER",
        }),
      /CHECK constraint failed|NOT NULL constraint failed/,
    );
    assert.equal(countRows(db, "users"), before);
    assert.equal(countRows(db, "audit_log"), 0);
  } finally {
    db.close();
    database.cleanup();
  }
});

test("Whitelist audit akun menolak event di luar daftar", () => {
  const { database, db } = setup();
  try {
    assert.throws(
      () =>
        writeAuthAudit(db, {
          actorId: 1,
          action: "DELETE_ALL" as never,
          entityType: "users",
          entityId: 1,
          details: {},
          nowMs: FIXED_NOW,
        }),
      /Event audit akun tidak terdaftar/,
    );
  } finally {
    db.close();
    database.cleanup();
  }
});
