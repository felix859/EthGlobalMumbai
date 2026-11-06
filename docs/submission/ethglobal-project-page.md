# ETHGlobal project page draft (D5)

Copy these into the ETHGlobal submission form. Fill the 🚧 fields at the end. Adjust the tone freely.

**Project name:** PennyAgent

**Short description** (one line):
An AI agent with its own Hedera wallet and a hard budget that pays for data over x402, with no human in the loop.

**Description:**
Agents can reason, but they cannot pay for anything without a human holding the card. PennyAgent gives an AI agent its own Hedera wallet and makes it safe to trust with money.

You ask a question and set a budget. The agent reads a catalogue of paid data endpoints, decides which are worth buying, and pays for each one over x402: the server answers HTTP 402 with a price, the agent signs a Hedera transfer, and a facilitator settles it. It answers from what it bought, mints a receipt NFT for the run, and logs every payment to a public HCS topic.

The interesting part is the guardrails. Every rule is enforced in code before anything is signed, never in the prompt: a run budget, a per-purchase cap, an allowlist of payees, a process-wide ceiling, a bound so a server cannot charge more than it advertised, and an optional "ask me above X" human approval. Spending is reserved atomically, so parallel purchases cannot overspend.

Agents can also pay agents: our Analyst agent sells a combined briefing over x402 and pays the data server out of its own wallet, two hops, both on-chain. And an MCP server lets any MCP client (such as Claude) use the same guarded wallet.

**How it's made:**
TypeScript monorepo. Payments use the x402 `exact` scheme for Hedera (`@x402/hedera`, `@x402/express`, `@x402/fetch`) settling HBAR on Hedera testnet through the Blocky402 facilitator. The data server wraps free public APIs (Open-Meteo, CoinGecko, Hacker News) behind an x402 paywall. The agent is a Claude tool-use loop; its spending guard plugs into the x402 client's hooks to reserve the exact amount being signed, commit it once the payment is sent (even if the server then errors), and refuse anything off-policy. Hedera services: HCS for the audit log and the agent's identity profile (a UAID following the HCS-14 draft), HTS for per-run receipt NFTs, the Mirror Node REST API for the dashboard's audit view and health checks. No Solidity. The dashboard is React + Vite. We ran two code reviews (one independent) and fixed every finding; the payer is tested with the real x402 client against a mock x402 server.

**Tech / sponsors:** Hedera (x402, HCS, HTS, Mirror Node), Anthropic Claude, React, Vite, TypeScript, Node.js

**Prize picks:** Hedera: "AI Agents That Pay: x402 on Hedera" and "No Solidity Allowed" (see [prize-checklist.md](prize-checklist.md)).

**Team:** Felix, Gopi, Annemarie, Eva, Helena. 🚧 Add every teammate's ETHGlobal account on the page.

**Links:**
- GitHub: https://github.com/felix859/EthGlobalMumbai (🚧 make public first)
- Demo video: 🚧
- Live demo: 🚧 (optional; local demo is fine)
