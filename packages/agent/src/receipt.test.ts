import { describe, it, expect } from "vitest";
import { receiptMetadata } from "./receipt.js";

describe("receiptMetadata", () => {
  it("is compact, readable, and within the 100-byte HTS limit", () => {
    const m = receiptMetadata({ runId: "123e4567-e89b-12d3-a456-426614174000", purchases: 3, totalTinybars: 6_000_000n });
    expect(new TextDecoder().decode(m)).toBe("pennyagent:v1:123e4567:3:6000000");
    expect(m.length).toBeLessThanOrEqual(100);
  });
  it("stays under the limit for huge totals", () => {
    const m = receiptMetadata({ runId: "x".repeat(64), purchases: 999, totalTinybars: 99_999_999_999_999_999n });
    expect(m.length).toBeLessThanOrEqual(100);
  });
});
