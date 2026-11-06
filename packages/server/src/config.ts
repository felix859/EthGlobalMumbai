// Server config and the catalogue. Prices, payee and asset live here so switching HBAR to an HTS token
// (or retuning a price) is one env var, not a code change.
import { PORTS, type Catalogue, type CatalogueEntry, type EndpointId } from "@pennyagent/shared";

export type DataEndpointId = Exclude<EndpointId, "briefing">;

export interface ServerConfig {
  port: number;
  network: "hedera:testnet";
  payTo: string;
  facilitatorUrl: string;
  /** "0.0.0" = native HBAR (tinybars), else an HTS token id (its smallest unit). */
  asset: string;
  assetDecimals: number;
  prices: Record<DataEndpointId, string>;
}

const ENDPOINTS: { id: DataEndpointId; description: string; defaultPrice: string }[] = [
  { id: "weather", description: "Current weather and today's forecast for Mumbai (temperature, rain chance, wind)", defaultPrice: "1000000" },
  { id: "air-quality", description: "Current air quality in Mumbai (US AQI, PM2.5, PM10, ozone, NO2)", defaultPrice: "2000000" },
  { id: "hbar-price", description: "HBAR price in INR and USD with 24h change", defaultPrice: "3000000" },
  { id: "headlines", description: "Top 5 Hacker News headlines right now", defaultPrice: "5000000" },
];

export const DATA_ENDPOINT_IDS = ENDPOINTS.map((e) => e.id);

const isAccountId = (s: string) => /^\d+\.\d+\.\d+$/.test(s);
const isAmount = (s: string) => /^[1-9]\d*$/.test(s);

/** Reads config from env. Throws on anything that would make the server charge the wrong account or amount. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const payTo = env.MERCHANT_ACCOUNT_ID ?? "";
  if (!isAccountId(payTo)) throw new Error(`MERCHANT_ACCOUNT_ID must be an account id like 0.0.12345, got "${payTo}"`);
  const asset = env.PAYMENT_ASSET || "0.0.0";
  if (!isAccountId(asset)) throw new Error(`PAYMENT_ASSET must be "0.0.0" (HBAR) or an HTS token id, got "${asset}"`);
  const assetDecimals = Number(env.PAYMENT_ASSET_DECIMALS || (asset === "0.0.0" ? 8 : NaN));
  if (!Number.isInteger(assetDecimals) || assetDecimals < 0) throw new Error("PAYMENT_ASSET_DECIMALS must be set for an HTS token");

  const prices = {} as Record<DataEndpointId, string>;
  for (const e of ENDPOINTS) {
    // e.g. PRICE_AIR_QUALITY_TINYBARS
    const key = `PRICE_${e.id.toUpperCase().replace(/-/g, "_")}_TINYBARS`;
    const p = env[key] || e.defaultPrice;
    if (!isAmount(p)) throw new Error(`${key} must be a positive integer, got "${p}"`);
    prices[e.id] = p;
  }

  return {
    port: Number(env.SERVER_PORT ?? PORTS.server),
    network: "hedera:testnet",
    payTo,
    facilitatorUrl: env.FACILITATOR_URL || "https://api.testnet.blocky402.com",
    asset,
    assetDecimals,
    prices,
  };
}

export function buildCatalogue(c: ServerConfig): Catalogue {
  const endpoints: CatalogueEntry[] = ENDPOINTS.map((e) => ({
    id: e.id,
    path: `/api/${e.id}`,
    description: e.description,
    priceTinybars: c.prices[e.id],
    asset: c.asset,
  }));
  return { network: c.network, payTo: c.payTo, endpoints };
}
