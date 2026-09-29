import { afterEach, describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/config/balance.js';
import type { GameEvent } from '../../src/core/events.js';
import { GEAR } from '../../src/data/gear.js';
import type { GearDef } from '../../src/data/types.js';
import { getEquippedItems, listGearItems } from '../../src/db/repos/inventory.js';
import { getBalance } from '../../src/db/repos/wallet.js';
import { aggregateStats, lineMistakeBonus, upgradeCost, upgradedStats } from '../../src/game/gear-stats.js';
import { clearSessions } from '../../src/services/fishing.js';
import { ensurePlayerReady, getPlayerState, starterGear } from '../../src/services/player-state.js';
import { buy, equipGear, upgradeGear } from '../../src/services/shop.js';
import { createTestContext, seedPlayer } from '../helpers.js';

afterEach(() => clearSessions());

const rod: GearDef = { id: 't-rod', slot: 'rod', tier: 'rare', name: 'R', emoji: '🎣', stats: { rarityBonus: 0.1, biteWindowMs: 400 }, unlockLevel: 1 };
const line: GearDef = { id: 't-line', slot: 'line', tier: 'rare', name: 'L', emoji: '🧵', stats: { reelMistakes: 1, maxWeight: 20 }, unlockLevel: 1 };

describe('gear stats (pure)', () => {
  it('upgrade adds +10% to every numeric stat per level', () => {
    expect(upgradedStats(rod.stats, 0)).toEqual({ rarityBonus: 0.1, biteWindowMs: 400 });
    expect(upgradedStats(rod.stats, 1)).toEqual({ rarityBonus: 0.11, biteWindowMs: 440 });
    expect(upgradedStats(rod.stats, 5)).toEqual({ rarityBonus: 0.15, biteWindowMs: 600 });
  });

  it('aggregates equipped items; missing line → base max weight', () => {
    const s = aggregateStats([{ def: rod, upgrade: 2 }, { def: line, upgrade: 0 }]);
    expect(s.rarityBonus).toBeCloseTo(0.12);
    expect(s.biteWindowMs).toBe(480);
    expect(s.maxWeight).toBe(20);
    expect(lineMistakeBonus(s)).toBe(1);
    expect(aggregateStats([{ def: rod, upgrade: 0 }]).maxWeight).toBe(BALANCE.fishing.baseLineMaxWeight);
  });

  it('upgrade cost grows exponentially and stops at +5', () => {
    const base = BALANCE.upgrade.baseCost.rare;
    expect(upgradeCost('rare', 0)).toBe(base);
    expect(upgradeCost('rare', 1)).toBe(base * 2);
    expect(upgradeCost('rare', 4)).toBe(base * 16);
    expect(upgradeCost('rare', 5)).toBeNull();
  });
});

describe('gear services', () => {
  it('grants & equips the cheapest common item of every slot once', () => {
    const ctx = createTestContext();
    ensurePlayerReady(ctx, 'u1');
    ensurePlayerReady(ctx, 'u1');
    const kit = starterGear();
    const eq = getEquippedItems(ctx, 'u1');
    for (const slot of ['rod', 'reel', 'line', 'outfit'] as const) {
      if (!kit[slot]) continue;
      expect(eq[slot]?.gear_id).toBe(kit[slot]!.id);
    }
    expect(listGearItems(ctx, 'u1')).toHaveLength(Object.keys(kit).length);
  });

  it('equip switches the slot; foreign items are refused', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { coins: 100_000 });
    ensurePlayerReady(ctx, 'u2');
    const better = GEAR.find((g) => g.slot === 'rod' && g.tier === 'uncommon' && g.shopPrice)!;
    ctx.db.prepare('UPDATE players SET level = 50 WHERE user_id = ?').run('u1');
    expect(buy(ctx, 'u1', better.id).ok).toBe(true);
    const item = listGearItems(ctx, 'u1').find((g) => g.gear_id === better.id)!;
    const r = equipGear(ctx, 'u1', item.id);
    expect(r.ok).toBe(true);
    expect(getPlayerState(ctx, 'u1').stats.rarityBonus).toBeCloseTo(better.stats.rarityBonus ?? 0, 4);
    expect(equipGear(ctx, 'u1', item.id)).toEqual({ ok: false, reason: 'already' });
    const foreign = listGearItems(ctx, 'u2')[0]!;
    expect(equipGear(ctx, 'u1', foreign.id)).toEqual({ ok: false, reason: 'not_owned' });
  });

  it('upgrade spends coins, scales stats, emits events, refuses at max and without funds', () => {
    const ctx = createTestContext();
    const events: GameEvent[] = [];
    ctx.bus.on('gear_upgraded', (e) => void events.push(e));
    ctx.bus.on('coins_spent', (e) => void events.push(e));
    seedPlayer(ctx, 'u1', { coins: 1_000_000 });
    ensurePlayerReady(ctx, 'u1');
    const before = getPlayerState(ctx, 'u1');
    const rodEq = before.equipped.find((e) => e.slot === 'rod')!;
    const def = GEAR.find((g) => g.id === rodEq.gearId)!;
    let spent = 0;
    for (let lvl = 0; lvl < 5; lvl++) {
      const r = upgradeGear(ctx, 'u1', 'rod');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.level).toBe(lvl + 1);
        expect(r.cost).toBe(upgradeCost(def.tier, lvl));
        spent += r.cost;
      }
    }
    expect(getBalance(ctx, 'u1').coins).toBe(1_000_000 - spent);
    expect(upgradeGear(ctx, 'u1', 'rod')).toMatchObject({ ok: false, reason: 'max' });
    expect(getPlayerState(ctx, 'u1').stats.biteWindowMs).toBeCloseTo((def.stats.biteWindowMs ?? 0) * 1.5, 3);
    expect(events.filter((e) => e.type === 'gear_upgraded')).toHaveLength(5);
    expect(events.filter((e) => e.type === 'coins_spent')).toHaveLength(5);

    const poor = createTestContext();
    ensurePlayerReady(poor, 'p');
    const r = upgradeGear(poor, 'p', 'reel');
    expect(r).toMatchObject({ ok: false, reason: 'funds', available: 0 });
    expect(getBalance(poor, 'p').coins).toBe(0);
  });
});
