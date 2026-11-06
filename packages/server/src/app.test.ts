// A5: start the real server (real x402 middleware) against a fake facilitator and fake upstreams, so it runs offline.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { FacilitatorClient } from "@x402/core/server";
import type { Catalogue } from "@pennyagent/shared";
import { createApp, createCaches } from "./app.js";
import { DATA_ENDPOINT_IDS, loadConfig } from "./config.js";
import type { Sources } from "./sources.js";

const FEE_PAYER = "0.0.7162784";
const config = loadConfig({ MERCHANT_ACCOUNT_ID: "0.0.11341093" });

const calls = { verify: 0, settle: 0 };
// Same /supported shape Blocky402 returns for Hedera testnet.
const facilitator: FacilitatorClient = {
  getSupported: async () => ({
    kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: FEE_PAYER } }],
    extensions: [],
    signers: { "hedera:*": [FEE_PAYER] },
  }),
  verify: async () => (calls.verify++, { isValid: true, payer: "0.0.11340811" }),
  settle: async () => (calls.settle++, { success: true, payer: "0.0.11340811", transaction: "0.0.7162784@1793978281.672658259", network: "hedera:testnet" }),
};

let airQualityDown = false;
const sources = Object.fromEntries(
  DATA_ENDPOINT_IDS.map((id) => [id, async () => {
    if (id === "air-quality" && airQualityDown) throw new Error("open-meteo returned HTTP 503");
    return { source: id };
  }]),
) as Sources;

let server: Server;
let base: string;

beforeAll(async () => {
  const app = createApp({ config, facilitator, caches: createCaches(sources) });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

const decode = (h: string | null) => JSON.parse(Buffer.from(h!, "base64").toString("utf8"));

describe("data server", () => {
  it("GET /catalogue is free and lists the four endpoints with prices, payee and asset", async () => {
    const r = await fetch(`${base}/catalogue`);
    expect(r.status).toBe(200);
    const cat = (await r.json()) as Catalogue;
    expect(cat.network).toBe("hedera:testnet");
    expect(cat.payTo).toBe("0.0.11341093");
    expect(cat.endpoints.map((e) => [e.id, e.path, e.priceTinybars, e.asset])).toEqual([
      ["weather", "/api/weather", "1000000", "0.0.0"],
      ["air-quality", "/api/air-quality", "2000000", "0.0.0"],
      ["hbar-price", "/api/hbar-price", "3000000", "0.0.0"],
      ["headlines", "/api/headlines", "5000000", "0.0.0"],
    ]);
    for (const e of cat.endpoints) expect(e.description.length).toBeGreaterThan(10);
  });

  it.each(DATA_ENDPOINT_IDS)("GET /api/%s without payment returns 402 with valid payment requirements", async (id) => {
    const r = await fetch(`${base}/api/${id}`);
    expect(r.status).toBe(402);
    const required = decode(r.headers.get("payment-required"));
    expect(required.x402Version).toBe(2);
    const price = config.prices[id];
    expect(required.accepts).toEqual([
      expect.objectContaining({
        scheme: "exact",
        network: "hedera:testnet",
        payTo: "0.0.11341093",
        amount: price,
        asset: "0.0.0",
        extra: expect.objectContaining({ feePayer: FEE_PAYER }),
      }),
    ]);
  });

  it("serves the data and settles once when the payment verifies", async () => {
    const first = await fetch(`${base}/api/weather`);
    const { accepts, resource } = decode(first.headers.get("payment-required"));
    const payment = Buffer.from(JSON.stringify({ x402Version: 2, resource, accepted: accepts[0], payload: { transaction: "AAAA" } })).toString("base64");
    const before = { ...calls };

    const r = await fetch(`${base}/api/weather`, { headers: { "payment-signature": payment } });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ source: "weather", asOf: expect.any(String) });
    expect(calls.verify - before.verify).toBe(1);
    expect(calls.settle - before.settle).toBe(1);
    expect(decode(r.headers.get("payment-response"))).toMatchObject({ success: true, transaction: "0.0.7162784@1793978281.672658259" });
  });

  it("answers 502 BEFORE the paywall when an upstream is down and nothing is cached: no 402, nothing to sign", async () => {
    airQualityDown = true;
    try {
      const fresh = createApp({ config, facilitator, caches: createCaches(sources) });
      const s = fresh.listen(0);
      await new Promise((r) => s.once("listening", r));
      const r = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/api/air-quality`);
      await new Promise((res) => s.close(res));
      expect(r.status).toBe(502);
      expect(r.headers.get("payment-required")).toBeNull();
      expect(await r.json()).toMatchObject({ charged: false });
    } finally {
      airQualityDown = false;
    }
  });

  it("returns 404 for an unknown endpoint without asking for payment", async () => {
    const r = await fetch(`${base}/api/lottery`);
    expect(r.status).toBe(404);
    expect(r.headers.get("payment-required")).toBeNull();
  });
});

describe("loadConfig", () => {
  it("rejects a missing or malformed merchant account", () => {
    expect(() => loadConfig({})).toThrow(/MERCHANT_ACCOUNT_ID/);
    expect(() => loadConfig({ MERCHANT_ACCOUNT_ID: "0.0.xxxxx" })).toThrow(/MERCHANT_ACCOUNT_ID/);
  });
  it("takes price, asset and decimals overrides from env", () => {
    const c = loadConfig({ MERCHANT_ACCOUNT_ID: "0.0.1", PRICE_AIR_QUALITY_TINYBARS: "42", PAYMENT_ASSET: "0.0.6001", PAYMENT_ASSET_DECIMALS: "6" });
    expect(c.prices["air-quality"]).toBe("42");
    expect([c.asset, c.assetDecimals]).toEqual(["0.0.6001", 6]);
  });
  it("rejects zero/negative prices and an HTS token without decimals", () => {
    expect(() => loadConfig({ MERCHANT_ACCOUNT_ID: "0.0.1", PRICE_WEATHER_TINYBARS: "0" })).toThrow(/PRICE_WEATHER_TINYBARS/);
    expect(() => loadConfig({ MERCHANT_ACCOUNT_ID: "0.0.1", PAYMENT_ASSET: "0.0.6001" })).toThrow(/DECIMALS/);
  });
});
