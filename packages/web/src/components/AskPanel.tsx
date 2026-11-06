import { useState, type FormEvent } from "react";
import { parseHbar, type AskRequest } from "@pennyagent/shared";

const EXAMPLES = [
  "Should I carry an umbrella in Mumbai today, and is HBAR up?",
  "How is the air in Mumbai right now? Is it OK to go for a run?",
  "Give me a quick briefing: weather, HBAR price and top tech headlines.",
];

export function AskPanel({ busy, onAsk }: { busy: boolean; onAsk: (req: AskRequest) => void }) {
  const [question, setQuestion] = useState("");
  const [budget, setBudget] = useState("0.5");
  const [cap, setCap] = useState("0.1");
  const [askAbove, setAskAbove] = useState(false);
  const [threshold, setThreshold] = useState("0.02");
  const [error, setError] = useState<string>();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    if (!question.trim()) return setError("Type a question first");
    try {
      const req: AskRequest = { question: question.trim(), budgetTinybars: parseHbar(budget), maxPerCallTinybars: parseHbar(cap) };
      if (askAbove) req.approvalAboveTinybars = parseHbar(threshold);
      if (req.budgetTinybars === "0") return setError("Budget must be more than 0");
      if (req.maxPerCallTinybars === "0") return setError("Max for one purchase must be more than 0");
      if (req.approvalAboveTinybars === "0") return setError("The approval threshold must be more than 0");
      onAsk(req);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <section className="panel" aria-labelledby="ask-title">
      <h2 id="ask-title">Ask</h2>
      <form onSubmit={submit} className="ask-form">
        <label className="field">
          <span>Question</span>
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={2000} rows={4} placeholder="What do you want to know?" />
        </label>
        <div className="examples" aria-label="Example questions">
          {EXAMPLES.map((q) => (
            <button key={q} type="button" className="example" onClick={() => setQuestion(q)}>
              {q}
            </button>
          ))}
        </div>
        <label className="field">
          <span>Budget for this run</span>
          <div className="with-unit">
            <input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
            <span className="unit">HBAR</span>
          </div>
        </label>
        <details className="policy">
          <summary>Spending policy</summary>
          <label className="field">
            <span>Max for one purchase</span>
            <div className="with-unit">
              <input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />
              <span className="unit">HBAR</span>
            </div>
          </label>
          <label className="check">
            <input type="checkbox" checked={askAbove} onChange={(e) => setAskAbove(e.target.checked)} />
            <span>Ask me before any purchase above</span>
          </label>
          <div className="with-unit">
            <input inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} disabled={!askAbove} aria-label="Approval threshold in HBAR" />
            <span className="unit">HBAR</span>
          </div>
          <p className="muted small">Off by default: the agent pays on its own, inside the limits above.</p>
        </details>
        {error && (
          <p className="bad-text" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Agent is working…" : "Run agent"}
        </button>
      </form>
    </section>
  );
}
