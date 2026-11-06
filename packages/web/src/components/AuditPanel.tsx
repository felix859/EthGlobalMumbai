import { useEffect, useState } from "react";
import { formatHbar } from "@pennyagent/shared";
import { fetchAuditRows, type AuditRow } from "../mirror.js";
import { topicUrl, txUrl } from "../links.js";
import { ExternalLink } from "./ExternalLink.js";

export function AuditPanel({ topicId, agentAccount, refreshKey }: { topicId?: string; agentAccount?: string; refreshKey: number }) {
  const [rows, setRows] = useState<AuditRow[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!topicId) return;
    let alive = true;
    const load = () =>
      fetchAuditRows(topicId, agentAccount)
        .then((r) => alive && (setRows(r), setError(undefined)))
        .catch((e: Error) => alive && setError(e.message));
    void load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [topicId, agentAccount, refreshKey]);

  return (
    <section className="panel" aria-labelledby="audit-title">
      <h2 id="audit-title">Audit log</h2>
      <p className="muted small">
        Read straight from the public Hedera mirror node{topicId ? ", topic " : ""}
        {topicId && <ExternalLink href={topicUrl(topicId)}>{topicId}</ExternalLink>}. It does not depend on our agent. Only messages submitted by the agent's own account count.
      </p>
      {error && <p className="bad-text small">{error}</p>}
      {!topicId && <p className="muted">Waiting for the agent's configuration…</p>}
      {rows && rows.length === 0 && <p className="muted">No audit messages on this topic yet.</p>}
      <ul className="audit-list">
        {rows?.map((r) => (
          <li key={r.sequenceNumber} className="audit-row">
            <span className="seq">#{r.sequenceNumber}</span>
            {r.message ? (
              <>
                <span>
                  <code>{r.message.endpointId}</code> · {formatHbar(r.message.amount)} HBAR
                </span>
                <ExternalLink className="tx small" href={txUrl(r.message.txId)}>
                  tx ↗
                </ExternalLink>
              </>
            ) : (
              <span className="muted small">not from the agent{r.payer ? ` (${r.payer})` : ""}: ignored</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
