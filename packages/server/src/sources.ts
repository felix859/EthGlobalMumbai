// Upstream fetchers: free public APIs, no keys. Each returns small, flat JSON because the model reads it.
import { MUMBAI } from "@pennyagent/shared";
import type { DataEndpointId } from "./config.js";

export type Fetch = typeof fetch;
export type Sources = Record<DataEndpointId, () => Promise<unknown>>;

export class UpstreamError extends Error {}

const TIMEOUT_MS = 5_000;
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

async function getJson<T>(f: Fetch, url: string): Promise<T> {
  let r: Response;
  try {
    r = await f(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
  } catch (e) {
    throw new UpstreamError(`${new URL(url).host} unreachable: ${(e as Error).message}`);
  }
  if (!r.ok) throw new UpstreamError(`${new URL(url).host} returned HTTP ${r.status}`);
  return (await r.json()) as T;
}

// WMO weather interpretation codes (Open-Meteo), grouped.
function describeWeather(code: number): string {
  if (code === 0) return "clear";
  if (code <= 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code <= 48) return "fog";
  if (code <= 57) return "drizzle";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "rain showers";
  if (code <= 86) return "snow showers";
  return "thunderstorm";
}

function aqiCategory(aqi: number): string {
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "moderate";
  if (aqi <= 150) return "unhealthy for sensitive groups";
  if (aqi <= 200) return "unhealthy";
  if (aqi <= 300) return "very unhealthy";
  return "hazardous";
}

export function createSources(f: Fetch = fetch, loc: { lat: number; lon: number } = MUMBAI): Sources {
  const where = `latitude=${loc.lat}&longitude=${loc.lon}&timezone=Asia%2FKolkata`;
  return {
    async weather() {
      const d = await getJson<any>(
        f,
        `https://api.open-meteo.com/v1/forecast?${where}&forecast_days=1` +
          "&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m" +
          "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum",
      );
      const c = d?.current, day = d?.daily;
      if (!c || !day) throw new UpstreamError("open-meteo: unexpected response");
      return {
        location: "Mumbai",
        time: c.time,
        condition: describeWeather(c.weather_code),
        temperatureC: c.temperature_2m,
        humidityPct: c.relative_humidity_2m,
        precipitationMm: c.precipitation,
        windKmh: c.wind_speed_10m,
        todayMaxC: day.temperature_2m_max?.[0],
        todayMinC: day.temperature_2m_min?.[0],
        todayRainChancePct: day.precipitation_probability_max?.[0],
        todayRainMm: day.precipitation_sum?.[0],
      };
    },

    async "air-quality"() {
      const d = await getJson<any>(
        f,
        `https://air-quality-api.open-meteo.com/v1/air-quality?${where}&current=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide`,
      );
      const c = d?.current;
      if (!c || typeof c.us_aqi !== "number") throw new UpstreamError("open-meteo air quality: unexpected response");
      return {
        location: "Mumbai",
        time: c.time,
        usAqi: c.us_aqi,
        category: aqiCategory(c.us_aqi),
        pm2_5: c.pm2_5,
        pm10: c.pm10,
        ozone: c.ozone,
        no2: c.nitrogen_dioxide,
        unit: "μg/m³",
      };
    },

    async "hbar-price"() {
      const d = await getJson<any>(
        f,
        "https://api.coingecko.com/api/v3/simple/price?ids=hedera-hashgraph&vs_currencies=inr,usd&include_24hr_change=true&include_last_updated_at=true",
      );
      const p = d?.["hedera-hashgraph"];
      if (typeof p?.usd !== "number" || typeof p?.inr !== "number") throw new UpstreamError("coingecko: unexpected response");
      return {
        inr: p.inr,
        usd: p.usd,
        inrChange24hPct: round(p.inr_24h_change ?? 0),
        usdChange24hPct: round(p.usd_24h_change ?? 0),
        updatedAt: p.last_updated_at ? new Date(p.last_updated_at * 1000).toISOString() : undefined,
      };
    },

    async headlines() {
      const hn = "https://hacker-news.firebaseio.com/v0";
      const ids = await getJson<number[]>(f, `${hn}/topstories.json`);
      if (!Array.isArray(ids)) throw new UpstreamError("hacker news: unexpected response");
      const items = await Promise.all(ids.slice(0, 5).map((id) => getJson<any>(f, `${hn}/item/${id}.json`)));
      return {
        source: "Hacker News",
        headlines: items
          .filter((i) => i?.title)
          .map((i) => ({ title: i.title, url: i.url ?? `https://news.ycombinator.com/item?id=${i.id}`, score: i.score })),
      };
    },
  };
}
