import { x402Client, x402HTTPClient } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";

const signer = createClientHederaSigner(
  process.env.AGENT_ACCOUNT_ID!,
  PrivateKey.fromStringECDSA(process.env.AGENT_PRIVATE_KEY!),
  { network: "hedera:testnet" },
);
const client = x402Client.fromConfig({
  schemes: [{ network: "hedera:*", client: new ExactHederaScheme(signer) }],
  // Built-in spend control: HBAR allowed, max 0.1 HBAR (10,000,000 tinybars) per payment.
  spendControls: { allowedAssets: [{ network: "hedera:testnet", asset: "0.0.0", maxAmountPerPayment: "10000000" }] },
});
const pay = wrapFetchWithPayment(fetch, client);

const res = await pay("http://localhost:3999/api/hello");
console.log("status:", res.status, "body:", await res.text());
const settle = new x402HTTPClient(client).getPaymentSettleResponse((n) => res.headers.get(n));
console.log("settlement:", JSON.stringify(settle));
if (settle?.transaction) console.log("HashScan: https://hashscan.io/testnet/transaction/" + settle.transaction);
