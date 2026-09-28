import { describe, expect, it } from 'vitest';
import { RARITIES } from '../../src/data/types.js';
import { FISH, FISH_BY_ID, JUNK_ITEMS } from '../../src/data/fish.js';
import { LOCATIONS, LOCATION_BY_ID } from '../../src/data/locations.js';
import { GEAR, GEAR_BY_ID } from '../../src/data/gear.js';
import { CONSUMABLES, CONSUMABLE_BY_ID } from '../../src/data/consumables.js';
import { CHESTS, CHEST_BY_ID } from '../../src/data/chests.js';
import { COSMETICS, COSMETIC_BY_ID, getCosmetic } from '../../src/data/cosmetics.js';
import { CHALLENGE_TEMPLATES, CHALLENGE_BY_ID } from '../../src/data/challenges.js';
import { ACHIEVEMENTS } from '../../src/data/achievements.js';
import { SEASON_THEMES, SEASON_THEME_BY_ID } from '../../src/data/seasons.js';
import { PASS_REWARDS } from '../../src/data/pass.js';
import { BOSSES, BOSS_BY_ID } from '../../src/data/bosses.js';
import { SHOP_LISTINGS } from '../../src/data/shop.js';
import { BALANCE } from '../../src/config/balance.js';

function assertUniqueIds<T extends { id: string | number }>(items: T[], label: string) {
  const ids = items.map((i) => i.id);
  expect(new Set(ids).size, `${label} ids must be unique`).toBe(ids.length);
}

describe('catalog id uniqueness', () => {
  it('every catalog has unique ids', () => {
    assertUniqueIds(FISH, 'FISH');
    assertUniqueIds(JUNK_ITEMS, 'JUNK_ITEMS');
    assertUniqueIds(LOCATIONS, 'LOCATIONS');
    assertUniqueIds(GEAR, 'GEAR');
    assertUniqueIds(CONSUMABLES, 'CONSUMABLES');
    assertUniqueIds(CHESTS, 'CHESTS');
    assertUniqueIds(COSMETICS, 'COSMETICS');
    assertUniqueIds(CHALLENGE_TEMPLATES, 'CHALLENGE_TEMPLATES');
    assertUniqueIds(ACHIEVEMENTS, 'ACHIEVEMENTS');
    assertUniqueIds(SEASON_THEMES, 'SEASON_THEMES');
    assertUniqueIds(BOSSES, 'BOSSES');
    assertUniqueIds(SHOP_LISTINGS, 'SHOP_LISTINGS');
  });
});

describe('fish catalog', () => {
  const regular = FISH.filter((f) => !f.seasonTheme);
  const seasonal = FISH.filter((f) => f.seasonTheme);

  it('has >=50 regular species and 16 seasonal species', () => {
    expect(regular.length).toBeGreaterThanOrEqual(50);
    expect(seasonal.length).toBe(16);
  });

  it('has 4 seasonal species per theme', () => {
    const byTheme = new Map<string, number>();
    for (const f of seasonal) byTheme.set(f.seasonTheme!, (byTheme.get(f.seasonTheme!) ?? 0) + 1);
    expect(byTheme.size).toBe(4);
    for (const count of byTheme.values()) expect(count).toBe(4);
  });

  it('every location has >=8 regular species and covers common..legendary', () => {
    for (const loc of LOCATIONS) {
      const species = regular.filter((f) => f.locations.includes(loc.id));
      expect(species.length, `${loc.id} species count`).toBeGreaterThanOrEqual(8);
      const rarities = new Set(species.map((f) => f.rarity));
      for (const r of RARITIES.filter((r) => r !== 'mythic')) {
        expect(rarities.has(r), `${loc.id} missing rarity ${r}`).toBe(true);
      }
    }
  });

  it('lake/sea/deep have a mythic species', () => {
    for (const locId of ['lake', 'sea', 'deep'] as const) {
      const hasMythic = regular.some((f) => f.locations.includes(locId) && f.rarity === 'mythic');
      expect(hasMythic, `${locId} missing mythic species`).toBe(true);
    }
  });

  it('FISH_BY_ID matches FISH', () => {
    for (const f of FISH) expect(FISH_BY_ID[f.id]).toBe(f);
  });

  it('has at least 8 junk items', () => {
    expect(JUNK_ITEMS.length).toBeGreaterThanOrEqual(8);
  });
});

