import { describe, expect, it } from 'vitest';
import { dayKey, nextDayReset, nextWeekReset, prevDayKey, startOfWeek, timeOfDay, weekKey } from '../../src/core/time.js';

const TZ = 'Europe/Moscow'; // UTC+3, no DST

describe('time keys (Europe/Moscow)', () => {
  it('day boundary is local midnight, not UTC', () => {
    // 2026-03-10 20:59:59 UTC = 23:59:59 MSK
    expect(dayKey(Date.UTC(2026, 2, 10, 20, 59, 59), TZ)).toBe('2026-03-10');
    // 2026-03-10 21:00:00 UTC = 00:00 MSK next day
    expect(dayKey(Date.UTC(2026, 2, 10, 21, 0, 0), TZ)).toBe('2026-03-11');
    expect(prevDayKey(Date.UTC(2026, 2, 10, 21, 0, 0), TZ)).toBe('2026-03-10');
  });

  it('week starts Monday 00:00 local', () => {
    // Sunday 2026-01-11 23:59 MSK = 20:59 UTC
    const sunday = Date.UTC(2026, 0, 11, 20, 59, 0);
    // Monday 2026-01-12 00:00 MSK = 2026-01-11 21:00 UTC
    const monday = Date.UTC(2026, 0, 11, 21, 0, 0);
    expect(weekKey(sunday, TZ)).toBe('2026-W02');
    expect(weekKey(monday, TZ)).toBe('2026-W03');
    expect(startOfWeek(sunday, TZ)).toBe(Date.UTC(2026, 0, 4, 21, 0, 0));
    expect(nextWeekReset(sunday, TZ)).toBe(monday);
  });

  it('ISO week-year at year boundary', () => {
    // 2027-01-01 (Friday) belongs to ISO week 2026-W53
    expect(weekKey(Date.UTC(2027, 0, 1, 12, 0, 0), TZ)).toBe('2026-W53');
  });

  it('nextDayReset returns next local midnight', () => {
    const t = Date.UTC(2026, 5, 1, 10, 0, 0); // 13:00 MSK
    expect(nextDayReset(t, TZ)).toBe(Date.UTC(2026, 5, 1, 21, 0, 0));
  });

  it('timeOfDay uses local hours', () => {
    expect(timeOfDay(Date.UTC(2026, 0, 1, 3, 0), TZ)).toBe('morning'); // 06 MSK
    expect(timeOfDay(Date.UTC(2026, 0, 1, 9, 0), TZ)).toBe('day'); // 12 MSK
    expect(timeOfDay(Date.UTC(2026, 0, 1, 15, 0), TZ)).toBe('evening'); // 18 MSK
    expect(timeOfDay(Date.UTC(2026, 0, 1, 20, 0), TZ)).toBe('night'); // 23 MSK
    expect(timeOfDay(Date.UTC(2026, 0, 1, 0, 0), TZ)).toBe('night'); // 03 MSK
  });
});
