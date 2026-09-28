import { describe, expect, it } from 'vitest';
import * as stats from '../../src/db/repos/stats.js';
import { getServerStat, incServerStat } from '../../src/db/repos/server-stats.js';
import { getConfig, setConfig, CONFIG_KEYS } from '../../src/db/repos/config.js';
import { addAudit, listAudit } from '../../src/db/repos/audit.js';
import { hasRun, markRun } from '../../src/db/repos/periodic.js';
import { createTestContext, seedPlayer } from '../helpers.js';

describe('stats repo', () => {
  it('defaultScopes without and with an active season', () => {
    const ctx = createTestContext(); // 2026-01-05 12:00 MSK (Monday)
    expect(stats.defaultScopes(ctx)).toEqual(['all', 'd:2026-01-05', 'w:2026-W02']);
    ctx.db.prepare("INSERT INTO seasons (id, theme_id, name, starts_at, ends_at, status) VALUES (7, 'winter', 'S', 0, 1, 'active')").run();
    expect(stats.defaultScopes(ctx)).toEqual(['all', 'd:2026-01-05', 'w:2026-W02', 's:7']);
  });

  it('inc / max / get / top / rank', () => {
    const ctx = createTestContext();
    for (const u of ['a', 'b', 'c']) seedPlayer(ctx, u);
    stats.inc(ctx, 'a', 'catches', 3);
    stats.inc(ctx, 'a', 'catches', 2);
    stats.inc(ctx, 'b', 'catches', 7);
    stats.max(ctx, 'a', 'heaviest_weight', 5);
    stats.max(ctx, 'a', 'heaviest_weight', 3);
    expect(stats.get(ctx, 'a', 'catches')).toBe(5);
    expect(stats.get(ctx, 'a', 'catches', 'w:2026-W02')).toBe(5);
    expect(stats.get(ctx, 'a', 'heaviest_weight')).toBe(5);
    expect(stats.get(ctx, 'c', 'catches')).toBe(0);
    expect(stats.top(ctx, 'catches', 'all')).toEqual([
      { userId: 'b', value: 7 },
      { userId: 'a', value: 5 },
    ]);
    expect(stats.rank(ctx, 'a', 'catches', 'all')).toBe(2);
    expect(stats.rank(ctx, 'c', 'catches', 'all')).toBeNull();
    expect(stats.getAll(ctx, 'a')).toEqual({ catches: 5, heaviest_weight: 5 });
  });

  it('server stats, config, audit, periodic', () => {
    const ctx = createTestContext();
    incServerStat(ctx, 'catches', 2);
    incServerStat(ctx, 'catches', 1);
    expect(getServerStat(ctx, 'catches')).toBe(3);
    expect(getServerStat(ctx, 'catches', 'w:2026-W02')).toBe(3);

    expect(ctx.config.timezone).toBe('Europe/Moscow');
    setConfig(ctx, CONFIG_KEYS.timezone, 'Asia/Tokyo');
    expect(ctx.config.timezone).toBe('Asia/Tokyo');
    expect(ctx.config.announceChannelId).toBeNull();
    setConfig(ctx, CONFIG_KEYS.announceChannelId, '123');
    expect(getConfig(ctx, CONFIG_KEYS.announceChannelId)).toBe('123');

    addAudit(ctx, 'admin', 'give', { coins: 5 });
    expect(listAudit(ctx)[0]).toMatchObject({ actor_id: 'admin', action: 'give', details: '{"coins":5}' });

    expect(markRun(ctx, 'weekly', '2026-W02')).toBe(true);
    expect(markRun(ctx, 'weekly', '2026-W02')).toBe(false);
    expect(hasRun(ctx, 'weekly', '2026-W02')).toBe(true);
  });
});
