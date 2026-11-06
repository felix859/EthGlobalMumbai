// Health checks for the demo: is the facilitator up, is the server up, does the agent have HBAR left?
import type { HealthCheck, HealthReport } from "@pennyagent/shared";

type Fetch = typeof fetch;
const LOW_BALANCE_TINYBARS = 50_000_000n; // 0.5 HBAR

async function timed(fn: () => Promise<Omit<HealthCheck, "ms">>): Promise<HealthCheck> {
  const t0 = Date.now();
  try {
    return { ...(await fn()), ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 };
  }
}

export interface HealthOptions {
  facilitatorUrl?: string;
  serverUrl?: string;
  agentAccountId?: string;
  mirrorUrl?: string;
  fetch?: Fetch;
}

export async function checkHealth(o: HealthOptions = {}): Promise<HealthReport> {
  const f = o.fetch ?? fetch;
  const facilitatorUrl = o.facilitatorUrl ?? process.env.FACILITATOR_URL ?? "https://api.testnet.blocky402.com";
  const serverUrl = o.serverUrl ?? process.env.SERVER_URL ?? "http://localhost:3000";
  const account = o.agentAccountId ?? process.env.AGENT_ACCOUNT_ID ?? "";
  const mirror = o.mirrorUrl ?? "https://testnet.mirrornode.hedera.com";
  const signal = () => AbortSignal.timeout(4000);

  const [facilitator, server, agentBalance] = await Promise.all([
    timed(async () => {
      const r = await f(`${facilitatorUrl}/supported`, { signal: signal() });
      if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
      const j = (await r.json()) as { kinds?: { network?: string; scheme?: string }[] };
      const ok = !!j.kinds?.some((k) => k.network === "hedera:testnet" && k.scheme === "exact");
      return { ok, detail: ok ? "supports hedera:testnet exact" : "does not list hedera:testnet exact" };
    }),
    timed(async () => {
      const r = await f(`${serverUrl}/catalogue`, { signal: signal() });
      return { ok: r.ok, detail: r.ok ? "catalogue reachable" : `HTTP ${r.status}` };
    }),
    timed(async () => {
      if (!account) return { ok: false, detail: "AGENT_ACCOUNT_ID not set" };
      const r = await f(`${mirror}/api/v1/accounts/${account}`, { signal: signal() });
      if (!r.ok) return { ok: false, detail: `mirror node HTTP ${r.status}` };
      const j = (await r.json()) as { balance?: { balance?: number } };
      const bal = BigInt(j.balance?.balance ?? 0);
      const low = bal < LOW_BALANCE_TINYBARS;
      return { ok: !low, detail: low ? "balance low, top up the agent account" : "balance ok", tinybars: bal.toString(), low };
    }),
  ]);

  return { ok: facilitator.ok && server.ok && agentBalance.ok, facilitator, server, agentBalance: agentBalance as HealthReport["agentBalance"], checkedAt: Date.now() };
}
