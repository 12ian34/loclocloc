/**
 * POST to public Overpass instances with rotation + retries (mirrors can be flaky).
 */

const ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

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
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(query)}`,
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
