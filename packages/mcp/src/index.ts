#!/usr/bin/env -S npx tsx
// PennyAgent MCP server (stdio). Gives any MCP client (Claude Desktop, Claude Code) a Hedera wallet that can only
// spend inside PennyAgent's guardrails. Add it to a client with the config shown in docs/mcp.md.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BudgetGuard } from "@pennyagent/agent/budget";
import { createPayingFetch } from "@pennyagent/agent/pay";
import { fetchCatalogues } from "@pennyagent/agent/catalogue";
import { buyerTrustedPayees, DEFAULT_MAX_RUN_BUDGET, parseList, parseTinybars } from "@pennyagent/agent/security";
import { Toolset } from "./toolset.js";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var ${k}`);
  return v;
};
const serverUrl = process.env.SERVER_URL ?? "http://localhost:3000";
const asset = process.env.PAYMENT_ASSET || "0.0.0";
const approvalAbove = parseTinybars(process.env.APPROVAL_ABOVE_TINYBARS, "APPROVAL_ABOVE_TINYBARS", 0n, true);
// The session budget can never exceed the per-run ceiling the agent uses (default 2 HBAR).
const ceiling = parseTinybars(process.env.MAX_RUN_BUDGET_TINYBARS, "MAX_RUN_BUDGET_TINYBARS", DEFAULT_MAX_RUN_BUDGET);
const requested = parseTinybars(process.env.MCP_SESSION_BUDGET_TINYBARS, "MCP_SESSION_BUDGET_TINYBARS", 20_000_000n); // 0.2 HBAR
if (requested > ceiling) throw new Error(`MCP_SESSION_BUDGET_TINYBARS (${requested}) exceeds MAX_RUN_BUDGET_TINYBARS (${ceiling})`);

const toolset = new Toolset({
  serverUrl,
  trustedPayees: buyerTrustedPayees(),
  trustedOrigins: parseList(process.env.TRUSTED_ORIGINS),
  sessionBudget: requested,
  maxPerCall: parseTinybars(process.env.MAX_PRICE_PER_CALL, "MAX_PRICE_PER_CALL", 10_000_000n),
  approvalAbove: approvalAbove > 0n ? approvalAbove : undefined,
  asset,
  fetchCatalogue: () => fetchCatalogues(serverUrl),
  makePay: (guard: BudgetGuard, allowedOrigins: string[]) =>
    createPayingFetch({ accountId: need("AGENT_ACCOUNT_ID"), privateKeyHex: need("AGENT_PRIVATE_KEY"), guard, allowedOrigins, asset }),
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
