// Paying fetch: calls an x402-protected URL and pays for it automatically, inside BudgetGuard's limits.
//
// Per call (no shared state between concurrent calls):
//   1. the URL must be on a trusted origin (checked here, not only by callers)
//   2. the 402's requirements are filtered by the guard (payee, asset, per-call cap, maxAmount)
//   3. right before signing, the REAL amount from the 402 is reserved atomically
//   4. once a payment is signed, the reservation is committed whatever happens next: a server can settle the
//      transfer and still answer 500, so "signed and sent" counts as spent (pessimistic, never optimistic)
//   5. redirects are refused, every request has a timeout, and the body is read with a byte cap
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera"; // single SDK copy: see docs/spike-notes.md
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { BudgetGuard, type Reservation } from "./budget.js";
import { assertAllowedUrl, DEFAULT_TIMEOUT_MS, MAX_BODY_BYTES, MAX_DATA_CHARS, readCapped, truncateForModel } from "./security.js";

type Requirement = { amount: string; payTo: string; asset: string; network?: string };

/** A client policy: keep only requirements the guard would allow; remember why others were dropped. Holds nothing. */
export function makeGuardPolicy(guard: BudgetGuard, state: { denial?: string }, maxAmount?: bigint, network?: string) {
  return <T extends Requirement>(_version: number, reqs: T[]): T[] => {
    const allowed: T[] = [];
    for (const r of reqs) {
      if (network !== undefined && r.network !== network) {
        state.denial ??= `Network ${r.network} is not ${network}`;
        continue;
      }
      const v = guard.check({ amount: r.amount, payTo: r.payTo, asset: r.asset }, maxAmount);
      if (v.ok) allowed.push(r);
      else state.denial ??= v.reason;
    }
    return allowed;
  };
}

export type PayResult =
  | { ok: true; data: unknown; txId: string; amount: bigint; asset: string }
  | {
      ok: false;
      reason: string;
      /** Set when a signed payment was sent, so the money may have moved. Counted against the budget. */
      chargedTinybars?: bigint;
    };

export interface PayOptions {
  /** Highest amount this purchase may cost: the advertised price, or the price a human approved. */
  maxAmount?: bigint;
}

export interface PayingFetchOptions {
  accountId: string;
  privateKeyHex: string; // ECDSA, as in .env
  guard: BudgetGuard;
  /** Only these origins can be paid. Required: the paying fetch never pays an arbitrary URL. */
  allowedOrigins: string[];
  network?: "hedera:testnet" | "hedera:mainnet";
  asset?: string;
  timeoutMs?: number;
  maxBodyBytes?: number;
  /** Test seam: the underlying fetch. */
  fetchImpl?: typeof fetch;
}

interface CallState {
  denial?: string;
  reservation?: Reservation;
  asset?: string;
  signed: boolean;
}

export function createPayingFetch(opts: PayingFetchOptions) {
  if (opts.allowedOrigins.length === 0) throw new Error("createPayingFetch needs at least one allowed origin");
  const network = opts.network ?? "hedera:testnet";
  const asset = opts.asset ?? "0.0.0";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBodyBytes = opts.maxBodyBytes ?? MAX_BODY_BYTES;
  const baseFetch = opts.fetchImpl ?? fetch;
  const signer = createClientHederaSigner(opts.accountId, PrivateKey.fromStringECDSA(opts.privateKeyHex), { network });

  // Redirects could carry the signed payment to another host: never follow one. Every request gets a timeout.
  const guardedFetch: typeof fetch = (input, init) => {
    const signal = init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    return baseFetch(input, { ...init, redirect: "error", signal });
  };

  return async function payFor(url: string, payOpts: PayOptions = {}): Promise<PayResult> {
    try {
      assertAllowedUrl(url, opts.allowedOrigins);
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }

    const state: CallState = { signed: false };
    const client = x402Client
      .fromConfig({
        schemes: [{ network: "hedera:*", client: new ExactHederaScheme(signer) }],
        // Library-level cap as a second line of defence; the real rules are in BudgetGuard.
        spendControls: { allowedAssets: [{ network, asset, maxAmountPerPayment: "100000000" }] },
        policies: [makeGuardPolicy(opts.guard, state, payOpts.maxAmount, network) as never],
      })
      .onBeforePaymentCreation(async ({ selectedRequirements: r }) => {
        if (r.network !== network) {
          state.denial = `Network ${r.network} is not ${network}`;
          return { abort: true, reason: state.denial };
        }
        // Atomic reservation of the amount that is about to be signed.
        const res = opts.guard.reserve({ amount: r.amount, payTo: r.payTo, asset: r.asset }, payOpts.maxAmount);
        if (!res.ok) {
          state.denial = res.reason;
          return { abort: true, reason: res.reason };
        }
        state.reservation = res.reservation;
        state.asset = r.asset;
      })
      .onAfterPaymentCreation(async () => {
        state.signed = true;
      })
      .onPaymentCreationFailure(async () => {
        if (!state.signed) state.reservation?.release(); // once signed it counts as spent, never released
      });

    const pay = wrapFetchWithPayment(guardedFetch, client);
    const http = new x402HTTPClient(client);

    /** Settles the reservation: signed → spent (pessimistic), not signed → released. */
    const settleReservation = (): bigint | undefined => {
      const r = state.reservation;
      if (!r) return undefined;
      if (state.signed) {
        r.commit();
        return r.amount;
      }
      r.release();
      return undefined;
    };

    let res: Response;
    try {
      res = await pay(url);
    } catch (e) {
      const charged = settleReservation();
      const reason = state.denial ?? (e instanceof Error ? e.message : String(e));
      return charged !== undefined ? { ok: false, reason: `${reason} (a signed payment was sent and is counted as spent)`, chargedTinybars: charged } : { ok: false, reason };
    }
    const charged = settleReservation();

    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: `Endpoint returned HTTP ${res.status}`, ...(charged !== undefined ? { chargedTinybars: charged } : {}) };
    }
    let txId: string | undefined;
    try {
      const settle = http.getPaymentSettleResponse((n) => res.headers.get(n));
      if (settle?.success && settle.transaction) txId = settle.transaction;
    } catch {
      /* missing or malformed settlement header */
    }
    if (charged === undefined || !txId) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: "Payment did not settle", ...(charged !== undefined ? { chargedTinybars: charged } : {}) };
    }

    // Money has moved. Read the body defensively: byte-capped, text-capped, never throws.
    let data: unknown;
    try {
      const { text, truncated } = await readCapped(res, maxBodyBytes);
      const raw = truncateForModel(text, MAX_DATA_CHARS);
      try {
        data = truncated ? raw : JSON.parse(raw);
      } catch {
        data = raw;
      }
    } catch {
      data = "(response body could not be read)";
    }
    return { ok: true, data, txId, amount: charged, asset: state.asset ?? asset };
  };
}
