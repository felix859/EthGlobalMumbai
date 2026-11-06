import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";

const facilitator = new HTTPFacilitatorClient({ url: process.env.FACILITATOR_URL! });
const resourceServer = new x402ResourceServer(facilitator).register(
  "hedera:*",
  new ExactHederaScheme({ defaultAssets: { "hedera:testnet": { asset: "0.0.0", decimals: 8 } } }),
);

const app = express();
app.use(
  paymentMiddleware(
    {
      "GET /api/hello": {
        accepts: [{
          scheme: "exact",
          network: "hedera:testnet",
          payTo: process.env.MERCHANT_ACCOUNT_ID!,
          price: { asset: "0.0.0", amount: "1000000" }, // 0.01 HBAR in tinybars
        }],
        description: "spike",
      },
    },
    resourceServer,
  ),
);
app.get("/api/hello", (_req, res) => res.json({ hello: "paid content" }));
app.listen(3999, () => console.log("spike server on :3999"));
