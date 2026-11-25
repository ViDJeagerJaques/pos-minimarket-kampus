/** Launcher untuk menjalankan Electron dengan profil SANDBOX. */
"use strict";

process.env.POS_SANDBOX = "1";

const { spawn } = require("node:child_process");
const electron = require("electron");

const child = spawn(electron, ["."], { stdio: "inherit", env: process.env });
child.on("error", (error) => {
  process.stderr.write(`Gagal menjalankan Electron sandbox: ${error.message}\n`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 0;
});
