// The Analyst's business logic, separated from HTTP so it can be tested: it BUYS upstream data with its own
// wallet and returns one combined briefing. It earns the difference between its price and its costs.
import type { PayResult } from "@pennyagent/agent/pay";

export interface BriefingPaid {
  path: string;
  txId: string;
  amountTinybars: string;
}
export interface Briefing {
  sources: string[];
  data: Record<string, unknown>;
  paid: BriefingPaid[];
  costTinybars: string;
  generatedAt: string;
}
export class UpstreamError extends Error {}

/** Buys each path in order through `payFor`. If any purchase fails the whole briefing fails (so the buyer is not charged). */
export async function buildBriefing(
  upstreamUrl: string,
  paths: string[],
  payFor: (url: string) => Promise<PayResult>,
  now: () => Date = () => new Date(),
): Promise<Briefing> {
  if (paths.length === 0) throw new UpstreamError("No upstream paths configured");
  const data: Record<string, unknown> = {};
  const paid: BriefingPaid[] = [];
  let cost = 0n;
  for (const path of paths) {
    const r = await payFor(new URL(path, upstreamUrl).toString());
    if (!r.ok) throw new UpstreamError(`Upstream purchase of ${path} failed: ${r.reason}`);
    data[path.replace(/^\/api\//, "")] = r.data;
    paid.push({ path, txId: r.txId, amountTinybars: r.amount.toString() });
    cost += r.amount;
  }
  return { sources: paths, data, paid, costTinybars: cost.toString(), generatedAt: now().toISOString() };
}
