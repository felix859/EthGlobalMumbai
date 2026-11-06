// The dashboard talks to the agent only through this interface. `realApi` follows the HTTP/SSE contract in
// packages/shared (implemented by issue #4); `mockApi` (see mock.ts) replays a recorded run so the page works alone.
import type { AgentConfig, AskRequest, HealthReport, RunEvent } from "@pennyagent/shared";

export interface AgentApi {
  readonly mode: "live" | "mock";
  config(): Promise<AgentConfig>;
  health(): Promise<HealthReport>;
  ask(req: AskRequest): Promise<{ runId: string }>;
  /**
   * Streams a run's events (the API replays earlier events first). `onEnd` fires when the server says the run is
   * fully finished, which is AFTER the answer: receipt and audit events can still follow the answer.
   * Returns a function that stops listening.
   */
  subscribe(runId: string, onEvent: (e: RunEvent) => void, onError: (message: string) => void, onEnd?: () => void): () => void;
  approve(runId: string, approvalId: string, approve: boolean): Promise<boolean>;
  /** Replays the last recorded run (demo safety net). */
  replay(): Promise<{ runId: string }>;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === "string") msg = body.error;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

const isRunEvent = (v: unknown): v is RunEvent => !!v && typeof v === "object" && typeof (v as { type?: unknown }).type === "string";

export function realApi(base: string): AgentApi {
  const url = (p: string) => `${base.replace(/\/$/, "")}${p}`;
  const post = (p: string, body?: unknown) =>
    fetch(url(p), { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

  return {
    mode: "live",
    config: () => fetch(url("/api/config")).then((r) => json<AgentConfig>(r)),
    health: () => fetch(url("/api/health")).then((r) => json<HealthReport>(r)),
    ask: (req) => post("/api/ask", req).then((r) => json<{ runId: string }>(r)),
    approve: (runId, approvalId, approve) =>
      post(`/api/runs/${encodeURIComponent(runId)}/approve`, { approvalId, approve }).then((r) => json<{ ok: boolean }>(r)).then((r) => r.ok),
    replay: () => post("/api/replay").then((r) => json<{ runId: string }>(r)),
    subscribe(runId, onEvent, onError, onEnd) {
      const es = new EventSource(url(`/api/runs/${encodeURIComponent(runId)}/events`));
      let finished = false;
      // The server sends a named `end` event once the run (including receipt and audit writes) is done. Closing here
      // also stops EventSource from reconnecting, which would replay the whole run again.
      es.addEventListener("end", () => {
        finished = true;
        es.close();
        onEnd?.();
      });
      es.onmessage = (m) => {
        let v: unknown;
        try {
          v = JSON.parse(m.data);
        } catch {
          return; // ignore malformed frames
        }
        if (!isRunEvent(v)) return;
        onEvent(v);
      };
      es.onerror = () => {
        if (!finished) onError("Lost the connection to the agent");
        es.close();
      };
      return () => es.close();
    },
  };
}
