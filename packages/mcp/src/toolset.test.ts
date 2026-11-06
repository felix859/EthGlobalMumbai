import { describe, it, expect } from "vitest";
import type { Catalogue } from "@pennyagent/shared";
import { Toolset, type ToolsetConfig } from "./toolset.js";

const cat: Catalogue = {
  network: "hedera:testnet",
  payTo: "0.0.111",
  endpoints: [
    { id: "weather", path: "/api/weather", description: "w", priceTinybars: "1000000", asset: "0.0.0" },
    { id: "headlines", path: "/api/headlines", description: "h", priceTinybars: "5000000", asset: "0.0.0" },
    { id: "briefing", path: "/api/briefing", description: "b", priceTinybars: "3000000", asset: "0.0.0", payTo: "0.0.222", baseUrl: "http://localhost:3100" },
  ],
};
const mk = (over: Partial<ToolsetConfig> = {}) => {
  const urls: string[] = [];
  const t = new Toolset({
    serverUrl: "http://localhost:3000", trustedPayees: ["0.0.111", "0.0.222"], trustedOrigins: ["http://localhost:3100"],
    sessionBudget: 6_000_000n, maxPerCall: 5_000_000n, fetchCatalogue: async () => cat,
    makePay: (guard) => async (url, opts) => {
      urls.push(url);
      const e = cat.endpoints.find((x) => url.endsWith(x.path))!;
      const v = guard.spend({ amount: e.priceTinybars, payTo: e.payTo ?? cat.payTo, asset: "0.0.0" }, opts?.maxAmount);
      if (!v.ok) return { ok: false, reason: v.reason };
      return { ok: true, data: { ok: e.id }, txId: "0.0.1@5", amount: BigInt(e.priceTinybars), asset: "0.0.0" };
    },
    ...over,
  });
  return { t, urls };
};
const text = (r: { content: { text: string }[] }) => r.content[0].text;

describe("MCP Toolset", () => {
  it("lists the catalogue with prices in HBAR", async () => {
    const r = await mk().t.listCatalogue();
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(text(r)).endpoints[0]).toMatchObject({ id: "weather", price: "0.01 HBAR" });
  });
  it("buys data, returns the tx link and warns the data is untrusted", async () => {
    const r = await mk().t.buyData("weather");
    const j = JSON.parse(text(r));
    expect(j.hashscanUrl).toContain("hashscan.io/testnet/transaction/");
    expect(j.remaining).toBe("0.05 HBAR");
    expect(j.warning).toMatch(/untrusted/);
  });
  it("routes a second seller to its own origin", async () => {
    const { t, urls } = mk();
    await t.buyData("briefing");
    expect(urls[0]).toBe("http://localhost:3100/api/briefing");
  });
  it("refuses unknown endpoints without paying", async () => {
    const { t, urls } = mk();
    expect((await t.buyData("steal")).isError).toBe(true);
    expect(urls).toHaveLength(0);
  });
  it("enforces the session budget", async () => {
    const { t } = mk();
    expect((await t.buyData("headlines")).isError).toBeUndefined(); // 5,000,000 of 6,000,000
    const r = await t.buyData("weather"); // 1,000,000 fits exactly
    expect(r.isError).toBeUndefined();
    const r2 = await t.buyData("weather");
    expect(r2.isError).toBe(true);
    expect(text(r2)).toMatch(/remaining budget/);
  });
  it("refuses above the approval threshold (no human over MCP)", async () => {
    const { t, urls } = mk({ approvalAbove: 2_000_000n });
    const r = await t.buyData("headlines");
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/approval/);
    expect(urls).toHaveLength(0);
  });
  it("refuses a catalogue that names an untrusted payee, and pays nothing", async () => {
    const evil = { ...cat, payTo: "0.0.666" };
    const { t, urls } = mk({ fetchCatalogue: async () => evil });
    expect((await t.listCatalogue()).isError).toBe(true);
    expect((await t.buyData("weather")).isError).toBe(true);
    expect(urls).toHaveLength(0);
  });
  it("tracks spend in budget_status", async () => {
    const { t } = mk();
    await t.buyData("weather");
    const j = JSON.parse(text(t.budgetStatus()));
    expect(j).toMatchObject({ spent: "0.01 HBAR", remaining: "0.05 HBAR" });
    expect(j.purchases).toHaveLength(1);
  });
  it("parallel buy_data calls cannot exceed the session budget", async () => {
    const { t } = mk({ sessionBudget: 2_000_000n });
    const results = await Promise.all(Array.from({ length: 5 }, () => t.buyData("weather")));
    expect(results.filter((r) => !r.isError)).toHaveLength(2);
    expect(JSON.parse(text(t.budgetStatus())).spent).toBe("0.02 HBAR");
  });
  it("passes the advertised price as maxAmount", async () => {
    const seen: (bigint | undefined)[] = [];
    const { t } = mk({ makePay: () => async (_u, opts) => (seen.push(opts?.maxAmount), { ok: false, reason: "x" }) });
    await t.buyData("headlines");
    expect(seen).toEqual([5_000_000n]);
  });
  it("records a failed-but-charged purchase in budget_status", async () => {
    const { t } = mk({ makePay: () => async () => ({ ok: false, reason: "Endpoint returned HTTP 500", chargedTinybars: 1_000_000n }) });
    await t.buyData("weather");
    expect(JSON.parse(text(t.budgetStatus())).purchases[0]).toMatchObject({ endpointId: "weather", failed: "Endpoint returned HTTP 500" });
  });
});
