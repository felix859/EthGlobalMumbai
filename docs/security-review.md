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
