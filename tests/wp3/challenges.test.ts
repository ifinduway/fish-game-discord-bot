import { afterEach, describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/config/balance.js';
import { CHALLENGE_TEMPLATES } from '../../src/data/challenges.js';
import type { ChallengeScope } from '../../src/data/types.js';
import { getBalance } from '../../src/db/repos/wallet.js';
import { eventToChallengeProgress, formatChallengeTitle, matchesParam, pickTemplates } from '../../src/game/challenges.js';
import { applyProgress, challengePassXp, dailyBonusClaimed, ensureChallenges, listChallenges } from '../../src/services/challenges.js';
import { registerPassXpHandler } from '../../src/services/rewards.js';
import { getPassProgress } from '../../src/services/season.js';
import { seededRng } from '../../src/core/rng.js';
import { createTestContext, seedPlayer } from '../helpers.js';
import { challengeRow, clearFixtureTemplates, fixtureTemplate, insertChallenge, registerWp3 } from './_fixtures.js';

const DAY = 86_400_000;

function poolSize(scope: ChallengeScope, level = 1): number {
  const unlock = BALANCE.locationUnlockLevels as Record<string, number>;
  return CHALLENGE_TEMPLATES.filter((t) => t.scope === scope && !(t.metric === 'cast_at_location' && t.param && (unlock[t.param] ?? 0) > level)).length;
}

afterEach(() => {
  clearFixtureTemplates();
  registerPassXpHandler(null);
});

describe('challenge generation', () => {
  it('creates 3 daily, 4 weekly and 10–15 seasonal challenges once per period', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    const created = ensureChallenges(ctx, 'u1');
    const list = listChallenges(ctx, 'u1');
    const count = (s: ChallengeScope) => list.filter((c) => c.scope === s).length;
    expect(count('daily')).toBe(Math.min(BALANCE.challenges.dailyCount, poolSize('daily')));
    expect(count('weekly')).toBe(Math.min(BALANCE.challenges.weeklyCount, poolSize('weekly')));
    const seasonal = count('seasonal');
    expect(seasonal).toBeGreaterThanOrEqual(Math.min(BALANCE.challenges.seasonalMin, poolSize('seasonal')));
    expect(seasonal).toBeLessThanOrEqual(BALANCE.challenges.seasonalMax);
    expect(created).toBe(list.length);
    for (const scope of ['daily', 'weekly', 'seasonal'] as const) {
      const ids = list.filter((c) => c.scope === scope).map((c) => c.templateId);
      expect(new Set(ids).size).toBe(ids.length);
    }
    for (const c of list) {
      const t = CHALLENGE_TEMPLATES.find((x) => x.id === c.templateId)!;
      expect(c.target).toBeGreaterThanOrEqual(Math.max(1, Math.min(...t.target)));
      expect(c.target).toBeLessThanOrEqual(Math.max(1, ...t.target));
      expect(c.param).toBe(t.param ?? null);
      expect(c.progress).toBe(0);
    }
    // idempotent
    expect(ensureChallenges(ctx, 'u1')).toBe(0);
    expect(listChallenges(ctx, 'u1').map((c) => c.id)).toEqual(list.map((c) => c.id));
  });

  it('new day → new dailies, same week keeps weekly; new week → new weekly', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    const first = listChallenges(ctx, 'u1');
    ctx.clock.advance(DAY);
    const second = listChallenges(ctx, 'u1');
    const ids = (l: typeof first, s: ChallengeScope) => l.filter((c) => c.scope === s).map((c) => c.id);
    if (poolSize('daily') > 0) expect(ids(second, 'daily')).not.toEqual(ids(first, 'daily'));
    expect(ids(second, 'weekly')).toEqual(ids(first, 'weekly'));
    expect(ids(second, 'seasonal')).toEqual(ids(first, 'seasonal'));
    ctx.clock.advance(7 * DAY);
    const third = listChallenges(ctx, 'u1');
    if (poolSize('weekly') > 0) expect(ids(third, 'weekly')).not.toEqual(ids(first, 'weekly'));
  });

  it('pickTemplates returns distinct templates and never more than the pool', () => {
    const pool = CHALLENGE_TEMPLATES.filter((t) => t.scope === 'daily');
    const picked = pickTemplates(seededRng(1), pool, 100);
    expect(picked).toHaveLength(pool.length);
    expect(new Set(picked.map((t) => t.id)).size).toBe(pool.length);
  });
});

