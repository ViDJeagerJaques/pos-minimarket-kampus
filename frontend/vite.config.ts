/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * CSP hanya disuntikkan pada build (bukan dev), karena dev server React
 * memakai skrip inline untuk HMR. Build tidak memuat skrip/style inline.
 * TODO(security): saat dibungkus Electron (DEC-011), kirim CSP + frame-ancestors
 * lewat header/session Electron juga; meta CSP tidak mendukung frame-ancestors.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

function buildCsp(): Plugin {
  return {
    name: "pos-build-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<!-- CSP_PLACEHOLDER -->",
        `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
      );
    },
  };
}

export default defineConfig({
  // Path relatif agar hasil build bisa dimuat lokal (mis. wrapper desktop) tanpa server publik.
  base: "./",
  plugins: [react(), buildCsp()],
  // Hanya loopback; jangan bind 0.0.0.0 (TECH_STACK §3).
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  build: { outDir: "dist", sourcemap: false },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});

