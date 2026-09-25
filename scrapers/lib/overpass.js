/**
 * POST to public Overpass instances with rotation + retries (mirrors can be flaky).
 */

// Order matters: overpass-api.de answers reliably (with a User-Agent); kumi.systems often hangs and
// openstreetmap.fr is now whitelist-only, so they are fallbacks. Run scrapers sequentially — the main
// instance limits concurrent slots per IP.
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];
const REQUEST_TIMEOUT_MS = 180_000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function overpassQuery(query, { retriesPerHost = 4 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < retriesPerHost; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            // Public instances reject UA-less requests (406 / 429); Node fetch sends none by default.
            "User-Agent": "loclocloc-scraper/1.0 (+https://github.com/12ian34/loclocloc)",
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) {
          lastErr = new Error(`${url} HTTP ${res.status}`);
          await sleep(res.status === 429 ? 25000 : res.status === 504 ? 5000 : 2000);
          continue;
        }
        return await res.json();
      } catch (e) {
        lastErr = e;
        await sleep(2000);
      }
    }
  }
  throw lastErr ?? new Error("Overpass query failed");
}
