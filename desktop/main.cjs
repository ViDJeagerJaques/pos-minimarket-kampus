/**
 * TASK-031 — Kandidat Electron MINIMAL untuk evaluasi (DEMO, bukan pilihan final).
 *
 * Guardrail sesuai ARCHITECTURE.md §20.2 dan TECH_STACK.md §3:
 * - nodeIntegration:false, contextIsolation:true, sandbox:true, webSecurity:true.
 * - Hanya memuat file lokal hasil build frontend (file://), tanpa konten remote.
 * - Navigasi dan window baru ditolak kecuali file lokal yang sama.
 * - Backend lokal di-spawn sebagai child process, bind 127.0.0.1 saja.
 * - DB disimpan di app.getPath('userData'), BUKAN di ASAR/folder instalasi.
 * - Preload hanya mengekspos API terbatas (lihat preload.cjs).
 *
 * Tidak ada log kata sandi/token. Baris POS_BENCH hanya untuk pengukuran TASK-031.
 */
"use strict";

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");

const T0 = process.hrtime.bigint();
const bench = (label) => {
  const ms = Number(process.hrtime.bigint() - T0) / 1e6;
  process.stdout.write(`POS_BENCH ${label}=${ms.toFixed(1)}ms\n`);
};

const ROOT = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "..");
const FRONTEND_DIST = path.join(ROOT, "frontend", "dist");
const API_PORT = Number(process.env.POS_SPIKE_API_PORT || (app.isPackaged ? 0 : 8787));
const NODE_BIN = app.isPackaged ? path.join(ROOT, "runtime", "node.exe") : (process.env.POS_NODE_BIN || "node");
const BENCH = process.env.POS_ELECTRON_BENCH === "1";

// Identitas data stabil lintas versi; terpisah dari data development/operasional.
if (app.isPackaged) {
  const testDataDir = app.commandLine.getSwitchValue("user-data-dir");
  if (testDataDir && !path.isAbsolute(testDataDir)) throw new Error("user-data-dir harus absolut.");
  app.setPath("userData", testDataDir || path.join(app.getPath("appData"), "PosMinimarketKampus-DEMO"));
}
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

let backend = null;
let mainWindow = null;
let startupWindow = null;
let apiBaseUrl = `http://127.0.0.1:${API_PORT}/api/v1`;
let resolveApiUrl;
const apiUrlReady = new Promise((resolve) => { resolveApiUrl = resolve; });
const setApiBaseUrl = (url) => {
  apiBaseUrl = url;
  if (BENCH) process.stdout.write(`POS_BENCH api=${url}\n`);
  resolveApiUrl(url);
};

function startBackend() {
  const dataDir = app.getPath("userData");
  fs.mkdirSync(dataDir, { recursive: true });
  const configPath = path.join(dataDir, "config.json");
  if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, JSON.stringify({ mode: "DEMO", apiPort: 0 }, null, 2), { flag: "wx" });
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (config.mode !== "DEMO" || !Number.isInteger(config.apiPort) || config.apiPort < 0 || config.apiPort > 65535) {
    throw new Error("Konfigurasi DEMO tidak valid; pulihkan config.json dari cadangan.");
  }
  const dbPath = path.join(dataDir, "pos-dev.sqlite");
  const env = { ...process.env, POS_DB_PATH: dbPath, POS_DB_PROFILE: "development", POS_DATA_DIR: dataDir, POS_BACKUP_DIR: path.join(dataDir, "backups"), POS_RESTORE_TEST_DIR: path.join(dataDir, "restore-test") };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;

  // First-run: pastikan skema ada sebelum server start (jalur development/DEMO).
  const migrate = spawnSync(
    NODE_BIN,
    [path.join(ROOT, "backend", "db", "src", "cli.ts"), "migrate", "--db", dbPath],
    { cwd: path.join(ROOT, "backend"), env, encoding: "utf8", windowsHide: true },
  );
  // BUG-119: kegagalan migrasi adalah kegagalan startup, bukan kondisi untuk
  // tetap membuka jendela kasir dengan backend mati.
  if (migrate.status !== 0) {
    throw new Error(`Migrasi database gagal: ${(migrate.stderr || migrate.stdout || "").slice(0, 300)}`);
  }

  // BUG-127: kembalikan promise yang hanya resolve saat backend benar-benar
  // melaporkan siap; reject pada exit awal, error proses, atau timeout.
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        if (backend && backend.exitCode === null) {
          try { backend.kill(); } catch { /* sudah keluar */ }
        }
        reject(error);
      } else {
        resolve();
      }
    };
    const timer = setTimeout(
      () => finish(new Error("Backend tidak melaporkan kesiapan dalam 15 detik.")),
      15_000,
    );

    backend = spawn(
      NODE_BIN,
      [path.join(ROOT, "backend", "src", "http", "cli.ts"), "serve", "--port", String(app.isPackaged ? config.apiPort : API_PORT), "--static-dir", FRONTEND_DIST],
      { cwd: path.join(ROOT, "backend"), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    // BUG-126: buffer sampai newline lengkap; potongan stream tidak boleh
    // dianggap sebagai baris output backend.
    let stdoutBuffer = "";
    backend.stdout.setEncoding("utf8");
    backend.stdout.on("data", (chunk) => {
      stdoutBuffer += String(chunk);
      let newline = stdoutBuffer.indexOf("\n");
      while (newline !== -1) {
        const line = stdoutBuffer.slice(0, newline);
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        const match = line.match(/Server DEMO berjalan di (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) {
          setApiBaseUrl(`${match[1]}/api/v1`);
          if (BENCH) bench("backend_ready");
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("pos:api-base-url", apiBaseUrl);
          }
          finish();
        }
        newline = stdoutBuffer.indexOf("\n");
      }
    });
    backend.stderr.setEncoding("utf8");
    backend.stderr.on("data", (chunk) => {
      if (process.env.POS_SPIKE_BACKEND_LOG) {
        fs.appendFileSync(process.env.POS_SPIKE_BACKEND_LOG, String(chunk));
      }
    });
    backend.once("error", (error) => finish(error));
    backend.once("exit", (code, signal) => {
      process.stdout.write(`POS_SPIKE backend exit code=${code} signal=${signal}\n`);
      finish(new Error(`Backend keluar lebih awal (code=${code}, signal=${signal}).`));
    });
  });
}

