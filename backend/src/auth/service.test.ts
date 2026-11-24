import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { REPO_ROOT } from "../../db/src/paths.ts";
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
import { bootstrapFirstAdmin } from "./bootstrap.ts";
import { createAuthService } from "./service.ts";
import { createSessionStore, type Role, type SessionUser } from "./session.ts";
import { createSecurityLogger } from "../security/securityLog.ts";

function makeRuntimePassword(prefix = "pw"): string {
  return `${prefix}-${randomBytes(12).toString("hex")}`;
}

function makeRuntimeSecret(): Buffer {
  return randomBytes(32);
}

const ADMIN_PASSWORD = makeRuntimePassword("admin");
const CASHIER_PASSWORD = makeRuntimePassword("cashier");
const TEST_SECRET = makeRuntimeSecret();

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
      { username: "admin.uji", password: makeRuntimePassword("wrong") },
      { username: "tidak.ada", password: ADMIN_PASSWORD },
      { username: "kasir.nonaktif", password: CASHIER_PASSWORD },
      { username: "demo.akun", password: makeRuntimePassword("any") },
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
      secret: makeRuntimeSecret(),
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
          password: makeRuntimePassword("denied"),
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

    const newCashierPassword = makeRuntimePassword("new-cashier");
    const created = auth.createUser(admin, {
      username: "kasir.baru",
      password: newCashierPassword,
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
          password: makeRuntimePassword("dup"),
          role: "CASHIER",
        }),
      (error: unknown) => error instanceof ConflictError && error.httpStatus === 409,
    );
    assert.throws(
      () =>
        auth.createUser(admin, {
          username: "kasir.baru2",
          password: randomBytes(2).toString("hex"),
          role: "CASHIER",
        }),
      (error: unknown) => error instanceof ValidationError && error.field === "password",
    );
    assert.throws(
      () =>
        auth.createUser(admin, {
          username: "kasir.baru3",
          password: makeRuntimePassword("role"),
          role: "SUPERVISOR" as Role,
        }),
      (error: unknown) => error instanceof ValidationError && error.field === "role",
    );

    const cashierLogin = auth.login({ username: "kasir.baru", password: newCashierPassword });
    const disabled = auth.updateUser(admin, created.id, { active: false });
    assert.equal(disabled.active, false);
    assert.equal(sessions.verify(cashierLogin.token), null, "sesi akun nonaktif dicabut");
    assert.equal(auditRows(db, "ACCOUNT_DISABLED").length, 1);

    const reenabled = auth.updateUser(admin, created.id, { active: true });
    assert.equal(reenabled.active, true);
    assert.equal(auditRows(db, "ACCOUNT_ENABLED").length, 1);

    const admin2Password = makeRuntimePassword("admin2");
    const admin2 = auth.createUser(admin, {
      username: "admin.dua",
      password: admin2Password,
      role: "ADMIN",
    });
    const admin2Login = auth.login({ username: "admin.dua", password: admin2Password });
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
    const password = makeRuntimePassword("secret-log");
    auth.createUser({ userId: 1, username: "admin.uji", role: "ADMIN" }, {
      username: "kasir.rahasia",
      password,
      role: "CASHIER",
    });
    try {
      auth.login({ username: "kasir.rahasia", password: makeRuntimePassword("wrong-log") });
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
    let nowCalls = 0;
    const service = createAuthService(db, {
      sessions: createSessionStore(db, { secret: TEST_SECRET, ttlMs: 1000 }),
      securityLog: createSecurityLogger(),
      now: () => {
        nowCalls += 1;
        return nowCalls === 1 ? FIXED_NOW : -1;
      },
    });
    assert.throws(
      () =>
        service.createUser({ userId: 1, username: "admin.uji", role: "ADMIN" }, {
          username: "kasir.gagal.audit",
          password: makeRuntimePassword("rollback"),
          role: "CASHIER",
        }),
      /CHECK constraint failed|NOT NULL constraint failed/,
    );
    assert.equal(nowCalls, 2, "INSERT users harus memakai panggilan clock ke-1 dan audit ke-2");
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

function runBootstrapProcess(
  dbPath: string,
  username: string,
  password: string,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const cliPath = path.join(REPO_ROOT, "backend", "src", "auth", "cli.ts");
    const child = spawn(
      process.execPath,
      [cliPath, "bootstrap-admin", "--username", username, "--db", dbPath, "--json"],
      {
        env: { ...process.env, POS_BOOTSTRAP_PASSWORD: password },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      resolve({ code, stderr });
    });
  });
}

