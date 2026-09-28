// Gear stat aggregation & upgrades (spec §4). Pure.
import { BALANCE } from '../config/balance.js';
import type { GearDef, GearStats, Rarity } from '../data/types.js';

export type AggregatedStats = Required<GearStats>;

export const STAT_KEYS: (keyof GearStats)[] = [
  'rarityBonus',
  'biteWindowMs',
  'weightBonus',
  'reelTimeMs',
  'reelMistakes',
  'maxWeight',
  'maxEnergy',
  'castCostReduction',
  'energyRegenBonus',
];

export function zeroStats(): AggregatedStats {
  return { rarityBonus: 0, biteWindowMs: 0, weightBonus: 0, reelTimeMs: 0, reelMistakes: 0, maxWeight: 0, maxEnergy: 0, castCostReduction: 0, energyRegenBonus: 0 };
}

/** Stats of one item at an upgrade level: every numeric stat × (1 + statBonusPerLevel × upgrade). */
export function upgradedStats(stats: GearStats, upgrade: number): GearStats {
  const mult = 1 + BALANCE.upgrade.statBonusPerLevel * Math.max(0, upgrade);
  const out: GearStats = {};
  for (const k of STAT_KEYS) {
    const v = stats[k];
    if (typeof v === 'number') out[k] = round4(v * mult);
  }
  return out;
}

/**
 * Sums the (upgraded) stats of equipped items. `maxWeight` falls back to BALANCE.fishing.baseLineMaxWeight
 * when nothing provides it (no line equipped).
 */
export function aggregateStats(items: readonly { def: GearDef; upgrade: number }[]): AggregatedStats {
  const out = zeroStats();
  for (const { def, upgrade } of items) {
    const s = upgradedStats(def.stats, upgrade);
    for (const k of STAT_KEYS) out[k] = round4(out[k] + (s[k] ?? 0));
  }
  if (out.maxWeight <= 0) out.maxWeight = BALANCE.fishing.baseLineMaxWeight;
  return out;
}

/** Allowed extra reel mistakes granted by the line (integer). */
export function lineMistakeBonus(stats: GearStats): number {
  return Math.floor((stats.reelMistakes ?? 0) + 1e-9);
}

/** Cost to go from `level` to `level + 1`, or null at max level. */
export function upgradeCost(tier: Rarity, level: number): number | null {
  if (level >= BALANCE.upgrade.maxLevel) return null;
  return Math.round(BALANCE.upgrade.baseCost[tier] * Math.pow(BALANCE.upgrade.costGrowth, level));
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
