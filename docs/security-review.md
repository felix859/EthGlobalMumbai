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
