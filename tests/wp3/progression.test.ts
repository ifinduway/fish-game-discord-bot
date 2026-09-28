import { afterEach, describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../../src/config/balance.js';
import type { AnnouncePayload } from '../../src/core/context.js';
import { ACHIEVEMENTS } from '../../src/data/achievements.js';
import { COSMETICS } from '../../src/data/cosmetics.js';
import { GEAR } from '../../src/data/gear.js';
import { PASS_REWARDS } from '../../src/data/pass.js';
import type { AchievementDef } from '../../src/data/types.js';
import { addCaughtFish, addGearItem, hasCosmetic, listCaughtFish, listCosmetics, listGearItems } from '../../src/db/repos/inventory.js';
import * as stats from '../../src/db/repos/stats.js';
import { getBalance } from '../../src/db/repos/wallet.js';
import { passLevelInfo, themeForSeasonNumber } from '../../src/game/pass.js';
import { checkAchievements, listAchievements } from '../../src/services/achievements.js';
import { grantReward, registerPassXpHandler } from '../../src/services/rewards.js';
import {
  addPassXp,
  ensureActiveSeason,
  getActiveSeason,
  getPassProgress,
  getSeason,
  seasonBadgeId,
  seasonTitleId,
} from '../../src/services/season.js';
import seasonJob from '../../src/scheduler/jobs/season.js';
import { createTestContext, seedPlayer } from '../helpers.js';
import { clearFixtureTemplates, registerWp3 } from './_fixtures.js';

const fixtures: AchievementDef[] = [];
function fixtureAchievement(def: AchievementDef): AchievementDef {
  ACHIEVEMENTS.push(def);
  fixtures.push(def);
  return def;
}

afterEach(() => {
  for (const f of fixtures.splice(0)) ACHIEVEMENTS.splice(ACHIEVEMENTS.indexOf(f), 1);
  clearFixtureTemplates();
  registerPassXpHandler(null);
});

describe('achievements', () => {
  it('grants each tier (reward + title) exactly once', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    const title = COSMETICS.find((c) => c.type === 'title')!;
    fixtureAchievement({
      id: 'wp3_ach',
      name: 'Тест',
      stat: 'wp3_metric',
      tiers: [
        { threshold: 2, reward: { coins: 10 } },
        { threshold: 5, reward: { pearls: 3 }, title: title.id },
      ],
    });
    stats.inc(ctx, 'u1', 'wp3_metric', 1, ['all']);
    expect(checkAchievements(ctx, 'u1', ['wp3_metric'])).toEqual([]);
    stats.inc(ctx, 'u1', 'wp3_metric', 1, ['all']);
    expect(checkAchievements(ctx, 'u1', ['wp3_metric'])).toHaveLength(1);
    expect(checkAchievements(ctx, 'u1', ['wp3_metric'])).toEqual([]);
    expect(getBalance(ctx, 'u1')).toEqual({ coins: 10, pearls: 0 });
    stats.inc(ctx, 'u1', 'wp3_metric', 10, ['all']);
    checkAchievements(ctx, 'u1');
    checkAchievements(ctx, 'u1');
    expect(getBalance(ctx, 'u1')).toEqual({ coins: 10, pearls: 3 });
    expect(hasCosmetic(ctx, 'u1', title.id)).toBe(true);
    expect(listAchievements(ctx, 'u1').find((a) => a.id === 'wp3_ach')).toMatchObject({ tier: 2, maxTier: 2, next: null });
  });

  it('is triggered by the stats subscriber after counters are written (load order safe)', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    fixtureAchievement({ id: 'wp3_casts', name: 'Забросы', stat: 'casts', tiers: [{ threshold: 2, reward: {} }] });
    registerWp3(ctx);
    ctx.bus.emit({ type: 'cast', userId: 'u1', location: 'pond', energySpent: 8 }, ctx);
    const row = () => ctx.db.prepare("SELECT tier FROM achievements WHERE user_id = 'u1' AND achievement_id = 'wp3_casts'").all();
    expect(row()).toEqual([]);
    const notices = ctx.bus.emit({ type: 'cast', userId: 'u1', location: 'pond', energySpent: 8 }, ctx);
    expect(row()).toEqual([{ tier: 1 }]);
    expect(notices.some((n) => n.text.includes('Забросы'))).toBe(true);
  });
});

