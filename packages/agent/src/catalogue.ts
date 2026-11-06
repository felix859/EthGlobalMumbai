// Fetching and validating seller catalogues. Kept separate from run.ts so other packages (MCP, analyst) can use it
// without pulling in the Anthropic SDK. A catalogue is UNTRUSTED input: it is size-capped, time-limited, validated,
// and its free text is sanitised before any model sees it. Trust (who may be paid) is decided elsewhere, from the
// buyer's own config (see assertCatalogueTrusted).
import type { Catalogue, CatalogueEntry } from "@pennyagent/shared";
import { AMOUNT_RE } from "./budget.js";
import { DEFAULT_TIMEOUT_MS, ENDPOINT_ID_RE, MAX_CATALOGUE_BYTES, parseList, readCapped, sanitizeSellerText } from "./security.js";

const HEDERA_ID_RE = /^0\.0\.[0-9]{1,12}$/;

/**
 * Validates the shape of a raw catalogue. Entries that are malformed (bad id, price, path, payee) are dropped rather
 * than trusted; a catalogue without a valid payee is rejected outright.
 */
export function normalizeCatalogue(raw: unknown): Catalogue {
  const c = raw as Partial<Catalogue> | null;
  if (!c || typeof c !== "object") throw new Error("Catalogue is not an object");
  if (typeof c.payTo !== "string" || !HEDERA_ID_RE.test(c.payTo)) throw new Error("Catalogue has no valid payTo account");
  const seen = new Set<string>();
  const endpoints: CatalogueEntry[] = [];
  for (const e of Array.isArray(c.endpoints) ? c.endpoints : []) {
    if (!e || typeof e !== "object") continue;
    if (typeof e.id !== "string" || !ENDPOINT_ID_RE.test(e.id) || seen.has(e.id)) continue;
    if (typeof e.priceTinybars !== "string" || !AMOUNT_RE.test(e.priceTinybars)) continue;
    if (typeof e.path !== "string" || !e.path.startsWith("/") || e.path.startsWith("//") || e.path.length > 200) continue;
    if (typeof e.asset !== "string" || !/^0\.0\.[0-9]{1,12}$/.test(e.asset)) continue;
    if (e.payTo !== undefined && (typeof e.payTo !== "string" || !HEDERA_ID_RE.test(e.payTo))) continue;
    seen.add(e.id);
    endpoints.push({
      id: e.id as CatalogueEntry["id"],
      path: e.path,
      description: sanitizeSellerText(e.description),
      priceTinybars: e.priceTinybars,
      asset: e.asset,
      ...(e.payTo !== undefined ? { payTo: e.payTo } : {}),
      ...(typeof e.baseUrl === "string" ? { baseUrl: e.baseUrl } : {}),
    });
  }
  return { network: "hedera:testnet", payTo: c.payTo, endpoints };
}

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const r = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) {
    await r.body?.cancel().catch(() => {});
    throw new Error(`Catalogue request to ${new URL(url).origin} failed: HTTP ${r.status}`);
  }
  const { text, truncated } = await readCapped(r, MAX_CATALOGUE_BYTES);
  if (truncated) throw new Error(`Catalogue from ${new URL(url).origin} is larger than ${MAX_CATALOGUE_BYTES} bytes`);
  return JSON.parse(text);
}

/**
 * The main server's catalogue, plus any EXTRA_CATALOGUE_URLS (other sellers such as the Analyst agent). Extra
 * entries are stamped with that seller's payee and origin; an unreachable or malformed extra seller is skipped.
 */
export async function fetchCatalogues(
  serverUrl: string,
  extraUrls: string[] = parseList(process.env.EXTRA_CATALOGUE_URLS),
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Catalogue> {
  const cat = normalizeCatalogue(await getJson(`${serverUrl}/catalogue`, timeoutMs));
  const ids = new Set(cat.endpoints.map((e) => e.id));
  for (const url of extraUrls) {
    try {
      const extra = normalizeCatalogue(await getJson(url, timeoutMs));
      const origin = new URL(url).origin;
      for (const e of extra.endpoints) {
        if (ids.has(e.id)) continue; // never let a second seller shadow an existing id
        ids.add(e.id);
        cat.endpoints.push({ ...e, payTo: extra.payTo, baseUrl: origin });
      }
    } catch {
      /* skip an unavailable or malformed seller */
    }
  }
  return cat;
}
