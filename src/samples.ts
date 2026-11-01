// A run's samples for the run detail screen (map, km splits, pace vs heart rate,
// elevation), in the shape cleanSamples in the web repo's netlify/lib/health-parse.mjs
// reads: parallel arrays on one shared timeline,
//   { t: [seconds from the start], d: [metres so far], hr: [bpm],
//     lat: [°], lng: [°], alt: [m] }
// with null for a gap. The timeline is a 5-second grid, so an hour's run is about 720
// rows (roughly 30 KB) however often the watch recorded.
import { queryQuantitySamples, type WorkoutProxyTyped } from '@kingstinct/react-native-healthkit';

export type RunSamples = {
  t: number[];
  d: (number | null)[];
  hr: (number | null)[];
  lat: (number | null)[];
  lng: (number | null)[];
  alt: (number | null)[];
};

const STEP = 5;           // seconds between rows
const MAX_ROWS = 6000;    // the server reads at most 6000 rows (MAX_SAMPLES)
const HR_WINDOW = 10;     // use a heart-rate reading up to 10 s away
const GPS_WINDOW = 5;     // and a route point up to 5 s away

type Sample = { startDate: Date; endDate: Date; quantity: number; sourceRevision?: { source?: { bundleIdentifier?: string } } };

const round = (v: number, places: number) => { const f = 10 ** places; return Math.round(v * f) / f; };

// Samples recorded with the workout. If the app that recorded the run didn't link its
// samples to the workout, fall back to the same time window from the same app only, so
// the phone's own step counter never doubles the distance.
async function during(
  w: WorkoutProxyTyped,
  type: 'HKQuantityTypeIdentifierHeartRate' | 'HKQuantityTypeIdentifierDistanceWalkingRunning',
  unit: 'count/min' | 'm',
): Promise<readonly Sample[]> {
  const linked = await queryQuantitySamples(type, { limit: 0, ascending: true, unit, filter: { workout: w } });
  if (linked.length) return linked;
  const src = w.sourceRevision?.source?.bundleIdentifier;
  if (!src) return [];
  const all = await queryQuantitySamples(type, {
    limit: 0, ascending: true, unit, filter: { date: { startDate: w.startDate, endDate: w.endDate } },
  });
  return all.filter((s) => s.sourceRevision?.source?.bundleIdentifier === src);
}

// Index of the item nearest to time x (seconds), or -1 if none is within `win`.
function nearest(times: number[], x: number, from: number, win: number): number {
  let i = from;
  while (i + 1 < times.length && times[i + 1] <= x) i++;
  let best = -1, gap = Infinity;
  for (const k of [i, i + 1]) {
    if (k < 0 || k >= times.length) continue;
    const g = Math.abs(times[k] - x);
    if (g < gap) { gap = g; best = k; }
  }
  return gap <= win ? best : -1;
}

export async function readSamples(w: WorkoutProxyTyped, durationSec: number): Promise<RunSamples | null> {
  const t0 = w.startDate.getTime() / 1000;
  const total = Math.max(durationSec, w.endDate.getTime() / 1000 - t0);
  if (!(total > 0)) return null;

  const [hrS, distS, routes] = await Promise.all([
    during(w, 'HKQuantityTypeIdentifierHeartRate', 'count/min').catch(() => [] as readonly Sample[]),
    during(w, 'HKQuantityTypeIdentifierDistanceWalkingRunning', 'm').catch(() => [] as readonly Sample[]),
    w.getWorkoutRoutes().catch(() => []),
  ]);

  // Heart rate: one reading per sample, at its start.
  const hrT: number[] = [], hrV: number[] = [];
  for (const s of hrS) {
    const ts = s.startDate.getTime() / 1000 - t0;
    if (Number.isFinite(s.quantity) && ts >= -HR_WINDOW && ts <= total + HR_WINDOW) { hrT.push(ts); hrV.push(s.quantity); }
  }

  // Route: every location from every route segment, in time order.
  const locs = routes
    .flatMap((r) => r.locations)
    .map((l) => ({ ts: l.date.getTime() / 1000 - t0, lat: l.latitude, lng: l.longitude, alt: l.altitude, vacc: l.verticalAccuracy, dist: l.distance }))
    .filter((l) => Number.isFinite(l.ts) && Number.isFinite(l.lat) && Number.isFinite(l.lng) && (l.lat || l.lng))
    .sort((a, b) => a.ts - b.ts);
  const gpsT = locs.map((l) => l.ts);

  // Distance so far: the end of each distance sample. With none, add up the route.
  const dT: number[] = [], dV: number[] = [];
  let run = 0;
  if (distS.length) {
    for (const s of distS) {
      if (!Number.isFinite(s.quantity) || s.quantity < 0) continue;
      run += s.quantity;
      dT.push(s.endDate.getTime() / 1000 - t0); dV.push(run);
    }
  } else {
    for (const l of locs) {
      if (Number.isFinite(l.dist) && (l.dist as number) > 0) run += l.dist as number;
      dT.push(l.ts); dV.push(run);
    }
  }
  if (!hrT.length && !gpsT.length && dT.length < 2) return null;

  // Distance at time x, straight-line between the readings either side.
  let di = 0;
  const distAt = (x: number): number | null => {
    if (dT.length < 2 || x < dT[0] - STEP || x > dT[dT.length - 1] + STEP) return null;
    while (di + 1 < dT.length && dT[di + 1] < x) di++;
    if (x <= dT[0]) return dV[0];
    if (di + 1 >= dT.length) return dV[dV.length - 1];
    const a = dT[di], b = dT[di + 1];
    return b > a ? dV[di] + ((dV[di + 1] - dV[di]) * (x - a)) / (b - a) : dV[di + 1];
  };

  const step = Math.max(STEP, Math.ceil(total / MAX_ROWS));
  const out: RunSamples = { t: [], d: [], hr: [], lat: [], lng: [], alt: [] };
  let hi = 0, gi = 0;
  for (let x = 0; x <= total && out.t.length < MAX_ROWS; x += step) {
    const h = hrT.length ? nearest(hrT, x, hi, HR_WINDOW) : -1;
    if (h >= 0) hi = h;
    const g = gpsT.length ? nearest(gpsT, x, gi, GPS_WINDOW) : -1;
    if (g >= 0) gi = g;
    const d = distAt(x);
    if (h < 0 && g < 0 && d === null) continue;
    const loc = g >= 0 ? locs[g] : null;
    out.t.push(Math.round(x));
    out.d.push(d === null ? null : round(d, 1));
    out.hr.push(h >= 0 ? Math.round(hrV[h]) : null);
    out.lat.push(loc ? round(loc.lat, 6) : null);
    out.lng.push(loc ? round(loc.lng, 6) : null);
    // Altitude only where the watch trusted it.
    out.alt.push(loc && Number.isFinite(loc.alt) && loc.vacc >= 0 && loc.vacc < 50 ? round(loc.alt, 1) : null);
  }
  return out.t.length > 1 ? out : null;
}
