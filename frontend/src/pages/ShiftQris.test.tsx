import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createMockDataSource } from "../api/mockDataSource";
import { ShiftDemoPage } from "./ShiftDemoPage";
it("BUG-139 menampilkan rincian QRIS milik kasir dari laporan backend", async () => {
  const source = createMockDataSource({ latencyMs: 0 });
  source.getPaymentReport = vi.fn(async () => ({ cash: { totalRp: 0, count: 0 }, qrisManual: { totalRp: 2500, count: 1, verifiedCount: 1 }, totalRp: 2500, qrisSales: [{ saleId: 1, saleNo: "S-000001", committedAtMs: 1700000000000, totalRp: 2500, cashierUsername: "kasir", verifiedBy: 2, verifiedAtMs: 1700000000000, evidenceRef: "REF", status: "verified" as const }] }));
  render(<ShiftDemoPage dataSource={source} currentUser={{ userId: 2, username: "kasir", displayName: "Kasir", role: "CASHIER" }} onSessionExpired={vi.fn()} onPendingChange={vi.fn()} />);
  expect(await screen.findByText("S-000001")).toBeTruthy();
  expect(screen.getByRole("table", { name: "Rincian QRIS terverifikasi" })).toBeTruthy();
});