describe('season pass', () => {
  it('level-ups grant PASS_REWARDS and emit pass_level_up', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    seedPlayer(ctx, 'ref');
    const season = ensureActiveSeason(ctx);
    const events: number[] = [];
    ctx.bus.on('pass_level_up', (e) => void events.push(e.level));
    const per = BALANCE.pass.xpPerLevel;

    expect(addPassXp(ctx, 'u1', per - 1)).toEqual([]);
    expect(getPassProgress(ctx, 'u1')).toMatchObject({ seasonId: season.id, level: 0, xp: per - 1, xpIntoLevel: per - 1, xpToNext: per });
    const notices = addPassXp(ctx, 'u1', per + 1); // → level 2
    expect(events).toEqual([1, 2]);
    expect(notices.filter((n) => n.text.includes('Уровень пасса'))).toHaveLength(2);
    expect(getPassProgress(ctx, 'u1')).toMatchObject({ level: 2, xp: 2 * per, xpIntoLevel: 0 });

    // same rewards granted to a reference player give the same balance
    for (const l of [1, 2]) grantReward(ctx, 'ref', PASS_REWARDS.find((p) => p.level === l)!.reward, 'ref');
    expect(getBalance(ctx, 'u1')).toEqual(getBalance(ctx, 'ref'));
    expect(stats.get(ctx, 'u1', 'pass_xp', stats.scopeSeason(season.id))).toBe(2 * per);

    // max level caps
    addPassXp(ctx, 'u1', per * BALANCE.pass.levels * 2);
    expect(getPassProgress(ctx, 'u1')).toMatchObject({ level: BALANCE.pass.levels, xpToNext: 0 });
    expect(events).toHaveLength(BALANCE.pass.levels);
  });

  it('Reward.passXp works through the registered handler; subscribers give cast/catch/boss xp', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    registerWp3(ctx);
    grantReward(ctx, 'u1', { passXp: 7 }, 'test');
    expect(getPassProgress(ctx, 'u1')!.xp).toBe(7);
    ctx.bus.emit({ type: 'cast', userId: 'u1', location: 'pond', energySpent: 8 }, ctx);
    ctx.bus.emit(
      { type: 'fish_caught', userId: 'u1', speciesId: 'x', rarity: 'rare', weight: 1, quality: 1, perfect: false, location: 'pond', value: 1, firstOfSpecies: false, seasonal: false },
      ctx,
    );
    ctx.bus.emit({ type: 'boss_damage', userId: 'u1', bossId: 3, damage: 10 }, ctx);
    ctx.bus.emit({ type: 'boss_damage', userId: 'u1', bossId: 3, damage: 10 }, ctx);
    const px = BALANCE.passXp;
    // challenge completions may add xp too (catalog challenges generated lazily), so compare the minimum
    expect(getPassProgress(ctx, 'u1')!.xp).toBeGreaterThanOrEqual(7 + px.cast + px.catchByRarity.rare + px.bossParticipation);
    const before = getPassProgress(ctx, 'u1')!.xp;
    ctx.bus.emit({ type: 'boss_damage', userId: 'u1', bossId: 3, damage: 10 }, ctx);
    expect(getPassProgress(ctx, 'u1')!.xp - before).toBeLessThan(px.bossParticipation);
  });

  it('pure helpers', () => {
    expect(['winter', 'spring', 'summer', 'autumn', 'winter'].map((_, i) => themeForSeasonNumber(i + 1))).toEqual(['winter', 'spring', 'summer', 'autumn', 'winter']);
    expect(passLevelInfo(0)).toMatchObject({ level: 0, xpIntoLevel: 0 });
  });
});

