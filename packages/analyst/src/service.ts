// The Analyst's selling logic, independent of Express and x402 so it can be tested.
// Every sale is bounded: upstream cost < sale price (no selling at a loss), a wallet-wide spending limit across all
// sales, a cap on concurrent briefings, and a per-minute rate limit. A refused request gets a non-2xx status, and
// the x402 middleware does not settle the buyer's payment for a non-2xx response.
import { BudgetGuard, SpendLimit } from "@pennyagent/agent/budget";
import type { PayOptions, PayResult } from "@pennyagent/agent/pay";
import { buildBriefing, UpstreamError } from "./briefing.js";

export interface AnalystConfig {
  priceTinybars: bigint;
  /** Max the analyst may spend upstream for ONE briefing. Must be below the price. */
  costCapTinybars: bigint;
  /** Max the analyst wallet may spend upstream in total, across all sales (in memory; resets on restart). */
  maxTotalSpendTinybars: bigint;
  maxPerCallTinybars: bigint;
  maxConcurrent: number;
  maxPerMinute: number;
  upstreamUrl: string;
  paths: string[];
  dataMerchant: string;
}

export function validateAnalystConfig(c: AnalystConfig): void {
  if (c.costCapTinybars >= c.priceTinybars) {
    throw new Error(`BRIEFING_COST_CAP_TINYBARS (${c.costCapTinybars}) must be below BRIEFING_PRICE_TINYBARS (${c.priceTinybars}), or every sale can lose money`);
  }
  if (c.maxConcurrent < 1 || c.maxPerMinute < 1) throw new Error("Concurrency and rate limits must be at least 1");
  if (c.paths.length === 0) throw new Error("UPSTREAM_PATHS is empty");
}

export interface ServiceResult {
  status: number;
  body: unknown;
}

export function createBriefingService(
  cfg: AnalystConfig,
  makePay: (guard: BudgetGuard, allowedOrigins: string[]) => (url: string, opts?: PayOptions) => Promise<PayResult>,
  now: () => number = Date.now,
) {
  validateAnalystConfig(cfg);
  const wallet = new SpendLimit(cfg.maxTotalSpendTinybars, "analyst wallet limit");
  const recent: number[] = [];
  let inFlight = 0;

  return {
    wallet,
    async handle(): Promise<ServiceResult> {
      const t = now();
      while (recent.length && recent[0] <= t - 60_000) recent.shift();
      if (recent.length >= cfg.maxPerMinute) return { status: 429, body: { error: "Too many briefings this minute, try again shortly" } };
      if (inFlight >= cfg.maxConcurrent) return { status: 503, body: { error: "Analyst is busy, try again shortly" } };
      if (wallet.remaining <= 0n) return { status: 503, body: { error: "Analyst has reached its spending limit" } };
      recent.push(t);
      inFlight++;
      try {
        const guard = new BudgetGuard({
          runBudget: cfg.costCapTinybars,
          maxPerCall: cfg.maxPerCallTinybars,
          allowedPayTo: cfg.dataMerchant,
          allowedAsset: "0.0.0",
          parent: wallet,
        });
        const body = await buildBriefing(cfg.upstreamUrl, cfg.paths, makePay(guard, [cfg.upstreamUrl]));
        return { status: 200, body };
      } catch (e) {
        return e instanceof UpstreamError ? { status: 502, body: { error: e.message } } : { status: 500, body: { error: "Internal error" } };
      } finally {
        inFlight--;
      }
    },
  };
}
