import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createHttpDataSource } from "./api/httpDataSource";
import { createMockDataSource } from "./api/mockDataSource";
import "./styles/tokens.css";
import "./styles/app.css";

/**
 * Jembatan opsional yang disediakan kandidat Electron (TASK-031). Di browser
 * development tidak ada objek ini, sehingga perilaku lama tetap dipertahankan.
 */
declare global {
  interface Window {
    POS_SPIKE?: {
      getApiBaseUrl: () => Promise<string>;
      openExternal: (target: string) => Promise<boolean>;
      retryStartup: () => Promise<boolean>;
      exitApp: () => Promise<boolean>;
    };
  }
}

/**
 * BUG-121: bila berjalan di Electron, alamat API diambil dari main process
 * yang memilih port loopback aktual. Tunggu nilai itu SEBELUM request pertama.
 * Fallback development memakai VITE_API_BASE_URL / proxy Vite seperti sebelumnya.
 */
async function resolveApiBaseUrl(): Promise<string> {
  const bridge = window.POS_SPIKE;
  if (bridge && typeof bridge.getApiBaseUrl === "function") {
    const endpoint = await bridge.getApiBaseUrl();
    if (typeof endpoint !== "string" || endpoint.trim().length === 0) {
      throw new Error("Alamat API dari main process tidak valid.");
    }
    return endpoint;
  }
  return import.meta.env.VITE_API_BASE_URL ?? "/api/v1";
}

async function bootstrap(): Promise<void> {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Elemen #root tidak ditemukan");
  }

  const baseUrl = await resolveApiBaseUrl();
  const dataSource =
    import.meta.env.VITE_AUTH_MODE === "demo"
      ? createMockDataSource({ latencyMs: 150 })
      : createHttpDataSource({ baseUrl });

  createRoot(container).render(
    <StrictMode>
      <App dataSource={dataSource} />
    </StrictMode>,
  );
}

void bootstrap();
