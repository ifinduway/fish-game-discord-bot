import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/config/balance.js';
import { FISH } from '../../src/data/fish.js';
import { updatePlayer } from '../../src/db/repos/players.js';
import { set, scopeSeason, scopeWeek } from '../../src/db/repos/stats.js';
import { getBalance } from '../../src/db/repos/wallet.js';
import {
  LEADERBOARD_CATEGORIES,
  WEEKLY_CATEGORIES,
  formatLeaderboardValue,
  isLeaderboardCategory,
  type LeaderboardCategory,
} from '../../src/game/leaderboard.js';
import weeklyJob from '../../src/scheduler/jobs/weekly.js';
import { getLeaderboard, runWeeklyReset } from '../../src/services/leaderboard.js';
import { createTestContext, seedPlayer, type TestContext } from '../helpers.js';

const WEEK = '2026-W02';
const PREV = '2026-W01';
const USERS = ['u1', 'u2', 'u3', 'u4'];

function setup(): TestContext {
  const ctx = createTestContext();
  for (const u of USERS) seedPlayer(ctx, u);
  return ctx;
}

function ids(ctx: TestContext, c: LeaderboardCategory, userId?: string, limit?: number) {
  const b = getLeaderboard(ctx, c, { userId, limit });
  return { order: b.rows.map((r) => r.userId), ranks: b.rows.map((r) => r.rank), me: b.me, board: b };
}

describe('game/leaderboard', () => {
  it('defines 8 categories, 4 weekly', () => {
    expect(LEADERBOARD_CATEGORIES).toHaveLength(8);
    expect(WEEKLY_CATEGORIES.sort()).toEqual(['casino_week', 'coins_week', 'heaviest_week', 'rare_week']);
    expect(isLeaderboardCategory('level')).toBe(true);
    expect(isLeaderboardCategory('nope')).toBe(false);
    expect(formatLeaderboardValue('collection', 5, 10)).toBe('5/10 (50%)');
    expect(formatLeaderboardValue('casino_week', 120)).toContain('+');
  });
});

