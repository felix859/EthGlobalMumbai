import { describe, it, expect } from "vitest";
import type { RunEvent } from "@pennyagent/shared";
import { formatHbar, parseHbar } from "@pennyagent/shared";
import { initialRunState, reduceRun, safeHashscan, spentFraction, type RunState } from "./state.js";

const play = (events: RunEvent[], s: RunState = initialRunState) => events.reduce(reduceRun, s);
const pay = (endpointId: string, spent: string): RunEvent => ({
  type: "payment", endpointId, amountTinybars: "1000000", asset: "0.0.0", txId: `0.0.1@${endpointId}`,
  hashscanUrl: "https://hashscan.io/testnet/transaction/x", spentTinybars: spent, remainingTinybars: "0",
});

describe("reduceRun", () => {
  it("a normal run: started → thinking → payment → answer", () => {
    const s = play([{ type: "started", runId: "r1", budgetTinybars: "5000000" }, { type: "thinking", text: "hmm" }, pay("weather", "1000000"), { type: "answer", text: "Sunny" }]);
    expect(s.status).toBe("done");
    expect(s.spentTinybars).toBe("1000000");
    expect(s.items.map((i) => i.kind)).toEqual(["thinking", "payment"]);
    expect(s.answer).toBe("Sunny");
  });
  it("a new run resets the previous one", () => {
    const s = play([{ type: "started", runId: "r1", budgetTinybars: "1" }, pay("weather", "1"), { type: "started", runId: "r2", budgetTinybars: "9" }]);
    expect(s).toMatchObject({ runId: "r2", items: [], spentTinybars: "0", status: "running" });
  });
  it("labels purchases from another agent", () => {
    const s = play([{ type: "started", runId: "r", budgetTinybars: "9" }, pay("briefing", "1"), pay("weather", "2")]);
    expect(s.items.map((i) => (i.kind === "payment" ? i.fromAgent : null))).toEqual([true, false]);
  });
  it("tracks a pending approval and its outcome", () => {
    let s = play([
      { type: "started", runId: "r", budgetTinybars: "9" },
      { type: "approval_required", approvalId: "a1", endpointId: "headlines", amountTinybars: "5000000", timeoutMs: 30000, expiresAt: 123 },
    ]);
    expect(s.pendingApprovalId).toBe("a1");
    s = reduceRun(s, { type: "approval_resolved", approvalId: "a1", outcome: "rejected" });
    expect(s.pendingApprovalId).toBeUndefined();
    expect(s.items[0]).toMatchObject({ kind: "approval", outcome: "rejected" });
  });
  it("receipt, warnings and errors", () => {
    const s = play([
      { type: "started", runId: "r", budgetTinybars: "9" },
      { type: "audit_failed", reason: "hcs down" },
      { type: "receipt", tokenId: "0.0.5", serial: "2", txId: "t", hashscanUrl: "https://hashscan.io/testnet/token/0.0.5/2" },
      { type: "error", message: "boom" },
    ]);
    expect(s.receipt?.serial).toBe("2");
    expect(s.items[0]).toMatchObject({ kind: "warning" });
    expect(s).toMatchObject({ status: "error", error: "boom" });
  });
  it("ignores unknown event types", () => {
    const s = play([{ type: "started", runId: "r", budgetTinybars: "9" }]);
    expect(reduceRun(s, { type: "something_new" } as unknown as RunEvent)).toBe(s);
  });
});

describe("helpers", () => {
  it("spentFraction is safe and clamped", () => {
    expect(spentFraction(initialRunState)).toBe(0);
    expect(spentFraction({ ...initialRunState, budgetTinybars: "4", spentTinybars: "1" })).toBe(0.25);
    expect(spentFraction({ ...initialRunState, budgetTinybars: "1", spentTinybars: "5" })).toBe(1);
    expect(spentFraction({ ...initialRunState, budgetTinybars: "0", spentTinybars: "5" })).toBe(0);
  });
  it("only HashScan links are treated as safe", () => {
    expect(safeHashscan("https://hashscan.io/testnet/transaction/1")).toBeDefined();
    expect(safeHashscan("javascript:alert(1)")).toBeUndefined();
    expect(safeHashscan("https://evil.example/hashscan.io/testnet/")).toBeUndefined();
  });
  it("formatHbar and parseHbar round-trip exactly", () => {
    expect(formatHbar("3000000")).toBe("0.03");
    expect(formatHbar(1n)).toBe("0.00000001");
    expect(parseHbar("0.5")).toBe("50000000");
    expect(parseHbar("2")).toBe("200000000");
    expect(parseHbar(" 0.00000001 ")).toBe("1");
    for (const bad of ["", "-1", "1.123456789", "abc", "1e3", ".5"]) expect(() => parseHbar(bad)).toThrow();
  });
});
