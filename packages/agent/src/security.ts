// Input and output hardening helpers for the agent. Pure functions, easy to test.

export const MAX_QUESTION_CHARS = 2000;
/** Hard ceiling for one run, whatever the caller asks for. 2 HBAR by default. */
export const DEFAULT_MAX_RUN_BUDGET = 200_000_000n;
/** Process-wide ceiling across all runs since the agent started. 10 HBAR by default. */
export const DEFAULT_MAX_TOTAL_SPEND = 1_000_000_000n;
/** Data returned by an endpoint is capped before it reaches the model (token cost and context stuffing). */
export const MAX_DATA_CHARS = 8_000;

/** Parses "a, b" or ["a","b"] into a clean list. */
export const parseList = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : (v ?? "").split(",")).map((x) => x.trim()).filter(Boolean);

/**
 * Refuses a catalogue that names any payee the buyer has not itself configured. The allowlist always comes from the
 * buyer's own config, never from the catalogue, so a spoofed or compromised seller cannot name its own account.
 */
export function assertCatalogueTrusted(cat: { payTo: string; endpoints: { id: string; payTo?: string }[] }, trusted: string[]): void {
  if (trusted.length === 0) throw new Error("MERCHANT_ACCOUNT_ID must be configured: the agent will not trust the server to name its own payee");
  if (!trusted.includes(cat.payTo)) throw new Error(`Catalogue payee ${cat.payTo} does not match the configured merchant ${trusted.join(",")}; refusing to run`);
  for (const e of cat.endpoints) {
    if (e.payTo !== undefined && !trusted.includes(e.payTo)) throw new Error(`Endpoint ${e.id} names payee ${e.payTo}, which is not a configured merchant; refusing to run`);
  }
}

export function validateRunInput(
  question: unknown,
  budget: unknown,
  maxRunBudget: bigint = DEFAULT_MAX_RUN_BUDGET,
): { question: string; budget: bigint } {
  if (typeof question !== "string" || question.trim() === "") throw new Error("Question must be a non-empty string");
  if (question.length > MAX_QUESTION_CHARS) throw new Error(`Question is too long (max ${MAX_QUESTION_CHARS} characters)`);
  if (typeof budget !== "string" || !/^[1-9][0-9]{0,17}$/.test(budget)) {
    throw new Error("Budget must be a positive integer string in tinybars");
  }
  const b = BigInt(budget);
  if (b > maxRunBudget) throw new Error(`Budget ${b} exceeds the maximum allowed per run (${maxRunBudget} tinybars)`);
  return { question: question.trim(), budget: b };
}

/**
 * Builds the URL to pay, and refuses anything that leaves the configured server:
 * absolute URLs, protocol-relative "//host", and "@host" tricks all change the origin.
 */
export function safeEndpointUrl(serverUrl: string, path: string, allowedOrigins?: string[]): string {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error(`Refusing endpoint path "${path}"`);
  }
  const base = new URL(serverUrl);
  // With an allowlist, the seller's origin must be on it; without one, only the configured server itself.
  const allowed = new Set((allowedOrigins ?? [serverUrl]).map((o) => new URL(o).origin));
  if (!allowed.has(base.origin)) throw new Error(`Origin ${base.origin} is not a trusted seller`);
  const url = new URL(path, base);
  if (url.origin !== base.origin) throw new Error(`Endpoint "${path}" is not on the configured server`);
  return url.toString();
}

/** Caps text sent to the model. Appends a marker so the model knows data was cut. */
export function truncateForModel(text: string, max = MAX_DATA_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated ${text.length - max} characters]`;
}

/** Network timeout for every outbound request the agent makes. */
export const DEFAULT_TIMEOUT_MS = 15_000;
/** Bytes read from a paid response before we stop (the text is then cut to MAX_DATA_CHARS for the model). */
export const MAX_BODY_BYTES = MAX_DATA_CHARS * 4;
/** Bytes read from a catalogue. */
export const MAX_CATALOGUE_BYTES = 64 * 1024;

/**
 * Parses a tinybar amount from config with a clear error, instead of an opaque BigInt SyntaxError.
 * Empty/undefined → the default. `allowZero` is for "0 = off" settings.
 */
export function parseTinybars(value: string | undefined, name: string, fallback: bigint, allowZero = false): bigint {
  if (value === undefined || value.trim() === "") return fallback;
  const v = value.trim();
  if (!/^(0|[1-9][0-9]{0,17})$/.test(v)) throw new Error(`${name} must be a whole number of tinybars, got "${value}"`);
  const n = BigInt(v);
  if (n === 0n && !allowZero) throw new Error(`${name} must be greater than 0`);
  return n;
}

/** Refuses any URL that is not http(s) on one of the allowed origins. Used inside the paying fetch itself. */
export function assertAllowedUrl(url: string, allowedOrigins: string[]): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`Refusing malformed URL "${url}"`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`Refusing non-HTTP URL "${url}"`);
  const allowed = new Set(allowedOrigins.map((o) => new URL(o).origin));
  if (!allowed.has(u.origin)) throw new Error(`Refusing to pay ${u.origin}: not a trusted seller`);
  return u;
}

/** Reads at most `maxBytes` of a response body, then cancels the stream. Never buffers more than that. */
export async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: "", truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const take = Math.min(value.length, maxBytes - total);
    chunks.push(value.subarray(0, take));
    total += take;
    if (total >= maxBytes) {
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  return { text: new TextDecoder().decode(buf), truncated };
}

/** Endpoint ids become tool enum values; keep them boring. */
export const ENDPOINT_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

// Control characters, C1 controls and the Unicode line/paragraph separators (U+2028, U+2029).
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]", "g");

/** Seller-provided text shown to the model: no control characters, single line, length-capped. */
export function sanitizeSellerText(s: unknown, max = 200): string {
  if (typeof s !== "string") return "";
  const clean = s.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}
