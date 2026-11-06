// The Analyst agent: a seller AND a buyer. Sells a combined briefing over x402 to other agents and
// pays the data server (also over x402) with its own wallet to produce it.
//   buyer agent ──x402──▶ analyst (:3100) ──x402──▶ data server (:3000)
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import type { Catalogue } from "@pennyagent/shared";
import { createPayingFetch } from "@pennyagent/agent/pay";
import { parseList, parseTinybars } from "@pennyagent/agent/security";
import { createBriefingService } from "./service.js";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var ${k}`);
  return v;
};
const port = Number(process.env.ANALYST_PORT ?? 3100);
const analystAccount = need("ANALYST_ACCOUNT_ID");
const price = parseTinybars(process.env.BRIEFING_PRICE_TINYBARS, "BRIEFING_PRICE_TINYBARS", 3_000_000n);

const service = createBriefingService(
  {
    priceTinybars: price,
    costCapTinybars: parseTinybars(process.env.BRIEFING_COST_CAP_TINYBARS, "BRIEFING_COST_CAP_TINYBARS", (price * 2n) / 3n),
    maxTotalSpendTinybars: parseTinybars(process.env.ANALYST_MAX_TOTAL_SPEND_TINYBARS, "ANALYST_MAX_TOTAL_SPEND_TINYBARS", 50_000_000n),
    maxPerCallTinybars: parseTinybars(process.env.MAX_PRICE_PER_CALL, "MAX_PRICE_PER_CALL", 10_000_000n),
    maxConcurrent: Number(process.env.BRIEFING_MAX_CONCURRENT ?? 2),
    maxPerMinute: Number(process.env.BRIEFING_MAX_PER_MINUTE ?? 10),
    upstreamUrl: process.env.UPSTREAM_URL ?? process.env.SERVER_URL ?? "http://localhost:3000",
    paths: parseList(process.env.UPSTREAM_PATHS ?? "/api/weather,/api/hbar-price"),
    dataMerchant: need("MERCHANT_ACCOUNT_ID"),
  },
  (guard, allowedOrigins) => createPayingFetch({ accountId: analystAccount, privateKeyHex: need("ANALYST_PRIVATE_KEY"), guard, allowedOrigins }),
);

const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: need("FACILITATOR_URL") })).register(
  "hedera:*",
  new ExactHederaScheme({ defaultAssets: { "hedera:testnet": { asset: "0.0.0", decimals: 8 } } }),
);

const app = express();
app.use(
  paymentMiddleware(
    {
      "GET /api/briefing": {
        accepts: [{ scheme: "exact", network: "hedera:testnet", payTo: analystAccount, price: { asset: "0.0.0", amount: price.toString() } }],
        description: "Combined data briefing, produced by buying from the data server",
      },
    },
    resourceServer,
  ),
);

const paths = parseList(process.env.UPSTREAM_PATHS ?? "/api/weather,/api/hbar-price");
app.get("/catalogue", (_req, res) => {
  const cat: Catalogue = {
    network: "hedera:testnet",
    payTo: analystAccount,
    endpoints: [{ id: "briefing", path: "/api/briefing", description: `Combined briefing of ${paths.map((p) => p.replace("/api/", "")).join(" + ")}, assembled by the Analyst agent`, priceTinybars: price.toString(), asset: "0.0.0" }],
  };
  res.json(cat);
});

// The buyer's payment is VERIFIED before this handler runs and SETTLED only after a 2xx response.
app.get("/api/briefing", async (_req, res) => {
  const r = await service.handle();
  res.status(r.status).json(r.body);
});

app.listen(port, () => console.log(`[analyst] ${analystAccount} selling /api/briefing for ${price} tinybars on :${port}`));
