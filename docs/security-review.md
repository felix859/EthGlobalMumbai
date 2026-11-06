# Security review: agent core (2026-11-06)

Scope: `packages/agent/src/*` on `main` (spending guard, paying fetch, Claude loop, policy/approval, receipt, replay, health), plus repo hygiene.
Method: manual code read, targeted tests for every fix, `npm audit`, secret scan of the working tree and full git history.
Threat model: an LLM that can be prompt-injected (endpoint data is untrusted text), a data server that may be compromised or spoofed, an unauthenticated caller of the HTTP API, and a wallet that holds real (testnet) funds.

## Findings and status

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **High** | The payee allowlist was taken from the server's own `/catalogue`. A spoofed or compromised server could name its own account as `payTo` and the guard would accept it. | **Fixed.** The allowlist is now the configured `MERCHANT_ACCOUNT_ID`. A catalogue naming anyone else aborts the run; a missing config aborts too. Tests added. |
| 2 | **High** | No upper bound on the budget a caller could request, and no cap across runs: an anonymous `POST /api/ask` could drain the whole wallet by repeating runs. | **Fixed in the agent.** Per-run ceiling (`MAX_RUN_BUDGET_TINYBARS`, default 2 HBAR) and a process-wide ceiling (`MAX_TOTAL_SPEND_TINYBARS`, default 10 HBAR). The API (#4) must still add auth and rate limiting, see "Open items". |
| 3 | Medium | Endpoint `path` from the catalogue was concatenated onto the server URL. A path like `//evil.com/x` or `@evil.com/x` could point the paid request at another host. | **Fixed.** `safeEndpointUrl` refuses any URL that leaves the configured origin. Tests added. |
| 4 | Medium | The paying fetch followed HTTP redirects, which could carry the signed payment payload to another host. | **Fixed.** Redirects are an error. |
| 5 | Medium | Approval ids were not bound to a run: anyone who saw an `approval_required` event in one run's stream could approve a purchase in another. | **Fixed.** `ApprovalGate.resolve(id, approve, runId)` requires the run id from the URL. Tests added. |
| 6 | Medium | Endpoint response size was unbounded: a hostile endpoint could stuff the model's context (cost, injection surface). A non-JSON body after payment would throw after money had moved. | **Fixed.** Bodies are capped at 8,000 characters and parsed defensively; payment is recorded before the body is read. |
| 7 | Low | Budget and question were not validated (negative, fractional, huge, or non-string values; unlimited question length). | **Fixed.** `validateRunInput` (digits only, no leading zero, 18 digits max, question ≤ 2,000 chars). |
| 8 | Low | `npm audit`: 4 advisories (1 high) in `ws`, pulled in via `ethers` → `@hiero-ledger/sdk` → `@x402/hedera`. | **Accepted.** Transitive dependency of the Hedera SDK; the advisory concerns running a `ws` server, which we do not. The forced fix is a breaking downgrade. Re-check before submission. |
| 9 | Info | Secret hygiene. `.env` is gitignored; no key material in the working tree or in git history (checked both private keys by prefix across all refs). | **Clean.** Keys live only in local `.env` files. Both are testnet keys; rotate if this chat or the `.env` was shared widely. |

## What was already sound
- Spending rules are enforced in code, before anything is signed (client policy), never in the prompt. A "buy everything" injection cannot exceed the budget (test: `B6`).
- Amounts are `bigint`, parsed from strict digit strings; the guard rejects `-1`, `0`, `1.5`, `1e6`, `0x10`.
- Human approval is requested before signing, can never hang (timeout), and is not requested for purchases the guard would refuse anyway.
- Audit-log and receipt failures never break a run.
- Replay reads only from the configured recordings directory; there is no user-supplied path.

## Open items for other workstreams (#4 API, #3 Web)
These cannot be fixed in the agent package and are added to issue #4:
1. **`POST /api/ask` spends real funds. Add auth.** A shared secret header (e.g. `x-demo-token` from env) checked before `runAgent`, or bind the API to localhost for the demo. Add a simple rate limit (e.g. 1 concurrent run, N per minute).
2. **`POST /api/runs/:runId/approve` must pass the `runId` from the URL** to `approvals.resolve(approvalId, approve, runId)`. Return 404 for unknown runs.
3. **Validate the JSON body** (types, not just values) and return 400, not 500, for bad input. `runAgent` re-validates, but the API should answer clearly.
4. **CORS:** allow only the web origin, not `*`.
5. **Do not expose file paths or error stacks** in API errors. `GET /api/health` returns the agent account id and balance; acceptable on testnet, trim before any mainnet use.
6. **`POST /api/replay` takes no path or id from the caller**: it replays `latestRecording()` only.
7. **Web:** render model and endpoint text as plain text, never as HTML (`dangerouslySetInnerHTML` is forbidden).

## Residual risks (accepted for a hackathon demo)
- Testnet only. Do not point this at mainnet funds without auth on the API and a dedicated low-balance wallet.
- The agent trusts `FACILITATOR_URL` to settle honestly. A malicious facilitator could take a signed transfer and settle it, but it can only move the exact amount to the exact payee that was signed.
- The model could waste the budget on useless but allowed purchases; the caps bound the damage, they do not judge usefulness.

---

# Second review: independent code review (2026-11-06)

An independent reviewer read all code on `main` (commit 1143936) and found that the self-review above was accurate **for a single sequential run** but missed three ways to beat the spending cap. All were fixed in the `review-fixes` branch (issue #24), with tests that reproduce each case.

| # | Severity | Finding | Fix |
|---|---|---|---|
| R1 | **Important** | The guard was check-then-record: concurrent purchases (MCP tool calls, Analyst under load) could all pass the check against the same remaining budget; shared per-fetch state could record the wrong amount. | `BudgetGuard.reserve()` holds the amount atomically before signing; commit/release afterwards. A fresh x402 client and state per call. Tested with 6 parallel purchases against a 2-purchase budget, live on testnet with 5 against 4. |
| R2 | **Important** | The approval threshold (and the MCP refusal) used the catalogue price, but the amount signed came from the 402. A hostile server could advertise low and charge up to the per-call cap without a human being asked. | Every purchase passes `maxAmount` = advertised (and, if asked, approved) price into the pay path; a higher 402 is refused before signing. |
| R3 | **Important** | Spend was not recorded when the server returned non-2xx (or no settlement header) after the payment was sent. | Reservation is committed as soon as a payment is signed (`onAfterPaymentCreation`), whatever the response. Failures report `chargedTinybars`. |
| R4 | **Important** | The process-wide ceiling was read once per run and could be exceeded by concurrent runs. | It is a shared `SpendLimit` that every run's guard reserves against atomically. Still in memory (documented). |
| R5 | **Important** | The Analyst could sell at a loss (cost cap 0.2 HBAR vs price 0.03) and had no rate, concurrency or wallet-wide limit; handler untested. | Cost cap must be below the price (startup check, default 2/3), wallet-wide limit, concurrency cap (503), per-minute rate limit (429). Logic moved to a tested service. |
| R6 | **Important** | Origin checks, timeouts and body caps lived only in callers; bodies were read fully before truncation. | `createPayingFetch` requires `allowedOrigins`, refuses non-HTTP URLs, times out every request, and stream-reads with a byte cap. Catalogue fetches are time- and size-capped and validated. |
| R7 | **Important** | Seller descriptions were interpolated into the system prompt. | System prompt is fixed text; the catalogue is sanitised (control characters, length) and passed in the user turn inside a marked `<catalogue>` block. |
| R8 | **Important** | Tests mostly mocked the real wiring. | New integration tests run the **real x402 client with real (offline) Hedera signing** against a local mock x402 server: price bound, payee, origin, redirect, timeout, 500-after-payment, missing settlement, huge body, concurrency. |

Minor items also fixed: duplicate purchases blocked in code, per-tool denial instead of aborting a run on a bad path, approval check uses the entry's own payee, config amounts validated with clear errors, MCP honours `PAYMENT_ASSET` and caps its session budget, exact HBAR formatting, `as any` casts around the Hedera SDK removed, `.env.example` completed.

**Statements above that this corrects:** "Human approval is requested before signing" was true only relative to the catalogue price (R2); "a 'buy everything' injection cannot exceed the budget" held only for sequential purchases (R1). Both now hold in general.

**Still accepted:** ceilings are in memory and reset on restart; the facilitator is trusted to settle only what was signed; the transitive `ws` advisory.

---

# Third review: independent code review (2026-11-06)

A second independent review covered the review fixes, the data server and the web dashboard (`main` 1143936..d9252c6). It confirmed that the spending cap, payee allowlist and price bound now hold under concurrency and server errors, by tracing the x402 library source, and found no critical issues. It also found that **two statements in the "Second review" above were too strong**:

- *"Human approval is requested before signing ... now holds in general"*: **false against a hostile catalogue.** Approval was only asked when the advertised terms passed the guard, so a catalogue could advertise a price above the cap (or a wrong asset) to skip the question, then charge up to the cap in the 402. The budget and caps still held. **Fixed:** advertised terms that break the policy are now refused outright; approval is asked whenever the advertised price is above the threshold; the 402 is bounded by that price.
- *R5 "no selling at a loss"*: **overstated.** With the defaults (weather + hbar-price upstream, 0.04 HBAR, against a 0.02 cost cap) every sale paid for weather and then failed. **Fixed:** default upstream is weather only; the Analyst refuses to start if its upstream paths cost more than its cost cap, and refuses a sale it cannot afford before buying anything. Remaining, documented: the Analyst works after the buyer's payment is verified but before it settles, so a buyer whose payment later fails to settle can still cost it up to one cost cap (bounded by the rate and wallet limits).

| # | Finding | Fix |
|---|---|---|
| T1 | Approval bypass via a hostile catalogue (above) | Pre-check of advertised terms; refuse instead of falling through |
| T2 | Dashboard closed the stream on `answer`, losing receipts and late audit events | Closes on the API's `end` event (sent after receipt and audit writes) |
| T3 | Dashboard depended on receiving `started` | Seeds the run from the `/api/ask` response; the API also replays a run's events to late subscribers |
| T4 | `.env.example` put several payees in `MERCHANT_ACCOUNT_ID`, breaking the data server and the Analyst | `MERCHANT_ACCOUNT_ID` is one id (the server's payee); buyers use `TRUSTED_PAYEES` |
| T5 | Analyst defaults lost money on every sale | See above |
| T6 | An API caller could raise the per-call cap (and switch off an operator approval threshold) | Callers can only tighten: cap and threshold are the stricter of operator and request |
| T7 | Anyone could post fake entries to the audit topic, shown as genuine | Dashboard only counts messages submitted by the agent's own account; new topics get a submit key |

Also fixed: guard checks the payment network; a signed payment is never released by a failing later hook; an untrusted extra seller is skipped instead of blocking every run; server `/api/constructor` is a 404; one failing headline no longer fails the endpoint; malformed amounts from the network are dropped instead of crashing the dashboard; double submit and zero caps blocked in the form; accessibility labels; one HBAR formatter. **Still accepted:** ceilings and MCP session budgets are in memory and per process; a failed payment that may have settled is reported as `denied` with `chargedTinybars` but not written to the HCS log (there is no transaction id to log); the existing demo audit topic has no submit key (the dashboard filter covers it).
