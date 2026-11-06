// The Analyst agent: a seller AND a buyer. Sells a combined briefing over x402 to other agents and
// pays the data server (also over x402) with its own wallet to produce it.
//   buyer agent ──x402──▶ analyst (:3100) ──x402──▶ data server (:3000)
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import type { Catalogue } from "@pennyagent/shared";
import { BudgetGuard } from "@pennyagent/agent/budget";
import { createPayingFetch } from "@pennyagent/agent/pay";
import { buildBriefing, UpstreamError } from "./briefing.js";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var ${k}`);
  return v;
};
const port = Number(process.env.ANALYST_PORT ?? 3100);
const upstream = process.env.UPSTREAM_URL ?? process.env.SERVER_URL ?? "http://localhost:3000";
const paths = (process.env.UPSTREAM_PATHS ?? "/api/weather,/api/hbar-price").split(",").map((p) => p.trim()).filter(Boolean);
const price = process.env.BRIEFING_PRICE_TINYBARS ?? "3000000";
const analystAccount = need("ANALYST_ACCOUNT_ID");
const dataMerchant = need("MERCHANT_ACCOUNT_ID");

const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: need("FACILITATOR_URL") })).register(
  "hedera:*",
  new ExactHederaScheme({ defaultAssets: { "hedera:testnet": { asset: "0.0.0", decimals: 8 } } }),
);

const app = express();
app.use(
  paymentMiddleware(
    {
      "GET /api/briefing": {
        accepts: [{ scheme: "exact", network: "hedera:testnet", payTo: analystAccount, price: { asset: "0.0.0", amount: price } }],
        description: "Combined data briefing, produced by buying from the data server",
      },
    },
    resourceServer,
  ),
);

app.get("/catalogue", (_req, res) => {
  const cat: Catalogue = {
    network: "hedera:testnet",
    payTo: analystAccount,
    endpoints: [{ id: "briefing", path: "/api/briefing", description: `Combined briefing of ${paths.map((p) => p.replace("/api/", "")).join(" + ")}, assembled by the Analyst agent`, priceTinybars: price, asset: "0.0.0" }],
  };
  res.json(cat);
});

app.get("/api/briefing", async (_req, res) => {
  // Fresh guard per request: the analyst can spend at most BRIEFING_COST_CAP on upstream data for one sale.
  const guard = new BudgetGuard({
    runBudget: BigInt(process.env.BRIEFING_COST_CAP_TINYBARS ?? "20000000"),
    maxPerCall: BigInt(process.env.MAX_PRICE_PER_CALL ?? "10000000"),
    allowedPayTo: dataMerchant,
    allowedAsset: "0.0.0",
  });
  const payFor = createPayingFetch({ accountId: analystAccount, privateKeyHex: need("ANALYST_PRIVATE_KEY"), guard });
  try {
    res.json(await buildBriefing(upstream, paths, payFor));
  } catch (e) {
    // Non-2xx: the x402 middleware does not settle the buyer's payment for a failed handler.
    res.status(e instanceof UpstreamError ? 502 : 500).json({ error: e instanceof UpstreamError ? e.message : "Internal error" });
  }
});

app.listen(port, () => console.log(`[analyst] ${analystAccount} selling /api/briefing for ${price} tinybars on :${port}`));
