import { useState } from "react";
import type { AgentConfig, HealthReport } from "@pennyagent/shared";
import { accountUrl, shortUaid, topicUrl } from "../links.js";
import { ExternalLink } from "./ExternalLink.js";

function HealthDot({ health, error }: { health?: HealthReport; error?: string }) {
  const [open, setOpen] = useState(false);
  const state = error ? "bad" : !health ? "unknown" : health.ok ? "ok" : "bad";
  const label = state === "ok" ? "All systems OK" : state === "unknown" ? "Checking…" : "Something needs attention";
  const rows = health ? ([["Facilitator", health.facilitator], ["Data server", health.server], ["Agent balance", health.agentBalance]] as const) : [];
  return (
    <div className="health">
      <button type="button" className={`health-btn ${state}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="dot" aria-hidden />
        {label}
      </button>
      {open && (
        <div className="health-pop" role="dialog" aria-label="System health">
          {error && <p className="bad-text">{error}</p>}
          {rows.map(([name, c]) => (
            <div key={name} className="health-row">
              <span className={`dot ${c.ok ? "ok" : "bad"}`} aria-hidden />
              <span className="health-name">{name}</span>
              <span className="muted">{c.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Header({ config, health, healthError, mode }: { config?: AgentConfig; health?: HealthReport; healthError?: string; mode: "live" | "mock" }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!config?.uaid) return;
    try {
      await navigator.clipboard.writeText(config.uaid);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <header className="header">
      <div className="brand">
        <span className="logo" aria-hidden>
          P
        </span>
        <div>
          <h1>PennyAgent</h1>
          <p className="muted">An AI agent with its own Hedera wallet and a hard budget</p>
        </div>
        {mode === "mock" && <span className="badge warn">Mock mode</span>}
      </div>
      <div className="chips">
        {config && (
          <>
            <span className="chip">
              <span className="chip-label">Agent</span>
              <ExternalLink href={accountUrl(config.agentAccount)}>{config.agentAccount}</ExternalLink>
            </span>
            <span className="chip">
              <span className="chip-label">Pays</span>
              <ExternalLink href={accountUrl(config.merchantAccount)}>{config.merchantAccount}</ExternalLink>
            </span>
            {config.uaid && (
              <span className="chip" title={config.uaid}>
                <span className="chip-label">ID</span>
                <ExternalLink href={config.identityTopicId ? topicUrl(config.identityTopicId) : undefined}>{shortUaid(config.uaid)}</ExternalLink>
                <button type="button" className="icon-btn" onClick={copy} aria-label="Copy agent ID">
                  {copied ? "✓" : "⧉"}
                </button>
              </span>
            )}
            <span className="chip">{config.network}</span>
          </>
        )}
        <HealthDot health={health} error={healthError} />
      </div>
    </header>
  );
}
