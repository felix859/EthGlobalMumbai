// Workstream B replaces this stub (Claude loop, x402 client, BudgetGuard, HCS logger).
import { createServer } from "node:http";
import { PORTS } from "@pennyagent/shared";

const port = Number(process.env.AGENT_PORT ?? PORTS.agent);

createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.setHeader("access-control-allow-origin", "http://localhost:5173");
  res.end(JSON.stringify({ service: "pennyagent-agent", ok: true, path: req.url }));
}).listen(port, () => console.log(`[agent] stub listening on http://localhost:${port}`));
