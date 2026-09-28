import { DateTime } from 'luxon';
import type { TimeOfDay } from '../data/types.js';

function local(ms: number, tz: string): DateTime {
  const dt = DateTime.fromMillis(ms, { zone: tz });
  if (!dt.isValid) throw new Error(`Invalid timezone: ${tz}`);
  return dt;
}

export function isValidTimezone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

/** 'YYYY-MM-DD' in the given zone. */
export function dayKey(ms: number, tz: string): string {
  return local(ms, tz).toFormat('yyyy-LL-dd');
}

/** Day key of the previous local day (for streaks). */
export function prevDayKey(ms: number, tz: string): string {
  return local(ms, tz).minus({ days: 1 }).toFormat('yyyy-LL-dd');
}

/** ISO week key 'YYYY-Www' (weeks start Monday 00:00 local). */
export function weekKey(ms: number, tz: string): string {
  return local(ms, tz).toFormat("kkkk-'W'WW");
}

/** Week key of the previous ISO week. */
export function prevWeekKey(ms: number, tz: string): string {
  return local(ms, tz).minus({ weeks: 1 }).toFormat("kkkk-'W'WW");
}

/** morning 05–11, day 11–17, evening 17–22, night 22–05 (local time). */
export function timeOfDay(ms: number, tz: string): TimeOfDay {
  const h = local(ms, tz).hour;
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'day';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

export const TIME_OF_DAY_NAMES: Record<TimeOfDay, string> = {
  morning: 'Утро',
  day: 'День',
  evening: 'Вечер',
  night: 'Ночь',
};

export function startOfDay(ms: number, tz: string): number {
  return local(ms, tz).startOf('day').toMillis();
}

/** Monday 00:00 local of the week containing ms. */
export function startOfWeek(ms: number, tz: string): number {
  return local(ms, tz).startOf('week').toMillis();
}

/** Next local midnight (daily reset). */
export function nextDayReset(ms: number, tz: string): number {
  return local(ms, tz).startOf('day').plus({ days: 1 }).toMillis();
}

/** Next Monday 00:00 local (weekly reset). */
export function nextWeekReset(ms: number, tz: string): number {
  return local(ms, tz).startOf('week').plus({ weeks: 1 }).toMillis();
}

/** Local calendar parts (weekday: 1 = Monday … 7 = Sunday). */
export function localParts(ms: number, tz: string): { year: number; month: number; day: number; weekday: number; hour: number; minute: number } {
  const d = local(ms, tz);
  return { year: d.year, month: d.month, day: d.day, weekday: d.weekday, hour: d.hour, minute: d.minute };
}