describe('locations', () => {
  it('has 5 locations with unlock levels from BALANCE and junkChance in range', () => {
    expect(LOCATIONS).toHaveLength(5);
    for (const loc of LOCATIONS) {
      expect(loc.unlockLevel).toBe(BALANCE.locationUnlockLevels[loc.id]);
      expect(loc.junkChance).toBeGreaterThanOrEqual(0.05);
      expect(loc.junkChance).toBeLessThanOrEqual(0.1);
      expect(LOCATION_BY_ID[loc.id]).toBe(loc);
    }
  });
});

describe('gear catalog', () => {
  it('has 24 items covering 4 slots x 6 tiers', () => {
    expect(GEAR).toHaveLength(24);
    const slots = new Set(GEAR.map((g) => g.slot));
    const tiers = new Set(GEAR.map((g) => g.tier));
    expect(slots.size).toBe(4);
    expect(tiers.size).toBe(6);
    for (const slot of slots) {
      for (const tier of RARITIES) {
        expect(GEAR.some((g) => g.slot === slot && g.tier === tier), `${slot}/${tier} missing`).toBe(true);
      }
    }
  });

  it('common/uncommon/rare have shopPrice, epic+ do not', () => {
    for (const g of GEAR) {
      if (g.tier === 'common' || g.tier === 'uncommon' || g.tier === 'rare') {
        expect(g.shopPrice, `${g.id} should have shopPrice`).toBeGreaterThan(0);
      } else {
        expect(g.shopPrice, `${g.id} should not have shopPrice`).toBeUndefined();
      }
    }
  });

  it('GEAR_BY_ID matches GEAR', () => {
    for (const g of GEAR) expect(GEAR_BY_ID[g.id]).toBe(g);
  });
});

describe('consumables', () => {
  it('has an energy item and >=5 baits', () => {
    expect(CONSUMABLES.some((c) => c.kind === 'energy')).toBe(true);
    expect(CONSUMABLES.filter((c) => c.kind === 'bait').length).toBeGreaterThanOrEqual(5);
    for (const c of CONSUMABLES) expect(CONSUMABLE_BY_ID[c.id]).toBe(c);
  });
});

describe('cosmetics', () => {
  it('has >=8 titles, >=6 frames, >=6 backgrounds, and season badges', () => {
    expect(COSMETICS.filter((c) => c.type === 'title').length).toBeGreaterThanOrEqual(8);
    expect(COSMETICS.filter((c) => c.type === 'frame').length).toBeGreaterThanOrEqual(6);
    expect(COSMETICS.filter((c) => c.type === 'background').length).toBeGreaterThanOrEqual(6);
    for (const theme of SEASON_THEMES) {
      expect(COSMETIC_BY_ID[`badge-season-${theme.id}`], `badge-season-${theme.id} missing`).toBeDefined();
    }
    expect(COSMETIC_BY_ID['title-boss-slayer']).toBeDefined();
  });

  it('getCosmetic synthesizes season-<n>-top titles', () => {
    expect(getCosmetic('season-3-top')).toMatchObject({ id: 'season-3-top', type: 'title' });
    expect(getCosmetic('title-novice')).toBe(COSMETIC_BY_ID['title-novice']);
    expect(getCosmetic('nonexistent-id')).toBeUndefined();
  });
});

describe('chests', () => {
  it('all loot weights are positive and referenced item ids exist', () => {
    for (const chest of CHESTS) {
      expect(chest.loot.length).toBeGreaterThan(0);
      for (const entry of chest.loot) {
        expect(entry.weight).toBeGreaterThan(0);
        if (entry.kind === 'item') {
          expect(CONSUMABLE_BY_ID[entry.itemId], `chest ${chest.id} references missing item ${entry.itemId}`).toBeDefined();
        }
      }
      expect(CHEST_BY_ID[chest.id]).toBe(chest);
    }
  });

  it('gold chest natural legendary+ chance is roughly 3-5%', () => {
    const gold = CHEST_BY_ID.gold;
    const total = gold.loot.reduce((s, e) => s + e.weight, 0);
    const legendaryPlus = gold.loot.filter((e) => e.rarity === 'legendary' || e.rarity === 'mythic').reduce((s, e) => s + e.weight, 0);
    const share = legendaryPlus / total;
    expect(share).toBeGreaterThanOrEqual(0.02);
    expect(share).toBeLessThanOrEqual(0.06);
  });
});

