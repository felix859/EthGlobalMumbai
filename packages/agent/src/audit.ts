// HCS audit log: one public message per settled payment, readable from the mirror node without trusting us.
// Same single-import rule as receipt.ts: all SDK classes from one copy of @hiero-ledger/sdk.
import { AccountId, Client, PrivateKey, TopicId, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import type { AuditMessage, RunEvent } from "@pennyagent/shared";

export interface AuditReceipt {
  topicId: string;
  sequenceNumber: string;
}
export type SubmitAudit = (m: AuditMessage) => Promise<AuditReceipt>;

/** Spec: one message, JSON, at most 1 KB (well under HCS's own 1024-byte single-chunk limit). */
export const MAX_AUDIT_BYTES = 1024;

export function encodeAudit(m: AuditMessage): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(m));
  if (bytes.length > MAX_AUDIT_BYTES) throw new Error(`Audit message is ${bytes.length} bytes (max ${MAX_AUDIT_BYTES})`);
  return bytes;
}

export interface HcsLoggerOptions {
  topicId: string;
  accountId: string;
  privateKeyHex: string;
}

/** Submits audit messages to the topic. One client for the logger's lifetime; call `close()` on shutdown. */
export function createHcsLogger(o: HcsLoggerOptions): { submit: SubmitAudit; close: () => void } {
  let client: Client | undefined;
  const topicId = TopicId.fromString(o.topicId);
  const getClient = () =>
    // Testnet only by design (see README limitations).
    (client ??= Client.forTestnet().setOperator(AccountId.fromString(o.accountId), PrivateKey.fromStringECDSA(o.privateKeyHex)));
  return {
    async submit(m) {
      const c = getClient();
      const res = await new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(encodeAudit(m)).execute(c);
      const rcpt = await res.getReceipt(c);
      return { topicId: topicId.toString(), sequenceNumber: String(rcpt.topicSequenceNumber) };
    },
    close: () => client?.close(),
  };
}

/** The HCS logger from env, or null when HCS_TOPIC_ID is not configured (audit is then reported as failed). */
export function hcsLoggerFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const { HCS_TOPIC_ID: topicId, AGENT_ACCOUNT_ID: accountId, AGENT_PRIVATE_KEY: privateKeyHex } = env;
  if (!topicId || !/^\d+\.\d+\.\d+$/.test(topicId) || !accountId || !privateKeyHex) return null;
  return createHcsLogger({ topicId, accountId, privateKeyHex });
}

/**
 * Builds runAgent's `onPayment`: submits the message and emits `audit`, or `audit_failed` on any error.
 * Never throws and never blocks the run: runAgent does not await it.
 */
export function auditOnPayment(submit: SubmitAudit | null, emit: (e: RunEvent) => void) {
  return async (m: AuditMessage) => {
    if (!submit) return emit({ type: "audit_failed", reason: "HCS_TOPIC_ID is not configured" });
    try {
      emit({ type: "audit", ...(await submit(m)) });
    } catch (e) {
      emit({ type: "audit_failed", reason: e instanceof Error ? e.message : String(e) });
    }
  };
}
