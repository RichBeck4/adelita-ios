// Reads runs and recovery from Apple Health on her iPhone, in the shape the page's
// health-sync function expects:
//   { workouts: [{ id, date, start, distanceM, durationSec, avgHr, maxHr, name }],
//     resting: [{ day, bpm }], hrv: [{ day, ms }], sleep: [{ day, secs }] }
import {
  isHealthDataAvailable,
  queryCategorySamples,
  queryQuantitySamples,
  queryWorkoutSamples,
  requestAuthorization,
  WorkoutActivityType,
} from '@kingstinct/react-native-healthkit';

const READ = [
  'HKWorkoutTypeIdentifier',
  'HKQuantityTypeIdentifierHeartRate',
  'HKQuantityTypeIdentifierRestingHeartRate',
  'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  'HKQuantityTypeIdentifierDistanceWalkingRunning',
  'HKCategoryTypeIdentifierSleepAnalysis',
] as const;

export type HealthPayload = {
  workouts: {
    id: string; date: string; start: string; distanceM: number; durationSec: number;
    avgHr: number | null; maxHr: number | null; name: string | null;
  }[];
  resting: { day: string; bpm: number }[];
  hrv: { day: string; ms: number }[];
  sleep: { day: string; secs: number }[];
};

export class HealthError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

// The day on her phone's calendar, not UTC.
function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function metres(q?: { quantity: number; unit: string }): number | null {
  if (!q || !Number.isFinite(q.quantity)) return null;
  switch (q.unit) {
    case 'm': return q.quantity;
    case 'km': return q.quantity * 1000;
    case 'mi': return q.quantity * 1609.344;
    case 'yd': return q.quantity * 0.9144;
    case 'ft': return q.quantity * 0.3048;
    default: return null;
  }
}

function seconds(q?: { quantity: number; unit: string }): number | null {
  if (!q || !Number.isFinite(q.quantity)) return null;
  switch (q.unit) {
    case 's': return q.quantity;
    case 'min': return q.quantity * 60;
    case 'hr': return q.quantity * 3600;
    default: return null;
  }
}

let asked = false;

export async function readHealth(days: number): Promise<HealthPayload> {
  if (!isHealthDataAvailable()) throw new HealthError('health_unavailable', 'Health data is not available on this device');
  if (!asked) {
    // iOS only shows the permission sheet once; after that this returns straight away.
    await requestAuthorization({ toRead: READ });
    asked = true;
  }
  const span = Math.max(1, Math.min(200, Math.round(days || 90)));
  const startDate = new Date(Date.now() - span * 86400000);
  const date = { startDate };

  // ---- runs ----
  const runs = await queryWorkoutSamples({
    limit: 0,
    ascending: false,
    filter: { date, workoutActivityType: WorkoutActivityType.running },
  });
  const workouts: HealthPayload['workouts'] = [];
  for (const w of runs.slice(0, 300)) {
    const distanceM = metres(w.totalDistance);
    const durationSec = seconds(w.duration) ?? (w.endDate.getTime() - w.startDate.getTime()) / 1000;
    if (distanceM === null || !durationSec) continue;
    let avgHr: number | null = null, maxHr: number | null = null;
    try {
      const hr = await w.getStatistic('HKQuantityTypeIdentifierHeartRate', 'count/min');
      if (hr?.averageQuantity) avgHr = Math.round(hr.averageQuantity.quantity);
      if (hr?.maximumQuantity) maxHr = Math.round(hr.maximumQuantity.quantity);
    } catch { /* no heart rate for this run */ }
    workouts.push({
      id: w.uuid,
      date: localDay(w.startDate),
      start: w.startDate.toISOString(),
      distanceM: Math.round(distanceM),
      durationSec: Math.round(durationSec),
      avgHr,
      maxHr,
      name: null, // the page names runs itself; device names can be personal ("Karla's Apple Watch")
    });
  }

  // ---- resting heart rate: the latest reading each day ----
  const restingByDay: Record<string, number> = {};
  const restingSamples = await queryQuantitySamples('HKQuantityTypeIdentifierRestingHeartRate', {
    limit: 0, ascending: true, unit: 'count/min', filter: { date },
  });
  for (const s of restingSamples) restingByDay[localDay(s.startDate)] = Math.round(s.quantity);

  // ---- HRV (SDNN): the average of the day's readings ----
  const hrvSum: Record<string, { total: number; n: number }> = {};
  const hrvSamples = await queryQuantitySamples('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', {
    limit: 0, ascending: true, unit: 'ms', filter: { date },
  });
  for (const s of hrvSamples) {
    const d = localDay(s.startDate);
    const cur = hrvSum[d] || { total: 0, n: 0 };
    cur.total += s.quantity; cur.n += 1; hrvSum[d] = cur;
  }

  // ---- sleep: time asleep, counted on the morning she wakes up ----
  // Several sources (watch, phone, a sleep app) can record the same night, so each
  // source is totalled separately and the fullest one is used.
  const sleepBySource: Record<string, Record<string, number>> = {};
  const sleepSamples = await queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', {
    limit: 0, ascending: true, filter: { date: { startDate: new Date(startDate.getTime() - 86400000) } },
  });
  for (const s of sleepSamples) {
    const v = Number(s.value);
    if (v !== 1 && v !== 3 && v !== 4 && v !== 5) continue; // asleep (any stage), not in bed or awake
    const secs = (s.endDate.getTime() - s.startDate.getTime()) / 1000;
    if (!(secs > 0)) continue;
    const day = localDay(s.endDate);
    const src = s.sourceRevision?.source?.bundleIdentifier || 'unknown';
    const days = (sleepBySource[src] = sleepBySource[src] || {});
    days[day] = (days[day] || 0) + secs;
  }
  const sleepByDay: Record<string, number> = {};
  for (const days of Object.values(sleepBySource)) {
    for (const [day, secs] of Object.entries(days)) sleepByDay[day] = Math.max(sleepByDay[day] || 0, secs);
  }

  return {
    workouts,
    resting: Object.entries(restingByDay).map(([day, bpm]) => ({ day, bpm })),
    hrv: Object.entries(hrvSum).map(([day, v]) => ({ day, ms: Math.round((v.total / v.n) * 10) / 10 })),
    sleep: Object.entries(sleepByDay).map(([day, secs]) => ({ day, secs: Math.round(secs) })),
  };
}