describe('challenges', () => {
  const daily = CHALLENGE_TEMPLATES.filter((c) => c.scope === 'daily');
  const weekly = CHALLENGE_TEMPLATES.filter((c) => c.scope === 'weekly');
  const seasonal = CHALLENGE_TEMPLATES.filter((c) => c.scope === 'seasonal');

  it('has >=15 daily, >=10 weekly, >=12 seasonal templates', () => {
    expect(daily.length).toBeGreaterThanOrEqual(15);
    expect(weekly.length).toBeGreaterThanOrEqual(10);
    expect(seasonal.length).toBeGreaterThanOrEqual(12);
  });

  it('includes the blackjack daily challenge with coins-only reward', () => {
    const bj = daily.find((c) => c.metric === 'blackjack_hands');
    expect(bj).toBeDefined();
    expect(bj!.target).toEqual([3, 3]);
    expect(bj!.reward.pearls).toBeUndefined();
    expect(bj!.reward.coins).toBeGreaterThan(0);
  });

  it('CHALLENGE_BY_ID matches CHALLENGE_TEMPLATES, and referenced reward ids exist', () => {
    for (const c of CHALLENGE_TEMPLATES) {
      expect(CHALLENGE_BY_ID[c.id]).toBe(c);
      for (const item of c.reward.items ?? []) expect(CONSUMABLE_BY_ID[item.itemId]).toBeDefined();
      for (const gearId of c.reward.gear ?? []) expect(GEAR_BY_ID[gearId]).toBeDefined();
      for (const cosId of c.reward.cosmetics ?? []) expect(getCosmetic(cosId)).toBeDefined();
    }
  });
});

describe('achievements', () => {
  it('has >=8 multi-tier achievements with valid reward references', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(8);
    for (const a of ACHIEVEMENTS) {
      expect(a.tiers.length).toBeGreaterThanOrEqual(2);
      for (const tier of a.tiers) {
        for (const item of tier.reward.items ?? []) expect(CONSUMABLE_BY_ID[item.itemId]).toBeDefined();
        for (const gearId of tier.reward.gear ?? []) expect(GEAR_BY_ID[gearId]).toBeDefined();
        for (const cosId of tier.reward.cosmetics ?? []) expect(getCosmetic(cosId)).toBeDefined();
        if (tier.title) expect(getCosmetic(tier.title)).toBeDefined();
      }
    }
  });
});

describe('season pass', () => {
  it('has 30 levels with valid reward references, and an exclusive level 30 cosmetic', () => {
    expect(PASS_REWARDS).toHaveLength(BALANCE.pass.levels);
    const levels = PASS_REWARDS.map((p) => p.level);
    expect(levels).toEqual(Array.from({ length: BALANCE.pass.levels }, (_, i) => i + 1));
    for (const p of PASS_REWARDS) {
      for (const item of p.reward.items ?? []) expect(CONSUMABLE_BY_ID[item.itemId]).toBeDefined();
      for (const gearId of p.reward.gear ?? []) expect(GEAR_BY_ID[gearId]).toBeDefined();
      for (const cosId of p.reward.cosmetics ?? []) expect(getCosmetic(cosId)).toBeDefined();
    }
    const last = PASS_REWARDS[PASS_REWARDS.length - 1]!;
    expect(last.reward.cosmetics?.length).toBeGreaterThan(0);
  });
});

describe('bosses', () => {
  it('has >=3 bosses, one per lake/sea/deep', () => {
    expect(BOSSES.length).toBeGreaterThanOrEqual(3);
    for (const locId of ['lake', 'sea', 'deep'] as const) {
      expect(BOSSES.some((b) => b.location === locId), `no boss for ${locId}`).toBe(true);
    }
    for (const b of BOSSES) expect(BOSS_BY_ID[b.id]).toBe(b);
  });
});

describe('season themes', () => {
  it('has all 4 themes', () => {
    expect(SEASON_THEMES).toHaveLength(4);
    for (const t of SEASON_THEMES) expect(SEASON_THEME_BY_ID[t.id]).toBe(t);
  });
});

describe('shop listings', () => {
  it('references existing gear/consumable ids and includes cage_upgrade', () => {
    for (const listing of SHOP_LISTINGS) {
      if (listing.kind === 'gear') expect(GEAR_BY_ID[listing.refId!], `missing gear ${listing.refId}`).toBeDefined();
      if (listing.kind === 'consumable') expect(CONSUMABLE_BY_ID[listing.refId!], `missing consumable ${listing.refId}`).toBeDefined();
    }
    expect(SHOP_LISTINGS.some((l) => l.kind === 'cage')).toBe(true);
  });
});
