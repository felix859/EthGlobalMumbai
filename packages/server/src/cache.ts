// Tiny in-memory cache for one upstream source. Fresh for `ttlMs`; if a refresh fails, the last good value is
// served for up to `maxStaleMs` so a flaky upstream on demo day does not turn into 502s. Concurrent misses share
// one in-flight fetch.
export interface Cached<T> {
  value: T;
  fetchedAt: number;
  stale: boolean;
}

export class SourceCache<T> {
  private last?: { value: T; fetchedAt: number };
  private inflight?: Promise<{ value: T; fetchedAt: number }>;

  constructor(
    private readonly fetcher: () => Promise<T>,
    private readonly ttlMs = 60_000,
    private readonly maxStaleMs = 10 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns a fresh value, or a stale one if the upstream is failing. Throws only when there is nothing to serve. */
  async get(): Promise<Cached<T>> {
    const t = this.now();
    if (this.last && t - this.last.fetchedAt < this.ttlMs) return { ...this.last, stale: false };
    try {
      return { ...(await this.refresh()), stale: false };
    } catch (e) {
      if (this.last && t - this.last.fetchedAt < this.maxStaleMs) return { ...this.last, stale: true };
      throw e;
    }
  }

  /** Fetches now (sharing any in-flight fetch) and stores the result. */
  refresh(): Promise<{ value: T; fetchedAt: number }> {
    this.inflight ??= this.fetcher()
      .then((value) => (this.last = { value, fetchedAt: this.now() }))
      .finally(() => (this.inflight = undefined));
    return this.inflight;
  }
}
