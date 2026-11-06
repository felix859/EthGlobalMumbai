# PennyAgent: Design Spec

**Event:** ETHGlobal Mumbai
**Primary prize target:** Hedera, "AI Agents That Pay: x402 on Hedera" ($6,500)
**Stretch targets:** Hedera "No Solidity Allowed" ($2,000), plus ETHGlobal Finalist
**Date:** 2026-11-06

## One-liner

An AI research agent with its own Hedera wallet and a hard budget. You ask a question; it decides which paid data endpoints are worth buying, pays for each one over x402 on Hedera with no human approval, and answers using what it bought. Every payment is also written to an HCS audit log.

## Why this shape

The Hedera track rewards one thing above all: **an agent completes a paid x402 request end to end, with no human approval, and settles on Hedera.** Everything else is extra credit. So the design keeps the core tiny and spends spare time on the extra-credit items the track names: spending controls, HCS audit logs, and (optionally) agent identity.

No Solidity. No custom contracts. TypeScript only, so all teammates can work in parallel.

## Track requirements → how we satisfy them

| Track requirement | Our answer |
|---|---|
| x402-protected endpoint settling on Hedera testnet via a listed facilitator | `server/` gates 4 endpoints with x402, using the Blocky402 testnet facilitator (fallback: the official x402 facilitator) |
| Agent completes a paid request end to end, no human approval | `agent/` signs and pays automatically through the `@x402/hedera` client |
| README: setup, architecture, payment flow, settled transaction ID | Final task in the plan |
| Demo ≤ 5 min linking to HashScan | The dashboard links every payment to HashScan |
| Extra: spending controls | `BudgetGuard` in code (not in the prompt): total cap, per-call cap, `payTo` allowlist |
| Extra: HCS audit logs | Every payment is submitted to an HCS topic and shown in the UI |
| Extra: Agent Kit / Network MCP, ERC-8004 identity, A2A | Out of scope unless time remains (see "Stretch") |

## Architecture

```
 ┌────────────┐  POST /api/ask      ┌──────────────────────────────┐
 │  web (UI)  │ ───────────────────▶│  agent (Node, port 4000)     │
 │ Vite+React │ ◀── SSE events ──── │  - Claude tool-use loop      │
 └────────────┘                     │  - BudgetGuard (hard caps)   │
       │                            │  - x402 client (@x402/hedera)│
       │ reads                      │  - HCS audit logger          │
       ▼                            └───────┬──────────────┬───────┘
 Hedera mirror node                         │ GET + pay    │ submit message
 (HCS topic messages)                       ▼              ▼
                                  ┌───────────────────┐  Hedera testnet
                                  │ server (port 3000)│  (HCS topic)
                                  │ x402-gated data   │
                                  └─────────┬─────────┘
                                            │ verify / settle
                                            ▼
                                  Facilitator (Blocky402 testnet)
                                  pays fees, submits the transfer
```

### Units and their boundaries

| Unit | Does | Depends on | Interface |
|---|---|---|---|
| `packages/shared` | Types and constants shared by everyone | nothing | TypeScript types (`Catalogue`, `PaymentEvent`, `RunEvent`) |
| `packages/server` | Sells data behind x402 | facilitator, public data APIs | `GET /catalogue` (free), `GET /api/*` (paid) |
| `packages/agent` | Runs the Claude loop, pays, logs | server, Claude API, Hedera SDK | `POST /api/ask`, `GET /api/runs/:id/events` (SSE) |
| `packages/web` | Question box, budget meter, payment feed | agent, mirror node | HTTP and SSE only |

The **contract between units** is fixed in the plan (section "Contracts"). Once it is merged, the three workstreams do not block each other.

## Data flow for one run

1. User submits `{ question, budgetHbar }` from the web UI.
2. Agent fetches the free `GET /catalogue` (endpoint ids, descriptions, prices).
3. Claude gets the question, the catalogue and the remaining budget. It can call a `buy_data` tool or give the final answer.
4. `buy_data(endpointId)` goes through `BudgetGuard`. If allowed, the x402 client calls the endpoint, gets `402`, signs a partially signed `TransferTransaction`, retries, and the facilitator settles it.
5. The agent emits a `payment` event (SSE) with the Hedera transaction id and writes the same record to the HCS topic.
6. Data returns to Claude. Loop until Claude answers or the budget blocks further buys.
7. The agent emits a final `answer` event.

