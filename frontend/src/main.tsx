import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createHttpDataSource } from "./api/httpDataSource";
import { createMockDataSource } from "./api/mockDataSource";
import "./styles/tokens.css";
import "./styles/app.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Elemen #root tidak ditemukan");
}

/**
 * TASK-011/TASK-012: autentikasi, akun, dan katalog memakai backend lokal nyata.
 *
 * - Default: `POST /auth/login` dan katalog via proxy Vite `/api` → 127.0.0.1:8787.
 * - `VITE_AUTH_MODE=demo`: kembali ke mock DEMO (hanya untuk kerja UI terisolasi).
 *   Mode DEMO menandai dirinya di UI dan menolak operasi tulis katalog.
 * - Build Electron: set `VITE_API_BASE_URL=http://127.0.0.1:8787/api/v1`
 *   (CSP `connect-src` sudah mengizinkan loopback).
 */
const dataSource =
  import.meta.env.VITE_AUTH_MODE === "demo"
    ? createMockDataSource({ latencyMs: 150 })
    : createHttpDataSource({
        baseUrl: import.meta.env.VITE_API_BASE_URL ?? "/api/v1",
      });

createRoot(container).render(
  <StrictMode>
    <App dataSource={dataSource} />
  </StrictMode>,
);