function createWindow() {
  if (BENCH) bench("app_ready");
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Sajikan frontend dari origin backend loopback yang sama agar tidak lintas origin
  // saat webSecurity aktif.
  const appOrigin = new URL(apiBaseUrl).origin;
  const appEntryUrl = `${appOrigin}/`;
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = url === appEntryUrl || url.startsWith(`${appEntryUrl}?`) || url.startsWith(`${appEntryUrl}#`);
    if (!allowed) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  mainWindow.loadURL(appEntryUrl);
  mainWindow.webContents.on("did-finish-load", () => {
    if (BENCH) bench("window_loaded");
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send("pos:api-base-url", apiBaseUrl);
    }
    process.stdout.write("POS_SPIKE window_ready\n");
    if (BENCH && process.env.POS_INSTALLER_RENDERER_TEST === "1" && process.env.POS_SPIKE_CREDS_FILE) {
      try {
        const creds = JSON.parse(fs.readFileSync(process.env.POS_SPIKE_CREDS_FILE, "utf8"));
        const setupFirst = process.env.POS_INSTALLER_SETUP_FIRST === "1";
        const userJson = JSON.stringify(String(setupFirst ? (creds.adminUser ?? "") : (creds.cashierUser ?? "")));
        const passJson = JSON.stringify(String(setupFirst ? (creds.adminPass ?? "") : (creds.cashierPass ?? "")));
        setTimeout(() => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          mainWindow.webContents
            .executeJavaScript(`(async () => {
              const setVal = (el, val) => {
                const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                setter.call(el, val);
                el.dispatchEvent(new Event('input', { bubbles: true }));
              };
              const deadline = Date.now() + 10000;
              if (${setupFirst ? "true" : "false"}) {
                let setupTitle = null;
                while (Date.now() < deadline) {
                  setupTitle = document.getElementById('setup-admin-title');
                  if (setupTitle) break;
                  await new Promise(r => setTimeout(r, 100));
                }
                if (!setupTitle) return 'FAIL:no_setup_screen';
                const setupForm = setupTitle.closest('form');
                const setupInputs = setupForm ? setupForm.querySelectorAll('input') : [];
                if (setupInputs.length < 3) return 'FAIL:setup_inputs';
                setVal(setupInputs[0], ${userJson});
                setVal(setupInputs[1], ${passJson});
                setVal(setupInputs[2], ${passJson});
                const setupBtn = setupForm.querySelector('button[type="submit"]');
                if (!setupBtn) return 'FAIL:no_setup_btn';
                setupBtn.click();
              }
              let loginTitle = null;
              while (Date.now() < deadline) {
                loginTitle = document.getElementById('login-title');
                if (loginTitle) break;
                const err = document.querySelector('[role="alert"]');
                if (err && err.textContent) return 'FAIL:' + err.textContent.trim();
                await new Promise(r => setTimeout(r, 100));
              }
              if (!loginTitle) return 'FAIL:no_login_form';
              const form = loginTitle.closest('form');
              const inputs = form ? form.querySelectorAll('input') : [];
              if (inputs.length < 2) return 'FAIL:login_inputs';
              setVal(inputs[0], ${userJson});
              setVal(inputs[1], ${passJson});
              const btn = form.querySelector('button[type="submit"]');
              if (!btn) return 'FAIL:no_submit_btn';
              btn.click();
              while (Date.now() < deadline) {
                const nav = document.querySelector('nav[aria-label="Menu utama"]');
                if (nav) return 'PASS';
                const err = document.querySelector('[role="alert"]');
                if (err && err.textContent) return 'FAIL:' + err.textContent.trim();
                await new Promise(r => setTimeout(r, 100));
              }
              return 'FAIL:timeout:' + document.body.innerText.slice(0, 200);
            })()`)
            .then((result) => process.stdout.write(`POS_SPIKE ${setupFirst ? "renderer_setup_and_login" : "renderer_login"}=${String(result)}\n`))
            .catch((error) => process.stdout.write(`POS_SPIKE ${setupFirst ? "renderer_setup_and_login" : "renderer_login"}=FAIL:${error.message}\n`));
        }, 500);
      } catch (error) {
        process.stdout.write(`POS_SPIKE renderer_login=FAIL:${error.message}\n`);
      }
    }
    // Bukti teks UI nyata dari renderer (tidak bergantung pada permukaan GPU).
    // Renderer kini menunggu endpoint IPC sebelum render, jadi ambil setelah
    // backend siap; did-finish-load saja terlalu awal dan menghasilkan teks kosong.
    if (!app.isPackaged || BENCH) setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents
        .executeJavaScript("document.body.innerText.slice(0, 600)")
        .then((text) => process.stdout.write(`POS_SPIKE dom_text=${String(text).replace(/\s+/g, " ").trim()}\n`))
        .catch((error) => process.stdout.write(`POS_SPIKE dom_fail=${error.message}\n`));
    }, 2500);
    const shotPath = process.env.POS_SPIKE_SCREENSHOT;
    if (shotPath) {
      // Screenshot nyata dari renderer, bukan gambar buatan.
      setTimeout(() => {
        mainWindow.webContents
          .capturePage()
          .then((image) => fs.writeFileSync(shotPath, image.toPNG()))
          .catch((error) => process.stdout.write(`POS_SPIKE screenshot_fail=${error.message}\n`));
      }, 1500);
    }
  });
}

