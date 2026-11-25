import type { QueuedSaleSync } from "./sheetsSync.ts";

export function validateDemoWebhookUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.hostname !== "script.google.com" || url.port || url.username || url.password || url.search || url.hash || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)) throw new Error("Alamat web app Apps Script tidak valid.");
  return url.toString();
}

export function buildDemoSalePayload(secret: string, databaseNamespace: string, item: QueuedSaleSync) {
  if (!/^[a-f0-9]{32}$/.test(databaseNamespace)) throw new Error("Identitas database tidak valid.");
  return { operation: "sale" as const, secret, databaseNamespace, attemptKey: item.attemptKey, saleNo: item.saleNo, totalRp: item.totalRp, method: item.method, cashier: item.cashier, committedAtMs: item.committedAtMs, items: item.items };
}

export async function sendDemoPayload(url: string, payload: object, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const endpoint = validateDemoWebhookUrl(url);
    const response = await fetchImpl(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), redirect: "manual", signal: AbortSignal.timeout(10000) });
    let final = response;
    if ([301, 302, 303].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) return false;
      const next = new URL(location, endpoint);
      if (next.protocol !== "https:" || next.hostname !== "script.googleusercontent.com" || next.port || next.username || next.password) return false;
      final = await fetchImpl(next.toString(), { method: "GET", redirect: "manual", signal: AbortSignal.timeout(10000) });
    }
    if (!final.ok) return false;
    const body: unknown = await final.json();
    return Boolean(body && typeof body === "object" && (body as { ok?: unknown }).ok === true && ((payload as { operation?: unknown }).operation !== "ping" || (body as { operation?: unknown }).operation === "ping"));
  } catch { return false; }
}
