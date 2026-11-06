import { describe, it, expect } from "vitest";
import { checkHealth } from "./health.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fakeFetch = (o: { fac?: any; srv?: number; bal?: number; throwFac?: boolean }) =>
  (async (url: string) => {
    if (url.includes("/supported")) { if (o.throwFac) throw new Error("ECONNREFUSED"); return json(o.fac ?? { kinds: [{ network: "hedera:testnet", scheme: "exact" }] }); }
    if (url.includes("/catalogue")) return json({}, o.srv ?? 200);
    return json({ balance: { balance: o.bal ?? 100_000_000_000 } });
  }) as unknown as typeof fetch;
const base = { facilitatorUrl: "http://f", serverUrl: "http://s", agentAccountId: "0.0.1", mirrorUrl: "http://m" };

describe("checkHealth", () => {
  it("all green", async () => {
    const h = await checkHealth({ ...base, fetch: fakeFetch({}) });
    expect(h.ok).toBe(true);
    expect(h.agentBalance.tinybars).toBe("100000000000");
  });
  it("facilitator down is reported, not thrown", async () => {
    const h = await checkHealth({ ...base, fetch: fakeFetch({ throwFac: true }) });
    expect(h.ok).toBe(false);
    expect(h.facilitator).toMatchObject({ ok: false, detail: "ECONNREFUSED" });
  });
  it("facilitator without hedera:testnet is a failure", async () => {
    const h = await checkHealth({ ...base, fetch: fakeFetch({ fac: { kinds: [{ network: "eip155:1", scheme: "exact" }] } }) });
    expect(h.facilitator.ok).toBe(false);
  });
  it("low balance warns", async () => {
    const h = await checkHealth({ ...base, fetch: fakeFetch({ bal: 1_000_000 }) });
    expect(h.agentBalance).toMatchObject({ ok: false, low: true });
  });
  it("server down fails", async () => {
    const h = await checkHealth({ ...base, fetch: fakeFetch({ srv: 500 }) });
    expect(h.server.ok).toBe(false);
  });
});
