import { describe, it, expect } from "vitest";
import type { AuditMessage, RunEvent } from "@pennyagent/shared";
import { auditOnPayment, encodeAudit, hcsLoggerFromEnv, MAX_AUDIT_BYTES } from "./audit.js";

const msg: AuditMessage = { v: 1, runId: "r1", endpointId: "weather", amount: "1000000", asset: "0.0.0", txId: "0.0.7162784@1793978281.672658259", ts: 1793978281 };

describe("audit", () => {
  it("encodes the AuditMessage as plain JSON the web UI can parse back", () => {
    expect(JSON.parse(new TextDecoder().decode(encodeAudit(msg)))).toEqual(msg);
  });

  it("refuses a message over 1 KB", () => {
    expect(() => encodeAudit({ ...msg, runId: "x".repeat(MAX_AUDIT_BYTES) })).toThrow(/max 1024/);
  });

  it("emits `audit` with topic and sequence number after a successful submit", async () => {
    const events: RunEvent[] = [];
    await auditOnPayment(async () => ({ topicId: "0.0.11341094", sequenceNumber: "7" }), (e) => events.push(e))(msg);
    expect(events).toEqual([{ type: "audit", topicId: "0.0.11341094", sequenceNumber: "7" }]);
  });

  it("turns a failed submit into `audit_failed` and never throws", async () => {
    const events: RunEvent[] = [];
    await expect(auditOnPayment(async () => { throw new Error("INSUFFICIENT_PAYER_BALANCE"); }, (e) => events.push(e))(msg)).resolves.toBeUndefined();
    expect(events).toEqual([{ type: "audit_failed", reason: "INSUFFICIENT_PAYER_BALANCE" }]);
  });

  it("reports `audit_failed` when no topic is configured", async () => {
    const events: RunEvent[] = [];
    await auditOnPayment(null, (e) => events.push(e))(msg);
    expect(events[0]).toMatchObject({ type: "audit_failed" });
    expect(hcsLoggerFromEnv({ HCS_TOPIC_ID: "0.0.xxxxx", AGENT_ACCOUNT_ID: "0.0.1", AGENT_PRIVATE_KEY: "ab" })).toBeNull();
  });
});