test("Bootstrap ADMIN bersamaan hanya mengizinkan satu ADMIN pertama", async () => {
  const database = createTempDatabase("pos-bootstrap-race-");
  try {
    migrateFresh(database);
    const pw1 = makeRuntimePassword("boot1");
    const pw2 = makeRuntimePassword("boot2");
    const [first, second] = await Promise.all([
      runBootstrapProcess(database.dbPath, "admin.satu", pw1),
      runBootstrapProcess(database.dbPath, "admin.dua", pw2),
    ]);
    const exitCodes = [first.code, second.code].sort();
    assert.deepEqual(exitCodes, [0, 1], `hasil proses bersamaan: ${JSON.stringify({ first, second })}`);

    const db = database.open();
    try {
      assert.equal(countRows(db, "users"), 1);
      assert.equal(countRows(db, "audit_log"), 1);
    } finally {
      db.close();
    }
  } finally {
    database.cleanup();
  }
});

test("BUG-004: bootstrap-admin berjalan pada DB berisi katalog/akun demo dan menolak jika sudah ada user asli", async () => {
  const database = createTempDatabase("pos-bootstrap-demo-");
  try {
    migrateFresh(database);
    const { seedDemo } = await import("../../db/src/seed.ts");
    seedDemo({ dbPath: database.dbPath, allowDemo: true, env: {} });

    const db = database.open();
    try {
      const admin = bootstrapFirstAdmin(db, {
        username: "admin.asli",
        password: makeRuntimePassword("boot-real"),
      });
      assert.equal(admin.username, "admin.asli");
      assert.equal(admin.role, "ADMIN");
      assert.throws(
        () =>
          bootstrapFirstAdmin(db, {
            username: "admin.kedua",
            password: makeRuntimePassword("boot-real-2"),
          }),
        /belum ada akun asli/,
      );
    } finally {
      db.close();
    }
  } finally {
    database.cleanup();
  }
});

test("BUG-156: bootstrap menolak username demo cadangan dan akun non-seed bernama demo memblokir bootstrap kedua", () => {
  const database = createTempDatabase("pos-bootstrap-bug156-");
  try {
    migrateFresh(database);
    const db = database.open();
    try {
      assert.throws(
        () =>
          bootstrapFirstAdmin(db, {
            username: "demo.admin",
            password: makeRuntimePassword("boot-reserved"),
          }),
        /dicadangkan/,
      );
      // Simulasikan akun asli yang kebetulan bernama demo.admin tanpa demo_seed_runs.
      db.prepare(
        "INSERT INTO users (id, username, password_hash, role, active, created_at_ms) VALUES (1, 'demo.admin', 'hash', 'ADMIN', 1, 1000)",
      ).run();
      assert.throws(
        () =>
          bootstrapFirstAdmin(db, {
            username: "admin.kedua",
            password: makeRuntimePassword("boot-second"),
          }),
        /belum ada akun asli/,
      );
    } finally {
      db.close();
    }
  } finally {
    database.cleanup();
  }
});

