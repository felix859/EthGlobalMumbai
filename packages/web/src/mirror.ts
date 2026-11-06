// Reads the HCS audit topic straight from the public Hedera mirror node, so the log shown in the UI does not depend
// on our agent being honest. Messages are untrusted: decoded defensively and validated before display.
import type { AuditMessage } from "@pennyagent/shared";

export interface AuditRow {
  sequenceNumber: number;
  consensusTimestamp: string;
  message?: AuditMessage;
  /** Set when the topic message is not a valid PennyAgent audit message. */
  raw?: string;
}

const MIRROR = "https://testnet.mirrornode.hedera.com";

export function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function parseAuditMessage(text: string): AuditMessage | undefined {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return undefined;
  }
  const m = v as Partial<AuditMessage>;
  const str = (x: unknown) => typeof x === "string" && x.length > 0 && x.length < 200;
  if (m?.v !== 1 || !str(m.runId) || !str(m.endpointId) || !str(m.txId) || !str(m.asset) || typeof m.ts !== "number") return undefined;
  if (typeof m.amount !== "string" || !/^[0-9]{1,18}$/.test(m.amount)) return undefined;
  return m as AuditMessage;
}

export async function fetchAuditRows(topicId: string, limit = 25, fetchImpl: typeof fetch = fetch): Promise<AuditRow[]> {
  if (!/^0\.0\.[0-9]{1,12}$/.test(topicId)) throw new Error(`Invalid topic id "${topicId}"`);
  const r = await fetchImpl(`${MIRROR}/api/v1/topics/${topicId}/messages?order=desc&limit=${limit}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Mirror node returned HTTP ${r.status}`);
  const body = (await r.json()) as { messages?: { sequence_number: number; consensus_timestamp: string; message: string }[] };
  return (body.messages ?? []).map((m) => {
    let text = "";
    try {
      text = decodeBase64Utf8(m.message);
    } catch {
      /* leave empty */
    }
    const message = parseAuditMessage(text);
    return { sequenceNumber: m.sequence_number, consensusTimestamp: m.consensus_timestamp, ...(message ? { message } : { raw: text.slice(0, 120) }) };
  });
}
