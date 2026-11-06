import { describe, it, expect } from "vitest";
import { BudgetGuard } from "./budget.js";

const cfg = { runBudget: 50_000_000n, maxPerCall: 10_000_000n, allowedPayTo: "0.0.111", allowedAsset: "0.0.0" };
const ok = { amount: "1000000", payTo: "0.0.111", asset: "0.0.0" };

describe("BudgetGuard", () => {
  it("allows a valid payment", () => {
    expect(new BudgetGuard(cfg).check(ok)).toEqual({ ok: true });
  });
  it("rejects over the per-call cap", () => {
    const r = new BudgetGuard(cfg).check({ ...ok, amount: "10000001" });
    expect(r.ok).toBe(false);
  });
  it("allows exactly the per-call cap", () => {
    expect(new BudgetGuard(cfg).check({ ...ok, amount: "10000000" }).ok).toBe(true);
  });
  it("rejects when the run budget would be exceeded, allows the exact boundary", () => {
    const g = new BudgetGuard({ ...cfg, runBudget: 3_000_000n });
    g.record(2_000_000n);
    expect(g.check({ ...ok, amount: "1000001" }).ok).toBe(false);
    expect(g.check({ ...ok, amount: "1000000" }).ok).toBe(true);
  });
  it("tracks spent and remaining", () => {
    const g = new BudgetGuard(cfg);
    g.record(1_000_000n);
    expect(g.spent).toBe(1_000_000n);
    expect(g.remaining).toBe(49_000_000n);
  });
  it("rejects a payTo that is not the allowlisted merchant", () => {
    expect(new BudgetGuard(cfg).check({ ...ok, payTo: "0.0.999" }).ok).toBe(false);
  });
  it("rejects a different asset", () => {
    expect(new BudgetGuard(cfg).check({ ...ok, asset: "0.0.6001" }).ok).toBe(false);
  });
  it.each(["-1", "0", "1.5", "abc", "", "1e6", "0x10", " 5", "99999999999999999999999999"])(
    "rejects malformed or unsafe amount %j",
    (amount) => {
      expect(new BudgetGuard(cfg).check({ ...ok, amount }).ok).toBe(false);
    },
  );
  it("refuses everything once the budget is exhausted", () => {
    const g = new BudgetGuard({ ...cfg, runBudget: 1_000_000n });
    g.record(1_000_000n);
    expect(g.check(ok).ok).toBe(false);
  });
  it("record() refuses to overspend", () => {
    const g = new BudgetGuard({ ...cfg, runBudget: 1_000_000n });
    expect(() => g.record(2_000_000n)).toThrow();
  });

  it("accepts any payee in an allowlist of several, still refuses others", () => {
    const g = new BudgetGuard({ ...cfg, allowedPayTo: ["0.0.111", "0.0.222"] });
    expect(g.check({ ...ok, payTo: "0.0.222" }).ok).toBe(true);
    expect(g.check({ ...ok, payTo: "0.0.333" }).ok).toBe(false);
  });
  it("refuses to be built with an empty allowlist", () => {
    expect(() => new BudgetGuard({ ...cfg, allowedPayTo: [] })).toThrow();
  });
});
