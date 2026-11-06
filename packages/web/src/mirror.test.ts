import { describe, it, expect } from "vitest";
import { decodeBase64Utf8, fetchAuditRows, parseAuditMessage } from "./mirror.js";

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const good = { v: 1, runId: "r1", endpointId: "weather", amount: "1000000", asset: "0.0.0", txId: "0.0.1@2", ts: 1 };

describe("mirror-node audit reader", () => {
  it("decodes base64 UTF-8", () => {
    expect(decodeBase64Utf8(b64("Mumbai ✓"))).toBe("Mumbai ✓");
  });
  it("accepts a valid audit message and rejects everything else", () => {
    expect(parseAuditMessage(JSON.stringify(good))).toEqual(good);
    for (const bad of ["not json", "{}", JSON.stringify({ ...good, v: 2 }), JSON.stringify({ ...good, amount: "-5" }), JSON.stringify({ ...good, ts: "x" })]) {
      expect(parseAuditMessage(bad)).toBeUndefined();
    }
  });
  it("maps mirror rows, keeping foreign messages as raw text", async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ messages: [
        { sequence_number: 2, consensus_timestamp: "2.0", message: b64(JSON.stringify(good)) },
        { sequence_number: 1, consensus_timestamp: "1.0", message: b64("hello from someone else") },
      ] }))) as unknown as typeof fetch;
    const rows = await fetchAuditRows("0.0.11341094", 25, fake);
    expect(rows[0].message?.endpointId).toBe("weather");
    expect(rows[1]).toMatchObject({ sequenceNumber: 1, raw: "hello from someone else" });
  });
  it("refuses a malformed topic id before making a request", async () => {
    await expect(fetchAuditRows("0.0.1/../../x")).rejects.toThrow(/Invalid topic id/);
  });
});
