import { describe, it, expect } from "vitest";
import { createSources, UpstreamError, type Fetch } from "./sources.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake fetch that answers by URL substring. */
const fakeFetch = (routes: Record<string, () => Response>): Fetch =>
  (async (input: string | URL | Request) => {
    const url = String(input);
    const hit = Object.keys(routes).find((k) => url.includes(k));
    if (!hit) throw new Error(`unexpected fetch ${url}`);
    return routes[hit]();
  }) as Fetch;

describe("createSources", () => {
  it("weather: flattens Open-Meteo into a compact summary", async () => {
    const s = createSources(fakeFetch({
      "api.open-meteo.com": () => json({
        current: { time: "2026-11-06T21:30", temperature_2m: 30, relative_humidity_2m: 52, precipitation: 0, weather_code: 61, wind_speed_10m: 8.8 },
        daily: { temperature_2m_max: [36.6], temperature_2m_min: [26.4], precipitation_probability_max: [70], precipitation_sum: [4.2] },
      }),
    }));
    expect(await s.weather()).toEqual({
      location: "Mumbai", time: "2026-11-06T21:30", condition: "rain", temperatureC: 30, humidityPct: 52, precipitationMm: 0,
      windKmh: 8.8, todayMaxC: 36.6, todayMinC: 26.4, todayRainChancePct: 70, todayRainMm: 4.2,
    });
  });

  it("air-quality: adds the AQI category", async () => {
    const s = createSources(fakeFetch({
      "air-quality-api": () => json({ current: { time: "t", us_aqi: 233, pm2_5: 38.2, pm10: 45.1, ozone: 121, nitrogen_dioxide: 15.6 } }),
    }));
    expect(await s["air-quality"]()).toMatchObject({ usAqi: 233, category: "very unhealthy", pm2_5: 38.2, no2: 15.6 });
  });

  it("hbar-price: rounds the 24h change", async () => {
    const s = createSources(fakeFetch({
      coingecko: () => json({ "hedera-hashgraph": { inr: 6.4, usd: 0.068138, inr_24h_change: -0.8332, usd_24h_change: 1.23456, last_updated_at: 1793981576 } }),
    }));
    expect(await s["hbar-price"]()).toMatchObject({ inr: 6.4, usd: 0.068138, inrChange24hPct: -0.83, usdChange24hPct: 1.23 });
  });

  it("headlines: top 5 stories only, with a fallback link for text posts", async () => {
    const s = createSources(fakeFetch({
      "topstories.json": () => json([1, 2, 3, 4, 5, 6, 7]),
      "/item/": () => json({ id: 9, title: "Ask HN: x", score: 10 }),
    }));
    const r = (await s.headlines()) as { headlines: { url: string }[] };
    expect(r.headlines).toHaveLength(5);
    expect(r.headlines[0]).toEqual({ title: "Ask HN: x", url: "https://news.ycombinator.com/item?id=9", score: 10 });
  });

  it("headlines: one failing item does not fail the endpoint; all failing does", async () => {
    let n = 0;
    const ok = createSources(fakeFetch({
      "topstories.json": () => json([1, 2, 3]),
      "/item/": () => (++n === 2 ? new Response("nope", { status: 500 }) : json({ id: n, title: `t${n}`, score: 1 })),
    }));
    expect(((await ok.headlines()) as { headlines: unknown[] }).headlines).toHaveLength(2);
    const bad = createSources(fakeFetch({ "topstories.json": () => json([1, 2]), "/item/": () => new Response("x", { status: 500 }) }));
    await expect(bad.headlines()).rejects.toThrow(UpstreamError);
  });

  it("turns HTTP errors, network errors and bad shapes into UpstreamError", async () => {
    await expect(createSources(fakeFetch({ coingecko: () => json({}, 429) }))["hbar-price"]()).rejects.toThrow(UpstreamError);
    await expect(createSources((async () => { throw new Error("ECONNREFUSED"); }) as Fetch).weather()).rejects.toThrow(/unreachable/);
    await expect(createSources(fakeFetch({ coingecko: () => json({ nope: 1 }) }))["hbar-price"]()).rejects.toThrow(UpstreamError);
  });
});
