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
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");

const T0 = process.hrtime.bigint();
const bench = (label) => {
  const ms = Number(process.hrtime.bigint() - T0) / 1e6;
  process.stdout.write(`POS_BENCH ${label}=${ms.toFixed(1)}ms\n`);
};

const ROOT = path.resolve(__dirname, "..");
const FRONTEND_INDEX = path.join(ROOT, "frontend", "dist", "index.html");
const API_PORT = Number(process.env.POS_SPIKE_API_PORT || 8787);
const NODE_BIN = process.env.POS_NODE_BIN || "node";
const BENCH = process.env.POS_ELECTRON_BENCH === "1";

let backend = null;
let mainWindow = null;
let apiBaseUrl = `http://127.0.0.1:${API_PORT}/api/v1`;

function startBackend() {
  const dataDir = app.getPath("userData");
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "pos-dev.sqlite");
  const env = { ...process.env, POS_DB_PATH: dbPath, POS_DB_PROFILE: "development" };

  // First-run: pastikan skema ada sebelum server start (jalur development/DEMO).
  const migrate = spawnSync(
    NODE_BIN,
    [path.join(ROOT, "backend", "db", "src", "cli.ts"), "migrate", "--db", dbPath],
    { cwd: path.join(ROOT, "backend"), env, encoding: "utf8" },
  );
  if (migrate.status !== 0) {
    process.stdout.write(`POS_SPIKE migrate_failed=${(migrate.stderr || "").slice(0, 300)}\n`);
    return;
  }

  backend = spawn(
    NODE_BIN,
    [path.join(ROOT, "backend", "src", "http", "cli.ts"), "serve", "--port", String(API_PORT)],
    { cwd: path.join(ROOT, "backend"), env, stdio: ["ignore", "pipe", "pipe"] },
  );
  backend.stdout.setEncoding("utf8");
  backend.stdout.on("data", (chunk) => {
    const match = String(chunk).match(/Server DEMO berjalan di (http:\/\/127\.0\.0\.1:\d+)/);
    if (match) {
      apiBaseUrl = `${match[1]}/api/v1`;
      if (BENCH) bench("backend_ready");
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("pos:api-base-url", apiBaseUrl);
      }
    }
  });
  backend.stderr.setEncoding("utf8");
  backend.stderr.on("data", (chunk) => {
    if (process.env.POS_SPIKE_BACKEND_LOG) {
      fs.appendFileSync(process.env.POS_SPIKE_BACKEND_LOG, String(chunk));
    }
  });
  backend.once("exit", (code, signal) => {
    process.stdout.write(`POS_SPIKE backend exit code=${code} signal=${signal}\n`);
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

  // Tolak navigasi atau window baru ke mana pun selain file lokal aplikasi.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://") || !url.includes("frontend")) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  mainWindow.loadFile(FRONTEND_INDEX);
  mainWindow.webContents.on("did-finish-load", () => {
    if (BENCH) bench("window_loaded");
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send("pos:api-base-url", apiBaseUrl);
    }
    process.stdout.write("POS_SPIKE window_ready\n");
    // Bukti teks UI nyata dari renderer (tidak bergantung pada permukaan GPU).
    mainWindow.webContents
      .executeJavaScript("document.body.innerText.slice(0, 600)")
      .then((text) => process.stdout.write(`POS_SPIKE dom_text=${String(text).replace(/\s+/g, " ").trim()}\n`))
      .catch((error) => process.stdout.write(`POS_SPIKE dom_fail=${error.message}\n`));
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

app.whenReady().then(() => {
  startBackend();
  createWindow();
});

app.on("before-quit", () => {
  if (backend && backend.exitCode === null) backend.kill();
});

app.on("window-all-closed", () => {
  app.quit();
});

ipcMain.handle("pos:get-api-base-url", () => apiBaseUrl);
ipcMain.handle("pos:open-external", async (_event, target) => {
  // Tidak ada tautan eksternal dalam alur kasir; tolak semua.
  void shell;
  void target;
  return false;
});
