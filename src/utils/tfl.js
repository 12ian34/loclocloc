import { TRANSIT_RINGS } from "../config.js";

const TFL_API_KEY = import.meta.env.VITE_TFL_API_KEY || "";

async function queryTfLJourneyTime(fromLat, fromLng, toLat, toLng) {
  const base = "https://api.tfl.gov.uk/Journey/JourneyResults";
  const from = `${fromLat.toFixed(5)},${fromLng.toFixed(5)}`;
  const to = `${toLat.toFixed(5)},${toLng.toFixed(5)}`;
  const params = new URLSearchParams({
    mode: "tube,dlr,elizabeth-line,overground,national-rail,bus,tram,walking",
    app_key: TFL_API_KEY,
  });
  try {
    const res = await fetch(`${base}/${from}/to/${to}?${params}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.journeys?.length) return null;
    return Math.min(...data.journeys.map((j) => j.duration));
  } catch {
    return null;
  }
}

export async function computeTransitIsochrones(lat, lng) {
  const numAngles = 24;
  const sampleDistKm = [2, 5, 10, 16];
  const targetMinutes = TRANSIT_RINGS.map((r) => r.mins);
  const cosLat = Math.cos((lat * Math.PI) / 180);

  const samples = [];
  for (let i = 0; i < numAngles; i++) {
    const angle = (i / numAngles) * 2 * Math.PI;
    for (const dist of sampleDistKm) {
      const destLat = lat + (dist / 111) * Math.cos(angle);
      const destLng = lng + (dist / (111 * cosLat)) * Math.sin(angle);
      samples.push({ angleIdx: i, angle, dist, destLat, destLng, time: null });
    }
  }

  const BATCH = 10;
  for (let b = 0; b < samples.length; b += BATCH) {
    const batch = samples.slice(b, b + BATCH);
    const results = await Promise.all(
      batch.map((s) => queryTfLJourneyTime(lat, lng, s.destLat, s.destLng))
    );
    batch.forEach((s, i) => { s.time = results[i]; });
  }

  const isochrones = {};
  for (const target of targetMinutes) {
    const points = [];
    for (let i = 0; i < numAngles; i++) {
      const angleSamples = samples
        .filter((s) => s.angleIdx === i && s.time != null)
        .sort((a, b) => a.dist - b.dist);

      let reachKm = target * 0.08;

      if (angleSamples.length >= 2) {
        let found = false;
        for (let j = 0; j < angleSamples.length - 1; j++) {
          const s1 = angleSamples[j], s2 = angleSamples[j + 1];
          if (s1.time <= target && s2.time > target) {
            const t = (target - s1.time) / (s2.time - s1.time);
            reachKm = s1.dist + t * (s2.dist - s1.dist);
            found = true;
            break;
          }
        }
        if (!found) {
          const last = angleSamples[angleSamples.length - 1];
          const first = angleSamples[0];
          if (last.time <= target) {
            reachKm = Math.min(30, last.dist * 1.2);
          } else if (first.time > target) {
            reachKm = Math.max(0.3, first.dist * (target / first.time));
          }
        }
      } else if (angleSamples.length === 1) {
        const s = angleSamples[0];
        reachKm = Math.max(0.3, Math.min(25, s.dist * (target / s.time)));
      }

      const angle = (i / numAngles) * 2 * Math.PI;
      points.push([
        lat + (reachKm / 111) * Math.cos(angle),
        lng + (reachKm / (111 * cosLat)) * Math.sin(angle),
      ]);
    }
    isochrones[target] = points;
  }

  return isochrones;
}
