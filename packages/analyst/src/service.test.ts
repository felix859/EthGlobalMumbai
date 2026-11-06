import { describe, it, expect } from "vitest";
import type { PayResult } from "@pennyagent/agent/pay";
import { createBriefingService, upstreamCost, validateAnalystConfig, type AnalystConfig } from "./service.js";

const cfg: AnalystConfig = {
  priceTinybars: 3_000_000n, costCapTinybars: 2_000_000n, maxTotalSpendTinybars: 50_000_000n, maxPerCallTinybars: 10_000_000n,
  maxConcurrent: 2, maxPerMinute: 10, upstreamUrl: "http://data:3000", paths: ["/api/weather"], dataMerchant: "0.0.111",
};
const paying = (amount = "1000000", delayMs = 0) => (guard: any) => async (): Promise<PayResult> => {
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  const v = guard.spend({ amount, payTo: "0.0.111", asset: "0.0.0" });
  return v.ok ? { ok: true, data: { t: 1 }, txId: "0.0.1@1", amount: BigInt(amount), asset: "0.0.0" } : { ok: false, reason: v.reason };
};

describe("Analyst config", () => {
  it("refuses a cost cap at or above the sale price", () => {
    expect(() => validateAnalystConfig({ ...cfg, costCapTinybars: 3_000_000n })).toThrow(/must be below/);
    expect(() => validateAnalystConfig({ ...cfg, costCapTinybars: 20_000_000n })).toThrow(/lose money/);
  });
  it("refuses empty paths and zero limits", () => {
    expect(() => validateAnalystConfig({ ...cfg, paths: [] })).toThrow();
    expect(() => validateAnalystConfig({ ...cfg, maxConcurrent: 0 })).toThrow();
  });
});

describe("Analyst briefing service", () => {
  it("sells a briefing within the cost cap", async () => {
    const s = createBriefingService(cfg, paying());
    const r = await s.handle();
    expect(r.status).toBe(200);
    expect((r.body as any).costTinybars).toBe("1000000");
  });
  it("an upstream purchase above the cost cap fails with 502, so the buyer is not charged", async () => {
    const s = createBriefingService(cfg, paying("2500000"));
    const r = await s.handle();
    expect(r.status).toBe(502);
  });
  it("rate-limits to maxPerMinute (429)", async () => {
    let t = 0;
    const s = createBriefingService({ ...cfg, maxPerMinute: 2 }, paying(), () => t);
    expect((await s.handle()).status).toBe(200);
    expect((await s.handle()).status).toBe(200);
    expect((await s.handle()).status).toBe(429);
    t = 61_000;
    expect((await s.handle()).status).toBe(200);
  });
  it("caps concurrent briefings (503)", async () => {
    const s = createBriefingService({ ...cfg, maxConcurrent: 1 }, paying("1000000", 30));
    const [a, b] = await Promise.all([s.handle(), s.handle()]);
    expect([a.status, b.status].sort()).toEqual([200, 503]);
  });
  it("stops at the wallet-wide spending limit across sales", async () => {
    const s = createBriefingService({ ...cfg, maxTotalSpendTinybars: 2_000_000n, maxPerMinute: 100 }, paying());
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await s.handle()).status);
    expect(statuses).toEqual([200, 200, 503, 503]);
    expect(s.wallet.spent).toBe(2_000_000n);
  });
  it("refuses an absolute upstream path", async () => {
    const s = createBriefingService({ ...cfg, paths: ["//evil.com/x"] }, paying());
    expect((await s.handle()).status).toBe(502);
  });
});

describe("Analyst affordability", () => {
  const cat = { endpoints: [{ path: "/api/weather", priceTinybars: "1000000" }, { path: "/api/hbar-price", priceTinybars: "3000000" }] };
  it("sums upstream prices and rejects unknown paths", () => {
    expect(upstreamCost(cat, ["/api/weather", "/api/hbar-price"])).toBe(4_000_000n);
    expect(() => upstreamCost(cat, ["/api/nope"])).toThrow(/does not sell/);
  });
  it("refuses a config whose upstream cost exceeds the cost cap (the old defaults)", () => {
    expect(() => validateAnalystConfig({ ...cfg, upstreamCostTinybars: 4_000_000n })).toThrow(/more than BRIEFING_COST_CAP/);
    expect(() => validateAnalystConfig({ ...cfg, upstreamCostTinybars: 1_000_000n })).not.toThrow();
  });
  it("refuses a list of payees as the data merchant", () => {
    expect(() => validateAnalystConfig({ ...cfg, dataMerchant: "0.0.111,0.0.222" })).toThrow(/ONE account id/);
  });
  it("does not start a briefing it cannot finish within the wallet limit", async () => {
    let bought = 0;
    const s = createBriefingService({ ...cfg, upstreamCostTinybars: 1_500_000n, maxTotalSpendTinybars: 2_000_000n, maxPerMinute: 100 }, (guard: any) => async () => {
      bought++;
      guard.spend({ amount: "1000000", payTo: "0.0.111", asset: "0.0.0" });
      return { ok: true, data: {}, txId: "t", amount: 1_000_000n, asset: "0.0.0" };
    });
    expect((await s.handle()).status).toBe(200); // 1,000,000 spent, 1,000,000 left < 1,500,000 needed
    expect((await s.handle()).status).toBe(503);
    expect(bought).toBe(1);
  });
});
