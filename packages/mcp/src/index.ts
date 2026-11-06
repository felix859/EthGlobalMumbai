#!/usr/bin/env -S npx tsx
// PennyAgent MCP server (stdio). Gives any MCP client (Claude Desktop, Claude Code) a Hedera wallet that can only
// spend inside PennyAgent's guardrails. Add it to a client with the config shown in docs/mcp.md.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BudgetGuard } from "@pennyagent/agent/budget";
import { createPayingFetch } from "@pennyagent/agent/pay";
import { defaultFetchCatalogue } from "@pennyagent/agent/run";
import { parseList } from "@pennyagent/agent/security";
import { Toolset } from "./toolset.js";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var ${k}`);
  return v;
};
const serverUrl = process.env.SERVER_URL ?? "http://localhost:3000";
const approvalAbove = process.env.APPROVAL_ABOVE_TINYBARS ? BigInt(process.env.APPROVAL_ABOVE_TINYBARS) : undefined;

const toolset = new Toolset({
  serverUrl,
  trustedPayees: parseList(need("MERCHANT_ACCOUNT_ID")),
  trustedOrigins: parseList(process.env.TRUSTED_ORIGINS),
  sessionBudget: BigInt(process.env.MCP_SESSION_BUDGET_TINYBARS ?? "20000000"), // 0.2 HBAR
  maxPerCall: BigInt(process.env.MAX_PRICE_PER_CALL ?? "10000000"),
  approvalAbove: approvalAbove && approvalAbove > 0n ? approvalAbove : undefined,
  fetchCatalogue: defaultFetchCatalogue,
  makePay: (guard: BudgetGuard) => createPayingFetch({ accountId: need("AGENT_ACCOUNT_ID"), privateKeyHex: need("AGENT_PRIVATE_KEY"), guard }),
});

const server = new McpServer({ name: "pennyagent", version: "0.1.0" });

server.registerTool(
  "list_catalogue",
  { description: "List the paid data endpoints this wallet can buy from, with their prices in HBAR. Free to call." },
  async () => toolset.listCatalogue(),
);
server.registerTool(
  "buy_data",
  {
    description: "Pay for and fetch one paid data endpoint with a real Hedera payment (x402). Limited by a hard session budget and per-call cap. Returns the data and a HashScan transaction link.",
    inputSchema: { endpointId: z.string().describe("An id from list_catalogue") },
  },
  async ({ endpointId }) => toolset.buyData(endpointId),
);
server.registerTool(
  "budget_status",
  { description: "Show how much of the session budget has been spent and the list of purchases so far. Free to call." },
  async () => toolset.budgetStatus(),
);

await server.connect(new StdioServerTransport());
console.error("[pennyagent-mcp] ready on stdio");
