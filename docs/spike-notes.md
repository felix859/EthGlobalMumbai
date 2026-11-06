# Phase 0.2 spike notes (x402 on Hedera testnet): PASSED 2026-11-06

**Proof:** a real payment settled on testnet.
https://hashscan.io/testnet/transaction/0.0.7162784@1793978281.672658259
Mirror node: agent `0.0.11340811` paid 1,000,000 tinybars (0.01 HBAR) to merchant `0.0.11341093`.
The facilitator `0.0.7162784` paid the network fee. Result `SUCCESS`.

Working code: `spike/server.ts` and `spike/client.ts`. Run (two terminals, from `spike/`):
`npx tsx --env-file=../.env server.ts` then `npx tsx --env-file=../.env client.ts`.

## Answers to the plan's open questions

| Question | Answer |
|---|---|
| Is `@x402/hedera` on npm? | **Yes**, 2.30.0 (also `@x402/core`, `@x402/express`, `@x402/hono`, `@x402/fetch`) |
| Does native HBAR work end to end? | **Yes**, asset `0.0.0`, amounts in tinybars. No token association needed. HTS fallback not needed |
| Facilitator | Blocky402 testnet `https://api.testnet.blocky402.com` works (`/supported` lists `hedera:testnet` exact, fee payer `0.0.7162784`) |
| Server middleware | `@x402/express` `paymentMiddleware(routes, resourceServer)`. Hono: `@x402/hono` |
| Facilitator client | `new HTTPFacilitatorClient({ url })` from `@x402/core/server` |
| Client | `@x402/fetch` `wrapFetchWithPayment(fetch, client)`; settlement info via `new x402HTTPClient(client).getPaymentSettleResponse(h => res.headers.get(h))` → `{ success, payer, transaction, network }` |

## Gotchas (read these)

1. **Price for HBAR must be an object**, not `"$0.01"`:
   `price: { asset: "0.0.0", amount: "1000000" }`. Also register
   `defaultAssets: { "hedera:testnet": { asset: "0.0.0", decimals: 8 } }` on `ExactHederaScheme`.
2. **The client blocks non-default assets by default.** Without config you get
   `All payment requirements were rejected by spendControls`. Use
   `x402Client.fromConfig({ schemes: [{ network: "hedera:*", client: new ExactHederaScheme(signer) }], spendControls: { allowedAssets: [{ network: "hedera:testnet", asset: "0.0.0", maxAmountPerPayment: "10000000" }] } })`.
3. **Workstream B: this is a built-in spend control.** `maxAmountPerPayment` (atomic units) is our per-call cap.
   The run budget and `payTo` allowlist still belong in our own `BudgetGuard` (reserve/commit, see `packages/agent/src/pay.ts`, which uses `onBeforePaymentCreation` / `onAfterPaymentCreation` to reserve the real 402 amount); the client also supports `policies`
   (`(version, requirements[]) => requirements[]`) which is a clean place to enforce them *before* signing.
4. **Use `PrivateKey` re-exported from `@x402/hedera`**, not from `@hiero-ledger/sdk` directly. Two copies of the SDK break `instanceof` checks (`t.startsWith is not a function`).
5. Key format: the agent key is ECDSA, so `PrivateKey.fromStringECDSA(hex)`.
6. The 402 response carries requirements in the `PAYMENT-REQUIRED` header (base64 JSON) as well as the body.
7. Settlement happens in the middleware after the handler succeeds. Failed upstream calls should error before payment is captured (see plan A4).

## Still to verify
- Behaviour when the facilitator is down or the payer balance is too low (Phase 2 failure drills).
- Whether the Express middleware settles before or after the handler response is sent (matters for plan A4).
