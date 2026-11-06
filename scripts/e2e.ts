// End-to-end proof run (submission evidence): ask one question with a 0.1 HBAR budget against the real data server,
// print every event, finish with the HashScan links. Needs the data server running (npm run dev:server).
//   npm run e2e
//   npm run e2e -- --budget 1500000 "Is HBAR up today?"     (tiny budget: shows the denied path)
import type { RunEvent } from "@pennyagent/shared";
import { hcsLoggerFromEnv } from "../packages/agent/src/audit.ts";
import { hbar } from "../packages/agent/src/run.ts";
import { RunHub } from "../packages/agent/src/runs.ts";
import { startRun } from "../packages/agent/src/session.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const budgetTinybars = flag("--budget") ?? "10000000"; // 0.1 HBAR
const question = args.join(" ").trim() || "Should I carry an umbrella in Mumbai today, and is the air OK for a run? Also, is HBAR up or down?";

const logger = hcsLoggerFromEnv();
const hub = new RunHub();
const events: RunEvent[] = [];

const line = (e: RunEvent): string => {
  switch (e.type) {
    case "started": return `▶ run ${e.runId}  budget ${hbar(e.budgetTinybars)} HBAR`;
    case "thinking": return `… ${e.text}`;
    case "payment": return `$ paid ${hbar(e.amountTinybars)} HBAR for ${e.endpointId}  (spent ${hbar(e.spentTinybars)}, left ${hbar(e.remainingTinybars)})  ${e.hashscanUrl}`;
    case "denied": return `✗ denied ${e.endpointId}: ${e.reason}`;
    case "audit": return `≡ audit logged to HCS ${e.topicId} #${e.sequenceNumber}`;
    case "audit_failed": return `! audit failed: ${e.reason}`;
    case "receipt": return `◆ receipt NFT ${e.tokenId} #${e.serial}  ${e.hashscanUrl}`;
    case "receipt_failed": return `! receipt failed: ${e.reason}`;
    case "approval_required": return `? approval needed for ${e.endpointId} (${hbar(e.amountTinybars)} HBAR)`;
    case "approval_resolved": return `? approval ${e.outcome}`;
    case "answer": return `\n${e.text}\n`;
    case "error": return `✗ ERROR ${e.message}`;
  }
};

console.log(`Q: ${question}\n`);
const { runId, done } = startRun({ question, budgetTinybars }, { hub, submitAudit: logger?.submit ?? null });
hub.subscribe(runId, (e) => (events.push(e), console.log(line(e))), () => {});
await done;
logger?.close();

const payments = events.filter((e): e is Extract<RunEvent, { type: "payment" }> => e.type === "payment");
const topic = process.env.HCS_TOPIC_ID;
console.log("──────── summary ────────");
console.log(`payments: ${payments.length}, spent ${hbar(payments.reduce((a, p) => a + BigInt(p.amountTinybars), 0n))} HBAR`);
for (const p of payments) console.log(`  ${p.endpointId.padEnd(12)} ${p.hashscanUrl}`);
if (topic) console.log(`audit log: https://hashscan.io/testnet/topic/${topic}`);
const failed = events.some((e) => e.type === "error") || !events.some((e) => e.type === "answer");
process.exit(failed ? 1 : 0);
