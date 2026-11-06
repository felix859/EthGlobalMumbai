// Paying fetch: calls an x402-protected URL and pays for it automatically,
// but only if BudgetGuard approves the price BEFORE anything is signed.
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera"; // single SDK copy: see docs/spike-notes.md
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { BudgetGuard } from "./budget.js";

type Requirement = { amount: string; payTo: string; asset: string };
export interface PolicyState {
  denial?: string;
  accepted?: Requirement;
}

/** A client policy: keep only requirements the guard allows; remember why others were dropped. */
export function makeGuardPolicy(guard: BudgetGuard, state: PolicyState) {
  return <T extends Requirement>(_version: number, reqs: T[]): T[] => {
    state.denial = undefined;
    state.accepted = undefined;
    const allowed: T[] = [];
    for (const r of reqs) {
      const v = guard.check({ amount: r.amount, payTo: r.payTo, asset: r.asset });
      if (v.ok) allowed.push(r);
      else state.denial ??= v.reason;
    }
    state.accepted = allowed[0];
    return allowed;
  };
}

export type PayResult =
  | { ok: true; data: unknown; txId: string; amount: bigint; asset: string }
  | { ok: false; reason: string };

export interface PayingFetchOptions {
  accountId: string;
  privateKeyHex: string; // ECDSA, as in .env
  guard: BudgetGuard;
  network?: "hedera:testnet" | "hedera:mainnet";
}

export function createPayingFetch(opts: PayingFetchOptions) {
  const network = opts.network ?? "hedera:testnet";
  const signer = createClientHederaSigner(opts.accountId, PrivateKey.fromStringECDSA(opts.privateKeyHex), { network });
  const state: PolicyState = {};
  const client = x402Client.fromConfig({
    schemes: [{ network: "hedera:*", client: new ExactHederaScheme(signer) }],
    // Library-level cap as a second line of defence; the real rules are in BudgetGuard.
    spendControls: {
      allowedAssets: [{ network, asset: "0.0.0", maxAmountPerPayment: "100000000" }],
    },
    policies: [makeGuardPolicy(opts.guard, state) as any],
  });
  const pay = wrapFetchWithPayment(fetch, client);
  const http = new x402HTTPClient(client);

  return async function payFor(url: string): Promise<PayResult> {
    state.denial = undefined;
    state.accepted = undefined;
    let res: Response;
    try {
      res = await pay(url);
    } catch (e) {
      // The guard dropped every option → report the guard's reason, not a library error.
      if (state.denial) return { ok: false, reason: state.denial };
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
    if (!res.ok) return { ok: false, reason: `Endpoint returned HTTP ${res.status}` };

    const settle = http.getPaymentSettleResponse((n) => res.headers.get(n));
    const accepted = state.accepted as Requirement | undefined; // set by the policy closure
    if (!settle?.success || !settle.transaction || !accepted) {
      return { ok: false, reason: "Payment did not settle" };
    }
    const amount = BigInt(accepted.amount);
    opts.guard.record(amount);
    return { ok: true, data: await res.json(), txId: settle.transaction, amount, asset: accepted.asset };
  };
}
