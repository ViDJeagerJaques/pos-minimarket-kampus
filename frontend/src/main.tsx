import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createMockDataSource } from "./api/mockDataSource";
import "./styles/tokens.css";
import "./styles/app.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Elemen #root tidak ditemukan");
}

// MODE DEMO: satu-satunya sumber data saat ini adalah mock di memori.
const dataSource = createMockDataSource({ latencyMs: 150 });

createRoot(container).render(
  <StrictMode>
    <App dataSource={dataSource} />
  </StrictMode>,
);

