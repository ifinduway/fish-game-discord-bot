import { describe, expect, it } from 'vitest';
import type { Rng } from '../../src/core/rng.js';
import { CHESTS, CHEST_BY_ID } from '../../src/data/chests.js';
import { rarityAtLeast, rarityIndex, type ChestDef, type CosmeticDef, type LootEntry } from '../../src/data/types.js';
import { listConsumables, listCosmetics, listGearItems } from '../../src/db/repos/inventory.js';
import { requirePlayer } from '../../src/db/repos/players.js';
import { getBalance } from '../../src/db/repos/wallet.js';
import { BALANCE } from '../../src/config/balance.js';
import { DEFAULT_CATALOGS, fallbackCoins, nextPityCounter, pityLeft, resolveLoot, rollChest } from '../../src/game/chest.js';
import { ChestError, chestOdds, openChests } from '../../src/services/chest.js';
import { createTestContext, seedPlayer } from '../helpers.js';

/** Rng that never rolls high: `weighted` always returns the lowest-rarity candidate, ints/picks take the minimum. */
function lowRng(): Rng {
  return {
    next: () => 0,
    int: (min) => min,
    float: (min) => min,
    pick: (arr) => arr[0]!,
    weighted: (items) => {
      const pos = items.filter((i) => i.weight > 0);
      return pos.reduce((best, it) =>
        rarityIndex((it.item as unknown as LootEntry).rarity) < rarityIndex((best.item as unknown as LootEntry).rarity) ? it : best,
      ).item;
    },
    chance: () => false,
  };
}

const FIXTURE_GOLD: ChestDef = {
  id: 'gold',
  name: 'Тестовый золотой',
  emoji: '🥇',
  price: 80,
  loot: [
    { weight: 90, rarity: 'rare', kind: 'coins', min: 10, max: 20 },
    { weight: 9, rarity: 'epic', kind: 'coins', min: 30, max: 40 },
    { weight: 1, rarity: 'legendary', kind: 'coins', min: 500, max: 500 },
  ],
  pity: { opens: 20, minRarity: 'legendary' },
};

describe('chest odds', () => {
  it('equal the configured weights for every chest', () => {
    for (const def of CHESTS) {
      const total = def.loot.reduce((s, e) => s + e.weight, 0);
      const odds = chestOdds(def);
      expect(odds).toHaveLength(def.loot.length);
      odds.forEach((o, n) => {
        expect(o.entry).toBe(def.loot[n]);
        expect(o.percent).toBeCloseTo((def.loot[n]!.weight / total) * 100, 10);
        expect(o.label.length).toBeGreaterThan(0);
      });
      expect(odds.reduce((s, o) => s + o.percent, 0)).toBeCloseTo(100, 8);
    }
  });

  it('gold/silver pity follows BALANCE', () => {
    expect(CHEST_BY_ID.gold.pity?.opens ?? BALANCE.chests.pity.gold.opens).toBeLessThanOrEqual(20);
    expect(CHEST_BY_ID.silver.pity?.opens ?? BALANCE.chests.pity.silver.opens).toBeLessThanOrEqual(15);
  });
});

describe('rollChest (pure)', () => {
  it('forces a legendary+ roll on the 20th open without a qualifying drop', () => {
    const rng = lowRng();
    let counter = 0;
    const rarities = [];
    for (let n = 1; n <= 20; n++) {
      const r = rollChest(FIXTURE_GOLD, counter, rng);
      rarities.push(r.entry.rarity);
      expect(r.forcedByPity).toBe(n === 20);
      counter = nextPityCounter(FIXTURE_GOLD, counter, r.entry.rarity);
    }
    expect(rarities.slice(0, 19).every((r) => r === 'rare')).toBe(true);
    expect(rarities[19]).toBe('legendary');
    expect(counter).toBe(0);
  });

  it('pityLeft counts down to the guarantee', () => {
    expect(pityLeft(FIXTURE_GOLD, 0)).toBe(20);
    expect(pityLeft(FIXTURE_GOLD, 19)).toBe(1);
    expect(pityLeft({ ...FIXTURE_GOLD, id: 'wood', pity: undefined }, 5)).toBeUndefined();
  });
});

describe('resolveLoot', () => {
  const cosmetics: CosmeticDef[] = [
    { id: 'fx_title_rare', type: 'title', name: 'Тест-титул', rarity: 'rare' },
    { id: 'fx_frame_common', type: 'frame', name: 'Тест-рамка', rarity: 'common' },
  ];
  const catalogs = { ...DEFAULT_CATALOGS, cosmetics };

  it('coins within [min,max]', () => {
    const ctx = createTestContext({ seed: 7 });
    for (let n = 0; n < 50; n++) {
      const r = resolveLoot({ weight: 1, rarity: 'common', kind: 'coins', min: 5, max: 9 }, ctx.rng);
      expect(r.reward.coins).toBeGreaterThanOrEqual(5);
      expect(r.reward.coins).toBeLessThanOrEqual(9);
    }
  });

  it('cosmetic falls back to the nearest lower tier, then to coins', () => {
    const rng = lowRng();
    const lower = resolveLoot({ weight: 1, rarity: 'epic', kind: 'cosmetic', cosmeticType: 'title', tier: 'legendary' }, rng, new Set(), catalogs);
    expect(lower.reward.cosmetics).toEqual(['fx_title_rare']);
    const none = resolveLoot({ weight: 1, rarity: 'epic', kind: 'cosmetic', cosmeticType: 'background', tier: 'epic' }, rng, new Set(), catalogs);
    expect(none.kind).toBe('coins');
    expect(none.reward.coins).toBe(fallbackCoins('epic'));
  });

  it('owned cosmetic becomes duplicate coins', () => {
    const r = resolveLoot(
      { weight: 1, rarity: 'rare', kind: 'cosmetic', cosmeticType: 'title', tier: 'rare' },
      lowRng(),
      new Set(['fx_title_rare']),
      catalogs,
    );
    expect(r.duplicate).toBe(true);
    expect(r.reward).toEqual({ coins: fallbackCoins('rare') });
  });

  it('gear picks a GEAR of the tier (any slot)', () => {
    const gear = DEFAULT_CATALOGS.gear[0];
    if (!gear) return;
    const r = resolveLoot({ weight: 1, rarity: gear.tier, kind: 'gear', tier: gear.tier }, createTestContext().rng);
    expect(r.kind).toBe('gear');
    expect(DEFAULT_CATALOGS.gear.find((g) => g.id === r.reward.gear![0])!.tier).toBe(gear.tier);
  });
});

