// Agent HTTP API: the web UI talks to this (see api.ts for the routes).
import { fileURLToPath } from "node:url";
import { PORTS, type AgentConfig } from "@pennyagent/shared";
import { createApi } from "./api.js";
import { hcsLoggerFromEnv } from "./audit.js";

const env = process.env;
// replay.ts resolves RECORD_DIR against the cwd, and `npm run dev -w` runs from packages/agent: anchor it to the repo's
// runs/ (which holds sample.json) so recordings are saved and found in one place however the agent is started.
env.RECORD_DIR ||= fileURLToPath(new URL("../../../runs/", import.meta.url));
const port = Number(env.AGENT_PORT ?? PORTS.agent);
// The API is unauthenticated and every run spends real HBAR, so listen on loopback unless told otherwise.
const host = env.AGENT_HOST || "127.0.0.1";

const config: AgentConfig = {
  topicId: env.HCS_TOPIC_ID ?? "",
  merchantAccount: env.MERCHANT_ACCOUNT_ID ?? "",
  agentAccount: env.AGENT_ACCOUNT_ID ?? "",
  network: env.HEDERA_NETWORK || "hedera:testnet",
  ...(env.AGENT_UAID && { uaid: env.AGENT_UAID }),
  ...(env.IDENTITY_TOPIC_ID && { identityTopicId: env.IDENTITY_TOPIC_ID }),
};

const logger = hcsLoggerFromEnv();
if (!logger) console.warn("[agent] HCS_TOPIC_ID not set: payments will emit audit_failed");
if (!env.ANTHROPIC_API_KEY) console.warn("[agent] ANTHROPIC_API_KEY not set: live runs will fail (replay still works)");

const server = createApi({
  config,
  submitAudit: logger?.submit ?? null,
  webOrigin: env.WEB_ORIGIN || `http://localhost:${PORTS.web}`,
  maxActiveRuns: Number(env.MAX_ACTIVE_RUNS || 3),
});

server.listen(port, host, () => console.log(`[agent] API on http://${host}:${port}  agent ${config.agentAccount}  audit topic ${config.topicId || "(none)"}`));

const shutdown = () => {
  logger?.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2_000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
