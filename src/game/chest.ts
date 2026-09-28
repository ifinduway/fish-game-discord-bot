// Pure chest logic (no db / discord): weighted loot roll with pity, loot entry → Reward resolution, odds table.
import { BALANCE } from '../config/balance.js';
import type { Rng } from '../core/rng.js';
import { CONSUMABLE_BY_ID } from '../data/consumables.js';
import { COSMETICS } from '../data/cosmetics.js';
import { GEAR } from '../data/gear.js';
import {
  RARITIES,
  RARITY_INFO,
  rarityAtLeast,
  rarityIndex,
  type ChestDef,
  type ConsumableDef,
  type CosmeticDef,
  type CosmeticType,
  type GearDef,
  type LootEntry,
  type Rarity,
  type Reward,
} from '../data/types.js';

export interface ChestPity {
  opens: number;
  minRarity: Rarity;
}

/** Pity rule of a chest: its own definition, falling back to BALANCE.chests.pity (silver/gold). */
export function chestPity(def: ChestDef): ChestPity | undefined {
  if (def.pity) return def.pity;
  return (BALANCE.chests.pity as Partial<Record<string, ChestPity>>)[def.id];
}

export interface ChestRoll {
  entry: LootEntry;
  /** the roll was restricted to qualifying entries because the pity counter reached its threshold */
  forcedByPity: boolean;
}

/**
 * Rolls one loot entry. `pityCounter` = opens since the last drop with rarity ≥ pity.minRarity.
 * When the counter reaches `opens − 1` this open is the `opens`-th one → roll only among qualifying entries.
 */
export function rollChest(def: ChestDef, pityCounter: number, rng: Rng): ChestRoll {
  const pity = chestPity(def);
  if (pity && pityCounter >= pity.opens - 1) {
    const qualifying = def.loot.filter((e) => e.weight > 0 && rarityAtLeast(e.rarity, pity.minRarity));
    if (qualifying.length > 0) {
      return { entry: rng.weighted(qualifying.map((e) => ({ item: e, weight: e.weight }))), forcedByPity: true };
    }
  }
  return { entry: rng.weighted(def.loot.map((e) => ({ item: e, weight: e.weight }))), forcedByPity: false };
}

/** Pity counter after an open that dropped `rarity` (reset on a qualifying drop). Chests without pity stay at 0. */
export function nextPityCounter(def: ChestDef, counter: number, rarity: Rarity): number {
  const pity = chestPity(def);
  if (!pity) return 0;
  return rarityAtLeast(rarity, pity.minRarity) ? 0 : counter + 1;
}

/** Opens left until the guaranteed drop (the guaranteed open included); undefined for chests without pity. */
export function pityLeft(def: ChestDef, counter: number): number | undefined {
  const pity = chestPity(def);
  if (!pity) return undefined;
  return Math.max(1, pity.opens - counter);
}

export type LootKind = LootEntry['kind'];

export interface ResolvedLoot {
  reward: Reward;
  kind: LootKind;
  rarity: Rarity;
  /** Russian label, e.g. "🔱 Удочка Посейдона" */
  label: string;
  cosmeticType?: CosmeticType;
  /** cosmetic already owned → converted to coins */
  duplicate?: boolean;
}

export interface LootCatalogs {
  gear: readonly GearDef[];
  cosmetics: readonly CosmeticDef[];
  consumables: Readonly<Record<string, ConsumableDef>>;
}

export const DEFAULT_CATALOGS: LootCatalogs = { gear: GEAR, cosmetics: COSMETICS, consumables: CONSUMABLE_BY_ID };

export const COSMETIC_TYPE_NAMES: Record<CosmeticType, { emoji: string; name: string }> = {
  title: { emoji: '🏷️', name: 'Титул' },
  frame: { emoji: '🖼️', name: 'Рамка' },
  background: { emoji: '🌄', name: 'Фон' },
  badge: { emoji: '🎖️', name: 'Значок' },
};

/** Coins used when a gear/cosmetic entry cannot be resolved or the cosmetic is a duplicate (reuses gearDuplicateCoins). */
export function fallbackCoins(tier: Rarity): number {
  return BALANCE.gearDuplicateCoins[tier];
}

function coinsLoot(coins: number, rarity: Rarity, extra: Partial<ResolvedLoot> = {}): ResolvedLoot {
  return { reward: { coins }, kind: 'coins', rarity, label: `🪙 ${coins}`, ...extra };
}

