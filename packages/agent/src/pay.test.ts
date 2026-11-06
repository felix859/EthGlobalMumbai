import { describe, it, expect } from "vitest";
import { BudgetGuard } from "./budget.js";
import { makeGuardPolicy } from "./pay.js";

const guard = () => new BudgetGuard({ runBudget: 5_000_000n, maxPerCall: 2_000_000n, allowedPayTo: "0.0.111", allowedAsset: "0.0.0" });
const req = (o: Partial<{ amount: string; payTo: string; asset: string }> = {}) =>
  ({ scheme: "exact", network: "hedera:testnet", amount: "1000000", payTo: "0.0.111", asset: "0.0.0", ...o }) as any;

describe("makeGuardPolicy", () => {
  it("keeps requirements the guard allows and remembers the chosen one", () => {
    const s = { denial: undefined as string | undefined, accepted: undefined as any };
    const out = makeGuardPolicy(guard(), s)(2, [req()]);
    expect(out).toHaveLength(1);
    expect(s.accepted.amount).toBe("1000000");
    expect(s.denial).toBeUndefined();
  });
  it("drops a requirement paying someone else and records why", () => {
    const s = { denial: undefined as string | undefined, accepted: undefined as any };
    const out = makeGuardPolicy(guard(), s)(2, [req({ payTo: "0.0.666" })]);
    expect(out).toHaveLength(0);
    expect(s.denial).toMatch(/allowlisted/);
  });
  it("drops an over-cap price", () => {
    const s = { denial: undefined as string | undefined, accepted: undefined as any };
    expect(makeGuardPolicy(guard(), s)(2, [req({ amount: "2000001" })])).toHaveLength(0);
    expect(s.denial).toMatch(/per-call cap/);
  });
  it("picks the first allowed option when several are offered", () => {
    const s = { denial: undefined as string | undefined, accepted: undefined as any };
    const out = makeGuardPolicy(guard(), s)(2, [req({ payTo: "0.0.666" }), req({ amount: "1500000" })]);
    expect(out).toHaveLength(1);
    expect(s.accepted.amount).toBe("1500000");
  });
});