/** Tampilkan error startup dengan aksi Coba lagi / Keluar (BUG-119). */
function showStartupError(message) {
  if (startupWindow && !startupWindow.isDestroyed()) startupWindow.close();
  startupWindow = new BrowserWindow({
    width: 560,
    height: 320,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  const safe = String(message).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);
  const html = [
    "<!doctype html><html><head><meta charset='utf-8'><title>Gagal memulai</title></head><body>",
    "<h2>Aplikasi belum dapat dimulai</h2>",
    `<p>${safe}</p>`,
    "<button id='retry' type='button'>Coba lagi</button> ",
    "<button id='exit' type='button'>Keluar</button>",
    "<script>",
    "document.getElementById('retry').addEventListener('click', () => window.POS_SPIKE.retryStartup());",
    "document.getElementById('exit').addEventListener('click', () => window.POS_SPIKE.exitApp());",
    "</script></body></html>",
  ].join("");
  startupWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

async function runStartup() {
  try {
    // BUG-127: jendela kasir hanya dibuka setelah backend siap.
    await startBackend();
    if (startupWindow && !startupWindow.isDestroyed()) {
      startupWindow.close();
      startupWindow = null;
    }
    createWindow();
  } catch (error) {
    showStartupError(error instanceof Error ? error.message : String(error));
  }
}

app.whenReady().then(() => {
  if (primaryInstance) void runStartup();
});

app.on("before-quit", () => {
  if (backend && backend.exitCode === null) backend.kill();
});

app.on("window-all-closed", () => {
  app.quit();
});

// BUG-121: renderer menunggu endpoint yang benar-benar dipilih main process,
// bukan nilai build-time VITE_API_BASE_URL.
ipcMain.handle("pos:get-api-base-url", async () => apiUrlReady);
let retryStartup = null;
ipcMain.handle("pos:retry-startup", async () => {
  if (!retryStartup) {
    retryStartup = runStartup().finally(() => { retryStartup = null; });
  }
  await retryStartup;
  return true;
});
ipcMain.handle("pos:exit-app", () => {
  app.quit();
  return true;
});
ipcMain.handle("pos:open-external", async (_event, target) => {
  // Tidak ada tautan eksternal dalam alur kasir; tolak semua.
  void shell;
  void target;
  return false;
});
