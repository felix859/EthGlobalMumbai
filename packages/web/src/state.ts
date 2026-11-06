// The whole run screen is derived from the RunEvent stream by one pure reducer, so it is easy to test and
// identical for real runs, replays and mock mode. Unknown event types are ignored (contract changes are additive).
import type { RunEvent } from "@pennyagent/shared";

export type TimelineItem =
  | { kind: "thinking"; id: number; text: string }
  | { kind: "payment"; id: number; endpointId: string; amountTinybars: string; txId: string; hashscanUrl: string; fromAgent: boolean }
  | { kind: "denied"; id: number; endpointId: string; reason: string }
  | { kind: "approval"; id: number; approvalId: string; endpointId: string; amountTinybars: string; expiresAt: number; outcome?: "approved" | "rejected" | "timeout" }
  | { kind: "audit"; id: number; topicId: string; sequenceNumber: string }
  | { kind: "warning"; id: number; text: string };

export interface RunState {
  status: "idle" | "running" | "done" | "error";
  runId?: string;
  budgetTinybars?: string;
  spentTinybars: string;
  items: TimelineItem[];
  pendingApprovalId?: string;
  answer?: string;
  receipt?: { tokenId: string; serial: string; hashscanUrl: string };
  error?: string;
}

export const initialRunState: RunState = { status: "idle", spentTinybars: "0", items: [] };

/** Endpoints sold by another agent rather than the data server. */
export const AGENT_SELLERS = new Set(["briefing"]);

/** Only links we can vouch for are rendered as links (defence in depth: event data comes from the network). */
export const safeHashscan = (url: string): string | undefined => (/^https:\/\/hashscan\.io\/(testnet|mainnet)\//.test(url) ? url : undefined);

export function reduceRun(state: RunState, e: RunEvent): RunState {
  const nextId = state.items.length ? state.items[state.items.length - 1].id + 1 : 1;
  const add = (item: TimelineItem): RunState => ({ ...state, items: [...state.items, item] });

  switch (e.type) {
    case "started":
      return { ...initialRunState, status: "running", runId: e.runId, budgetTinybars: e.budgetTinybars };
    case "thinking":
      return add({ kind: "thinking", id: nextId, text: e.text });
    case "payment":
      return {
        ...add({ kind: "payment", id: nextId, endpointId: e.endpointId, amountTinybars: e.amountTinybars, txId: e.txId, hashscanUrl: e.hashscanUrl, fromAgent: AGENT_SELLERS.has(e.endpointId) }),
        spentTinybars: e.spentTinybars,
      };
    case "denied":
      return add({ kind: "denied", id: nextId, endpointId: e.endpointId, reason: e.reason });
    case "approval_required":
      return {
        ...add({ kind: "approval", id: nextId, approvalId: e.approvalId, endpointId: e.endpointId, amountTinybars: e.amountTinybars, expiresAt: e.expiresAt }),
        pendingApprovalId: e.approvalId,
      };
    case "approval_resolved":
      return {
        ...state,
        pendingApprovalId: state.pendingApprovalId === e.approvalId ? undefined : state.pendingApprovalId,
        items: state.items.map((i) => (i.kind === "approval" && i.approvalId === e.approvalId ? { ...i, outcome: e.outcome } : i)),
      };
    case "audit":
      return add({ kind: "audit", id: nextId, topicId: e.topicId, sequenceNumber: e.sequenceNumber });
    case "audit_failed":
      return add({ kind: "warning", id: nextId, text: `Audit log write failed: ${e.reason}` });
    case "receipt":
      return { ...state, receipt: { tokenId: e.tokenId, serial: e.serial, hashscanUrl: e.hashscanUrl } };
    case "receipt_failed":
      return add({ kind: "warning", id: nextId, text: `Receipt NFT could not be minted: ${e.reason}` });
    case "answer":
      return { ...state, status: "done", answer: e.text, pendingApprovalId: undefined };
    case "error":
      return { ...state, status: "error", error: e.message, pendingApprovalId: undefined };
    default:
      return state; // unknown, newer event types
  }
}

/** Fraction of the budget spent, 0..1, safe for missing or zero budgets. */
export function spentFraction(s: RunState): number {
  if (!s.budgetTinybars) return 0;
  const b = BigInt(s.budgetTinybars);
  if (b <= 0n) return 0;
  const f = Number((BigInt(s.spentTinybars) * 10_000n) / b) / 10_000;
  return Math.min(1, Math.max(0, f));
}
