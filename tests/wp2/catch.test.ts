import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/config/balance.js';
import { seededRng } from '../../src/core/rng.js';
import { FISH } from '../../src/data/fish.js';
import { RARITIES, type FishSpecies, type Rarity } from '../../src/data/types.js';
import {
  finalQuality,
  perfectWeight,
  rarityWeights,
  rollCast,
  rollQuality,
  rollSpecies,
  rollWeight,
  speciesPool,
  type RollContext,
} from '../../src/game/catch.js';

const F = BALANCE.fishing;

function sp(id: string, rarity: Rarity, extra: Partial<FishSpecies> = {}): FishSpecies {
  return { id, name: id, emoji: '🐟', rarity, locations: ['pond'], minWeight: 1, maxWeight: 3, basePrice: 10, description: '', ...extra };
}

// one species per rarity at the pond, plus filtered-out variants
const POOL: FishSpecies[] = [
  ...RARITIES.map((r) => sp(`p-${r}`, r)),
  sp('river-only', 'common', { locations: ['river'] }),
  sp('night-only', 'rare', { times: ['night'] }),
  sp('winter-only', 'epic', { seasonTheme: 'winter' }),
];

const RC: RollContext = { location: 'pond', timeOfDay: 'day', level: 100, seasonTheme: null, rarityBonus: 0, rarityMultiplier: 1 };

describe('species pool', () => {
  it('respects location, time of day, season and level', () => {
    const ids = (f: Partial<RollContext>) => speciesPool(POOL, { ...RC, ...f }).map((s) => s.id);
    expect(ids({})).not.toContain('river-only');
    expect(ids({})).not.toContain('night-only');
    expect(ids({ timeOfDay: 'night' })).toContain('night-only');
    expect(ids({})).not.toContain('winter-only');
    expect(ids({ seasonTheme: 'winter' })).toContain('winter-only');
    expect(ids({ seasonTheme: 'summer' })).not.toContain('winter-only');
    expect(ids({ location: 'river' })).toEqual(['river-only']);
    const low = ids({ level: 1 });
    expect(low).not.toContain('p-mythic');
    expect(low).not.toContain('p-legendary');
    expect(low).toContain('p-common');
    expect(ids({ level: F.rarityMinLevel.mythic })).toContain('p-mythic');
  });

  it('rolled species always satisfy the filters (real catalog)', () => {
    const rng = seededRng(7);
    for (let n = 0; n < 2000; n++) {
      const s = rollSpecies(rng, FISH, { ...RC, level: 3, timeOfDay: 'morning' });
      expect(s).not.toBeNull();
      expect(s!.locations).toContain('pond');
      expect(s!.seasonTheme).toBeUndefined();
      expect(!s!.times || s!.times.includes('morning')).toBe(true);
      expect(3 >= F.rarityMinLevel[s!.rarity]).toBe(true);
    }
  });
});

describe('rarity distribution', () => {
  it('100k rolls stay within ±10% of the configured odds', () => {
    const rng = seededRng(12345);
    const counts: Record<string, number> = {};
    const N = 100_000;
    for (let n = 0; n < N; n++) {
      const s = rollSpecies(rng, POOL, RC)!;
      counts[s.rarity] = (counts[s.rarity] ?? 0) + 1;
    }
    const total = RARITIES.reduce((a, r) => a + F.rarityWeights[r], 0);
    for (const r of RARITIES) {
      const expected = (N * F.rarityWeights[r]) / total;
      const tol = Math.max(0.1 * expected, 3 * Math.sqrt(expected)); // 3σ floor for the rarest tier (≈100 expected)
      expect(Math.abs((counts[r] ?? 0) - expected)).toBeLessThanOrEqual(tol);
    }
  });

  it('rod/bait bonus and bite hour boost rare+ weights only', () => {
    const base = Object.fromEntries(rarityWeights(RARITIES).map((w) => [w.item, w.weight]));
    const boosted = Object.fromEntries(rarityWeights(RARITIES, 0.5, 2).map((w) => [w.item, w.weight]));
    expect(boosted.common).toBe(base.common);
    expect(boosted.uncommon).toBe(base.uncommon);
    expect(boosted.rare).toBeCloseTo(base.rare! * 3);
    expect(boosted.mythic).toBeCloseTo(base.mythic! * 3);
  });

  it('bite hour roughly doubles the rare+ share in simulation', () => {
    const share = (mult: number) => {
      const rng = seededRng(99);
      let rare = 0;
      for (let n = 0; n < 50_000; n++) if (['rare', 'epic', 'legendary', 'mythic'].includes(rollSpecies(rng, POOL, { ...RC, rarityMultiplier: mult })!.rarity)) rare++;
      return rare / 50_000;
    };
    const a = share(1);
    const b = share(2);
    expect(b / a).toBeGreaterThan(1.7);
  });
});

describe('weight, quality, outcome', () => {
  it('weight within species range × (1 + reel bonus); perfect adds 10%', () => {
    const rng = seededRng(1);
    const s = sp('x', 'common', { minWeight: 2, maxWeight: 4 });
    for (let n = 0; n < 500; n++) {
      const w = rollWeight(rng, s, 0);
      expect(w).toBeGreaterThanOrEqual(2);
      expect(w).toBeLessThanOrEqual(4);
      const wb = rollWeight(rng, s, 0.5);
      expect(wb).toBeGreaterThanOrEqual(3);
      expect(wb).toBeLessThanOrEqual(6);
    }
    expect(perfectWeight(2)).toBe(2.2);
  });

  it('quality: base roll 1..5, +1 perfect, −1 per mistake, clamped', () => {
    const rng = seededRng(3);
    for (let n = 0; n < 500; n++) {
      const q = rollQuality(rng);
      expect(q).toBeGreaterThanOrEqual(1);
      expect(q).toBeLessThanOrEqual(5);
    }
    expect(finalQuality(3, true, 0)).toBe(4);
    expect(finalQuality(5, true, 0)).toBe(5);
    expect(finalQuality(3, false, 1)).toBe(2);
    expect(finalQuality(1, false, 2)).toBe(1);
  });

  it('junk and treasure rates follow the configured chances; heavy fish may snap the line', () => {
    const rng = seededRng(5);
    const N = 50_000;
    let junk = 0;
    let treasure = 0;
    let snaps = 0;
    let heavy = 0;
    const junkItems = [{ id: 'boot', name: 'Ботинок', emoji: '🥾', coins: 1 }];
    for (let n = 0; n < N; n++) {
      const o = rollCast(rng, { species: POOL, junk: junkItems, junkChance: 0.08, rc: RC, weightBonus: 0, maxWeight: 2 });
      if (o.kind === 'junk') junk++;
      else if (o.kind === 'treasure') {
        treasure++;
        expect(o.coins > 0 || (o.pearls >= 1 && o.pearls <= 3)).toBe(true);
      } else if (o.weight > 2) {
        heavy++;
        if (o.snap) snaps++;
      } else expect(o.snap).toBe(false);
    }
    expect(junk / N).toBeCloseTo(0.08, 2);
    expect(treasure / N).toBeCloseTo(F.treasureChance, 2);
    expect(snaps / heavy).toBeGreaterThan(0.45);
    expect(snaps / heavy).toBeLessThan(0.55);
  });
});
