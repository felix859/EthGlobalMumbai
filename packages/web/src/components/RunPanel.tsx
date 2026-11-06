import { useEffect, useState } from "react";
import { formatHbar } from "@pennyagent/shared";
import { safeHashscan, spentFraction, type RunState, type TimelineItem } from "../state.js";
import { ExternalLink } from "./ExternalLink.js";

function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.ceil((until - now) / 1000));
  return <span className="countdown">{s}s</span>;
}

function Item({ item, pending, onDecide }: { item: TimelineItem; pending: boolean; onDecide: (approvalId: string, approve: boolean) => void }) {
  switch (item.kind) {
    case "thinking":
      return (
        <li className="tl thinking">
          <span className="tl-icon" aria-hidden>
            …
          </span>
          <p>{item.text}</p>
        </li>
      );
    case "payment":
      return (
        <li className="tl payment">
          <span className="tl-icon" aria-hidden>
            ↗
          </span>
          <div className="tl-body">
            <p>
              Paid <strong>{formatHbar(item.amountTinybars)} HBAR</strong> for <code>{item.endpointId}</code>
              {item.fromAgent && <span className="badge agent">from Analyst agent</span>}
            </p>
            <ExternalLink className="tx" href={safeHashscan(item.hashscanUrl)}>
              {item.txId} ↗
            </ExternalLink>
          </div>
        </li>
      );
    case "denied":
      return (
        <li className="tl denied">
          <span className="tl-icon" aria-hidden>
            ✕
          </span>
          <div className="tl-body">
            <p>
              Refused <code>{item.endpointId}</code>
            </p>
            <p className="muted small">{item.reason}</p>
          </div>
        </li>
      );
    case "approval":
      return (
        <li className={`tl approval ${item.outcome ?? "pending"}`}>
          <span className="tl-icon" aria-hidden>
            ?
          </span>
          <div className="tl-body">
            <p>
              Approval needed: <code>{item.endpointId}</code> costs <strong>{formatHbar(item.amountTinybars)} HBAR</strong>
            </p>
            {pending && !item.outcome ? (
              <div className="approval-actions">
                <button type="button" className="primary" onClick={() => onDecide(item.approvalId, true)}>
                  Approve
                </button>
                <button type="button" className="ghost" onClick={() => onDecide(item.approvalId, false)}>
                  Reject
                </button>
                <Countdown until={item.expiresAt} />
              </div>
            ) : (
              <p className="muted small">{item.outcome === "approved" ? "Approved" : item.outcome === "rejected" ? "Rejected" : item.outcome === "timeout" ? "No answer in time: not bought" : "Waiting…"}</p>
            )}
          </div>
        </li>
      );
    case "audit":
      return (
        <li className="tl audit">
          <span className="tl-icon" aria-hidden>
            ≡
          </span>
          <p className="muted small">
            Logged to audit topic {item.topicId} (#{item.sequenceNumber})
          </p>
        </li>
      );
    case "warning":
      return (
        <li className="tl warning">
          <span className="tl-icon" aria-hidden>
            !
          </span>
          <p className="small">{item.text}</p>
        </li>
      );
  }
}

export function RunPanel({ run, onDecide }: { run: RunState; onDecide: (approvalId: string, approve: boolean) => void }) {
  if (run.status === "idle") {
    return (
      <section className="panel run empty" aria-labelledby="run-title">
        <h2 id="run-title">Live run</h2>
        <p className="muted">Ask a question and watch the agent decide what data is worth paying for. Every payment is a real Hedera transaction.</p>
      </section>
    );
  }
  const frac = spentFraction(run);
  return (
    <section className="panel run" aria-labelledby="run-title" aria-live="polite">
      <h2 id="run-title">Live run</h2>
      <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={frac} aria-label="Budget spent">
        <div className="meter-head">
          <span>
            Spent <strong>{formatHbar(run.spentTinybars)}</strong> of {run.budgetTinybars ? formatHbar(run.budgetTinybars) : "?"} HBAR
          </span>
          <span className="muted">{run.status === "running" ? "running" : run.status}</span>
        </div>
        <div className="meter-track">
          <div className="meter-fill" style={{ width: `${(frac * 100).toFixed(1)}%` }} />
        </div>
      </div>
      <ol className="timeline">
        {run.items.map((i) => (
          <Item key={i.id} item={i} pending={i.kind === "approval" && run.pendingApprovalId === i.approvalId} onDecide={onDecide} />
        ))}
        {run.status === "running" && !run.pendingApprovalId && <li className="tl working">Agent is working…</li>}
      </ol>
      {run.answer !== undefined && (
        <div className="answer">
          <h3>Answer</h3>
          <p className="answer-text">{run.answer}</p>
        </div>
      )}
      {run.receipt && (
        <div className="receipt">
          <span aria-hidden>◈</span>
          <span>
            Receipt NFT minted: {run.receipt.tokenId} #{run.receipt.serial}
          </span>
          <ExternalLink href={safeHashscan(run.receipt.hashscanUrl)}>View ↗</ExternalLink>
        </div>
      )}
      {run.status === "error" && (
        <p className="bad-text" role="alert">
          {run.error}
        </p>
      )}
    </section>
  );
}
