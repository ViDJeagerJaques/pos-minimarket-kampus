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
 * TASK-011: autentikasi & akun memakai backend lokal nyata.
 * Katalog produk masih mock DEMO sampai TASK-012.
 *
 * - Default: `POST /auth/login` via proxy Vite `/api` → 127.0.0.1:8787.
 * - `VITE_AUTH_MODE=demo`: kembali ke mock login (hanya untuk kerja UI terisolasi).
 * - Build Electron: set `VITE_API_BASE_URL=http://127.0.0.1:8787/api/v1`
 *   (CSP `connect-src` sudah mengizinkan loopback).
 */
const catalog = createMockDataSource({ latencyMs: 150 });
const dataSource =
  import.meta.env.VITE_AUTH_MODE === "demo"
    ? catalog
    : createHttpDataSource({
        baseUrl: import.meta.env.VITE_API_BASE_URL ?? "/api/v1",
        catalog,
      });

createRoot(container).render(
  <StrictMode>
    <App dataSource={dataSource} />
  </StrictMode>,
);
