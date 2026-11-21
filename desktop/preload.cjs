/**
 * TASK-031 — Preload terbatas untuk kandidat Electron.
 * Hanya mengekspos dua fungsi; TIDAK mengekspos Node, fs, SQLite, atau shell.
 * Renderer tetap memakai API HTTP lokal yang alamatnya diberikan main process.
 */
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("POS_SPIKE", Object.freeze({
  getApiBaseUrl: () => ipcRenderer.invoke("pos:get-api-base-url"),
  openExternal: (target) => ipcRenderer.invoke("pos:open-external", target),
}));
