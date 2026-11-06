# PennyAgent

> An AI research agent with its own Hedera wallet and a hard budget. It decides which paid data endpoints are worth buying, pays for them over **x402 on Hedera** with no human approval, and logs every payment to an **HCS audit topic**.

Built at ETHGlobal Mumbai. Target: Hedera, "AI Agents That Pay: x402 on Hedera".

## Teammates: start here

1. Read the [design spec](docs/superpowers/specs/2026-11-06-pennyagent-design.md) (10 min).
2. Open the [implementation plan](docs/superpowers/plans/2026-11-06-implementation-plan.md), claim a workstream, and begin with **Phase 0** (scaffold plus the x402 spike).
3. Copy `.env.example` to `.env`. Never commit it.

## Status

Planning done. Nothing is built yet; see the plan for tasks and owners.

## Planned layout

```
packages/shared   shared types and constants (the contracts)
packages/server   x402-gated data API         (port 3000)
packages/agent    Claude loop, wallet, budget (port 4000)
packages/web      dashboard                   (port 5173)
scripts/          one-off scripts (create HCS topic)
docs/             spec, plan, spike notes
```

The full README (architecture, payment flow, settled transactions) is written at the end; see workstream D in the plan.
