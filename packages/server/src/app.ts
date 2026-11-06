// The x402-gated data API. `createApp` takes its facilitator and upstream sources as arguments so tests can run
// fully offline; `index.ts` wires the real ones.
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import type { FacilitatorClient, RoutesConfig } from "@x402/core/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { buildCatalogue, DATA_ENDPOINT_IDS, type DataEndpointId, type ServerConfig } from "./config.js";
import { SourceCache } from "./cache.js";
import type { Sources } from "./sources.js";

export type Caches = Record<DataEndpointId, SourceCache<unknown>>;

export const createCaches = (sources: Sources): Caches =>
  Object.fromEntries(DATA_ENDPOINT_IDS.map((id) => [id, new SourceCache(sources[id])])) as Caches;

export interface AppDeps {
  config: ServerConfig;
  facilitator: FacilitatorClient;
  caches: Caches;
}

export function createApp({ config, facilitator, caches }: AppDeps): Express {
  const catalogue = buildCatalogue(config);
  const resourceServer = new x402ResourceServer(facilitator).register(
    "hedera:*",
    new ExactHederaScheme({ defaultAssets: { [config.network]: { asset: config.asset, decimals: config.assetDecimals } } }),
  );

  const routes: RoutesConfig = Object.fromEntries(
    catalogue.endpoints.map((e) => [
      `GET ${e.path}`,
      {
        accepts: [{ scheme: "exact", network: config.network, payTo: config.payTo, price: { asset: e.asset, amount: e.priceTinybars } }],
        description: e.description,
        mimeType: "application/json",
      },
    ]),
  );

  const app = express();
  app.disable("x-powered-by");

  // Free routes.
  app.get("/", (_req, res) => res.json({ service: "pennyagent-server", catalogue: "/catalogue" }));
  app.get("/catalogue", (_req, res) => res.json(catalogue));

  // Upstream pre-check, BEFORE the paywall: if a source is down and nothing is cached, answer 502 without
  // issuing a 402, so a buyer never signs a payment for data we cannot deliver. The value it loads is cached,
  // so the paid request right after is served from memory.
  app.get("/api/:id", async (req: Request, res: Response, next: NextFunction) => {
    // Own keys only: `/api/constructor` or `/api/toString` must be a 404, not an inherited Object method.
    const cache = Object.hasOwn(caches, req.params.id) ? caches[req.params.id as DataEndpointId] : undefined;
    if (!cache) return res.status(404).json({ error: "Unknown endpoint", catalogue: "/catalogue" });
    try {
      res.locals.cached = await cache.get();
      next();
    } catch (e) {
      res.status(502).json({ error: `Upstream unavailable: ${(e as Error).message}`, charged: false });
    }
  });

  app.use(paymentMiddleware(routes, resourceServer));

  // Paid routes. A non-2xx here also means no settlement: the middleware only settles responses below 400.
  app.get("/api/:id", (_req, res) => {
    const { value, fetchedAt, stale } = res.locals.cached as Awaited<ReturnType<SourceCache<object>["get"]>>;
    res.json({ ...value, asOf: new Date(fetchedAt).toISOString(), ...(stale && { stale: true }) });
  });

  return app;
}