test("BUG-166: getBootstrapStatus mengembalikan needsSetup=true bila hanya ada baris seed demo terkunci, dan false bila sudah ada akun usable atau akun asli", async () => {
  const database = createTempDatabase("pos-bootstrap-status-bug166-");
  try {
    migrateFresh(database);
    const { seedDemo } = await import("../../db/src/seed.ts");
    seedDemo({ dbPath: database.dbPath, allowDemo: true, env: {} });

    const db = database.open();
    try {
      const sessions = createSessionStore(db, {
        secret: randomBytes(32),
        ttlMs: 12 * 60 * 60 * 1000,
      });
      const auth = createAuthService(db, {
        sessions,
        securityLog: createSecurityLogger(),
      });
      assert.deepEqual(auth.getBootstrapStatus(), { needsSetup: true });
      auth.bootstrapAdmin({
        username: "admin.asli",
        password: makeRuntimePassword("boot-status"),
      });
      assert.deepEqual(auth.getBootstrapStatus(), { needsSetup: false });
      assert.throws(
        () =>
          bootstrapFirstAdmin(db, {
            username: "admin.tanpa.login",
            password: makeRuntimePassword("boot-blocked"),
          }),
        /belum ada akun asli/,
      );
    } finally {
      db.close();
    }
  } finally {
    database.cleanup();
  }
});

test("BUG-166: getBootstrapStatus mengembalikan needsSetup=false pada DB DEMO yang di-seed dengan installerPassword agar login langsung tersedia", async () => {
  const database = createTempDatabase("pos-bootstrap-status-usable-");
  try {
    migrateFresh(database);
    const { seedDemo } = await import("../../db/src/seed.ts");
    seedDemo({
      dbPath: database.dbPath,
      allowDemo: true,
      installerPassword: makeRuntimePassword("demo-usable"),
      env: {},
    });

    const db = database.open();
    try {
      const sessions = createSessionStore(db, {
        secret: randomBytes(32),
        ttlMs: 12 * 60 * 60 * 1000,
      });
      const auth = createAuthService(db, {
        sessions,
        securityLog: createSecurityLogger(),
      });
      assert.deepEqual(auth.getBootstrapStatus(), { needsSetup: false });
      assert.throws(
        () =>
          bootstrapFirstAdmin(db, {
            username: "admin.tanpa.login",
            password: makeRuntimePassword("boot-blocked"),
          }),
        /belum ada akun asli/,
      );
    } finally {
      db.close();
    }
  } finally {
    database.cleanup();
  }
});

test("BUG-207: perubahan sandi milik sendiri atomik, audit aman, seluruh sesi lama dicabut", () => {
  const { database, db, auth, sessions, admin, cashier } = setup();
  try {
    const old = auth.login({ username: admin.username, password: ADMIN_PASSWORD });
    const other = auth.login({ username: cashier.username, password: CASHIER_PASSWORD });
    const next = makeRuntimePassword();
    assert.throws(() => auth.changePassword(admin, { oldPassword: next, newPassword: next }), ValidationError);
    assert.throws(() => auth.changePassword(admin, { oldPassword: ADMIN_PASSWORD, newPassword: "x" }), ValidationError);
    assert.ok(sessions.verify(old.token));
    assert.equal(auditRows(db, "PASSWORD_CHANGED").length, 0);
    db.exec("CREATE TRIGGER reject_password_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'PASSWORD_CHANGED' BEGIN SELECT RAISE(ABORT, 'fixture'); END");
    assert.throws(() => auth.changePassword(admin, { oldPassword: ADMIN_PASSWORD, newPassword: next }));
    assert.ok(auth.login({ username: admin.username, password: ADMIN_PASSWORD }));
    db.exec("DROP TRIGGER reject_password_audit");
    assert.deepEqual(auth.changePassword(admin, { oldPassword: ADMIN_PASSWORD, newPassword: next }), { changed: true });
    assert.equal(sessions.verify(old.token), null);
    assert.ok(sessions.verify(other.token));
    assert.throws(() => auth.login({ username: admin.username, password: ADMIN_PASSWORD }), InvalidCredentialsError);
    assert.ok(auth.login({ username: admin.username, password: next }));
    const audit = auditRows(db, "PASSWORD_CHANGED");
    assert.equal(audit.length, 1);
    assert.equal(JSON.stringify(audit).includes(next), false);
    assert.equal(JSON.stringify(audit).includes(ADMIN_PASSWORD), false);
    assert.equal(audit[0].actor_id, admin.userId);
  } finally { db.close(); database.cleanup(); }
});
