// Spending policy + optional human approval. The default flow stays fully autonomous;
// when `approvalAboveTinybars` is set, any single purchase above it pauses until a human decides.
import { randomUUID } from "node:crypto";

export type ApprovalOutcome = "approved" | "rejected" | "timeout";

export interface PolicyOptions {
  /** Cap for a single payment (tinybars). Can only LOWER the operator's MAX_PRICE_PER_CALL. */
  maxPerCallTinybars?: string;
  /** Purchases strictly above this need a human OK. Can only LOWER the operator's APPROVAL_ABOVE_TINYBARS. */
  approvalAboveTinybars?: string;
  /** How long to wait for the human. Default 30 s. */
  approvalTimeoutMs?: number;
}

export interface ResolvedPolicy {
  maxPerCall: bigint;
  approvalAbove: bigint | undefined;
  approvalTimeoutMs: number;
}

export const DEFAULT_APPROVAL_TIMEOUT_MS = 30_000;

const asPositive = (v: string | undefined, name: string): bigint | undefined => {
  if (v === undefined || v === "") return undefined;
  if (!/^\d{1,18}$/.test(v)) throw new Error(`${name} must be a non-negative integer string, got "${v}"`);
  return BigInt(v);
};

/**
 * Combines the operator's limits (env) with what a caller asked for. A caller can only make the policy STRICTER:
 * the per-call cap is the smaller of the two, and the approval threshold is the smaller of the two that are set.
 * A request can therefore never raise the cap or switch off an approval the operator configured.
 */
export function resolvePolicy(o: PolicyOptions = {}, env: NodeJS.ProcessEnv = process.env): ResolvedPolicy {
  const operatorCap = asPositive(env.MAX_PRICE_PER_CALL || "10000000", "MAX_PRICE_PER_CALL")!;
  if (operatorCap <= 0n) throw new Error("MAX_PRICE_PER_CALL must be > 0");
  const requestedCap = asPositive(o.maxPerCallTinybars, "maxPerCallTinybars");
  if (requestedCap !== undefined && requestedCap <= 0n) throw new Error("maxPerCallTinybars must be > 0");
  const maxPerCall = requestedCap !== undefined && requestedCap < operatorCap ? requestedCap : operatorCap;

  const positive = (v: bigint | undefined) => (v !== undefined && v > 0n ? v : undefined);
  const operatorAbove = positive(asPositive(env.APPROVAL_ABOVE_TINYBARS, "APPROVAL_ABOVE_TINYBARS"));
  const requestedAbove = positive(asPositive(o.approvalAboveTinybars, "approvalAboveTinybars"));
  const approvalAbove =
    operatorAbove === undefined ? requestedAbove : requestedAbove === undefined ? operatorAbove : requestedAbove < operatorAbove ? requestedAbove : operatorAbove;

  const timeout = o.approvalTimeoutMs ?? (env.APPROVAL_TIMEOUT_MS ? Number(env.APPROVAL_TIMEOUT_MS) : DEFAULT_APPROVAL_TIMEOUT_MS);
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("approvalTimeoutMs must be > 0");
  return { maxPerCall, approvalAbove, approvalTimeoutMs: timeout };
}

export const needsApproval = (p: ResolvedPolicy, priceTinybars: bigint) =>
  p.approvalAbove !== undefined && priceTinybars > p.approvalAbove;

/** Pending human decisions, keyed by approvalId. The HTTP API (#4) calls `resolve`. */
export class ApprovalGate {
  private pending = new Map<string, { runId: string; fn: (o: ApprovalOutcome) => void }>();

  newId = () => randomUUID();

  /** Waits for `resolve(id, …)`. Never hangs: resolves "timeout" after `timeoutMs`. */
  request(id: string, timeoutMs: number, runId: string): Promise<ApprovalOutcome> {
    return new Promise((done) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) done("timeout");
      }, timeoutMs);
      this.pending.set(id, {
        runId,
        fn: (o) => {
          clearTimeout(timer);
          done(o);
        },
      });
    });
  }

  /**
   * Returns false when the id is unknown, already decided, timed out, or belongs to a different run.
   * `runId` must be the run named in the request URL: an approval id seen in one run's stream
   * cannot approve a purchase in another.
   */
  resolve(id: string, approve: boolean, runId: string): boolean {
    const p = this.pending.get(id);
    if (!p || p.runId !== runId) return false;
    this.pending.delete(id);
    p.fn(approve ? "approved" : "rejected");
    return true;
  }

  get size() {
    return this.pending.size;
  }
}

/** Process-wide gate used by runAgent and the API. */
export const approvals = new ApprovalGate();