describe('challenge progress & rewards', () => {
  it('completes once and grants reward + pass xp exactly once (double event does not double-grant)', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    const t = fixtureTemplate('wp3_w_catch', 'weekly', 'catch', { pearls: 12, coins: 30 });
    const id = insertChallenge(ctx, 'u1', t, 2);
    const events: string[] = [];
    ctx.bus.on('challenge_completed', (e) => void events.push(`${e.scope}:${e.templateId}`));

    expect(applyProgress(ctx, 'u1', 'catch', 1)).toEqual([]);
    expect(challengeRow(ctx, id)).toMatchObject({ progress: 1, completed_at: null });
    const notices = applyProgress(ctx, 'u1', 'catch', 1);
    expect(notices.some((n) => n.text.includes('Испытание выполнено'))).toBe(true);
    expect(challengeRow(ctx, id).completed_at).toBe(ctx.clock.now());
    expect(getBalance(ctx, 'u1')).toEqual({ coins: 30, pearls: 12 });
    expect(getPassProgress(ctx, 'u1')!.xp).toBe(BALANCE.passXp.weeklyChallenge);

    applyProgress(ctx, 'u1', 'catch', 5);
    applyProgress(ctx, 'u1', 'catch', 5);
    expect(challengeRow(ctx, id).progress).toBe(2);
    expect(getBalance(ctx, 'u1')).toEqual({ coins: 30, pearls: 12 });
    expect(getPassProgress(ctx, 'u1')!.xp).toBe(BALANCE.passXp.weeklyChallenge);
    expect(events).toEqual(['weekly:wp3_w_catch']);
    expect(challengePassXp(t)).toBe(BALANCE.passXp.weeklyChallenge);
  });

  it('respects params: location and weight', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    const loc = fixtureTemplate('wp3_d_loc', 'daily', 'cast_at_location', { coins: 1 }, { param: 'river' });
    const heavy = fixtureTemplate('wp3_d_heavy', 'daily', 'catch_heavier_than', { coins: 1 }, { param: '5' });
    const a = insertChallenge(ctx, 'u1', loc, 3);
    const b = insertChallenge(ctx, 'u1', heavy, 3);
    applyProgress(ctx, 'u1', 'cast_at_location', 1, { location: 'pond' });
    applyProgress(ctx, 'u1', 'cast_at_location', 1, { location: 'river' });
    applyProgress(ctx, 'u1', 'catch_heavier_than', 1, { weight: 4.9 });
    applyProgress(ctx, 'u1', 'catch_heavier_than', 1, { weight: 5.1 });
    expect(challengeRow(ctx, a).progress).toBe(1);
    expect(challengeRow(ctx, b).progress).toBe(1);
    expect(matchesParam('catch', 'river', {})).toBe(true);
    expect(formatChallengeTitle('Поймать {n} рыб тяжелее {param} кг', 3, '5')).toBe('Поймать 3 рыб тяжелее 5 кг');
  });

  it('all dailies done → bonus pearls exactly once', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    insertChallenge(ctx, 'u1', fixtureTemplate('wp3_d1', 'daily', 'catch', {}), 1);
    insertChallenge(ctx, 'u1', fixtureTemplate('wp3_d2', 'daily', 'perfect', {}), 1);
    insertChallenge(ctx, 'u1', fixtureTemplate('wp3_d3', 'daily', 'open_chest', {}), 1);
    applyProgress(ctx, 'u1', 'catch', 1);
    applyProgress(ctx, 'u1', 'perfect', 1);
    expect(getBalance(ctx, 'u1').pearls).toBe(0);
    expect(dailyBonusClaimed(ctx, 'u1')).toBe(false);
    const notices = applyProgress(ctx, 'u1', 'open_chest', 1);
    expect(notices.some((n) => n.text.includes('Все ежедневные'))).toBe(true);
    expect(getBalance(ctx, 'u1').pearls).toBe(BALANCE.challenges.allDailyBonusPearls);
    applyProgress(ctx, 'u1', 'open_chest', 1);
    applyProgress(ctx, 'u1', 'catch', 1);
    expect(getBalance(ctx, 'u1').pearls).toBe(BALANCE.challenges.allDailyBonusPearls);
    expect(dailyBonusClaimed(ctx, 'u1')).toBe(true);
  });

  it('daily blackjack challenge rewards coins, never pearls', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    const bj = CHALLENGE_TEMPLATES.find((t) => t.scope === 'daily' && t.metric === 'blackjack_hands');
    expect(bj, 'daily blackjack template exists').toBeDefined();
    expect(bj!.reward.pearls ?? 0).toBe(0);
    expect(bj!.reward.coins ?? 0).toBeGreaterThan(0);
    // a second unfinished daily keeps the all-dailies bonus out of the picture
    insertChallenge(ctx, 'u1', fixtureTemplate('wp3_d_other', 'daily', 'catch', {}), 99);
    const target = 3;
    const id = insertChallenge(ctx, 'u1', bj!, target);
    // direct service calls (not the bus) so catalog achievements on bj_hands cannot add pearls to the balance
    const [upd] = eventToChallengeProgress({ type: 'blackjack_finished', userId: 'u1', result: 'lose', net: -10, stakeType: 'coins' });
    for (let k = 0; k < target; k++) applyProgress(ctx, 'u1', upd!.metric, upd!.amount, upd!.meta);
    expect(challengeRow(ctx, id).completed_at).not.toBeNull();
    expect(getBalance(ctx, 'u1')).toEqual({ coins: bj!.reward.coins, pearls: 0 });
  });

  it('events drive progress through the subscriber (lazy generation included)', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    const d = insertChallenge(ctx, 'u1', fixtureTemplate('wp3_d_w', 'daily', 'total_weight', {}), 10);
    const w = insertChallenge(ctx, 'u1', fixtureTemplate('wp3_w_sell', 'weekly', 'sell_coins', {}), 1000);
    const s = insertChallenge(ctx, 'u1', fixtureTemplate('wp3_s_seasonal', 'seasonal', 'catch_seasonal', {}), 5);
    registerWp3(ctx);
    const fish = {
      type: 'fish_caught' as const,
      userId: 'u1',
      speciesId: 'x',
      rarity: 'common' as const,
      quality: 1,
      perfect: false,
      location: 'pond' as const,
      value: 1,
      firstOfSpecies: false,
    };
    ctx.bus.emit({ ...fish, weight: 2.5, seasonal: true }, ctx);
    ctx.bus.emit({ ...fish, weight: 1.75, seasonal: false }, ctx);
    ctx.bus.emit({ type: 'fish_sold', userId: 'u1', count: 3, coins: 250 }, ctx);
    expect(challengeRow(ctx, d).progress).toBeCloseTo(4.25);
    expect(challengeRow(ctx, w).progress).toBe(250);
    expect(challengeRow(ctx, s).progress).toBe(1);

    // a player who never opened /challenges gets them generated on the first event
    seedPlayer(ctx, 'u2');
    ctx.bus.emit({ type: 'cast', userId: 'u2', location: 'pond', energySpent: 8 }, ctx);
    const n = ctx.db.prepare("SELECT COUNT(*) AS n FROM challenges WHERE user_id = 'u2'").get() as { n: number };
    expect(n.n).toBeGreaterThan(0);
  });

  it('maps events to metrics', () => {
    const m = eventToChallengeProgress({
      type: 'fish_caught',
      userId: 'u',
      speciesId: 'x',
      rarity: 'legendary',
      weight: 12,
      quality: 5,
      perfect: true,
      location: 'sea',
      value: 1,
      firstOfSpecies: true,
      seasonal: true,
    }).map((u) => u.metric);
    expect(m).toEqual(['catch', 'catch_rare_plus', 'catch_epic_plus', 'perfect', 'catch_heavier_than', 'new_species', 'total_weight', 'catch_seasonal']);
    expect(eventToChallengeProgress({ type: 'gear_upgraded', userId: 'u', gearItemId: 1, level: 2 })[0]!.metric).toBe('upgrade_gear');
    expect(eventToChallengeProgress({ type: 'coins_spent', userId: 'u', amount: 40, reason: 'x' })[0]).toMatchObject({ metric: 'spend_coins', amount: 40 });
    expect(eventToChallengeProgress({ type: 'boss_damage', userId: 'u', bossId: 1, damage: 33 })[0]).toMatchObject({ metric: 'boss_damage', amount: 33 });
    expect(eventToChallengeProgress({ type: 'chest_opened', userId: 'u', chestId: 'wood', rewardRarity: 'rare' })[0]!.metric).toBe('open_chest');
  });
});
