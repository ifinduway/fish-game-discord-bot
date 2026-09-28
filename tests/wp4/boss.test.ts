import { describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../../src/config/balance.js';
import type { GameEvent } from '../../src/core/events.js';
import { dayKey } from '../../src/core/time.js';
import { BOSSES } from '../../src/data/bosses.js';
import type { LocationId } from '../../src/data/types.js';
import { hasCosmetic } from '../../src/db/repos/inventory.js';
import { getServerStat } from '../../src/db/repos/server-stats.js';
import { inc, scopeDay } from '../../src/db/repos/stats.js';
import { getBalance } from '../../src/db/repos/wallet.js';
import {
  BOSS_SLAYER_TITLE,
  bossSlotKey,
  computeBossDamage,
  computeBossMaxHp,
  distributeBossRewards,
  latestBossSlot,
  nextBossSlot,
  rewardTierFor,
} from '../../src/game/boss.js';
import bossJob from '../../src/scheduler/jobs/boss.js';
import {
  BossError,
  endBoss,
  expireDueBosses,
  finishBoss,
  getActiveBoss,
  getBoss,
  getUserContribution,
  listContributions,
  runScheduledBossSpawn,
  spawnBoss,
} from '../../src/services/boss.js';
import registerBoss from '../../src/subscribers/boss.js';
import { createTestContext, seedPlayer, type TestContext } from '../helpers.js';

const DEF = BOSSES[0]!;
const TZ = 'Europe/Moscow';
const HOUR = 3_600_000;

function catchEvent(userId: string, location: LocationId, weight: number, quality = 1, perfect = false): GameEvent {
  return { type: 'fish_caught', userId, speciesId: 'x', rarity: 'common', weight, quality, perfect, location, value: 1, firstOfSpecies: false, seasonal: false };
}

function setup(): TestContext {
  const ctx = createTestContext();
  registerBoss(ctx.bus);
  for (const u of ['u1', 'u2', 'u3', 'u4']) seedPlayer(ctx, u);
  return ctx;
}

describe('game/boss (pure)', () => {
  it('scales max hp by active players with a minimum', () => {
    expect(computeBossMaxHp(500, 0)).toBe(500 * BALANCE.boss.minPlayers);
    expect(computeBossMaxHp(500, 3)).toBe(500 * BALANCE.boss.minPlayers);
    expect(computeBossMaxHp(500, 12)).toBe(6000);
  });

  it('damage = (base + kg × perKg) × quality multiplier × perfect', () => {
    const b = BALANCE.boss;
    const qm = BALANCE.fishing.qualityMultipliers;
    expect(computeBossDamage({ weight: 2, quality: 1, perfect: false })).toBe(Math.round(b.damageBase + 2 * b.damagePerKg));
    expect(computeBossDamage({ weight: 2, quality: 3, perfect: true })).toBe(
      Math.round((b.damageBase + 2 * b.damagePerKg) * qm[2]! * b.perfectMultiplier),
    );
    expect(computeBossDamage({ weight: 0, quality: 1, perfect: false })).toBeGreaterThanOrEqual(1);
  });

  it('distributes tiers by share; top-1 is slayer; expired → consolation for all', () => {
    const d = distributeBossRewards(
      [
        { userId: 'b', damage: 50 },
        { userId: 'a', damage: 940 },
        { userId: 'c', damage: 10 },
        { userId: 'z', damage: 0 },
      ],
      'defeated',
    );
    expect(d.map((p) => p.userId)).toEqual(['a', 'b', 'c']);
    expect(d[0]!.slayer).toBe(true);
    expect(d[1]!.slayer).toBe(false);
    expect(d[0]!.reward.pearls).toBe(rewardTierFor(0.94).pearls);
    expect(d[1]!.reward.pearls).toBe(rewardTierFor(0.05).pearls);
    expect(d[2]!.reward.pearls).toBe(rewardTierFor(0.01).pearls);
    const e = distributeBossRewards([{ userId: 'a', damage: 5 }], 'expired');
    expect(e[0]!.reward).toEqual({ pearls: BALANCE.boss.consolationPearls, coins: BALANCE.boss.consolationCoins });
    expect(e[0]!.slayer).toBe(false);
  });

  it('computes schedule slots (Tue & Fri 18:00 Moscow)', () => {
    const mon = Date.UTC(2026, 0, 5, 9, 0); // Mon 12:00 MSK
    const tue18 = Date.UTC(2026, 0, 6, 15, 0);
    const fri18 = Date.UTC(2026, 0, 2, 15, 0);
    expect(nextBossSlot(mon, TZ)).toBe(tue18);
    expect(latestBossSlot(mon, TZ)).toBe(fri18);
    expect(latestBossSlot(tue18, TZ)).toBe(tue18);
    expect(bossSlotKey(tue18, TZ)).toBe('2026-01-06T18');
  });
});

describe('boss service', () => {
  it('spawn hp scales with players active in the last 7 days', () => {
    const ctx = setup();
    const now = ctx.clock.now();
    for (let n = 0; n < 8; n++) {
      // spread over the window; one of them outside the window (8 days ago) must not count
      const day = n === 7 ? 8 : n;
      inc(ctx, `p${n}`, 'casts', 1, [scopeDay(dayKey(now - day * 86_400_000, TZ))]);
    }
    const boss = spawnBoss(ctx, { bossDefId: DEF.id });
    expect(boss.max_hp).toBe(DEF.hpPerPlayer * 7);
    expect(boss.hp).toBe(boss.max_hp);
    expect(boss.location).toBe(DEF.location);
    expect(boss.expires_at).toBe(now + BALANCE.boss.durationHours * HOUR);
    expect(() => spawnBoss(ctx)).toThrow(BossError);
  });

  it('uses the minimum player count when few players are active', () => {
    const ctx = setup();
    const boss = spawnBoss(ctx, { bossDefId: DEF.id });
    expect(boss.max_hp).toBe(DEF.hpPerPlayer * BALANCE.boss.minPlayers);
  });

  it('damage accumulates; defeat happens exactly once with tiered rewards and the slayer title', async () => {
    const ctx = setup();
    const announce = vi.fn(async () => undefined);
    ctx.announce = announce;
    const events: string[] = [];
    ctx.bus.on('boss_damage', (e) => void events.push(`dmg:${e.userId}:${e.damage}`));
    ctx.bus.on('boss_finished', (e) => void events.push(`fin:${e.defeated}`));

    const boss = spawnBoss(ctx, { bossDefId: DEF.id });
    ctx.db.prepare('UPDATE bosses SET hp = 1000, max_hp = 1000 WHERE id = ?').run(boss.id);
    const loc = boss.location as LocationId;
    const other = (['pond', 'river', 'lake', 'sea', 'deep'] as LocationId[]).find((l) => l !== loc)!;

    ctx.bus.emit(catchEvent('u4', other, 50), ctx); // wrong location → no damage
    expect(getBoss(ctx, boss.id)!.hp).toBe(1000);

    const u3Dmg = computeBossDamage({ weight: 0, quality: 1, perfect: false });
    const u2Weight = (50 - BALANCE.boss.damageBase) / BALANCE.boss.damagePerKg;
    ctx.bus.emit(catchEvent('u3', loc, 0), ctx);
    ctx.bus.emit(catchEvent('u2', loc, u2Weight), ctx);
    let hits = 0;
    while (getBoss(ctx, boss.id)!.status === 'active' && hits < 100) {
      ctx.bus.emit(catchEvent('u1', loc, 10), ctx);
      hits++;
    }
    const after = getBoss(ctx, boss.id)!;
    expect(after.status).toBe('defeated');
    expect(after.hp).toBe(0);
    expect(after.rewarded).toBe(1);

    const contrib = listContributions(ctx, boss.id);
    expect(contrib.map((c) => c.userId)).toEqual(['u1', 'u2', 'u3']);
    expect(contrib.reduce((s, c) => s + c.damage, 0)).toBe(1000);
    expect(contrib[0]!.hits).toBe(hits);
    expect(contrib[2]!.damage).toBe(u3Dmg);
    expect(getUserContribution(ctx, boss.id, 'u2')).toMatchObject({ damage: 50, place: 2 });

    const t1 = rewardTierFor(contrib[0]!.damage / 1000);
    const t2 = rewardTierFor(0.05);
    const t3 = rewardTierFor(u3Dmg / 1000);
    expect(getBalance(ctx, 'u1')).toEqual({ coins: t1.coins, pearls: t1.pearls });
    expect(getBalance(ctx, 'u2')).toEqual({ coins: t2.coins, pearls: t2.pearls });
    expect(getBalance(ctx, 'u3')).toEqual({ coins: t3.coins, pearls: t3.pearls });
    expect(getBalance(ctx, 'u4')).toEqual({ coins: 0, pearls: 0 });
    expect(t1.pearls).toBeGreaterThan(t2.pearls);
    expect(t2.pearls).toBeGreaterThan(t3.pearls);
    expect(hasCosmetic(ctx, 'u1', BOSS_SLAYER_TITLE)).toBe(true);
    expect(hasCosmetic(ctx, 'u2', BOSS_SLAYER_TITLE)).toBe(false);
    expect(getServerStat(ctx, 'bosses_defeated')).toBe(1);

    // more catches / repeated finish / expiry do nothing
    ctx.bus.emit(catchEvent('u1', loc, 10), ctx);
    expect(finishBoss(ctx, boss.id, 'defeated')).toBeNull();
    ctx.clock.advance(30 * HOUR);
    expect(expireDueBosses(ctx)).toEqual([]);
    expect(getBalance(ctx, 'u1')).toEqual({ coins: t1.coins, pearls: t1.pearls });
    expect(getServerStat(ctx, 'bosses_defeated')).toBe(1);
    expect(events.filter((e) => e.startsWith('fin:'))).toEqual(['fin:true']);
    expect(events.filter((e) => e.startsWith('dmg:')).length).toBe(hits + 2);

    await new Promise((r) => setTimeout(r, 200));
    expect(announce).toHaveBeenCalled();
  });

  it('expiry grants the consolation exactly once', () => {
    const ctx = setup();
    const boss = spawnBoss(ctx, { bossDefId: DEF.id });
    ctx.bus.emit(catchEvent('u1', boss.location as LocationId, 1), ctx);
    ctx.bus.emit(catchEvent('u2', boss.location as LocationId, 1), ctx);
    ctx.clock.advance(BALANCE.boss.durationHours * HOUR + 60_000);
    // after expiry, catches deal no damage
    ctx.bus.emit(catchEvent('u3', boss.location as LocationId, 1), ctx);
    bossJob.run(ctx);
    bossJob.run(ctx);
    expect(getBoss(ctx, boss.id)!.status).toBe('expired');
    const consolation = { coins: BALANCE.boss.consolationCoins, pearls: BALANCE.boss.consolationPearls };
    expect(getBalance(ctx, 'u1')).toEqual(consolation);
    expect(getBalance(ctx, 'u2')).toEqual(consolation);
    expect(getBalance(ctx, 'u3')).toEqual({ coins: 0, pearls: 0 });
    expect(hasCosmetic(ctx, 'u1', BOSS_SLAYER_TITLE)).toBe(false);
    expect(getServerStat(ctx, 'bosses_defeated')).toBe(0);
    expect(finishBoss(ctx, boss.id, 'expired')).toBeNull();
    expect(getBalance(ctx, 'u1')).toEqual(consolation);
  });

  it('admin endBoss expires the active boss; throws when there is none', () => {
    const ctx = setup();
    expect(() => endBoss(ctx)).toThrow(BossError);
    const boss = spawnBoss(ctx, { bossDefId: DEF.id });
    ctx.bus.emit(catchEvent('u1', boss.location as LocationId, 1), ctx);
    endBoss(ctx);
    expect(getBoss(ctx, boss.id)!.status).toBe('expired');
    expect(getBalance(ctx, 'u1').pearls).toBe(BALANCE.boss.consolationPearls);
    expect(getActiveBoss(ctx)).toBeUndefined();
    expect(() => spawnBoss(ctx, { bossDefId: 'nope' })).toThrow(BossError);
  });

  it('scheduled spawn job is idempotent for the same slot', () => {
    const ctx = setup();
    const tue18 = Date.UTC(2026, 0, 6, 15, 0);
    ctx.clock.set(tue18 - 60_000);
    bossJob.run(ctx);
    expect(getActiveBoss(ctx)).toBeUndefined();

    ctx.clock.set(tue18 + 5 * 60_000);
    bossJob.run(ctx);
    bossJob.run(ctx);
    const rows = ctx.db.prepare('SELECT * FROM bosses').all() as { expires_at: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.expires_at).toBe(tue18 + BALANCE.boss.durationHours * HOUR);

    // ended early by admin → same slot must not respawn
    endBoss(ctx);
    ctx.clock.advance(10 * 60_000);
    expect(runScheduledBossSpawn(ctx)).toBeNull();
    bossJob.run(ctx);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM bosses').get()).toEqual({ n: 1 });

    // next slot (Friday) spawns a new one
    ctx.clock.set(Date.UTC(2026, 0, 9, 15, 1));
    bossJob.run(ctx);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM bosses').get()).toEqual({ n: 2 });
  });

  it('scheduled slot is retried while an admin boss is active, and skipped once the window passes', () => {
    const ctx = setup();
    const tue18 = Date.UTC(2026, 0, 6, 15, 0);
    ctx.clock.set(tue18 - HOUR);
    spawnBoss(ctx, { bossDefId: DEF.id }); // admin boss alive through 18:00
    ctx.clock.set(tue18 + 60_000);
    expect(runScheduledBossSpawn(ctx)).toBeNull();
    endBoss(ctx);
    ctx.clock.advance(60_000);
    expect(runScheduledBossSpawn(ctx)).not.toBeNull();

    const ctx2 = setup();
    ctx2.clock.set(tue18 + BALANCE.boss.durationHours * HOUR + 60_000);
    expect(runScheduledBossSpawn(ctx2)).toBeNull();
  });
});
