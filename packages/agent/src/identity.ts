// Agent identity: a UAID following the HCS-14 draft "AID" method.
// Spec (draft): https://hol.org/docs/standards/hcs-14/
//   id = Base58( SHA-384( canonical JSON of { name, nativeId, protocol, registry, skills, version } ) )
//   UAID = uaid:aid:{id};uid={uid};registry={registry};proto={protocol};nativeId={nativeId}
import { createHash } from "node:crypto";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  return "1".repeat(zeros) + out;
}

export interface AidInput {
  registry: string; // "self" for self-sovereign agents
  name: string;
  version: string; // semver
  protocol: string;
  nativeId: string; // e.g. "hedera:testnet:0.0.11340811"
  skills: number[]; // 0-39 or 100+ (40-99 are rejected by the spec)
}

/** Canonical JSON exactly as the spec describes: trimmed, lowercased registry/protocol, sorted skills, sorted keys. */
export function canonicalAid(i: AidInput): string {
  const str = (v: unknown, name: string) => {
    if (typeof v !== "string" || v.trim() === "") throw new Error(`AID field "${name}" must be a non-empty string`);
    return v.trim();
  };
  const skills = [...(i.skills ?? [])];
  for (const s of skills) {
    if (!Number.isInteger(s) || s < 0 || (s >= 40 && s <= 99)) throw new Error(`AID skill ${s} is invalid (allowed: 0-39 or 100+)`);
  }
  skills.sort((a, b) => a - b);
  const obj = {
    name: str(i.name, "name"),
    nativeId: str(i.nativeId, "nativeId"),
    protocol: str(i.protocol, "protocol").toLowerCase(),
    registry: str(i.registry, "registry").toLowerCase(),
    skills,
    version: str(i.version, "version"),
  };
  return JSON.stringify(obj); // keys are already in alphabetical order
}

export function aidHash(i: AidInput): string {
  return base58Encode(createHash("sha384").update(canonicalAid(i), "utf8").digest());
}

/** `uid` is "0" when not applicable (spec). It is not part of the hash. */
export function buildUaid(i: AidInput, uid = "0"): string {
  const registry = i.registry.trim().toLowerCase();
  const proto = i.protocol.trim().toLowerCase();
  return `uaid:aid:${aidHash(i)};uid=${uid};registry=${registry};proto=${proto};nativeId=${i.nativeId.trim()}`;
}

/** Our agent's identity input. Protocol "x402" is what the agent speaks; it is not verified against HCS-14's supported-protocol list. */
export function agentAid(accountId: string, network: "testnet" | "mainnet" = "testnet"): AidInput {
  return {
    registry: "self",
    name: "PennyAgent",
    version: "1.0.0",
    protocol: "x402",
    nativeId: `hedera:${network}:${accountId}`,
    skills: [0], // 0 = text/general reasoning, per the draft's skill list as we understand it
  };
}

/**
 * Minimal agent profile, HCS-11-shaped (version, type 1 = ai_agent, display_name) plus our fields.
 * NOTE: published as a single HCS message, not as an HCS-1 inscription, so it is not a compliant HCS-11 profile.
 */
export function agentProfile(accountId: string, uaid: string, endpoint?: string) {
  return {
    version: "1.0",
    type: 1,
    display_name: "PennyAgent",
    bio: "AI research agent that buys data over x402 on Hedera within a hard budget.",
    uaid,
    account: accountId,
    network: "hedera:testnet",
    capabilities: ["x402-payments", "budget-guard", "human-approval", "hcs-audit-log", "hts-receipts"],
    ...(endpoint ? { endpoint } : {}),
  };
}
