// The agent's HTTP API (web → agent), exactly as in the plan's "Contracts":
//   POST /api/ask                     AskRequest      → { runId }
//   GET  /api/runs/:runId/events      text/event-stream of RunEvent
//   POST /api/runs/:runId/approve     ApproveRequest  → { ok }
//   GET  /api/config                  AgentConfig
//   GET  /api/health                  HealthReport
//   POST /api/replay                  replays the latest recording as a new run → { runId }
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AgentConfig, AskRequest, HealthReport, RunEvent } from "@pennyagent/shared";
import type { SubmitAudit } from "./audit.js";
import { checkHealth } from "./health.js";
import { approvals as defaultGate, resolvePolicy, type ApprovalGate } from "./policy.js";
import { latestRecording, replayRun, type Recording } from "./replay.js";
import type { RunOptions } from "./run.js";
import { RunHub } from "./runs.js";
import { DEFAULT_MAX_RUN_BUDGET, parseTinybars, validateRunInput } from "./security.js";
import { startRun } from "./session.js";

export interface ApiDeps {
  config: AgentConfig;
  submitAudit: SubmitAudit | null;
  /** Origin allowed by CORS (the web app). */
  webOrigin?: string;
  /** Runs (live or replayed) allowed at once. Each live run can spend money, so keep this small. */
  maxActiveRuns?: number;
  hub?: RunHub;
  gate?: ApprovalGate;
  /** Test seams. */
  runAgent?: (o: RunOptions) => Promise<void>;
  health?: () => Promise<HealthReport>;
  latestRecording?: () => Promise<Recording | undefined>;
  record?: boolean;
  replaySpeed?: number;
}

const MAX_JSON_BYTES = 16 * 1024;
const HEARTBEAT_MS = 15_000;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(req.headers["content-type"] ?? "").includes("application/json")) throw new HttpError(415, "Content-Type must be application/json");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_JSON_BYTES) throw new HttpError(413, "Body too large");
    chunks.push(c as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new HttpError(400, "Body must be a JSON object");
  }
}

const optionalString = (v: unknown, name: string): string | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") throw new HttpError(400, `${name} must be a string`);
  return v;
};

/** Validates up front so bad input gets a 400 instead of a run that immediately emits `error`. */
function parseAsk(body: Record<string, unknown>): AskRequest {
  const ask: AskRequest = {
    question: body.question as string,
    budgetTinybars: body.budgetTinybars as string,
    maxPerCallTinybars: optionalString(body.maxPerCallTinybars, "maxPerCallTinybars"),
    approvalAboveTinybars: optionalString(body.approvalAboveTinybars, "approvalAboveTinybars"),
  };
  try {
    const maxRun = parseTinybars(process.env.MAX_RUN_BUDGET_TINYBARS, "MAX_RUN_BUDGET_TINYBARS", DEFAULT_MAX_RUN_BUDGET);
    validateRunInput(ask.question, ask.budgetTinybars, maxRun);
    resolvePolicy({ maxPerCallTinybars: ask.maxPerCallTinybars, approvalAboveTinybars: ask.approvalAboveTinybars });
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  return ask;
}

export function createApi(deps: ApiDeps): Server {
  const hub = deps.hub ?? new RunHub();
  const gate = deps.gate ?? defaultGate;
  const webOrigin = deps.webOrigin ?? "http://localhost:5173";
  const maxActive = deps.maxActiveRuns ?? 3;
  const health = deps.health ?? (() => checkHealth());
  const getRecording = deps.latestRecording ?? (() => latestRecording());

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const assertCapacity = () => {
    if (hub.active >= maxActive) throw new HttpError(429, `Too many runs in progress (max ${maxActive}); try again shortly`);
  };

  function streamEvents(req: IncomingMessage, res: ServerResponse, runId: string) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
    res.write(": connected\n\n");
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
    // `subscribe` may call onDone synchronously (run already finished), so `unsubscribe` can still be unset here.
    let unsubscribe: (() => void) | null = null;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe?.();
      res.end();
    };
    unsubscribe = hub.subscribe(
      runId,
      (e: RunEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`),
      () => {
        res.write("event: end\ndata: {}\n\n");
        close();
      },
    );
    req.on("close", close);
  }

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://agent");
    const path = url.pathname;
    const runMatch = path.match(/^\/api\/runs\/([\w-]{1,64})\/(events|approve)$/);

    if (req.method === "GET" && path === "/api/config") return send(res, 200, deps.config);
    if (req.method === "GET" && path === "/api/health") return send(res, 200, await health());

    if (req.method === "POST" && path === "/api/ask") {
      const ask = parseAsk(await readJson(req));
      assertCapacity();
      const { runId } = startRun(ask, { hub, submitAudit: deps.submitAudit, runAgent: deps.runAgent, record: deps.record });
      return send(res, 200, { runId });
    }

    if (req.method === "POST" && path === "/api/replay") {
      const rec = await getRecording();
      if (!rec) throw new HttpError(404, "No recording available to replay");
      assertCapacity();
      const runId = hub.create();
      // Same stream as a live run; the old run id is swapped for the new one so the client sees a consistent run.
      void replayRun(rec, (e) => hub.emit(runId, e.type === "started" ? { ...e, runId } : e), { speed: deps.replaySpeed })
        .catch((e) => hub.emit(runId, { type: "error", message: `Replay failed: ${(e as Error).message}` }))
        .finally(() => hub.finish(runId));
      return send(res, 200, { runId, replay: true });
    }

    if (runMatch && req.method === "GET" && runMatch[2] === "events") {
      if (!hub.has(runMatch[1])) throw new HttpError(404, "Unknown run");
      return streamEvents(req, res, runMatch[1]);
    }

    if (runMatch && req.method === "POST" && runMatch[2] === "approve") {
      const body = await readJson(req);
      if (typeof body.approvalId !== "string" || typeof body.approve !== "boolean") {
        throw new HttpError(400, "Body must be { approvalId: string, approve: boolean }");
      }
      // ok=false: unknown id, already decided, timed out, or not this run's approval.
      return send(res, 200, { ok: gate.resolve(body.approvalId, body.approve, runMatch[1]) });
    }

    throw new HttpError(404, "Not found");
  }

  return createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", webOrigin);
    res.setHeader("vary", "origin");
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "600" });
      return res.end();
    }
    try {
      await route(req, res);
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error("[agent] request failed:", e);
      send(res, 500, { error: "Internal error" });
    }
  });
}
