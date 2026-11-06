import { describe, it, expect, vi } from "vitest";
import { ApprovalGate, needsApproval, resolvePolicy } from "./policy.js";

describe("resolvePolicy", () => {
  it("defaults: no approval, 10M cap, 30 s timeout", () => {
    expect(resolvePolicy({}, {})).toEqual({ maxPerCall: 10_000_000n, approvalAbove: undefined, approvalTimeoutMs: 30_000 });
  });
  it("reads options over env", () => {
    const p = resolvePolicy({ maxPerCallTinybars: "5", approvalAboveTinybars: "2" }, { MAX_PRICE_PER_CALL: "9", APPROVAL_ABOVE_TINYBARS: "8" });
    expect(p).toMatchObject({ maxPerCall: 5n, approvalAbove: 2n });
  });
  it("reads env when no options", () => {
    expect(resolvePolicy({}, { APPROVAL_ABOVE_TINYBARS: "3000000", APPROVAL_TIMEOUT_MS: "5000" })).toMatchObject({ approvalAbove: 3_000_000n, approvalTimeoutMs: 5000 });
  });
  it('"0" disables approvals', () => {
    expect(resolvePolicy({ approvalAboveTinybars: "0" }, {}).approvalAbove).toBeUndefined();
  });
  it.each(["-1", "1.5", "abc", "1e6"])("rejects bad value %j", (v) => {
    expect(() => resolvePolicy({ approvalAboveTinybars: v }, {})).toThrow();
    expect(() => resolvePolicy({ maxPerCallTinybars: v }, {})).toThrow();
  });
  it("rejects a zero per-call cap", () => {
    expect(() => resolvePolicy({ maxPerCallTinybars: "0" }, {})).toThrow();
  });
});

describe("needsApproval", () => {
  const p = resolvePolicy({ approvalAboveTinybars: "2000000" }, {});
  it("is strictly above the threshold", () => {
    expect(needsApproval(p, 2_000_000n)).toBe(false);
    expect(needsApproval(p, 2_000_001n)).toBe(true);
  });
  it("never when unset", () => {
    expect(needsApproval(resolvePolicy({}, {}), 999_999_999n)).toBe(false);
  });
});

describe("ApprovalGate", () => {
  it("approve and reject resolve the waiter", async () => {
    const g = new ApprovalGate();
    const a = g.request("a", 1000), b = g.request("b", 1000);
    expect(g.resolve("a", true)).toBe(true);
    expect(g.resolve("b", false)).toBe(true);
    expect(await a).toBe("approved");
    expect(await b).toBe("rejected");
    expect(g.size).toBe(0);
  });
  it("times out instead of hanging, and a late decision is refused", async () => {
    vi.useFakeTimers();
    const g = new ApprovalGate();
    const p = g.request("x", 5000);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await p).toBe("timeout");
    expect(g.resolve("x", true)).toBe(false);
    vi.useRealTimers();
  });
  it("unknown and double decisions return false", async () => {
    const g = new ApprovalGate();
    expect(g.resolve("nope", true)).toBe(false);
    const p = g.request("y", 1000);
    expect(g.resolve("y", true)).toBe(true);
    expect(g.resolve("y", false)).toBe(false);
    expect(await p).toBe("approved");
  });
});