describe('openChests (service)', () => {
  it('pity forces legendary+ by the 20th gold open and then resets', () => {
    const ctx = createTestContext();
    const gold = CHEST_BY_ID.gold;
    const pity = gold.pity ?? BALANCE.chests.pity.gold;
    seedPlayer(ctx, 'u1', { pearls: gold.price * (pity.opens + 1) });
    ctx.rng = lowRng();
    const drops: string[] = [];
    for (let n = 1; n <= pity.opens; n++) {
      const res = openChests(ctx, 'u1', 'gold', 1);
      drops.push(res.rewards[0]!.rarity);
      if (rarityAtLeast(res.rewards[0]!.rarity, pity.minRarity)) break;
      expect(requirePlayer(ctx, 'u1').pity_gold).toBe(n);
    }
    expect(drops.some((r) => rarityAtLeast(r as never, pity.minRarity))).toBe(true);
    expect(drops.length).toBeLessThanOrEqual(pity.opens);
    // reset after the qualifying drop
    expect(requirePlayer(ctx, 'u1').pity_gold).toBe(0);
    const next = openChests(ctx, 'u1', 'gold', 1);
    if (!rarityAtLeast(next.rewards[0]!.rarity, pity.minRarity)) expect(requirePlayer(ctx, 'u1').pity_gold).toBe(1);
    expect(next.pity?.left).toBe(pity.opens - requirePlayer(ctx, 'u1').pity_gold);
  });

  it('insufficient pearls → ChestError and no state change', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { pearls: CHEST_BY_ID.silver.price - 1, coins: 5 });
    const before = {
      bal: getBalance(ctx, 'u1'),
      p: requirePlayer(ctx, 'u1'),
      gear: listGearItems(ctx, 'u1'),
      cos: listCosmetics(ctx, 'u1'),
      items: listConsumables(ctx, 'u1'),
    };
    const events: unknown[] = [];
    ctx.bus.on('chest_opened', (e) => void events.push(e));
    expect(() => openChests(ctx, 'u1', 'silver', 1)).toThrow(ChestError);
    expect(() => openChests(ctx, 'u1', 'wood', 5)).toThrow(/жемчуга/);
    expect(getBalance(ctx, 'u1')).toEqual(before.bal);
    expect(requirePlayer(ctx, 'u1')).toEqual(before.p);
    expect(listGearItems(ctx, 'u1')).toEqual(before.gear);
    expect(listCosmetics(ctx, 'u1')).toEqual(before.cos);
    expect(listConsumables(ctx, 'u1')).toEqual(before.items);
    expect(events).toHaveLength(0);
  });

  it('multi-open spends price × count, returns count rewards and emits one event per chest', () => {
    const ctx = createTestContext({ seed: 3 });
    const wood = CHEST_BY_ID.wood;
    seedPlayer(ctx, 'u1', { pearls: wood.price * 5 + 7 });
    const events: { chestId: string }[] = [];
    ctx.bus.on('chest_opened', (e) => void events.push(e));
    const res = openChests(ctx, 'u1', 'wood', 5);
    expect(res.pearlsSpent).toBe(wood.price * 5);
    expect(res.pearlsLeft).toBe(7);
    expect(getBalance(ctx, 'u1').pearls).toBe(7);
    expect(res.rewards).toHaveLength(5);
    expect(events).toHaveLength(5);
    expect(events.every((e) => e.chestId === 'wood')).toBe(true);
  });

  it('rejects counts outside 1..maxOpenCount', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { pearls: 10_000 });
    expect(() => openChests(ctx, 'u1', 'wood', 0)).toThrow(ChestError);
    expect(() => openChests(ctx, 'u1', 'wood', BALANCE.chests.maxOpenCount + 1)).toThrow(ChestError);
    expect(getBalance(ctx, 'u1').pearls).toBe(10_000);
  });

  it('many seeded opens never fail and pity counters stay within bounds', () => {
    const ctx = createTestContext({ seed: 99 });
    seedPlayer(ctx, 'u1', { pearls: 100_000 });
    for (let n = 0; n < 40; n++) {
      openChests(ctx, 'u1', 'silver', 5);
      openChests(ctx, 'u1', 'gold', 5);
      openChests(ctx, 'u1', 'wood', 5);
      const p = requirePlayer(ctx, 'u1');
      expect(p.pity_silver).toBeLessThan((CHEST_BY_ID.silver.pity ?? BALANCE.chests.pity.silver).opens);
      expect(p.pity_gold).toBeLessThan((CHEST_BY_ID.gold.pity ?? BALANCE.chests.pity.gold).opens);
    }
  });
});
