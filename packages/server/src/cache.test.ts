import { describe, it, expect } from "vitest";
import { SourceCache } from "./cache.js";

const clock = () => {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

describe("SourceCache", () => {
  it("serves from memory within the TTL and refetches after it", async () => {
    const c = clock();
    let n = 0;
    const cache = new SourceCache(async () => ++n, 60_000, 600_000, c.now);
    expect((await cache.get()).value).toBe(1);
    c.advance(59_999);
    expect((await cache.get()).value).toBe(1);
    c.advance(1);
    expect((await cache.get()).value).toBe(2);
  });

  it("shares one in-flight fetch between concurrent callers", async () => {
    let n = 0;
    const cache = new SourceCache(async () => (await new Promise((r) => setTimeout(r, 5)), ++n));
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect([a.value, b.value, n]).toEqual([1, 1, 1]);
  });

  it("serves the last good value as stale while the upstream fails, until maxStale", async () => {
    const c = clock();
    let fail = false;
    const cache = new SourceCache(async () => { if (fail) throw new Error("down"); return "ok"; }, 60_000, 600_000, c.now);
    await cache.get();
    fail = true;
    c.advance(120_000);
    expect(await cache.get()).toMatchObject({ value: "ok", stale: true });
    c.advance(600_000);
    await expect(cache.get()).rejects.toThrow("down");
  });

  it("throws when the upstream fails and nothing was ever cached", async () => {
    const cache = new SourceCache(async () => { throw new Error("down"); });
    await expect(cache.get()).rejects.toThrow("down");
  });
});
