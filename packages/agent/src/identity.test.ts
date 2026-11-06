import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { agentAid, agentProfile, aidHash, base58Encode, buildUaid, canonicalAid } from "./identity.js";

const enc = (s: string) => new TextEncoder().encode(s);
const vec = { registry: "hol", name: "Support Agent", version: "1.0.0", protocol: "hcs-10", nativeId: "hedera:testnet:0.0.123456", skills: [17, 0] };

describe("base58Encode", () => {
  it("matches known vectors", () => {
    expect(base58Encode(enc("hello world"))).toBe("StV1DL6CwTryKyV");
    expect(base58Encode(enc("Hello World!"))).toBe("2NEpo7TZRRrLZSi2U");
    expect(base58Encode(new Uint8Array([]))).toBe("");
    expect(base58Encode(new Uint8Array([0, 0, 1]))).toBe("112");
  });
});

describe("canonicalAid (HCS-14 test vector 1 inputs)", () => {
  it("sorts keys and skills, compact JSON", () => {
    expect(canonicalAid(vec)).toBe('{"name":"Support Agent","nativeId":"hedera:testnet:0.0.123456","protocol":"hcs-10","registry":"hol","skills":[0,17],"version":"1.0.0"}');
  });
  it("trims strings and lowercases registry and protocol", () => {
    const c = JSON.parse(canonicalAid({ ...vec, registry: "  HOL ", protocol: " HCS-10", name: "  Support Agent  " }));
    expect(c).toMatchObject({ registry: "hol", protocol: "hcs-10", name: "Support Agent" });
  });
  it("allows empty skills, rejects reserved 40-99 and non-integers", () => {
    expect(() => canonicalAid({ ...vec, skills: [] })).not.toThrow();
    expect(() => canonicalAid({ ...vec, skills: [50] })).toThrow(/invalid/);
    expect(() => canonicalAid({ ...vec, skills: [1.5] })).toThrow();
    expect(() => canonicalAid({ ...vec, skills: [-1] })).toThrow();
    expect(() => canonicalAid({ ...vec, skills: [100, 39] })).not.toThrow();
  });
  it("rejects empty or missing required strings", () => {
    expect(() => canonicalAid({ ...vec, name: "  " })).toThrow();
    expect(() => canonicalAid({ ...vec, nativeId: "" })).toThrow();
  });
});

describe("buildUaid", () => {
  it("hash is Base58(SHA-384(canonical JSON)) and independent of uid", () => {
    const expected = base58Encode(createHash("sha384").update(canonicalAid(vec), "utf8").digest());
    expect(aidHash(vec)).toBe(expected);
    expect(buildUaid(vec, "0")).toBe(`uaid:aid:${expected};uid=0;registry=hol;proto=hcs-10;nativeId=hedera:testnet:0.0.123456`);
    expect(buildUaid(vec, "42").split(";")[0]).toBe(buildUaid(vec, "0").split(";")[0]);
  });
  it("is deterministic, and skill order does not matter", () => {
    expect(buildUaid(vec)).toBe(buildUaid({ ...vec, skills: [0, 17] }));
  });
  it("any field change changes the id", () => {
    expect(aidHash(vec)).not.toBe(aidHash({ ...vec, version: "1.0.1" }));
    expect(aidHash(vec)).not.toBe(aidHash({ ...vec, nativeId: "hedera:testnet:0.0.999" }));
  });
  it("SHA-384 Base58 is ~65 chars and contains no ';'", () => {
    const id = aidHash(vec);
    expect(id.length).toBeGreaterThan(60);
    expect(id).not.toContain(";");
  });
});

describe("agent identity helpers", () => {
  it("builds our agent's UAID and profile", () => {
    const uaid = buildUaid(agentAid("0.0.11340811"));
    expect(uaid).toMatch(/^uaid:aid:[1-9A-HJ-NP-Za-km-z]+;uid=0;registry=self;proto=x402;nativeId=hedera:testnet:0\.0\.11340811$/);
    expect(agentProfile("0.0.11340811", uaid)).toMatchObject({ type: 1, uaid, display_name: "PennyAgent" });
  });
});
