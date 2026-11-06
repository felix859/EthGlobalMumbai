# PennyAgent

**An AI agent with its own Hedera wallet and a hard budget. It decides what data is worth buying, pays for it over x402 on Hedera with no human in the loop, and leaves an on-chain paper trail.**

Built at ETHGlobal Mumbai 2026. Prize tracks: **Hedera, "AI Agents That Pay: x402 on Hedera"** and **Hedera, "No Solidity Allowed"** ([checklist with evidence](docs/submission/prize-checklist.md)).

> **Status:** the agent core, data server, dashboard, Analyst agent and MCP server are built and tested; the agent's HTTP API and audit logger are in progress. Sections marked 🚧 are filled in at submission. Task board: [GitHub issues](https://github.com/felix859/EthGlobalMumbai/issues).

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

All rules are enforced **in code, before anything is signed**, never in the prompt. A prompt-injected model cannot talk its way past them. Spending is **reserve → commit**: the exact amount the server asks for is reserved atomically before signing, so parallel purchases cannot overspend, and once a signed payment has been sent it counts as spent even if the server then errors.

| Control | What it does |
|---|---|
| **Run budget** | Total spend per run can never exceed what the user set, also under parallel purchases |
| **Per-call cap** | No single purchase above a limit |
| **Payee allowlist** | Only the configured merchant account can be paid; the server cannot name its own payee |
| **Process-wide ceiling** | A cap across all runs in one agent process, shared atomically. In memory: a restart resets it, so keep the wallet itself low-balance |
| **Price bound** | The server cannot charge more than the price it advertised; a higher 402 is refused before signing |
| **Human approval (optional)** | Purchases above a threshold pause until a person approves, and the payment is then capped at the approved price; no answer in time means no purchase |
| **Origin, redirect and size checks** | The paying fetch itself only pays trusted origins, never follows redirects, times out slow servers and caps response size |
| **Untrusted seller text** | Catalogue descriptions and endpoint data are passed to the model as marked data, never in the system prompt |

A security review and an independent code review, with findings and fixes: [docs/security-review.md](docs/security-review.md).

## Hedera services used

| Service | What for |
|---|---|
| **x402 `exact` scheme on `hedera:testnet`** | Every data purchase, settled in HBAR via the Blocky402 facilitator |
| **Hedera Consensus Service (HCS)** | Public audit log, one message per payment ([topic 0.0.11341094](https://hashscan.io/testnet/topic/0.0.11341094)), and the agent's identity profile |
| **Mirror Node REST API** | The dashboard reads the audit log and the agent's balance straight from the public mirror node |
| **Hedera Token Service (HTS)** | One receipt NFT per run, recording what was bought and what it cost (payments themselves settle in HBAR) |

No Solidity contracts: everything is the JS/TS SDK and the x402 packages.

## Proof it works

Real testnet transactions, each checked on the public mirror node (`SUCCESS`):

| What | Transaction |
|---|---|
| First x402 payment, agent → merchant, 0.01 HBAR | [0.0.7162784@1793978281.672658259](https://hashscan.io/testnet/transaction/0.0.7162784@1793978281.672658259) |
| Agent pays the data server for `weather`, 0.01 HBAR, logged to HCS | [0.0.7162784@1793983625.495026253](https://hashscan.io/testnet/transaction/0.0.7162784@1793983625.495026253) · [audit topic 0.0.11341094](https://hashscan.io/testnet/topic/0.0.11341094) |
| Agent-to-agent, hop 1: buyer → Analyst, 0.03 HBAR | [0.0.7162784@1793980336.325585694](https://hashscan.io/testnet/transaction/0.0.7162784@1793980336.325585694) |
| Agent-to-agent, hop 2: Analyst → data merchant, 0.01 HBAR | [0.0.7162784@1793980337.958678541](https://hashscan.io/testnet/transaction/0.0.7162784@1793980337.958678541) |
| Same chain, bought by a real MCP client through `packages/mcp` | [hop 1](https://hashscan.io/testnet/transaction/0.0.7162784@1793980484.277937785) · [hop 2](https://hashscan.io/testnet/transaction/0.0.7162784@1793980484.579713018) |
| Receipt NFTs (HTS collection `0.0.11341392`) | [serial 1](https://hashscan.io/testnet/token/0.0.11341392/1) · [serial 2](https://hashscan.io/testnet/token/0.0.11341392/2) |
| Agent identity profile (HCS) | [topic 0.0.11341592](https://hashscan.io/testnet/topic/0.0.11341592) |

🚧 Final demo run through the dashboard: its transaction ids and the demo video link are added here at submission.

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
docs/             design spec, plan, spike notes, security reviews, MCP guide, submission material
```

Details: [design spec](docs/superpowers/specs/2026-11-06-pennyagent-design.md) · [implementation plan](docs/superpowers/plans/2026-11-06-implementation-plan.md) · [spike notes](docs/spike-notes.md).

## Quick start

Requirements: Node 20+, one funded Hedera **testnet** account (the setup script creates the receiving account), an Anthropic API key.

```bash
git clone https://github.com/felix859/EthGlobalMumbai.git && cd EthGlobalMumbai
npm install
cp .env.example .env          # fill in account ids and keys; testnet keys only, never commit .env
npm run setup:hedera          # creates the merchant account and the HCS audit topic
npm run setup:receipt         # creates the receipt NFT collection
npm run setup:identity        # optional: publishes the agent's identity profile
npm test                      # all tests
npm run dev                   # data server, agent and dashboard together
npm run e2e                   # optional: one real paid run from the CLI (needs the server running), prints HashScan links
```

Then open http://localhost:5173. To see the dashboard **without any backend**, open http://localhost:5173/?mock=1 (replays a recorded run).

Optional: `npm run setup:analyst` and `npm run dev:analyst` start the Analyst agent (agent-to-agent payments); [docs/mcp.md](docs/mcp.md) shows how to add the MCP server to Claude.

## Limitations (honest list)

- Testnet only; no mainnet funds were used.
- Spending ceilings live in memory: restarting a process resets its totals. Keep the agent's wallet itself low-balance.
- Agent identity follows the HCS-14 **draft**; the profile is HCS-11-shaped, not a compliant HCS-1 inscription.
- The agent trusts the configured facilitator to settle; it can only settle the exact transfer the agent signed.
- A model can waste budget on allowed-but-useless purchases. The caps bound the damage; they do not judge value.
- Data endpoints wrap free public APIs (Open-Meteo, CoinGecko, Hacker News) and are cached for 60 seconds. If an upstream fails, the last good value is served (marked `stale`) for up to 10 minutes; after that the server answers 502 *before* asking for payment, so a buyer is never charged for data it cannot get.

## Team

Built by the ETHGlobal Mumbai team: Felix, Gopi, Annemarie, Eva and Helena. 🚧 Final credits and links added at submission.
