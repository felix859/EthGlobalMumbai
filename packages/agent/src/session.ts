// One run as the outside world sees it: register it in the hub, run the agent with the HCS logger plugged into
// `onPayment`, record it for replay, and mark it finished only after outstanding audit writes have reported, so the
// stream does not close before the last `audit` event. Shared by the HTTP API and `npm run e2e`.
import type { AskRequest } from "@pennyagent/shared";
import { auditOnPayment, type SubmitAudit } from "./audit.js";
import { recordRun } from "./replay.js";
import { runAgent, type RunOptions } from "./run.js";
import type { RunHub } from "./runs.js";

export interface SessionDeps {
  hub: RunHub;
  submitAudit: SubmitAudit | null;
  /** Test seam. */
  runAgent?: (o: RunOptions) => Promise<void>;
  /** Save the run to RECORD_DIR for replay. Default true. */
  record?: boolean;
  /** Longest to wait for pending audit writes after the answer. */
  auditGraceMs?: number;
}

export function startRun(req: AskRequest, deps: SessionDeps): { runId: string; done: Promise<void> } {
  const { hub } = deps;
  const runId = hub.create();
  const toHub = (e: Parameters<typeof hub.emit>[1]) => hub.emit(runId, e);
  const emit = deps.record === false ? toHub : recordRun(toHub, { question: req.question }).emit;

  const pending: Promise<void>[] = [];
  const audit = auditOnPayment(deps.submitAudit, emit);
  const graceMs = deps.auditGraceMs ?? 20_000;

  const done = (deps.runAgent ?? runAgent)({
    runId,
    question: req.question,
    budgetTinybars: req.budgetTinybars,
    policy: { maxPerCallTinybars: req.maxPerCallTinybars, approvalAboveTinybars: req.approvalAboveTinybars },
    emit,
    onPayment: (m) => {
      const p = audit(m);
      pending.push(p);
      return p;
    },
  })
    .then(() => {
      let timer: NodeJS.Timeout | undefined;
      const grace = new Promise<void>((r) => (timer = setTimeout(r, graceMs)));
      return Promise.race([Promise.allSettled(pending), grace]).finally(() => clearTimeout(timer));
    })
    .then(() => undefined)
    .finally(() => hub.finish(runId));

  return { runId, done };
}
