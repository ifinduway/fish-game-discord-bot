import { afterEach, describe, expect, it } from 'vitest';
import * as stats from '../../src/db/repos/stats.js';
import { getServerStat } from '../../src/db/repos/server-stats.js';
import { registerPassXpHandler } from '../../src/services/rewards.js';
import { ensureActiveSeason } from '../../src/services/season.js';
import registerStats from '../../src/subscribers/stats.js';
import { createTestContext, seedPlayer } from '../helpers.js';

const SCOPES = ['all', 'd:2026-01-05', 'w:2026-W02', 's:1'];

describe('stats subscriber', () => {
  afterEach(() => registerPassXpHandler(null));

  it('maps every event to its metrics in all default scopes', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    registerStats(ctx.bus);
    const u = 'u1';
    const bus = ctx.bus;
    bus.emit({ type: 'cast', userId: u, location: 'pond', energySpent: 8 }, ctx);
    bus.emit(
      { type: 'fish_caught', userId: u, speciesId: 'x', rarity: 'epic', weight: 3.5, quality: 3, perfect: true, location: 'pond', value: 10, firstOfSpecies: true, seasonal: false },
      ctx,
    );
    bus.emit(
      { type: 'fish_caught', userId: u, speciesId: 'y', rarity: 'common', weight: 1.25, quality: 1, perfect: false, location: 'pond', value: 2, firstOfSpecies: false, seasonal: false },
      ctx,
    );
    bus.emit({ type: 'fish_escaped', userId: u, reason: 'late' }, ctx);
    bus.emit({ type: 'junk_caught', userId: u, itemName: 'Ботинок' }, ctx);
    bus.emit({ type: 'treasure_found', userId: u, coins: 40, pearls: 2 }, ctx);
    bus.emit({ type: 'fish_sold', userId: u, count: 2, coins: 100 }, ctx);
    bus.emit({ type: 'coins_spent', userId: u, amount: 30, reason: 'shop' }, ctx);
    bus.emit({ type: 'chest_opened', userId: u, chestId: 'wood', rewardRarity: 'common' }, ctx);
    bus.emit({ type: 'boss_damage', userId: u, bossId: 9, damage: 50 }, ctx);
    bus.emit({ type: 'boss_damage', userId: u, bossId: 9, damage: 25 }, ctx);
    bus.emit({ type: 'blackjack_finished', userId: u, result: 'blackjack', net: 75, stakeType: 'coins' }, ctx);
    bus.emit({ type: 'blackjack_finished', userId: u, result: 'bust', net: -50, stakeType: 'coins' }, ctx);
    bus.emit({ type: 'blackjack_finished', userId: u, result: 'push', net: 0, stakeType: 'fish' }, ctx);
    bus.emit({ type: 'blackjack_finished', userId: u, result: 'win', net: 20, stakeType: 'coins' }, ctx);
    bus.emit({ type: 'daily_claimed', userId: u, streak: 2 }, ctx);

    const expected: Record<string, number> = {
      casts: 1,
      catches: 2,
      total_weight: 4.75,
      heaviest_weight: 3.5,
      catch_epic: 1,
      catch_common: 1,
      rare_plus: 1,
      epic_plus: 1,
      perfects: 1,
      new_species: 1,
      escapes: 1,
      junk: 1,
      coins_earned: 140,
      pearls_earned: 2,
      coins_spent: 30,
      chests_opened: 1,
      boss_damage: 75,
      bosses_joined: 1,
      bj_hands: 4,
      bj_wins: 2,
      bj_blackjacks: 1,
      bj_losses: 1,
      bj_pushes: 1,
      bj_net: 45,
      bj_biggest_win: 75,
      daily_claims: 1,
    };
    expect(ensureActiveSeason(ctx).id).toBe(1);
    for (const scope of SCOPES) {
      const all = stats.getAll(ctx, u, scope);
      for (const [metric, value] of Object.entries(expected)) expect([scope, metric, all[metric]]).toEqual([scope, metric, value]);
    }
    for (const scope of ['all', 'w:2026-W02']) {
      expect(getServerStat(ctx, 'casts', scope)).toBe(1);
      expect(getServerStat(ctx, 'catches', scope)).toBe(2);
      expect(getServerStat(ctx, 'total_weight', scope)).toBeCloseTo(4.75);
    }
  });

  it('counts bosses_joined once per boss', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    registerStats(ctx.bus);
    for (const bossId of [1, 1, 2, 2, 2]) ctx.bus.emit({ type: 'boss_damage', userId: 'u1', bossId, damage: 1 }, ctx);
    expect(stats.get(ctx, 'u1', 'bosses_joined')).toBe(2);
  });
});
