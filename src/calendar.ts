// When she's busy over the next few days, for Ask Adelita's clash check, read from every
// calendar on her phone. Only start and end times ever leave this file: never titles,
// places, notes or who else is invited. All-day events, events marked "free" and
// cancelled events are left out.
import {
  Availability,
  EntityTypes,
  EventStatus,
  getCalendarPermissions,
  getCalendars,
  listEvents,
  requestCalendarPermissions,
} from 'expo-calendar';

export type BusySlot = { start: string; end: string };

export class CalendarError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export const MAX_DAYS = 14;

// Asks only the first time the page wants it; after that iOS answers straight away.
async function allowed(): Promise<boolean> {
  const now = await getCalendarPermissions();
  if (now.granted) return true;
  if (!now.canAskAgain) return false;
  return (await requestCalendarPermissions()).granted;
}

export async function readBusy(days: number): Promise<BusySlot[]> {
  if (!(await allowed())) throw new CalendarError('calendar_denied', 'Calendar access was not allowed');
  const span = Math.max(1, Math.min(MAX_DAYS, Math.round(days || 7)));
  const from = new Date();
  const to = new Date(from.getTime() + span * 86400000);

  const calendars = await getCalendars(EntityTypes.EVENT);
  if (!calendars.length) return [];
  const events = await listEvents(calendars.map((c) => c.id), from, to);

  const out: BusySlot[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (e.allDay) continue;
    if (e.availability === Availability.FREE) continue;
    if (e.status === EventStatus.CANCELED) continue;
    const s = new Date(e.startDate), f = new Date(e.endDate);
    if (!Number.isFinite(s.getTime()) || !Number.isFinite(f.getTime()) || f <= s) continue;
    if (f <= from || s >= to) continue;
    const slot = { start: s.toISOString(), end: f.toISOString() };
    const k = slot.start + '|' + slot.end; // the same meeting on two calendars counts once
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(slot);
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}