describe('leaderboards', () => {
  it.each(['heaviest_week', 'coins_week', 'rare_week', 'casino_week'] as const)('%s: current week only, ties by user id, requester rank', (cat) => {
    const ctx = setup();
    const metric = LEADERBOARD_CATEGORIES.find((c) => c.id === cat)!.metric!;
    set(ctx, 'u1', metric, 5, [scopeWeek(WEEK)]);
    set(ctx, 'u2', metric, 9, [scopeWeek(WEEK)]);
    set(ctx, 'u3', metric, 9, [scopeWeek(WEEK)]);
    set(ctx, 'u4', metric, 100, [scopeWeek(PREV)]); // previous week does not count
    const r = ids(ctx, cat, 'u1');
    expect(r.order).toEqual(['u2', 'u3', 'u1']);
    expect(r.ranks).toEqual([1, 2, 3]);
    expect(r.me).toMatchObject({ rank: 3, value: 5 });
    expect(ids(ctx, cat, 'u4').me).toBeNull();
    // limit + requester outside the top
    const small = ids(ctx, cat, 'u1', 2);
    expect(small.order).toEqual(['u2', 'u3']);
    expect(small.me?.rank).toBe(3);
    // explicit week key
    expect(getLeaderboard(ctx, cat, { weekKey: PREV }).rows.map((x) => x.userId)).toEqual(['u4']);
  });

  it('casino_week excludes non-positive net', () => {
    const ctx = setup();
    set(ctx, 'u1', 'bj_net', -50, [scopeWeek(WEEK)]);
    set(ctx, 'u2', 'bj_net', 30, [scopeWeek(WEEK)]);
    expect(ids(ctx, 'casino_week', 'u1').order).toEqual(['u2']);
    expect(ids(ctx, 'casino_week', 'u1').me).toBeNull();
  });

  it('collection: species count', () => {
    const ctx = setup();
    const ins = ctx.db.prepare('INSERT INTO collection (user_id, species_id, first_caught_at, count) VALUES (?, ?, 1, 1)');
    const species = FISH.slice(0, 3).map((f) => f.id);
    for (const s of species) ins.run('u3', s);
    for (const s of species.slice(0, 2)) ins.run('u1', s);
    ins.run('u2', species[0]!);
    const r = ids(ctx, 'collection', 'u2');
    expect(r.order).toEqual(['u3', 'u1', 'u2']);
    expect(r.me?.rank).toBe(3);
    expect(r.board.rows[0]!.display).toContain(`/${FISH.length}`);
  });

  it('pass_level and boss_damage_season use the active season', () => {
    const ctx = setup();
    expect(getLeaderboard(ctx, 'pass_level').rows).toEqual([]);
    expect(getLeaderboard(ctx, 'boss_damage_season').rows).toEqual([]);
    ctx.db.prepare("INSERT INTO seasons (id, theme_id, name, starts_at, ends_at, status) VALUES (1, 'winter', 'Зима', 0, 1, 'ended'), (2, 'spring', 'Весна', 0, 9e15, 'active')").run();
    const sp = ctx.db.prepare('INSERT INTO season_pass (user_id, season_id, xp, level) VALUES (?, ?, ?, ?)');
    sp.run('u1', 2, 900, 3);
    sp.run('u2', 2, 950, 3);
    sp.run('u3', 2, 100, 1);
    sp.run('u4', 1, 9999, 30); // old season
    const p = ids(ctx, 'pass_level', 'u3');
    expect(p.order).toEqual(['u2', 'u1', 'u3']);
    expect(p.me?.rank).toBe(3);
    expect(p.board.subtitle).toBe('Весна');

    set(ctx, 'u4', 'boss_damage', 500, [scopeSeason(2)]);
    set(ctx, 'u1', 'boss_damage', 700, [scopeSeason(2)]);
    set(ctx, 'u2', 'boss_damage', 9000, [scopeSeason(1)]);
    expect(ids(ctx, 'boss_damage_season').order).toEqual(['u1', 'u4']);
  });

  it('level: level then xp', () => {
    const ctx = setup();
    updatePlayer(ctx, 'u1', { level: 5, xp: 10 });
    updatePlayer(ctx, 'u2', { level: 7, xp: 0 });
    updatePlayer(ctx, 'u3', { level: 5, xp: 40 });
    const r = ids(ctx, 'level', 'u4');
    expect(r.order).toEqual(['u2', 'u3', 'u1', 'u4']);
    expect(r.me?.rank).toBe(4);
    expect(r.board.rows[0]!.display).toContain('ур. 7');
  });
});

describe('weekly reset', () => {
  it('awards the previous week top-1 of each weekly category exactly once', () => {
    const ctx = setup();
    const w = scopeWeek(PREV);
    set(ctx, 'u1', 'heaviest_weight', 12, [w]);
    set(ctx, 'u2', 'heaviest_weight', 8, [w]);
    set(ctx, 'u1', 'coins_earned', 500, [w]);
    set(ctx, 'u3', 'coins_earned', 900, [w]);
    set(ctx, 'u2', 'rare_plus', 4, [w]);
    set(ctx, 'u4', 'bj_net', -10, [w]); // no positive casino result → no winner
    set(ctx, 'u4', 'coins_earned', 99_999, [scopeWeek(WEEK)]); // current week ignored

    weeklyJob.run(ctx);
    weeklyJob.run(ctx);
    expect(runWeeklyReset(ctx)).toBeNull();

    const p = BALANCE.weekly.winnerPearls;
    expect(getBalance(ctx, 'u1').pearls).toBe(p); // heaviest
    expect(getBalance(ctx, 'u3').pearls).toBe(p); // coins
    expect(getBalance(ctx, 'u2').pearls).toBe(p); // rare
    expect(getBalance(ctx, 'u4').pearls).toBe(0);

    // next Monday → the week that was current gets settled once
    ctx.clock.advance(7 * 86_400_000);
    const res = runWeeklyReset(ctx)!;
    expect(res.weekKey).toBe(WEEK);
    expect(res.categories.find((c) => c.category === 'coins_week')!.winner?.userId).toBe('u4');
    expect(getBalance(ctx, 'u4').pearls).toBe(p);
    expect(runWeeklyReset(ctx)).toBeNull();
  });
});
