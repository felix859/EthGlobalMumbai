# PennyAgent

**An AI agent with its own Hedera wallet and a hard budget. It decides what data is worth buying, pays for it over x402 on Hedera with no human in the loop, and leaves an on-chain paper trail.**

Built at ETHGlobal Mumbai 2026. Target prize: **Hedera, "AI Agents That Pay: x402 on Hedera"**.

> **Status: work in progress.** Sections marked 🚧 are filled in as the team lands each part. Task board: [GitHub issues](https://github.com/felix859/EthGlobalMumbai/issues).

## The idea

Agents can reason, but they cannot pay for things without a human holding the card. x402 turns an HTTP `402 Payment Required` response into a payment the agent can make by itself. PennyAgent shows what that looks like when the agent is **safe enough to trust with money**:

- You ask a question and give a budget, e.g. *"Should I carry an umbrella in Mumbai today, and is HBAR up?"* with 0.5 HBAR.
- The agent reads a catalogue of paid data endpoints with their prices, buys only what it needs, and answers from what it bought.
- Every purchase is a real Hedera transaction you can click through to on HashScan.

## How a payment works

```
 Agent                    Data server                 Facilitator (Blocky402)         Hedera
   │  GET /api/weather         │                              │                         │
   │──────────────────────────▶│                              │                         │
   │  402 + price, payTo,      │                              │                         │
   │  fee payer                │                              │                         │
   │◀──────────────────────────│                              │                         │
   │ spending guard checks price, payee, asset, budget BEFORE signing                   │
   │ signs a partially-signed TransferTransaction (agent → merchant)                    │
   │  GET /api/weather + signed payment                        │                         │
   │──────────────────────────▶│  verify + settle             │                         │
   │                           │─────────────────────────────▶│ adds fee-payer          │
   │                           │                              │ signature, submits ────▶│
   │                           │◀─────────────────────────────│ transaction id          │
   │  200 + data               │                              │                         │
   │◀──────────────────────────│                              │                         │
```

The facilitator pays the network fee, so the agent's wallet only ever moves the price of the data.

## What makes it safe to give an agent money

All rules are enforced **in code, before anything is signed**, never in the prompt. A prompt-injected model cannot talk its way past them.

| Control | What it does |
|---|---|
| **Run budget** | Total spend per run can never exceed what the user set |
| **Per-call cap** | No single purchase above a limit |
| **Payee allowlist** | Only the configured merchant account can be paid; the server cannot name its own payee |
| **Process-wide ceiling** | A cap across all runs, so repeated calls cannot drain the wallet |
| **Human approval (optional)** | Purchases above a threshold pause until a person approves; no answer in time means no purchase |
| **Origin and redirect checks** | Payments only go to the configured server, and redirects are never followed |

A security review with findings and fixes: [docs/security-review.md](docs/security-review.md).

## Hedera services used

| Service | What for |
|---|---|
| **x402 `exact` scheme on `hedera:testnet`** | Every data purchase, settled in HBAR via the Blocky402 facilitator |
| **Hedera Consensus Service (HCS)** | Public audit log: one message per payment, readable from the mirror node 🚧 |
| **Hedera Token Service (HTS)** | One receipt NFT per run, recording what was bought and what it cost |

No Solidity contracts: everything is the JS/TS SDK and the x402 packages.

## Proof it works

Real testnet transactions from development:

- First x402 payment, agent → merchant, 0.01 HBAR: [HashScan](https://hashscan.io/testnet/transaction/0.0.7162784@1793978281.672658259)
- Receipt NFT collection `0.0.11341392`, serial 1: [HashScan](https://hashscan.io/testnet/token/0.0.11341392/1)
- HCS audit topic `0.0.11341094`: [HashScan](https://hashscan.io/testnet/topic/0.0.11341094)

🚧 Final demo run: transaction ids, screenshots and the demo video link are added here at the end.

## Agents that pay each other

PennyAgent is not only a buyer. The **Analyst agent** (`packages/analyst`) is a seller *and* a buyer with its own wallet: it sells a combined data briefing over x402 and pays the data server (also over x402) to produce it. A two-hop chain, both hops verified on testnet:

`buyer agent ──0.03 HBAR──▶ Analyst ──0.01 HBAR──▶ data server`  (the Analyst keeps the margin)

The buyer trusts only the sellers and origins in its own config, never ones named by a catalogue.

## Agent identity

The agent has a Universal Agent ID following the [HCS-14 draft](https://hol.org/docs/standards/hcs-14/) AID method (SHA-384 over canonical JSON, Base58), and a profile published on an HCS topic. Honest limits: HCS-14 is a draft, and the profile is a single HCS message rather than a full HCS-1 inscription, so it is HCS-11-*shaped*, not compliant.

## MCP server

`packages/mcp` exposes the guarded wallet as MCP tools (`list_catalogue`, `buy_data`, `budget_status`), so any MCP client such as Claude gets a wallet that can only spend inside the same guardrails. See [docs/mcp.md](docs/mcp.md).

## Demo safety net

Testnets and facilitators fail at the worst time. Every real run is recorded to disk and can be replayed through the same event stream, and a health check shows whether the facilitator, the server and the agent's balance are OK.

## Architecture

```
packages/shared   shared types and constants (the contracts between the parts)
packages/server   x402-gated data API: weather, air quality, HBAR price, headlines   (port 3000)
packages/agent    spending guard, paying fetch, Claude tool-use loop, approval,
                  receipt NFT, replay, health                                        (port 4000)
packages/web      dashboard: ask, live payments, audit log, approvals                (port 5173)
packages/analyst  seller+buyer agent: sells briefings, buys its data                 (port 3100)
packages/mcp      MCP server exposing the guarded wallet as tools
scripts/          one-off Hedera setup (merchant account, audit topic, receipt NFT)
spike/            the first working x402 payment, kept as a reference
docs/             design spec, implementation plan, spike notes, security review
```

Details: [design spec](docs/superpowers/specs/2026-11-06-pennyagent-design.md) · [implementation plan](docs/superpowers/plans/2026-11-06-implementation-plan.md) · [spike notes](docs/spike-notes.md).

## Quick start

Requirements: Node 20+, two Hedera **testnet** accounts (one pays, one receives), an Anthropic API key.

```bash
git clone https://github.com/felix859/EthGlobalMumbai.git && cd EthGlobalMumbai
npm install
cp .env.example .env          # fill in account ids and keys; testnet keys only, never commit .env
npm run setup:hedera          # creates the merchant account and the HCS audit topic
npm run setup:receipt         # creates the receipt NFT collection
npm test                      # unit tests
npm run dev                   # server, agent and web together 🚧 (server and web are still being built)
```

## Limitations (honest list)

- Testnet only; no mainnet funds were used.
- The agent trusts the configured facilitator to settle; it can only settle the exact transfer the agent signed.
- A model can waste budget on allowed-but-useless purchases. The caps bound the damage; they do not judge value.
- 🚧 Data endpoints wrap free public APIs and are cached for 60 seconds.

## Team

Built by the ETHGlobal Mumbai team: Felix, Gopi, Annemarie and Eva. 🚧 Final credits and links added at submission.
