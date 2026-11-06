// Data server: free GET /catalogue, x402-gated GET /api/{weather,air-quality,hbar-price,headlines}.
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createApp, createCaches } from "./app.js";
import { DATA_ENDPOINT_IDS, loadConfig } from "./config.js";
import { createSources } from "./sources.js";

const config = loadConfig();
const caches = createCaches(createSources());
const app = createApp({ config, facilitator: new HTTPFacilitatorClient({ url: config.facilitatorUrl }), caches });

// Warm up on boot and refresh in the background, so paid requests are served from memory and a failing upstream
// is noticed (and answered with 502, before any payment) rather than discovered mid-request.
const refreshAll = () =>
  Promise.all(
    DATA_ENDPOINT_IDS.map((id) =>
      caches[id].refresh().then(
        () => id,
        (e) => (console.warn(`[server] ${id} upstream failed: ${(e as Error).message}`), null),
      ),
    ),
  );

const ready = await refreshAll();
setInterval(refreshAll, 60_000).unref();

app.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}  payTo ${config.payTo}  asset ${config.asset}`);
  console.log(`[server] facilitator ${config.facilitatorUrl}; warm: ${ready.filter(Boolean).join(", ") || "none"}`);
});
