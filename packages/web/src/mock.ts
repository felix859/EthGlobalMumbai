// Mock mode (?mock=1): the dashboard without any backend. It replays the committed sample run (runs/sample.json),
// adds an approval step when the policy asks for one, and ends with a receipt, so every UI state can be shown.
// The ids below are our real public testnet accounts; the tx ids in the sample are real testnet payments.
import type { AgentConfig, AskRequest, HealthReport, RunEvent } from "@pennyagent/shared";
import sample from "../../../runs/sample.json";
import type { AgentApi } from "./api.js";

const CONFIG: AgentConfig = {
  network: "hedera:testnet",
  agentAccount: "0.0.11340811",
  merchantAccount: "0.0.11341093",
  topicId: "0.0.11341094",
  identityTopicId: "0.0.11341592",
  uaid: "uaid:aid:21pgm9NKjjXGt6omthFPV2qhcCHU4hYk6mGyKvsWdzDoffu66jYbEVUK4JfmqD6798;uid=0;registry=self;proto=x402;nativeId=hedera:testnet:0.0.11340811",
};

type Timed = { t: number; event: RunEvent };
const recorded = (sample as { events: Timed[] }).events;

export function mockApi(speed = 1): AgentApi {
  const runs = new Map<string, AskRequest | undefined>();
  const decisions = new Map<string, (approve: boolean) => void>();
  let n = 0;

  return {
    mode: "mock",
    config: async () => CONFIG,
    health: async (): Promise<HealthReport> => ({
      ok: true,
      checkedAt: Date.now(),
      facilitator: { ok: true, detail: "mock mode: not checked" },
      server: { ok: true, detail: "mock mode: not checked" },
      agentBalance: { ok: true, detail: "mock mode: not checked" },
    }),
    ask: async (req) => {
      const runId = `mock-${++n}`;
      runs.set(runId, req);
      return { runId };
    },
    replay: async () => {
      const runId = `mock-replay-${++n}`;
      runs.set(runId, undefined);
      return { runId };
    },
    approve: async (_runId, approvalId, approve) => {
      const d = decisions.get(approvalId);
      if (!d) return false;
      decisions.delete(approvalId);
      d(approve);
      return true;
    },
    subscribe(runId, onEvent) {
      let stopped = false;
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.min(ms, 1500) / speed));
      const req = runs.get(runId);
      void (async () => {
        let prev = 0;
        let approved = true;
        for (const { t, event } of recorded) {
          await sleep(t - prev);
          prev = t;
          if (stopped) return;
          if (event.type === "started") {
            onEvent({ ...event, runId, budgetTinybars: req?.budgetTinybars ?? event.budgetTinybars });
            continue;
          }
          // With an approval threshold below a purchase's price, pause and ask, like the real agent does.
          if (event.type === "payment" && req?.approvalAboveTinybars && BigInt(event.amountTinybars) > BigInt(req.approvalAboveTinybars)) {
            const approvalId = `${runId}-a${event.endpointId}`;
            const timeoutMs = 30_000;
            onEvent({ type: "approval_required", approvalId, endpointId: event.endpointId, amountTinybars: event.amountTinybars, timeoutMs, expiresAt: Date.now() + timeoutMs });
            approved = await new Promise<boolean>((resolve) => {
              decisions.set(approvalId, resolve);
              setTimeout(() => decisions.has(approvalId) && (decisions.delete(approvalId), resolve(false)), timeoutMs);
            });
            if (stopped) return;
            onEvent({ type: "approval_resolved", approvalId, outcome: approved ? "approved" : "rejected" });
            if (!approved) {
              onEvent({ type: "denied", endpointId: event.endpointId, reason: "A human reviewer rejected this purchase" });
              continue;
            }
          }
          if (event.type === "audit" && !approved) continue;
          if (event.type === "answer") {
            onEvent(event);
            await sleep(800);
            if (!stopped) onEvent({ type: "receipt", tokenId: "0.0.11341392", serial: "1", txId: "mock", hashscanUrl: "https://hashscan.io/testnet/token/0.0.11341392/1" });
            return;
          }
          onEvent(event);
        }
      })();
      return () => {
        stopped = true;
      };
    },
  };
}
