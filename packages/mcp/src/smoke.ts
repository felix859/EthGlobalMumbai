// Smoke test: starts the MCP server over stdio like a real client would, lists the tools, and (with --buy <id>)
// buys one endpoint. Run: npm run smoke -w @pennyagent/mcp -- --buy briefing
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const buyId = process.argv.includes("--buy") ? process.argv[process.argv.indexOf("--buy") + 1] : undefined;
const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "--env-file-if-exists=../../.env", "src/index.ts"],
  env: { ...process.env } as Record<string, string>,
  cwd: new URL("..", import.meta.url).pathname,
});
const client = new Client({ name: "smoke", version: "0.0.1" });
await client.connect(transport);
const show = (label: string, r: any) => console.log(`\n== ${label}\n${r.content?.[0]?.text ?? JSON.stringify(r)}`);

console.log("tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));
show("list_catalogue", await client.callTool({ name: "list_catalogue", arguments: {} }));
if (buyId) show(`buy_data ${buyId}`, await client.callTool({ name: "buy_data", arguments: { endpointId: buyId } }));
show("budget_status", await client.callTool({ name: "budget_status", arguments: {} }));
await client.close();