describe('season lifecycle', () => {
  it('creates season 1 (winter, 4 weeks) on first run', async () => {
    const ctx = createTestContext();
    expect(getActiveSeason(ctx)).toBeNull();
    await seasonJob.run(ctx);
    const s = getActiveSeason(ctx)!;
    expect(s).toMatchObject({ id: 1, themeId: 'winter', startsAt: ctx.clock.now() });
    // 2026-01-05 12:00 MSK + 28 days → ends at local midnight 2026-02-02 00:00 MSK
    expect(s.endsAt).toBe(Date.UTC(2026, 1, 1, 21, 0, 0));
    await seasonJob.run(ctx);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM seasons').get()).toEqual({ n: 1 });
  });

  it('rollover: top-3 get title + badge, next season with next theme, nothing else wiped, idempotent', async () => {
    const ctx = createTestContext();
    const announced: AnnouncePayload[] = [];
    ctx.announce = vi.fn(async (p: AnnouncePayload) => void announced.push(p));
    const users = ['a', 'b', 'c', 'd'];
    for (const u of users) seedPlayer(ctx, u, { coins: 500, pearls: 40 });
    const s1 = ensureActiveSeason(ctx);
    const scope = stats.scopeSeason(s1.id);
    // pass xp: a > b > c > d ; boss damage: d > c > b > a (d wins here) ; weight: only a
    users.forEach((u, i) => addPassXp(ctx, u, 1000 - i * 100));
    users.forEach((u, i) => stats.inc(ctx, u, 'boss_damage', 10 + i, [scope]));
    stats.inc(ctx, 'a', 'total_weight', 50, [scope]);
    const gear = GEAR[0]!;
    addGearItem(ctx, 'd', gear.id, ctx.clock.now());
    addCaughtFish(ctx, { userId: 'd', speciesId: 'x', weight: 1, quality: 1, value: 5, location: 'pond', caughtAt: ctx.clock.now() });
    ctx.db.prepare("INSERT INTO collection (user_id, species_id, first_caught_at, count) VALUES ('d', 'x', 0, 1)").run();
    const balancesBefore = users.map((u) => getBalance(ctx, u));

    await seasonJob.run(ctx); // not due yet
    expect(getActiveSeason(ctx)!.id).toBe(s1.id);

    ctx.clock.set(s1.endsAt + 60_000);
    await seasonJob.run(ctx);
    await seasonJob.run(ctx); // idempotent

    expect(getSeason(ctx, s1.id)!.status).toBe('ended');
    const s2 = getActiveSeason(ctx)!;
    expect(s2.id).toBe(2);
    expect(s2.themeId).toBe('spring');
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM seasons').get()).toEqual({ n: 2 });

    const title = seasonTitleId(1);
    const badge = seasonBadgeId('winter');
    // pass top-3: a b c; boss top-3: d c b; weight: a → everybody is a winner in some category
    for (const u of ['a', 'b', 'c', 'd']) {
      expect(hasCosmetic(ctx, u, title)).toBe(true);
      expect(hasCosmetic(ctx, u, badge)).toBe(true);
    }
    expect(listCosmetics(ctx, 'a').filter((c) => c.cosmetic_id === title)).toHaveLength(1);

    // nothing else wiped
    expect(users.map((u) => getBalance(ctx, u))).toEqual(balancesBefore);
    expect(listGearItems(ctx, 'd').map((g) => g.gear_id)).toEqual([gear.id]);
    expect(listCaughtFish(ctx, 'd')).toHaveLength(1);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM collection WHERE user_id = 'd'").get()).toEqual({ n: 1 });
    // pass for the new season starts at 0; the old season keeps its history
    expect(getPassProgress(ctx, 'a')).toMatchObject({ seasonId: 2, level: 0, xp: 0 });
    expect(getPassProgress(ctx, 'a', 1)!.xp).toBe(1000);

    expect(announced).toHaveLength(1);
    expect(announced[0]!.title).toContain(s1.name);
    expect(announced[0]!.file?.data.subarray(1, 4).toString()).toBe('PNG');
  });

  it('only top-3 per category are rewarded', async () => {
    const ctx = createTestContext();
    const users = ['a', 'b', 'c', 'd', 'e'];
    for (const u of users) seedPlayer(ctx, u);
    const s1 = ensureActiveSeason(ctx);
    users.forEach((u, i) => addPassXp(ctx, u, 500 - i * 50));
    ctx.clock.set(s1.endsAt);
    await seasonJob.run(ctx);
    expect(users.map((u) => hasCosmetic(ctx, u, seasonTitleId(1)))).toEqual([true, true, true, false, false]);
  });
});
