// Workstream A replaces this stub (x402-gated data API).
import { createServer } from "node:http";
import { PORTS } from "@pennyagent/shared";

const port = Number(process.env.SERVER_PORT ?? PORTS.server);

createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ service: "pennyagent-server", ok: true, path: req.url }));
}).listen(port, () => console.log(`[server] stub listening on http://localhost:${port}`));
