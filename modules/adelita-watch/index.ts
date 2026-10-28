// Apple Watch scheduled workouts (WorkoutKit). See ios/AdelitaWatchModule.swift.
import { requireOptionalNativeModule } from 'expo';

export type WatchStep = {
  purpose?: 'work' | 'recovery';
  goal: { type: 'time' | 'distance' | 'open'; value?: number };
  pace: { fast: number; slow: number } | null; // seconds per km
};
export type WatchWorkout = {
  name: string;
  warmup: WatchStep | null;
  blocks: { iterations: number; steps: WatchStep[] }[];
  cooldown: WatchStep | null;
};
export type ScheduleResult = {
  denied: boolean; scheduled: number; removed: number; kept: number; skipped: number; max?: number;
};

type Native = {
  isSupported(): boolean;
  schedule(json: string): Promise<ScheduleResult>;
};

// Optional, so the app still runs (without the watch feature) if the native part is missing.
const native = requireOptionalNativeModule<Native>('AdelitaWatch');

export function watchSupported(): boolean {
  try { return !!native && native.isSupported(); } catch { return false; }
}

// One sync at a time: two overlapping ones would both see a session missing and add it twice.
let queue: Promise<unknown> = Promise.resolve();

export async function scheduleWorkouts(workouts: { id: string; date: string; workout: WatchWorkout }[]): Promise<ScheduleResult> {
  if (!native) throw Object.assign(new Error('watch_unsupported'), { code: 'watch_unsupported' });
  const run = queue.then(() => native!.schedule(JSON.stringify({ workouts })));
  queue = run.catch(() => undefined);
  return run;
}