## Spending controls (extra credit, and our "denied path")

Enforced in code in `BudgetGuard`, so a prompt-injected model cannot bypass them:

- **Run cap:** the total spent in a run never exceeds the user's budget.
- **Per-call cap:** no single call may cost more than `MAX_PRICE_PER_CALL`.
- **Allowlist:** the `payTo` account in the 402 response must equal the configured merchant account. If not, refuse. This stops a hostile endpoint from redirecting funds.
- **Denied path:** when a purchase is blocked, the agent emits a `denied` event with the reason, and the model is told so it can answer with what it already has. The demo shows this path on purpose.

## Settlement asset

**Start with native HBAR** (asset `0.0.0`, amounts in tinybars): no token association and no test token needed. The scheme docs say HBAR is supported, but whether the facilitator and the `@x402/hedera` package handle it smoothly has to be proven by the Task 0 spike. **Fallback:** an HTS fungible token on testnet (asset id `0.0.6001` is the docs' example; the real id must be confirmed). Both payer and merchant accounts must be associated with the token.

## Data endpoints (all free upstream APIs, no keys)

| id | Path | Upstream | Price (tinybars, tunable) |
|---|---|---|---|
| `weather` | `/api/weather` | Open-Meteo forecast | 1,000,000 (0.01 HBAR) |
| `air-quality` | `/api/air-quality` | Open-Meteo air quality | 2,000,000 |
| `hbar-price` | `/api/hbar-price` | CoinGecko simple price (cached) | 3,000,000 |
| `headlines` | `/api/headlines` | Hacker News API | 5,000,000 |

Different prices make the agent's "is it worth it?" decision visible. Defaults to Mumbai coordinates. Each response is cached for 60s so demo-day rate limits cannot break us.

## HCS audit log

One HCS topic, created once by a script. Message format (JSON, ≤ 1 KB):

```json
{ "v": 1, "runId": "...", "endpointId": "weather", "amount": "1000000",
  "asset": "0.0.0", "txId": "0.0.123@1699999999.123456789", "ts": 1699999999 }
```

The web UI reads messages from the public mirror node
(`https://testnet.mirrornode.hedera.com/api/v1/topics/{topicId}/messages`), so the audit log is visible without trusting the agent process.

## Error handling

- Facilitator or settlement failure: the agent retries once; if it still fails, it emits an `error` event and tells Claude the endpoint is unavailable.
- Upstream data API failure: the server returns cached data when present, else 502 **before** payment is taken (the paywall wraps the handler, so check upstream health in a pre-check route where possible).
- HCS write failure: logged and surfaced in the UI as "audit write failed". It never blocks the answer.
- Claude API failure: surfaced as an `error` event with a retry button in the UI.

## Testing

- `BudgetGuard`: unit tests (this is the safety-critical part).
- Server: one integration test hitting a paid endpoint without payment and expecting `402` with correct `PaymentRequirements`.
- End to end: a script `npm run e2e` that performs one real testnet payment and prints the HashScan link. This is also our submission proof.

## Stretch (only after the core demo works end to end)

- Agent identity via HCS-14 or ERC-8004.
- A second agent that *sells* a service (agent to agent).
- Mainnet run via Blocky402 mainnet (requires real HBAR).
- Hedera Agent Kit tools for HCS instead of raw SDK calls.

## Non-goals

No custom smart contracts, no token launch, no user accounts, no database. State lives in memory plus the HCS topic.

## Risks

| Risk | Mitigation |
|---|---|
| `@x402/hedera` is not on npm, or its API differs from the docs | Task 0 spike on day one; build from the x402 monorepo source if needed |
| HBAR not supported end to end by the facilitator | Fall back to an HTS token (Task 0 decides) |
| Facilitator is down during the demo | Switch the facilitator URL via env var; record a backup demo video early |
| Testnet is slow or flaky | Pre-record the demo video; show a previously settled transaction as proof |
| Free data API rate limits | Server-side 60 s cache |
| Leaked private keys | Testnet-only keys, `.env` gitignored, repo is private |
