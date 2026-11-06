// Integration tests for the REAL paying fetch: real x402 client, real Hedera signing (offline, random key),
// against a local mock server that speaks the x402 v2 headers. No network, no funds.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { PrivateKey } from "@x402/hedera";
import { BudgetGuard, SpendLimit } from "./budget.js";
import { createPayingFetch, makeGuardPolicy } from "./pay.js";

const MERCHANT = "0.0.111";
const PAYER = "0.0.1234";
const KEY = PrivateKey.generateECDSA().toStringRaw();

type Mode = "ok" | "500-after-pay" | "no-settle-header" | "redirect" | "hang" | "huge" | "not-json";
interface Ctl {
  mode: Mode;
  amount: string;
  payTo: string;
  unpaidRequests: number;
  paidRequests: number;
}
const ctl: Ctl = { mode: "ok", amount: "1000000", payTo: MERCHANT, unpaidRequests: 0, paidRequests: 0 };

function handler(req: IncomingMessage, res: ServerResponse) {
  const paid = typeof req.headers["payment-signature"] === "string" || typeof req.headers["x-payment"] === "string";
  if (ctl.mode === "redirect") {
    res.writeHead(302, { location: "http://127.0.0.1:1/elsewhere" }).end();
    return;
  }
  if (!paid) {
    ctl.unpaidRequests++;
    const required = {
      x402Version: 2,
      error: "Payment required",
      resource: { url: `http://${req.headers.host}${req.url}`, description: "test", mimeType: "application/json" },
      accepts: [{ scheme: "exact", network: "hedera:testnet", amount: ctl.amount, asset: "0.0.0", payTo: ctl.payTo, maxTimeoutSeconds: 300, extra: { feePayer: "0.0.7162784" } }],
    };
    res.writeHead(402, { "content-type": "application/json", "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required as never) });
    res.end(JSON.stringify({ error: "Payment required" }));
    return;
  }
  ctl.paidRequests++;
  if (ctl.mode === "hang") return; // never answer
  const settle = encodePaymentResponseHeader({ success: true, payer: PAYER, transaction: "0.0.7162784@1700000000.000000001", network: "hedera:testnet" } as never);
  if (ctl.mode === "500-after-pay") {
    res.writeHead(500, { "PAYMENT-RESPONSE": settle }).end("boom");
    return;
  }
  if (ctl.mode === "no-settle-header") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: 1 }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json", "PAYMENT-RESPONSE": settle });
  if (ctl.mode === "huge") res.end("x".repeat(1_000_000));
  else if (ctl.mode === "not-json") res.end("plain text <b>body</b>");
  else res.end(JSON.stringify({ temperature: 31, city: "Mumbai" }));
}

let server: Server;
let base = "";
beforeAll(async () => {
  server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});
beforeEach(() => Object.assign(ctl, { mode: "ok", amount: "1000000", payTo: MERCHANT, unpaidRequests: 0, paidRequests: 0 }));

const mk = (over: { runBudget?: bigint; parent?: SpendLimit; allowedOrigins?: string[]; timeoutMs?: number } = {}) => {
  const guard = new BudgetGuard({ runBudget: over.runBudget ?? 10_000_000n, maxPerCall: 5_000_000n, allowedPayTo: MERCHANT, allowedAsset: "0.0.0", parent: over.parent });
  const payFor = createPayingFetch({ accountId: PAYER, privateKeyHex: KEY, guard, allowedOrigins: over.allowedOrigins ?? [base], timeoutMs: over.timeoutMs ?? 5000 });
  return { guard, payFor };
};

describe("createPayingFetch (real x402 client against a mock server)", () => {
  it("pays the 402 amount, records it, and returns the data and tx id", async () => {
    const { guard, payFor } = mk();
    const r = await payFor(`${base}/api/weather`);
    expect(r).toMatchObject({ ok: true, txId: "0.0.7162784@1700000000.000000001", amount: 1_000_000n, data: { city: "Mumbai" } });
    expect(guard.spent).toBe(1_000_000n);
    expect(ctl.paidRequests).toBe(1);
  });

  it("refuses to sign when the 402 asks for more than the advertised price (maxAmount)", async () => {
    ctl.amount = "3000000";
    const { guard, payFor } = mk();
    const r = await payFor(`${base}/api/weather`, { maxAmount: 1_000_000n });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/advertised or approved price/);
    expect(ctl.paidRequests).toBe(0);
    expect(guard.spent).toBe(0n);
    expect(guard.remaining).toBe(10_000_000n); // nothing left reserved
  });

  it("refuses a 402 that names a payee outside the allowlist", async () => {
    ctl.payTo = "0.0.666";
    const { guard, payFor } = mk();
    const r = await payFor(`${base}/api/weather`);
    expect((r as { reason: string }).reason).toMatch(/not an allowlisted merchant/);
    expect(ctl.paidRequests).toBe(0);
    expect(guard.spent).toBe(0n);
  });

  it("refuses an untrusted origin before making any request", async () => {
    const { payFor } = mk({ allowedOrigins: ["http://localhost:9"] });
    const r = await payFor(`${base}/api/weather`);
    expect((r as { reason: string }).reason).toMatch(/not a trusted seller/);
    expect(ctl.unpaidRequests + ctl.paidRequests).toBe(0);
  });

  it("refuses non-HTTP URLs", async () => {
    const { payFor } = mk({ allowedOrigins: ["file:///"] });
    expect((await payFor("file:///etc/passwd")).ok).toBe(false);
  });

  it("counts the spend when the server takes the payment and then returns 500", async () => {
    ctl.mode = "500-after-pay";
    const { guard, payFor } = mk();
    const r = await payFor(`${base}/api/weather`);
    expect(r).toMatchObject({ ok: false, chargedTinybars: 1_000_000n });
    expect(guard.spent).toBe(1_000_000n);
  });

  it("counts the spend when the settlement header is missing after payment", async () => {
    ctl.mode = "no-settle-header";
    const { guard, payFor } = mk();
    const r = await payFor(`${base}/api/weather`);
    expect(r).toMatchObject({ ok: false, reason: "Payment did not settle", chargedTinybars: 1_000_000n });
    expect(guard.spent).toBe(1_000_000n);
  });

  it("never follows a redirect", async () => {
    ctl.mode = "redirect";
    const { guard, payFor } = mk();
    const r = await payFor(`${base}/api/weather`);
    expect(r.ok).toBe(false);
    expect(guard.spent).toBe(0n);
  });

  it("times out a server that never answers, and still counts the signed payment", async () => {
    ctl.mode = "hang";
    const { guard, payFor } = mk({ timeoutMs: 300 });
    const t0 = Date.now();
    const r = await payFor(`${base}/api/weather`);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r).toMatchObject({ ok: false, chargedTinybars: 1_000_000n });
    expect(guard.spent).toBe(1_000_000n);
  });

  it("caps a huge body before it reaches the model", async () => {
    ctl.mode = "huge";
    const { payFor } = mk();
    const r = await payFor(`${base}/api/weather`);
    if (!r.ok) throw new Error(r.reason);
    expect(typeof r.data).toBe("string");
    expect((r.data as string).length).toBeLessThan(9000);
    expect(r.data as string).toContain("truncated");
  });

  it("returns a non-JSON body as plain text", async () => {
    ctl.mode = "not-json";
    const { payFor } = mk();
    const r = await payFor(`${base}/api/weather`);
    expect(r).toMatchObject({ ok: true, data: "plain text <b>body</b>" });
  });

  it("concurrent purchases cannot exceed the budget (reservation is atomic)", async () => {
    const { guard, payFor } = mk({ runBudget: 2_000_000n });
    const results = await Promise.all(Array.from({ length: 6 }, () => payFor(`${base}/api/weather`)));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(guard.spent).toBe(2_000_000n);
    expect(ctl.paidRequests).toBe(2);
  });

  it("concurrent purchases through two guards cannot exceed a shared process limit", async () => {
    const parent = new SpendLimit(1_000_000n, "process-wide spending limit");
    const a = mk({ parent });
    const b = mk({ parent });
    const results = await Promise.all([a.payFor(`${base}/x`), b.payFor(`${base}/y`), a.payFor(`${base}/z`)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(parent.spent).toBe(1_000_000n);
  });
});

describe("makeGuardPolicy", () => {
  const guard = () => new BudgetGuard({ runBudget: 5_000_000n, maxPerCall: 2_000_000n, allowedPayTo: MERCHANT, allowedAsset: "0.0.0" });
  const req = (o: Partial<{ amount: string; payTo: string; asset: string }> = {}) => ({ amount: "1000000", payTo: MERCHANT, asset: "0.0.0", ...o });

  it("keeps allowed requirements and holds nothing", () => {
    const g = guard();
    expect(makeGuardPolicy(g, {})(2, [req()])).toHaveLength(1);
    expect(g.remaining).toBe(5_000_000n);
  });
  it("drops disallowed requirements and records the first reason", () => {
    const s: { denial?: string } = {};
    expect(makeGuardPolicy(guard(), s)(2, [req({ payTo: "0.0.666" }), req({ amount: "2000001" })])).toHaveLength(0);
    expect(s.denial).toMatch(/allowlisted/);
  });
  it("applies maxAmount", () => {
    const s: { denial?: string } = {};
    expect(makeGuardPolicy(guard(), s, 500_000n)(2, [req()])).toHaveLength(0);
    expect(s.denial).toMatch(/advertised or approved/);
  });
});
