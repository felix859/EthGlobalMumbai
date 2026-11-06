import { describe, it, expect } from "vitest";
import type { RunEvent } from "@pennyagent/shared";
import { RunHub } from "./runs.js";
import { startRun } from "./session.js";

const thinking = (text: string): RunEvent => ({ type: "thinking", text });

describe("RunHub", () => {
  it("replays past events to a late subscriber, then streams new ones", () => {
    const hub = new RunHub();
    const id = hub.create();
    hub.emit(id, thinking("a"));
    const seen: string[] = [];
    hub.subscribe(id, (e) => seen.push((e as { text: string }).text), () => seen.push("done"));
    hub.emit(id, thinking("b"));
    hub.finish(id);
    expect(seen).toEqual(["a", "b", "done"]);
  });

  it("a subscriber to a finished run gets the whole run and an immediate done", () => {
    const hub = new RunHub();
    const id = hub.create();
    hub.emit(id, thinking("a"));
    hub.finish(id);
    hub.emit(id, thinking("late")); // dropped
    const seen: string[] = [];
    hub.subscribe(id, (e) => seen.push((e as { text: string }).text), () => seen.push("done"));
    expect(seen).toEqual(["a", "done"]);
  });

  it("counts active runs and returns null for unknown ones", () => {
    const hub = new RunHub();
    const a = hub.create();
    hub.create();
    hub.finish(a);
    expect(hub.active).toBe(1);
    expect(hub.subscribe("nope", () => {}, () => {})).toBeNull();
  });
});

describe("startRun", () => {
  it("passes its runId and policy to the agent and waits for a slow audit before finishing", async () => {
    const hub = new RunHub();
    let got: { runId?: string; policy?: unknown } = {};
    const { runId, done } = startRun(
      { question: "q", budgetTinybars: "100", maxPerCallTinybars: "50" },
      {
        hub,
        record: false,
        submitAudit: async () => (await new Promise((r) => setTimeout(r, 30)), { topicId: "0.0.5", sequenceNumber: "1" }),
        runAgent: async (o) => {
          got = { runId: o.runId, policy: o.policy };
          o.emit({ type: "started", runId: o.runId!, budgetTinybars: "100" });
          void o.onPayment!({ v: 1, runId: o.runId!, endpointId: "weather", amount: "1", asset: "0.0.0", txId: "t", ts: 1 });
          o.emit({ type: "answer", text: "done" }); // returns before the audit lands, like the real agent
        },
      },
    );
    const types: string[] = [];
    hub.subscribe(runId, (e) => types.push(e.type), () => types.push("END"));
    await done;
    expect(got).toEqual({ runId, policy: { maxPerCallTinybars: "50", approvalAboveTinybars: undefined } });
    expect(types).toEqual(["started", "answer", "audit", "END"]);
  });

  it("does not hang on an audit that never returns", async () => {
    const hub = new RunHub();
    const { done } = startRun({ question: "q", budgetTinybars: "1" }, {
      hub, record: false, auditGraceMs: 20,
      submitAudit: () => new Promise(() => {}),
      runAgent: async (o) => void o.onPayment!({ v: 1, runId: "r", endpointId: "weather", amount: "1", asset: "0.0.0", txId: "t", ts: 1 }),
    });
    await expect(done).resolves.toBeUndefined();
  });
});
