import { describe, it, expect } from "vitest";
import { buildBriefing, UpstreamError } from "./briefing.js";

const ok = (path: string, amount = 1_000_000n) => ({ ok: true as const, data: { path }, txId: `0.0.1@${path}`, amount, asset: "0.0.0" });

describe("buildBriefing", () => {
  it("buys every path, combines the data and totals the cost", async () => {
    const urls: string[] = [];
    const b = await buildBriefing("http://data:3000", ["/api/weather", "/api/hbar-price"], async (u) => { urls.push(u); return ok(new URL(u).pathname, 1_500_000n); }, () => new Date("2026-11-06T00:00:00Z"));
    expect(urls).toEqual(["http://data:3000/api/weather", "http://data:3000/api/hbar-price"]);
    expect(Object.keys(b.data)).toEqual(["weather", "hbar-price"]);
    expect(b.costTinybars).toBe("3000000");
    expect(b.paid.map((p) => p.txId)).toEqual(["0.0.1@/api/weather", "0.0.1@/api/hbar-price"]);
    expect(b.generatedAt).toBe("2026-11-06T00:00:00.000Z");
  });
  it("fails the whole briefing if any upstream purchase fails", async () => {
    let n = 0;
    await expect(buildBriefing("http://d", ["/api/a", "/api/b"], async () => (++n === 1 ? ok("/api/a") : { ok: false, reason: "denied" }))).rejects.toThrow(UpstreamError);
  });
  it("refuses an empty path list", async () => {
    await expect(buildBriefing("http://d", [], async () => ok("x"))).rejects.toThrow(/No upstream/);
  });
});
