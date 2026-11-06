// BudgetGuard: the hard spending rules. Pure logic, no I/O, enforced in code
// (never in the prompt) so a prompt-injected model cannot bypass it.

export interface GuardConfig {
  /** Total the agent may spend in one run, in tinybars. */
  runBudget: bigint;
  /** Max for any single payment, in tinybars. */
  maxPerCall: bigint;
  /** The only account(s) the agent may pay. */
  allowedPayTo: string | string[];
  /** The only asset the agent may pay with ("0.0.0" = HBAR). */
  allowedAsset: string;
}

export interface PaymentRequest {
  amount: string; // atomic units as a decimal string, straight from the 402
  payTo: string;
  asset: string;
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

// Digits only, no leading zero (except we reject "0" separately), max 18 digits
// so the value is far below any overflow concern.
const AMOUNT_RE = /^[1-9][0-9]{0,17}$/;

export class BudgetGuard {
  private _spent = 0n;

  private readonly payees: Set<string>;

  constructor(private readonly cfg: GuardConfig) {
    this.payees = new Set(Array.isArray(cfg.allowedPayTo) ? cfg.allowedPayTo : [cfg.allowedPayTo]);
    if (this.payees.size === 0) throw new Error("BudgetGuard needs at least one allowed payee");
  }

  get spent(): bigint {
    return this._spent;
  }

  get remaining(): bigint {
    return this.cfg.runBudget - this._spent;
  }

  check(req: PaymentRequest): GuardResult {
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
    if (amount > this.remaining) {
      return { ok: false, reason: `Price ${amount} exceeds the remaining budget of ${this.remaining}` };
    }
    return { ok: true };
  }

  /** Call after a payment has settled. Throws rather than ever overspending. */
  record(amount: bigint): void {
    if (amount <= 0n || amount > this.remaining) {
      throw new Error(`Cannot record ${amount}: remaining budget is ${this.remaining}`);
    }
    this._spent += amount;
  }
}
