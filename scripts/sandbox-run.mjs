/**
 * Runner generik untuk perintah backend/test dengan profil SANDBOX.
 * Pemakaian: node scripts/sandbox-run.mjs <perintah> [argumen...]
 */
import { spawn } from "node:child_process";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  process.stderr.write("Pemakaian: node scripts/sandbox-run.mjs <perintah> [argumen...]\n");
  process.exit(1);
}

const executable = command === "npm" && process.platform === "win32" ? "npm.cmd" : command;
const env = { ...process.env, POS_SANDBOX: "1" };
const child = spawn(executable, args, {
  stdio: "inherit",
  env,
  // npm pada Windows adalah file .cmd dan memerlukan shell.
  shell: executable.endsWith(".cmd"),
});

child.on("error", (error) => {
  process.stderr.write(`Gagal menjalankan ${command}: ${error.message}\n`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 0;
});
