// The HTTP API on a real port, with a scripted agent instead of Claude + testnet.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { RunEvent } from "@pennyagent/shared";
import { createApi, type ApiDeps } from "./api.js";
import { ApprovalGate } from "./policy.js";
import type { RunOptions } from "./run.js";

const config = { topicId: "0.0.11341094", merchantAccount: "0.0.11341093", agentAccount: "0.0.11340811", network: "hedera:testnet" };
const gate = new ApprovalGate();

/** A fake agent: one payment (audited), optionally one approval, then an answer. */
async function fakeAgent(o: RunOptions) {
  o.emit({ type: "started", runId: o.runId!, budgetTinybars: o.budgetTinybars });
  o.emit({ type: "payment", endpointId: "weather", amountTinybars: "1000000", asset: "0.0.0", txId: "0.0.1@1", hashscanUrl: "h", spentTinybars: "1000000", remainingTinybars: "9000000" });
  void o.onPayment?.({ v: 1, runId: o.runId!, endpointId: "weather", amount: "1000000", asset: "0.0.0", txId: "0.0.1@1", ts: 1 });
  if (o.question.includes("approve")) {
    const decision = o.gate!.request("ap-1", 5_000, o.runId!);
    o.emit({ type: "approval_required", approvalId: "ap-1", endpointId: "headlines", amountTinybars: "5000000", timeoutMs: 5_000, expiresAt: 0 });
    o.emit({ type: "approval_resolved", approvalId: "ap-1", outcome: await decision });
  }
  o.emit({ type: "answer", text: `answer to ${o.question}` });
}

let server: Server;
let base: string;
const start = async (extra: Partial<ApiDeps> = {}) => {
  const s = createApi({
    config,
    gate,
    record: false,
    submitAudit: async () => ({ topicId: config.topicId, sequenceNumber: "42" }),
    runAgent: (o) => fakeAgent({ ...o, gate }),
    health: async () => ({ ok: true, checkedAt: 1 } as never),
    latestRecording: async () => ({ version: 1, recordedAt: "x", events: [{ t: 0, event: { type: "started", runId: "old", budgetTinybars: "1" } }, { t: 5, event: { type: "answer", text: "replayed" } }] }),
    replaySpeed: 1000,
    ...extra,
  });
  s.listen(0);
  await new Promise((r) => s.once("listening", r));
  return { s, url: `http://127.0.0.1:${(s.address() as AddressInfo).port}` };
};
beforeAll(async () => ({ s: server, url: base } = await start()));
afterAll(() => new Promise((r) => server.close(r)));

const post = (path: string, body: unknown, url = base) =>
  fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Reads an SSE stream to its end and returns the RunEvents. */
async function readEvents(runId: string, onEvent?: (e: RunEvent) => void): Promise<RunEvent[]> {
  const r = await fetch(`${base}/api/runs/${runId}/events`);
  expect(r.headers.get("content-type")).toBe("text/event-stream");
  const out: RunEvent[] = [];
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (block.startsWith(":") || block.startsWith("event: end")) continue;
      const e = JSON.parse(block.replace(/^data: /, "")) as RunEvent;
      out.push(e);
      onEvent?.(e);
    }
  }
  return out;
}

describe("agent API", () => {
  it("POST /api/ask returns a runId whose SSE stream carries the run, including the HCS audit, then ends", async () => {
    const r = await post("/api/ask", { question: "Umbrella?", budgetTinybars: "10000000" });
    expect(r.status).toBe(200);
    const { runId } = (await r.json()) as { runId: string };
    expect(runId).toMatch(/^[\w-]{8,}$/);
    const events = await readEvents(runId);
    expect(events.map((e) => e.type)).toEqual(["started", "payment", "answer", "audit"]);
    expect(events[0]).toMatchObject({ runId });
    expect(events[3]).toEqual({ type: "audit", topicId: "0.0.11341094", sequenceNumber: "42" });
  });

  it("a client that connects after the run finished still gets every event", async () => {
    const { runId } = (await (await post("/api/ask", { question: "late", budgetTinybars: "5" })).json()) as { runId: string };
    await new Promise((r) => setTimeout(r, 50));
    expect((await readEvents(runId)).at(-2)).toEqual({ type: "answer", text: "answer to late" });
  });

  it.each([
    [{ budgetTinybars: "100" }, /Question/],
    [{ question: "q", budgetTinybars: "-1" }, /Budget/],
    [{ question: "q", budgetTinybars: "999999999999" }, /exceeds/],
    [{ question: "q", budgetTinybars: "100", maxPerCallTinybars: "abc" }, /maxPerCallTinybars/],
  ])("POST /api/ask rejects bad input %j with 400", async (body, msg) => {
    const r = await post("/api/ask", body);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(msg);
  });

  it("rejects non-JSON bodies", async () => {
    const r = await fetch(`${base}/api/ask`, { method: "POST", body: "question=hi" });
    expect(r.status).toBe(415);
  });

  it("POST /api/runs/:id/approve resolves a pending approval for that run only", async () => {
    const { runId } = (await (await post("/api/ask", { question: "please approve", budgetTinybars: "10000000" })).json()) as { runId: string };
    const events = await readEvents(runId, async (e) => {
      if (e.type !== "approval_required") return;
      expect(await (await post(`/api/runs/other-run/approve`, { approvalId: e.approvalId, approve: true })).json()).toEqual({ ok: false });
      expect(await (await post(`/api/runs/${runId}/approve`, { approvalId: e.approvalId, approve: true })).json()).toEqual({ ok: true });
    });
    expect(events.find((e) => e.type === "approval_resolved")).toMatchObject({ outcome: "approved" });
    expect((await post(`/api/runs/${runId}/approve`, { approvalId: "ap-1", approve: "yes" })).status).toBe(400);
  });

  it("GET /api/config and /api/health", async () => {
    expect(await (await fetch(`${base}/api/config`)).json()).toEqual(config);
    expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({ ok: true });
  });

  it("POST /api/replay streams the latest recording as a new run, with the new runId", async () => {
    const r = await post("/api/replay", {});
    const { runId, replay } = (await r.json()) as { runId: string; replay: boolean };
    expect(replay).toBe(true);
    expect(await readEvents(runId)).toEqual([{ type: "started", runId, budgetTinybars: "1" }, { type: "answer", text: "replayed" }]);
  });

  it("answers 404 for an unknown run or route and sets CORS for the web origin", async () => {
    const r = await fetch(`${base}/api/runs/nope/events`);
    expect(r.status).toBe(404);
    expect(r.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect((await fetch(`${base}/api/nothing`)).status).toBe(404);
    const pre = await fetch(`${base}/api/ask`, { method: "OPTIONS" });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("limits concurrent runs with 429", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((r) => (release = r));
    const { s, url } = await start({ maxActiveRuns: 1, runAgent: () => blocked });
    try {
      expect((await post("/api/ask", { question: "a", budgetTinybars: "1" }, url)).status).toBe(200);
      expect((await post("/api/ask", { question: "b", budgetTinybars: "1" }, url)).status).toBe(429);
    } finally {
      release();
      await new Promise((r) => s.close(r));
    }
  });
});
