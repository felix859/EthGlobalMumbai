# Demo script and recording guide (D3, D4)

Target length: **3:30** (hard limit 5:00). One person drives, one narrates. Record at 1440×900 or larger, browser zoom 110%.

## Before you record (10 minutes)

1. `npm run dev` (server, agent, web) and, for the agent-to-agent beat, `npm run dev:analyst`.
2. Open the dashboard: `http://localhost:5173`. The health dot must be **green**; click it to check facilitator, server and balance.
3. Policy for the take: budget **0.5 HBAR**, max per purchase **0.1 HBAR**, approval **off** for run 1.
4. Open three tabs in advance: HashScan for the agent account, the audit topic [0.0.11341094](https://hashscan.io/testnet/topic/0.0.11341094), and the receipt collection [0.0.11341392](https://hashscan.io/testnet/token/0.0.11341392).
5. Do one throwaway run so caches are warm.
6. **Fallback:** if testnet or the facilitator fails mid-take, click **Replay last run** in the footer (replays the last real run), or open `?mock=1`. Say so on camera: never present a replay as live.

## The script

| Time | On screen | Say (roughly) |
|---|---|---|
| 0:00–0:20 | Dashboard, header | "Agents can reason, but they can't pay for anything without a human holding the card. PennyAgent is an AI agent with its own Hedera wallet and a hard budget." |
| 0:20–0:35 | Point at agent account, ID chip, health dot | "This is its wallet on Hedera testnet, and this is its identity: a UAID following the HCS-14 draft." |
| 0:35–1:20 | Click example *"Should I carry an umbrella in Mumbai today, and is HBAR up?"*, Run | "I ask a question and give it half an HBAR. It reads a catalogue of paid data endpoints and decides what is worth buying. Each of these is an x402 payment: the server answers 402, the agent signs a Hedera transfer, the facilitator settles it." Let the budget meter fill. |
| 1:20–1:45 | Click a payment's tx link → HashScan | "Every purchase is a real transaction. Here it is on HashScan: agent to merchant, settled by the facilitator." Back to the dashboard. |
| 1:45–2:15 | Answer + receipt card, then audit panel | "It answers from the data it bought, mints a receipt NFT on HTS, and logs every payment to an HCS topic. The audit log here is read straight from the public mirror node, not from our agent." |
| 2:15–2:55 | Open Spending policy, turn on "Ask me above **0.02 HBAR**", ask the briefing example | "Now the safety. All limits are enforced in code before anything is signed: budget, per-purchase cap, allowed payees. Above this threshold, it asks me first." Approve one, **Reject** one: "Rejected: nothing is signed, nothing is paid." Point at a red refusal with its reason. |
| 2:55–3:15 | The Analyst purchase in the timeline (labelled) | "Agents can pay agents too. This briefing was sold by our Analyst agent, which paid the data server out of its own wallet. Two hops, both on-chain." |
| 3:15–3:30 | README / repo | "Built with TypeScript, the x402 Hedera scheme, HCS and HTS, no Solidity. Two security reviews, all findings fixed. Thanks!" |

## Recording checklist

- [ ] At least **two HashScan pages** shown on screen (a payment, and the audit topic or the receipt)
- [ ] The **refused / rejected** path shown (a red refusal with its reason)
- [ ] No private keys, `.env` or terminal history on screen; close other tabs
- [ ] Under 5:00; export 1080p; upload (YouTube unlisted or Loom) and paste the link into the README and the ETHGlobal page
- [ ] Record a rough take as soon as the full stack runs; re-record at the end if time allows
