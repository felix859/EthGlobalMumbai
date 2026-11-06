import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { AgentConfig, AskRequest, HealthReport } from "@pennyagent/shared";
import { realApi, type AgentApi } from "./api.js";
import { mockApi } from "./mock.js";
import { initialRunState, reduceRun } from "./state.js";
import { Header } from "./components/Header.js";
import { AskPanel } from "./components/AskPanel.js";
import { RunPanel } from "./components/RunPanel.js";
import { AuditPanel } from "./components/AuditPanel.js";

function pickApi(): AgentApi {
  const params = new URLSearchParams(location.search);
  if (params.has("mock")) return mockApi(Number(params.get("speed")) || 1);
  return realApi(import.meta.env.VITE_AGENT_URL ?? "http://localhost:4000");
}

export function App() {
  const [api] = useState(pickApi);
  const [config, setConfig] = useState<AgentConfig>();
  const [configError, setConfigError] = useState<string>();
  const [health, setHealth] = useState<HealthReport>();
  const [healthError, setHealthError] = useState<string>();
  const [run, dispatch] = useReducer(reduceRun, initialRunState);
  const [streamError, setStreamError] = useState<string>();
  const [auditKey, setAuditKey] = useState(0);
  const stop = useRef<() => void>();

  useEffect(() => {
    api.config().then(setConfig, (e: Error) => setConfigError(e.message));
    const check = () => api.health().then((h) => (setHealth(h), setHealthError(undefined)), (e: Error) => setHealthError(`Agent not reachable: ${e.message}`));
    void check();
    const t = setInterval(check, 15000);
    return () => {
      clearInterval(t);
      stop.current?.();
    };
  }, [api]);

  const follow = useCallback(
    (runId: string) => {
      stop.current?.();
      setStreamError(undefined);
      stop.current = api.subscribe(
        runId,
        (e) => {
          dispatch(e);
          if (e.type === "audit" || e.type === "answer") setAuditKey((k) => k + 1);
        },
        setStreamError,
      );
    },
    [api],
  );

  const ask = async (req: AskRequest) => {
    setStreamError(undefined);
    try {
      follow((await api.ask(req)).runId);
    } catch (e) {
      setStreamError((e as Error).message);
    }
  };
  const replay = async () => {
    try {
      follow((await api.replay()).runId);
    } catch (e) {
      setStreamError((e as Error).message);
    }
  };
  const decide = async (approvalId: string, approve: boolean) => {
    if (!run.runId) return;
    try {
      const ok = await api.approve(run.runId, approvalId, approve);
      if (!ok) setStreamError("That approval is no longer pending");
    } catch (e) {
      setStreamError((e as Error).message);
    }
  };

  return (
    <div className="app">
      <Header config={config} health={health} healthError={healthError} mode={api.mode} />
      {configError && (
        <div className="banner" role="alert">
          Could not reach the agent ({configError}). Start it with <code>npm run dev:agent</code>, or open <a href="?mock=1">mock mode</a> to see the dashboard without a backend.
        </div>
      )}
      <main className="grid">
        <AskPanel busy={run.status === "running"} onAsk={ask} />
        <div className="run-col">
          <RunPanel run={run} onDecide={decide} />
          {streamError && (
            <p className="bad-text" role="alert">
              {streamError}
            </p>
          )}
        </div>
        <AuditPanel topicId={config?.topicId} refreshKey={auditKey} />
      </main>
      <footer className="footer muted small">
        <span>Testnet only. Spending limits are enforced in code before anything is signed.</span>
        <button type="button" className="link-btn" onClick={replay} disabled={run.status === "running"}>
          Replay last run
        </button>
      </footer>
    </div>
  );
}
