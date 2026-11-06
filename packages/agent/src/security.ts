// Input and output hardening helpers for the agent. Pure functions, easy to test.

export const MAX_QUESTION_CHARS = 2000;
/** Hard ceiling for one run, whatever the caller asks for. 2 HBAR by default. */
export const DEFAULT_MAX_RUN_BUDGET = 200_000_000n;
/** Process-wide ceiling across all runs since the agent started. 10 HBAR by default. */
export const DEFAULT_MAX_TOTAL_SPEND = 1_000_000_000n;
/** Data returned by an endpoint is capped before it reaches the model (token cost and context stuffing). */
export const MAX_DATA_CHARS = 8_000;

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
