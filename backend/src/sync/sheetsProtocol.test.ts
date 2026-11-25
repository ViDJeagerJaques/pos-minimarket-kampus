import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { buildDemoSalePayload, sendDemoPayload, sendDemoPayloadResult, validateDemoWebhookUrl } from "./sheetsProtocol.ts";

test("sender DEMO identitas dan redirect tidak meneruskan secret ke host lain", async () => {
  const secret = randomBytes(32).toString("hex");
  const payload = buildDemoSalePayload(secret, randomBytes(16).toString("hex"), { attemptKey: "co_1", saleNo: "S-1", totalRp: 5000, method: "CASH", cashier: "demo", committedAtMs: 1, items: "Produk x 1" });
  assert.equal(payload.operation, "sale"); assert.equal(payload.attemptKey, "co_1");
  for (const url of ["http://script.google.com/macros/s/a/exec", "https://script.google.com.evil.invalid/macros/s/a/exec", "https://script.google.com/macros/s/a/exec?x=1", "https://user@script.google.com/macros/s/a/exec"]) assert.throws(() => validateDemoWebhookUrl(url));
  const calls: RequestInit[] = [];
  const mock: typeof fetch = async (_url, init) => { calls.push(init ?? {}); return calls.length === 1 ? new Response(null, { status: 302, headers: { location: "https://script.googleusercontent.com/macros/echo?fixture=1" } }) : new Response(JSON.stringify({ ok: true }), { status: 200 }); };
  assert.equal(await sendDemoPayload("https://script.google.com/macros/s/fixture/exec", payload, mock), true);
  assert.equal(calls[1].method, "GET"); assert.equal(calls[1].body, undefined);
  let sent = 0;
  const unsafe: typeof fetch = async () => { sent++; return new Response(null, { status: 307, headers: { location: "https://attacker.invalid/" } }); };
  assert.equal(await sendDemoPayload("https://script.google.com/macros/s/fixture/exec", payload, unsafe), false); assert.equal(sent, 1);
  const offline: typeof fetch = async () => { throw new Error("offline"); };
  assert.equal(await sendDemoPayload("https://script.google.com/macros/s/fixture/exec", payload, offline), false);
});

test("receiver conflict and namespace errors become safe codes without exposing response text", async () => {
 const url = "https://script.google.com/macros/s/fixture/exec";
 for (const [error, failure] of [["nomor struk sudah digunakan", "SALE_CONFLICT"], ["namespace berbeda", "NAMESPACE_MISMATCH"], ["secret and private URL", "REJECTED"]] as const) {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ ok: false, error }), { status: 200 });
  assert.deepEqual(await sendDemoPayloadResult(url, {}, fetchImpl), { ok: false, failure });
 }
});