/** Candidates of the exact tier, else the nearest lower tier that has any. */
function byTierWithFallback<T>(all: readonly T[], tier: Rarity, tierOf: (x: T) => Rarity): T[] {
  for (let i = rarityIndex(tier); i >= 0; i--) {
    const r = RARITIES[i]!;
    const found = all.filter((x) => tierOf(x) === r);
    if (found.length > 0) return found;
  }
  return [];
}

/**
 * Turns a loot entry into a concrete Reward.
 * coins → int in [min,max]; item → as is; gear → random GEAR of that tier (any slot, nearest lower tier if none);
 * cosmetic → random unowned COSMETIC of type & tier (nearest lower tier if none; all owned → duplicate coins; nothing → coins).
 */
export function resolveLoot(
  entry: LootEntry,
  rng: Rng,
  ownedCosmetics: ReadonlySet<string> = new Set(),
  catalogs: LootCatalogs = DEFAULT_CATALOGS,
): ResolvedLoot {
  switch (entry.kind) {
    case 'coins':
      return coinsLoot(rng.int(entry.min, entry.max), entry.rarity);
    case 'item': {
      const def = catalogs.consumables[entry.itemId];
      if (!def) return coinsLoot(fallbackCoins(entry.rarity), entry.rarity);
      return {
        reward: { items: [{ itemId: entry.itemId, qty: entry.qty }] },
        kind: 'item',
        rarity: entry.rarity,
        label: `${def.emoji} ${def.name} ×${entry.qty}`,
      };
    }
    case 'gear': {
      const pool = byTierWithFallback(catalogs.gear, entry.tier, (g) => g.tier);
      if (pool.length === 0) return coinsLoot(fallbackCoins(entry.tier), entry.rarity);
      const g = rng.pick(pool);
      return { reward: { gear: [g.id] }, kind: 'gear', rarity: entry.rarity, label: `${g.emoji} ${g.name}` };
    }
    case 'cosmetic': {
      const ofType = catalogs.cosmetics.filter((c) => c.type === entry.cosmeticType);
      const pool = byTierWithFallback(ofType, entry.tier, (c) => c.rarity);
      const meta = COSMETIC_TYPE_NAMES[entry.cosmeticType];
      if (pool.length === 0) return coinsLoot(fallbackCoins(entry.tier), entry.rarity);
      const unowned = pool.filter((c) => !ownedCosmetics.has(c.id));
      if (unowned.length === 0) {
        const c = rng.pick(pool);
        const coins = fallbackCoins(entry.tier);
        return coinsLoot(coins, entry.rarity, {
          label: `${meta.emoji} ${meta.name} «${c.name}» (дубль → 🪙 ${coins})`,
          duplicate: true,
          cosmeticType: entry.cosmeticType,
        });
      }
      const c = rng.pick(unowned);
      return {
        reward: { cosmetics: [c.id] },
        kind: 'cosmetic',
        rarity: entry.rarity,
        label: `${meta.emoji} ${meta.name} «${c.name}»`,
        cosmeticType: entry.cosmeticType,
      };
    }
  }
}

export interface OddsRow {
  entry: LootEntry;
  /** 0..100 (weight / total weight × 100) */
  percent: number;
  label: string;
}

/** Generic, non-random label of a loot entry for /chest info. */
export function lootEntryLabel(entry: LootEntry, consumables: Readonly<Record<string, ConsumableDef>> = CONSUMABLE_BY_ID): string {
  switch (entry.kind) {
    case 'coins':
      return entry.min === entry.max ? `🪙 ${entry.min}` : `🪙 ${entry.min}–${entry.max}`;
    case 'item': {
      const def = consumables[entry.itemId];
      return def ? `${def.emoji} ${def.name} ×${entry.qty}` : `🎁 ${entry.itemId} ×${entry.qty}`;
    }
    case 'gear':
      return `🎣 Снаряжение (${RARITY_INFO[entry.tier].name.toLowerCase()})`;
    case 'cosmetic': {
      const meta = COSMETIC_TYPE_NAMES[entry.cosmeticType];
      return `${meta.emoji} ${meta.name} (${RARITY_INFO[entry.tier].name.toLowerCase()})`;
    }
  }
}

/** Per-entry drop chance in % — exactly the configured weights normalised to 100. */
export function chestOdds(def: ChestDef): OddsRow[] {
  const total = def.loot.reduce((s, e) => s + Math.max(0, e.weight), 0);
  return def.loot.map((entry) => ({
    entry,
    percent: total > 0 ? (Math.max(0, entry.weight) / total) * 100 : 0,
    label: lootEntryLabel(entry),
  }));
}
