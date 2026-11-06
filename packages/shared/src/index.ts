// Contracts shared by server, agent and web. Changing anything here affects
// everyone: tell the team first. See docs/superpowers/plans/ ("Contracts").

// ---- Catalogue (server → agent, free endpoint) ----
export type EndpointId = "weather" | "air-quality" | "hbar-price" | "headlines";

export interface CatalogueEntry {
  id: EndpointId;
  path: string; // e.g. "/api/weather"
  description: string; // shown to the model
  priceTinybars: string; // string to avoid bigint JSON issues
  asset: string; // "0.0.0" for HBAR, else HTS token id
}

export interface Catalogue {
  network: "hedera:testnet";
  payTo: string; // merchant account id, e.g. "0.0.12345"
  endpoints: CatalogueEntry[];
}

// ---- Agent HTTP API (web → agent) ----
// POST /api/ask → 200 { runId: string }
export interface AskRequest {
  question: string;
  budgetTinybars: string;
}

// GET /api/runs/:runId/events → text/event-stream, each `data:` is a RunEvent JSON
export type RunEvent =
  | { type: "started"; runId: string; budgetTinybars: string }
  | { type: "thinking"; text: string }
  | {
      type: "payment";
      endpointId: string;
      amountTinybars: string;
      asset: string;
      txId: string;
      hashscanUrl: string;
      spentTinybars: string;
      remainingTinybars: string;
    }
  | { type: "denied"; endpointId: string; reason: string }
  | { type: "audit"; topicId: string; sequenceNumber: string }
  | { type: "audit_failed"; reason: string }
  | { type: "answer"; text: string }
  | { type: "error"; message: string };

// GET /api/config
export interface AgentConfig {
  topicId: string;
  merchantAccount: string;
  agentAccount: string;
  network: string;
}

// ---- Health (agent → web, for the demo safety net) ----
export interface HealthCheck { ok: boolean; detail: string; ms?: number }
export interface HealthReport {
  ok: boolean; // all checks passed
  facilitator: HealthCheck;
  server: HealthCheck;
  agentBalance: HealthCheck & { tinybars?: string; low?: boolean };
  checkedAt: number;
}

// ---- HCS audit message (agent → topic) ----
export interface AuditMessage {
  v: 1;
  runId: string;
  endpointId: string;
  amount: string;
  asset: string;
  txId: string;
  ts: number;
}

// ---- Defaults ----
export const PORTS = { server: 3000, agent: 4000, web: 5173 } as const;
export const MUMBAI = { lat: 19.076, lon: 72.8777 } as const;

export const hashscanTxUrl = (txId: string, network: "testnet" | "mainnet" = "testnet") =>
  `https://hashscan.io/${network}/transaction/${encodeURIComponent(txId)}`;
