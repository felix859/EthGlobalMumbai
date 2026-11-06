import { describe, it, expect } from "vitest";
import { BudgetGuard, SpendLimit } from "./budget.js";

const cfg = { runBudget: 50_000_000n, maxPerCall: 10_000_000n, allowedPayTo: "0.0.111", allowedAsset: "0.0.0" };
const ok = { amount: "1000000", payTo: "0.0.111", asset: "0.0.0" };
const amt = (amount: string) => ({ ...ok, amount });

describe("BudgetGuard.check", () => {
  it("allows a valid payment", () => {
    expect(new BudgetGuard(cfg).check(ok)).toEqual({ ok: true });
  });
  it("rejects over the per-call cap, allows exactly the cap", () => {
    expect(new BudgetGuard(cfg).check(amt("10000001")).ok).toBe(false);
    expect(new BudgetGuard(cfg).check(amt("10000000")).ok).toBe(true);
  });
  it("rejects a payTo that is not allowlisted, and a different asset", () => {
    expect(new BudgetGuard(cfg).check({ ...ok, payTo: "0.0.999" }).ok).toBe(false);
    expect(new BudgetGuard(cfg).check({ ...ok, asset: "0.0.6001" }).ok).toBe(false);
  });
  it.each(["-1", "0", "1.5", "abc", "", "1e6", "0x10", " 5", "99999999999999999999999999"])("rejects malformed amount %j", (amount) => {
    expect(new BudgetGuard(cfg).check(amt(amount)).ok).toBe(false);
  });
  it("maxAmount bounds a single purchase (advertised / approved price)", () => {
    const g = new BudgetGuard(cfg);
    expect(g.check(amt("2000000"), 2_000_000n).ok).toBe(true);
    const r = g.check(amt("2000001"), 2_000_000n);
    expect(r).toMatchObject({ ok: false });
    expect((r as any).reason).toMatch(/advertised or approved/);
  });
  it("accepts any payee in an allowlist of several", () => {
    const g = new BudgetGuard({ ...cfg, allowedPayTo: ["0.0.111", "0.0.222"] });
    expect(g.check({ ...ok, payTo: "0.0.222" }).ok).toBe(true);
    expect(g.check({ ...ok, payTo: "0.0.333" }).ok).toBe(false);
  });
  it("refuses to be built with an empty allowlist", () => {
    expect(() => new BudgetGuard({ ...cfg, allowedPayTo: [] })).toThrow();
  });
});

describe("BudgetGuard reservations", () => {
  it("reserve holds budget immediately, so a second reservation sees less", () => {
    const g = new BudgetGuard({ ...cfg, runBudget: 3_000_000n });
    const a = g.reserve(amt("2000000"));
    expect(a.ok).toBe(true);
    expect(g.remaining).toBe(1_000_000n);
    expect(g.reserve(amt("2000000")).ok).toBe(false); // would have passed with check-then-record
    expect(g.reserve(amt("1000000")).ok).toBe(true); // exact boundary
  });
  it("many concurrent reservations never exceed the budget", async () => {
    const g = new BudgetGuard({ ...cfg, runBudget: 5_000_000n });
    const results = await Promise.all(Array.from({ length: 20 }, async () => g.reserve(amt("1000000"))));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
  });
  it("commit moves the amount to spent; release returns it", () => {
    const g = new BudgetGuard(cfg);
    const a = g.reserve(ok);
    const b = g.reserve(ok);
    if (!a.ok || !b.ok) throw new Error("setup");
    a.reservation.commit();
    b.reservation.release();
    expect(g.spent).toBe(1_000_000n);
    expect(g.remaining).toBe(49_000_000n);
  });
  it("commit/release are idempotent and exclusive", () => {
    const g = new BudgetGuard(cfg);
    const a = g.reserve(ok);
    if (!a.ok) throw new Error("setup");
    a.reservation.commit();
    a.reservation.commit();
    a.reservation.release();
    expect(g.spent).toBe(1_000_000n);
    expect(a.reservation.settled).toBe(true);
  });
  it("refuses everything once exhausted", () => {
    const g = new BudgetGuard({ ...cfg, runBudget: 1_000_000n });
    expect(g.spend(ok).ok).toBe(true);
    expect(g.check(ok).ok).toBe(false);
    expect(g.reserve(ok).ok).toBe(false);
  });
});

describe("parent SpendLimit (process-wide ceiling)", () => {
  it("two guards sharing a parent cannot together exceed it", () => {
    const parent = new SpendLimit(3_000_000n, "process ceiling");
    const g1 = new BudgetGuard({ ...cfg, parent });
    const g2 = new BudgetGuard({ ...cfg, parent });
    expect(g1.reserve(amt("2000000")).ok).toBe(true);
    const r = g2.reserve(amt("2000000"));
    expect(r.ok).toBe(false);
    expect((r as any).reason).toMatch(/process ceiling/);
    expect(g2.reserve(amt("1000000")).ok).toBe(true);
    expect(parent.remaining).toBe(0n);
  });
  it("a failed parent reservation does not leak the guard's own reservation", () => {
    const parent = new SpendLimit(1_000_000n);
    const g = new BudgetGuard({ ...cfg, parent });
    expect(g.reserve(amt("2000000")).ok).toBe(false);
    expect(g.spent).toBe(0n);
    expect(g.remaining).toBe(1_000_000n);
  });
  it("release returns budget to both", () => {
    const parent = new SpendLimit(5_000_000n);
    const g = new BudgetGuard({ ...cfg, parent });
    const r = g.reserve(amt("2000000"));
    if (!r.ok) throw new Error("setup");
    r.reservation.release();
    expect(parent.remaining).toBe(5_000_000n);
  });
  it("remaining reports the tighter of guard and parent", () => {
    const g = new BudgetGuard({ ...cfg, parent: new SpendLimit(2_000_000n) });
    expect(g.remaining).toBe(2_000_000n);
  });
  it("SpendLimit rejects a non-positive limit and over-commit", () => {
    expect(() => new SpendLimit(0n)).toThrow();
    const l = new SpendLimit(10n);
    expect(() => l.commit(1n)).toThrow();
  });
});
