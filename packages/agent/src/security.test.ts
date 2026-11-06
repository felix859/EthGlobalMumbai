import { describe, it, expect } from "vitest";
import { MAX_DATA_CHARS, safeEndpointUrl, truncateForModel, validateRunInput } from "./security.js";

describe("validateRunInput", () => {
  it("accepts a normal request", () => {
    expect(validateRunInput(" hi ", "5000000")).toEqual({ question: "hi", budget: 5_000_000n });
  });
  it.each([[""], ["   "], [42], [null], ["x".repeat(2001)]])("rejects bad question %j", (q) => {
    expect(() => validateRunInput(q, "1000")).toThrow();
  });
  it.each(["0", "-5", "1.5", "abc", "", "1e9", "0x10", " 5", "1000000000000000000000"])("rejects bad budget %j", (b) => {
    expect(() => validateRunInput("q", b)).toThrow();
  });
  it("rejects non-string budgets (e.g. numbers from JSON)", () => {
    expect(() => validateRunInput("q", 5000000)).toThrow();
  });
  it("enforces the per-run ceiling, exact boundary allowed", () => {
    expect(validateRunInput("q", "200000000").budget).toBe(200_000_000n);
    expect(() => validateRunInput("q", "200000001")).toThrow(/maximum/);
    expect(() => validateRunInput("q", "11", 10n)).toThrow(/maximum/);
  });
});

describe("safeEndpointUrl", () => {
  const s = "http://localhost:3000";
  it("joins a normal path", () => {
    expect(safeEndpointUrl(s, "/api/weather")).toBe("http://localhost:3000/api/weather");
    expect(safeEndpointUrl(s, "/api/x?city=Mumbai")).toBe("http://localhost:3000/api/x?city=Mumbai");
  });
  it.each(["http://evil.com/x", "//evil.com/x", "@evil.com/x", "api/weather", "/\\evil.com", "", "javascript:alert(1)"])(
    "refuses %j",
    (p) => expect(() => safeEndpointUrl(s, p)).toThrow(),
  );
  it("a path with @ in the middle stays on our origin", () => {
    expect(new URL(safeEndpointUrl(s, "/a@evil.com")).hostname).toBe("localhost");
  });
});

describe("truncateForModel", () => {
  it("leaves short text alone and marks long text", () => {
    expect(truncateForModel("abc")).toBe("abc");
    const out = truncateForModel("x".repeat(MAX_DATA_CHARS + 50));
    expect(out.length).toBeLessThan(MAX_DATA_CHARS + 60);
    expect(out).toContain("truncated 50 characters");
  });
});
