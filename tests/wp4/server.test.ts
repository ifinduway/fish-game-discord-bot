import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/config/balance.js';
import type { GameEvent } from '../../src/core/events.js';
import { FISH } from '../../src/data/fish.js';
import { rarityIndex } from '../../src/data/types.js';
import { set, scopeWeek } from '../../src/db/repos/stats.js';
import { getBalance } from '../../src/db/repos/wallet.js';
import { computeGoalTarget, ensureServerGoal, getPlayerStatsView, getServerGoal, getServerOverview, rewardServerGoal } from '../../src/services/server.js';
import registerGoal from '../../src/subscribers/server-goal.js';
import { createTestContext, seedPlayer } from '../helpers.js';

const WEEK = '2026-W02'; // Mon 2026-01-05 (test clock default)
const PREV = '2026-W01';

function fish(userId: string, weight: number): GameEvent {
  return { type: 'fish_caught', userId, speciesId: FISH[0]!.id, rarity: 'common', weight, quality: 1, perfect: false, location: 'pond', value: 1, firstOfSpecies: false, seasonal: false };
}

describe('weekly server goal', () => {
  it('target scales with active players (rounded)', () => {
    const g = BALANCE.serverGoal;
    expect(computeGoalTarget(0)).toBe(g.baseTarget);
    expect(computeGoalTarget(g.referencePlayers)).toBe(g.baseTarget);
    expect(computeGoalTarget(g.referencePlayers * 2.5)).toBe(g.baseTarget * 2.5);
    expect(computeGoalTarget(13) % g.targetRounding).toBe(0);
  });

  it('is created lazily for the current week', () => {
    const ctx = createTestContext();
    expect(getServerGoal(ctx, WEEK)).toBeUndefined();
    const goal = ensureServerGoal(ctx);
    expect(goal).toMatchObject({ week_key: WEEK, metric: BALANCE.serverGoal.metric, target: BALANCE.serverGoal.baseTarget, progress: 0, completed_at: null });
    expect(ensureServerGoal(ctx)).toEqual(goal);
  });

  it('completes once and rewards only players active this week', () => {
    const ctx = createTestContext();
    registerGoal(ctx.bus);
    for (const u of ['u1', 'u2', 'u3', 'u4']) seedPlayer(ctx, u);
    set(ctx, 'u1', 'casts', 3, [scopeWeek(WEEK)]);
    set(ctx, 'u2', 'casts', 1, [scopeWeek(WEEK)]);
    set(ctx, 'u3', 'casts', 9, [scopeWeek(PREV)]); // active only last week
    ensureServerGoal(ctx);
    ctx.db.prepare('UPDATE server_goals SET target = 100 WHERE week_key = ?').run(WEEK);

    ctx.bus.emit(fish('u1', 60), ctx);
    expect(getServerGoal(ctx, WEEK)!.completed_at).toBeNull();
    const notices = ctx.bus.emit(fish('u2', 50), ctx);
    const goal = getServerGoal(ctx, WEEK)!;
    expect(goal.progress).toBeCloseTo(110);
    expect(goal.completed_at).not.toBeNull();
    expect(goal.rewarded).toBe(1);
    expect(notices.some((n) => n.userId === 'u2')).toBe(true);

    const reward = { coins: BALANCE.serverGoal.rewardCoins, pearls: BALANCE.serverGoal.rewardPearls };
    expect(getBalance(ctx, 'u1')).toEqual(reward);
    expect(getBalance(ctx, 'u2')).toEqual(reward);
    expect(getBalance(ctx, 'u3')).toEqual({ coins: 0, pearls: 0 });
    expect(getBalance(ctx, 'u4')).toEqual({ coins: 0, pearls: 0 });

    // more progress / explicit re-reward → nothing more
    ctx.bus.emit(fish('u1', 500), ctx);
    expect(rewardServerGoal(ctx, WEEK)).toBeNull();
    expect(getBalance(ctx, 'u1')).toEqual(reward);
    expect(getServerGoal(ctx, WEEK)!.progress).toBeCloseTo(610);
  });
});

describe('overview & personal stats', () => {
  it('builds the /server overview (records, rarest, goal, active players)', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    seedPlayer(ctx, 'u2');
    set(ctx, 'u1', 'casts', 2, [scopeWeek(WEEK)]);
    const byRarity = [...FISH].sort((x, y) => rarityIndex(x.rarity) - rarityIndex(y.rarity));
    const [a, b] = [byRarity[0]!, byRarity[byRarity.length - 1]!]; // b is at least as rare as a
    ctx.db.prepare('INSERT INTO species_records (species_id, user_id, weight, caught_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)').run(a.id, 'u1', 3, 1, b.id, 'u2', 9, 2);
    ctx.db
      .prepare('INSERT INTO collection (user_id, species_id, first_caught_at, count, best_weight) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)')
      .run('u1', a.id, 10, 5, 3, 'u2', b.id, 20, 1, 9);
    ctx.db.prepare("INSERT INTO server_stats (scope, metric, value) VALUES ('all', 'catches', 6), ('all', 'bosses_defeated', 2)").run();
    const o = getServerOverview(ctx);
    expect(o.totals).toMatchObject({ catches: 6, bossesDefeated: 2 });
    expect(o.records.map((r) => r.userId)).toEqual(['u2', 'u1']);
    expect(o.week.activePlayers).toBe(1);
    expect(o.goal.week_key).toBe(WEEK);
    // b: higher rarity, or same rarity with fewer catches → rarest either way
    expect(o.rarest).toMatchObject({ speciesId: b.id, userId: 'u2' });
  });

  it('personal stats view: perfect rate, collection, records, rarity counters', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    set(ctx, 'u1', 'catches', 10);
    set(ctx, 'u1', 'perfects', 4);
    set(ctx, 'u1', 'catch_rare', 2);
    ctx.db.prepare('INSERT INTO collection (user_id, species_id, first_caught_at, count, best_weight) VALUES (?, ?, 1, 3, 2.5)').run('u1', FISH[0]!.id);
    const v = getPlayerStatsView(ctx, 'u1')!;
    expect(v.perfectRate).toBeCloseTo(0.4);
    expect(v.collection).toEqual({ caught: 1, total: FISH.length });
    expect(v.personalRecords[0]).toMatchObject({ speciesId: FISH[0]!.id, weight: 2.5, count: 3 });
    expect(v.byRarity.find((r) => r.rarity === 'rare')!.count).toBe(2);
    expect(getPlayerStatsView(ctx, 'ghost')).toBeNull();
  });
});
