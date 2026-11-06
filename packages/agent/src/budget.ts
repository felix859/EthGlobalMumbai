// BudgetGuard: the hard spending rules. Pure logic, no I/O, enforced in code
// (never in the prompt) so a prompt-injected model cannot bypass it.
//
// Spending is RESERVE → COMMIT/RELEASE, not check-then-record: a reservation is taken synchronously (JS is
// single-threaded, so it is atomic) before anything is signed. Concurrent purchases therefore cannot both pass
// against the same remaining budget. A reservation is committed as soon as a signed payment has been SENT,
// whatever the server answers, because a server can settle and still return an error.

export interface GuardConfig {
  /** Total the guard may spend, in tinybars (one run, one MCP session, ...). */
  runBudget: bigint;
  /** Max for any single payment, in tinybars. */
  maxPerCall: bigint;
  /** The only account(s) the guard may pay. */
  allowedPayTo: string | string[];
  /** The only asset the guard may pay with ("0.0.0" = HBAR). */
  allowedAsset: string;
  /** Optional wider limit shared with other guards (e.g. process-wide). Reservations are taken in both. */
  parent?: SpendLimit;
}

export interface PaymentRequest {
  amount: string; // atomic units as a decimal string, straight from the 402
  payTo: string;
  asset: string;
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

/** Digits only, no leading zero, max 18 digits: far below any overflow concern. */
export const AMOUNT_RE = /^[1-9][0-9]{0,17}$/;

/** An amount-only limit with reservations. Shared between guards to build a process-wide ceiling. */
export class SpendLimit {
  private _spent = 0n;
  private _reserved = 0n;

  constructor(
    readonly limit: bigint,
    readonly label = "budget",
  ) {
    if (limit <= 0n) throw new Error(`${label} must be > 0`);
  }

  get spent(): bigint {
    return this._spent;
  }
  get reserved(): bigint {
    return this._reserved;
  }
  get remaining(): bigint {
    return this.limit - this._spent - this._reserved;
  }

  tryReserve(amount: bigint): boolean {
    if (amount <= 0n || amount > this.remaining) return false;
    this._reserved += amount;
    return true;
  }
  commit(amount: bigint): void {
    if (amount > this._reserved) throw new Error(`Cannot commit ${amount}: only ${this._reserved} reserved`);
    this._reserved -= amount;
    this._spent += amount;
  }
  release(amount: bigint): void {
    if (amount > this._reserved) throw new Error(`Cannot release ${amount}: only ${this._reserved} reserved`);
    this._reserved -= amount;
  }
}

/** A held amount. Exactly one of commit()/release() takes effect; later calls are no-ops. */
export interface Reservation {
  readonly amount: bigint;
  readonly settled: boolean;
  commit(): void;
  release(): void;
}

export type ReserveResult = { ok: true; reservation: Reservation } | { ok: false; reason: string };

export class BudgetGuard {
  private readonly payees: Set<string>;
  private readonly own: SpendLimit;

  constructor(private readonly cfg: GuardConfig) {
    this.payees = new Set(Array.isArray(cfg.allowedPayTo) ? cfg.allowedPayTo : [cfg.allowedPayTo]);
    if (this.payees.size === 0) throw new Error("BudgetGuard needs at least one allowed payee");
    this.own = new SpendLimit(cfg.runBudget, "run budget");
  }

  get spent(): bigint {
    return this.own.spent;
  }

  /** What can still be reserved: the smaller of this guard's and the parent's headroom. */
  get remaining(): bigint {
    const mine = this.own.remaining;
    const parent = this.cfg.parent?.remaining;
    return parent !== undefined && parent < mine ? parent : mine;
  }

  /** Validation only; holds nothing. `maxAmount` bounds one purchase further (e.g. the price a human approved). */
  check(req: PaymentRequest, maxAmount?: bigint): GuardResult {
    if (!AMOUNT_RE.test(req.amount)) {
      return { ok: false, reason: `Invalid payment amount "${req.amount}"` };
    }
    const amount = BigInt(req.amount);

    if (!this.payees.has(req.payTo)) {
      return { ok: false, reason: `Payee ${req.payTo} is not an allowlisted merchant` };
    }
    if (req.asset !== this.cfg.allowedAsset) {
      return { ok: false, reason: `Asset ${req.asset} is not allowed` };
    }
    if (amount > this.cfg.maxPerCall) {
      return { ok: false, reason: `Price ${amount} exceeds the per-call cap of ${this.cfg.maxPerCall}` };
    }
    if (maxAmount !== undefined && amount > maxAmount) {
      return { ok: false, reason: `Price ${amount} is higher than the advertised or approved price of ${maxAmount}` };
    }
    if (amount > this.own.remaining) {
      return { ok: false, reason: `Price ${amount} exceeds the remaining budget of ${this.own.remaining}` };
    }
    if (this.cfg.parent && amount > this.cfg.parent.remaining) {
      return { ok: false, reason: `Price ${amount} exceeds the remaining ${this.cfg.parent.label} of ${this.cfg.parent.remaining}` };
    }
    return { ok: true };
  }

  /** Checks and holds the amount atomically, in this guard and in the parent. */
  reserve(req: PaymentRequest, maxAmount?: bigint): ReserveResult {
    const v = this.check(req, maxAmount);
    if (!v.ok) return v;
    const amount = BigInt(req.amount);
    const own = this.own;
    const parent = this.cfg.parent;
    if (!own.tryReserve(amount)) return { ok: false, reason: `Price ${amount} exceeds the remaining budget of ${own.remaining}` };
    if (parent && !parent.tryReserve(amount)) {
      own.release(amount);
      return { ok: false, reason: `Price ${amount} exceeds the remaining ${parent.label} of ${parent.remaining}` };
    }
    let settled = false;
    return {
      ok: true,
      reservation: {
        amount,
        get settled() {
          return settled;
        },
        commit() {
          if (settled) return;
          settled = true;
          own.commit(amount);
          parent?.commit(amount);
        },
        release() {
          if (settled) return;
          settled = true;
          own.release(amount);
          parent?.release(amount);
        },
      },
    };
  }

  /** Convenience for callers that pay outside the x402 flow (tests, fakes): reserve and commit at once. */
  spend(req: PaymentRequest, maxAmount?: bigint): GuardResult {
    const r = this.reserve(req, maxAmount);
    if (!r.ok) return r;
    r.reservation.commit();
    return { ok: true };
  }
}
