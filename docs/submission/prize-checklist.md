# Prize checklist with evidence (D2)

Status legend: ✅ done and verified · 🟡 done in code, needs the final demo run · ⏳ waiting on a teammate · ❌ not done

All transaction links were checked on the public Hedera mirror node (`result: SUCCESS`) on 2026-11-06.

## Hedera: "AI Agents That Pay: x402 on Hedera" ($6,500) — main target

| Requirement (from the prize page) | Status | Evidence |
|---|---|---|
| An x402-protected endpoint that settles on Hedera testnet through a listed facilitator | ✅ | Data server `packages/server` (x402 paywall on `/api/*`, Blocky402 testnet facilitator). Payment into it: [0.0.7162784@1793983625.495026253](https://hashscan.io/testnet/transaction/0.0.7162784@1793983625.495026253) (agent → merchant, 0.01 HBAR, `weather`) |
| An agent finds the endpoint and completes a paid request with no human approval | 🟡 | Discovery via the free `GET /catalogue`; autonomous payment through the guarded payer. **Agent-to-agent, fully autonomous:** the Analyst agent sold a briefing and paid the data server itself: [buyer → analyst](https://hashscan.io/testnet/transaction/0.0.7162784@1793980336.325585694), [analyst → merchant](https://hashscan.io/testnet/transaction/0.0.7162784@1793980337.958678541). Still to record: one full run of the **Claude agent loop** (`runAgent`) through the UI, which needs an Anthropic API key and the agent API (#4) |
| Public repo | ⏳ | Repo is private today. Make it public before submitting (see D6) |
| README includes a settled transaction ID | ✅ | README "Proof it works" lists settled tx ids (all verified) |
| Demo video, 5 minutes or less, linking to HashScan | ❌ | Script and recording guide: [demo-script.md](demo-script.md). Needs a person to record |

**Extra credit claimed**

| Extra credit item | Status | Evidence |
|---|---|---|
| Spending controls | ✅ | `packages/agent/src/budget.ts`, `pay.ts`: run budget, per-call cap, payee and asset allowlist, process-wide ceiling, price bound, optional human approval. Atomic reserve/commit before signing. Tested (real x402 client against a mock server) and verified live: 5 parallel purchases against room for 4 → 4 paid, 1 denied. Two independent reviews: [security-review.md](../security-review.md) |
| Agent identity (HCS-14) | ✅ (draft standard) | UAID per the HCS-14 **draft** AID method, profile on topic [0.0.11341592](https://hashscan.io/testnet/topic/0.0.11341592). Honest limit: profile is HCS-11-shaped, single message, not an HCS-1 inscription |
| HCS audit log | 🟡 / ⏳ | Topic [0.0.11341094](https://hashscan.io/testnet/topic/0.0.11341094) holds a real audit message for the payment above (posted by a teammate's smoke test). The logger in the agent API is issue #4. The UI reads the topic from the mirror node |
| HTS settlement or custom fees | Partly | HTS is used for **receipt NFTs** (collection [0.0.11341392](https://hashscan.io/testnet/token/0.0.11341392), serials [1](https://hashscan.io/testnet/token/0.0.11341392/1) and [2](https://hashscan.io/testnet/token/0.0.11341392/2)); payments settle in HBAR, not an HTS token. Do not claim "HTS settlement" |
| A2A / ACP negotiation | Partly | Agent-to-agent **payment** (two-hop, above). No negotiation protocol: do not claim A2A/ACP |
| Hedera Network MCP / Agent Kit | ❌ | Not used. Our own MCP server (`packages/mcp`) exposes the guarded wallet, but it is not the Hedera Network MCP |
| Scheduled Transactions | ❌ | Not used |

## Hedera: "No Solidity Allowed" ($2,000, up to 2 teams) — stretch target

| Requirement | Status | Evidence |
|---|---|---|
| JS/TS or Python SDK, no Solidity | ✅ | TypeScript only; no contracts anywhere in the repo |
| At least two native services (e.g. HTS and HCS) | ✅ | **HTS:** receipt NFT collection created and minted (`scripts/create-receipt-token.ts`, `packages/agent/src/receipt.ts`). **HCS:** audit topic and identity topic created; profile and audit messages submitted (`scripts/hedera-setup.ts`, `scripts/register-agent.ts`) |
| Public repo with setup and usage README | ⏳ | README is ready; repo still private |
| Demo video, 5 minutes or less | ❌ | Same video as above |

Extra credit here: **Mirror Node REST API** (the dashboard reads the audit topic from the mirror node; health check reads the balance), **creative HCS use** (audit log + identity profile), **considered security approach** (two reviews, all findings fixed, tests). End-to-end UX: the dashboard.

## Prize picks (D6)

- The prize page's Arkiv section says partner prizes "count as one partner prize ... one of your three picks", which implies **each team picks up to three partners**, and all of one partner's tracks count as one pick. The page does not state the rule in full: confirm it in the ETHGlobal dashboard when submitting.
- **Recommendation:** pick **Hedera** (enter both "AI Agents That Pay" and "No Solidity Allowed"). Nothing we built qualifies for other partners' tracks without new work, so do not spend picks on them.

## Before submitting (D6 checklist)

- [ ] Agent API (#4) merged and one full UI run recorded, with its tx ids added to the README
- [ ] Demo video recorded (≤ 5 min) with HashScan links visible; uploaded and linked
- [ ] Secret scan: `.env` never committed; no keys in git history (checked 2026-11-06 for both testnet keys across all refs)
- [ ] Repo made **public**
- [ ] ETHGlobal project page filled from [ethglobal-project-page.md](ethglobal-project-page.md), **every teammate added**
- [ ] Prize picks set to Hedera (both tracks)
