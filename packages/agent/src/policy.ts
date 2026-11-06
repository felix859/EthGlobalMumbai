// Spending policy + optional human approval. The default flow stays fully autonomous;
// when `approvalAboveTinybars` is set, any single purchase above it pauses until a human decides.
import { randomUUID } from "node:crypto";

export type ApprovalOutcome = "approved" | "rejected" | "timeout";

export interface PolicyOptions {
  /** Cap for a single payment (tinybars). Defaults to env MAX_PRICE_PER_CALL. */
  maxPerCallTinybars?: string;
  /** Purchases strictly above this need a human OK. Unset or "0" = never ask. */
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

export function resolvePolicy(o: PolicyOptions = {}, env: NodeJS.ProcessEnv = process.env): ResolvedPolicy {
  const maxPerCall = asPositive(o.maxPerCallTinybars ?? env.MAX_PRICE_PER_CALL ?? "10000000", "maxPerCallTinybars")!;
  if (maxPerCall <= 0n) throw new Error("maxPerCallTinybars must be > 0");
  const above = asPositive(o.approvalAboveTinybars ?? env.APPROVAL_ABOVE_TINYBARS, "approvalAboveTinybars");
  const timeout = o.approvalTimeoutMs ?? (env.APPROVAL_TIMEOUT_MS ? Number(env.APPROVAL_TIMEOUT_MS) : DEFAULT_APPROVAL_TIMEOUT_MS);
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("approvalTimeoutMs must be > 0");
  return { maxPerCall, approvalAbove: above && above > 0n ? above : undefined, approvalTimeoutMs: timeout };
}

export const needsApproval = (p: ResolvedPolicy, priceTinybars: bigint) =>
  p.approvalAbove !== undefined && priceTinybars > p.approvalAbove;

/** Pending human decisions, keyed by approvalId. The HTTP API (#4) calls `resolve`. */
export class ApprovalGate {
  private pending = new Map<string, (o: ApprovalOutcome) => void>();

  newId = () => randomUUID();

  /** Waits for `resolve(id, …)`. Never hangs: resolves "timeout" after `timeoutMs`. */
  request(id: string, timeoutMs: number): Promise<ApprovalOutcome> {
    return new Promise((done) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) done("timeout");
      }, timeoutMs);
      this.pending.set(id, (o) => {
        clearTimeout(timer);
        done(o);
      });
    });
  }

  /** Returns false when the id is unknown or was already decided or timed out. */
  resolve(id: string, approve: boolean): boolean {
    const fn = this.pending.get(id);
    if (!fn) return false;
    this.pending.delete(id);
    fn(approve ? "approved" : "rejected");
    return true;
  }

  get size() {
    return this.pending.size;
  }
}

/** Process-wide gate used by runAgent and the API. */
export const approvals = new ApprovalGate();
